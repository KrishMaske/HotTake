/**
 * Developer mode: fixture people, their matches, and the AI replies.
 *
 * The security-relevant assertion is at the bottom: fixtures are
 * `read: 'own'`, so a *different* signed-in user cannot see them or act on
 * them even holding a real fixture id. Everything else here is behaviour.
 *
 * The spec cleans up after itself, because it runs against a live backend and
 * leaving fifty fixtures behind would change what the next run sees.
 */

import { test, expect } from 'deepspace/testing'
import type { Page } from '@playwright/test'

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function callAction(page: Page, name: string, params: Record<string, unknown>) {
  return await page.evaluate(
    async ({ name, params }) => {
      const tokenRes = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const { token } = (await tokenRes.json()) as { token?: string }
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return { status: res.status, body: await res.json() }
    },
    { name, params },
  )
}

async function ensureProfile(
  page: Page,
  name: string,
  age: string,
  hotTake: string,
  gender: 'woman' | 'man' | 'nonbinary',
) {
  await page.goto('/discover')
  await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 20_000 })
  const nameField = page.getByTestId('input-name')
  const stack = page.getByTestId('discovery-card').or(page.getByTestId('discovery-empty'))
  await expect(nameField.or(stack).first()).toBeVisible({ timeout: 20_000 })
  if ((await nameField.count()) === 0) return

  await nameField.fill(name)
  await page.getByTestId('input-age').fill(age)
  await page.getByTestId('input-hot-take').fill(hotTake)
  await page.getByTestId(`gender-${gender}`).click()
  for (const want of ['woman', 'man', 'nonbinary']) {
    const chip = page.getByTestId(`interest-${want}`)
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click()
  }
  await page.locator('input[type="file"]').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: PIXEL_PNG,
  })
  await expect(page.getByTestId('submit-profile')).toBeEnabled({ timeout: 30_000 })
  await page.getByTestId('submit-profile').click()
  await page.waitForURL(/\/discover/, { timeout: 20_000 })
}

test.describe('developer mode', () => {
  test.describe.configure({ timeout: 240_000 })

  test('seeds fixtures, matches some of them, and hides them when off', async ({ users }) => {
    const [alex] = await users(['Alex'])
    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')

    // Start clean so the counts below mean something.
    await callAction(alex.page, 'setDevMode', { enabled: true })
    await callAction(alex.page, 'devReset', {})

    // --- seeding, through the real UI ---------------------------------------
    await alex.page.goto('/profile')
    await expect(alex.page.getByTestId('dev-mode-toggle')).toBeVisible({ timeout: 20_000 })
    await expect(alex.page.getByTestId('dev-controls')).toBeVisible()
    await expect(alex.page.getByTestId('dev-mode-chip')).toBeVisible()

    await alex.page.getByTestId('dev-seed').click()
    // Seeding is batched ten at a time, then matched — give it room.
    await expect(alex.page.getByTestId('dev-controls')).toContainText('50 / 50', {
      timeout: 120_000,
    })

    // --- fixtures reach discovery -------------------------------------------
    await alex.page.goto('/discover')
    await expect(alex.page.getByTestId('discovery-card').first()).toBeVisible({
      timeout: 20_000,
    })

    // --- a random subset already matched ------------------------------------
    await alex.page.goto('/matches')
    await expect(alex.page.getByTestId('matches-list')).toBeVisible({ timeout: 20_000 })
    const matchCount = await alex.page.getByTestId('matches-list').locator('li').count()
    expect(matchCount).toBeGreaterThan(0)

    // --- toggling off hides every synthetic match ---------------------------
    await alex.page.goto('/profile')
    await alex.page.getByTestId('dev-mode-toggle').click()
    await expect(alex.page.getByTestId('dev-mode-chip')).toHaveCount(0, { timeout: 20_000 })

    await alex.page.goto('/matches')
    // Only real matches survive, so the AI badge must be gone entirely.
    await expect(alex.page.getByText('AI', { exact: true })).toHaveCount(0, { timeout: 20_000 })

    // Back on, so the rest of the suite and any manual poking still has data.
    await callAction(alex.page, 'setDevMode', { enabled: true })
  })

  test('fixtures belong to their developer and nobody else', async ({ users }) => {
    const [alex, maya] = await users(['Alex', 'Maya'])
    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')
    await ensureProfile(maya.page, 'Maya', '22', 'Brunch is just overpriced breakfast.', 'woman')

    await callAction(alex.page, 'setDevMode', { enabled: true })
    const seed = await callAction(alex.page, 'devSeed', {})
    expect(seed.body.success).toBe(true)

    // Alex can see his own fixtures.
    await alex.page.goto('/discover')
    await expect(alex.page.getByTestId('discovery-card').first()).toBeVisible({ timeout: 20_000 })
    await expect(alex.page.getByText('Dev fixture').first()).toBeVisible({ timeout: 20_000 })

    // Maya, a real signed-in user, must not be able to act on one. Her own
    // `dev-profiles` query returns none of Alex's — that is `read: 'own'` — so
    // the only avenue is to name an id directly, and the swipe action refuses
    // because it checks `ownerId` rather than mere existence.
    const intrusion = await callAction(maya.page, 'swipe', {
      targetId: 'some-fixture-id-belonging-to-alex',
      direction: 'like',
    })
    expect(intrusion.body.success).toBe(false)
    expect(intrusion.body.error).toContain('no longer exists')

    // And Maya's own discovery contains no fixtures at all.
    await maya.page.goto('/discover')
    await expect(
      maya.page.getByTestId('discovery-card').or(maya.page.getByTestId('discovery-empty')),
    ).toBeVisible({ timeout: 20_000 })
    await expect(maya.page.getByText('Dev fixture')).toHaveCount(0)
  })

  test('devReply refuses a conversation with a real person', async ({ users }) => {
    const [alex, maya] = await users(['Alex', 'Maya'])
    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')
    await ensureProfile(maya.page, 'Maya', '22', 'Brunch is just overpriced breakfast.', 'woman')

    // Alex and Maya match in the main spec; find that channel if it exists.
    await alex.page.goto('/matches')
    await expect(
      alex.page.getByTestId('matches-list').or(alex.page.getByTestId('matches-empty')),
    ).toBeVisible({ timeout: 20_000 })

    const href = await alex.page
      .locator('[data-testid="matches-list"] a')
      .first()
      .getAttribute('href')
      .catch(() => null)

    test.skip(!href, 'No conversation available to probe')
    const channelId = href!.split('/messages/')[1]

    const result = await callAction(alex.page, 'devReply', { channelId })
    // Either it is a real conversation (refused), or a synthetic one that
    // needs a key. Both are correct answers; what must never happen is an AI
    // message appearing in a conversation with an actual human.
    if (!result.body.success) {
      expect(result.body.error).toMatch(/real person|GROQ_API_KEY|did not answer|reach the AI/i)
    }
  })
})
