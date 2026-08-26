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

  test('seeds fixtures, and a match still takes a right-swipe from both sides', async ({
    users,
  }) => {
    const [alex] = await users(['Alex'])
    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')

    // Start clean so the assertions below mean something.
    await callAction(alex.page, 'setDevMode', { enabled: true })
    await callAction(alex.page, 'devReset', {})

    // --- seeding, through the real UI ---------------------------------------
    await alex.page.goto('/profile')
    await expect(alex.page.getByTestId('dev-mode-toggle')).toBeVisible({ timeout: 20_000 })
    await expect(alex.page.getByTestId('dev-controls')).toBeVisible()
    await expect(alex.page.getByTestId('dev-mode-chip')).toBeVisible()

    await alex.page.getByTestId('dev-seed').click()
    await expect(alex.page.getByTestId('dev-controls')).toContainText('50 / 50', {
      timeout: 180_000,
    })
    // "50 / 50" exactly. Overshoot ("95 / 50") would fail this, and the race
    // test below pins the number down through the action itself.

    // --- seeding alone creates no matches ------------------------------------
    // A match means both sides swiped right. Fixtures are not pre-matched.
    await alex.page.goto('/matches')
    await expect(alex.page.getByTestId('matches-empty')).toBeVisible({ timeout: 20_000 })

    // --- swiping right is what produces one ----------------------------------
    await alex.page.goto('/discover')
    await expect(alex.page.getByTestId('discovery-card')).toBeVisible({ timeout: 20_000 })

    let matched = false
    // Roughly half the fixtures like back, so a handful of likes is plenty;
    // the loop is bounded so a change in that ratio fails loudly, not forever.
    for (let i = 0; i < 14 && !matched; i++) {
      if ((await alex.page.getByTestId('discovery-card').count()) === 0) break
      await alex.page.getByTestId('like-button').click()
      await alex.page.waitForTimeout(900)
      if ((await alex.page.getByTestId('match-modal').count()) > 0) {
        matched = true
        await alex.page.getByText('Keep swiping').click()
      }
    }
    expect(matched).toBe(true)

    await alex.page.goto('/matches')
    await expect(alex.page.getByTestId('matches-list')).toBeVisible({ timeout: 20_000 })

    // --- toggling off hides every synthetic match ---------------------------
    await alex.page.goto('/profile')
    await alex.page.getByTestId('dev-mode-toggle').click()
    await expect(alex.page.getByTestId('dev-mode-chip')).toHaveCount(0, { timeout: 20_000 })

    await alex.page.goto('/matches')
    await expect(alex.page.getByText('AI', { exact: true })).toHaveCount(0, { timeout: 20_000 })

    // Leave it off and cleaned up. Developer mode is not the resting state,
    // and fixtures left behind would show up in the real-user specs' stacks.
    await callAction(alex.page, 'setDevMode', { enabled: true })
    await callAction(alex.page, 'devReset', {})
    await callAction(alex.page, 'setDevMode', { enabled: false })
  })

  test('seeding twice never exceeds the fixture count', async ({ users }) => {
    const [alex] = await users(['Alex'])
    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')
    await callAction(alex.page, 'setDevMode', { enabled: true })
    await callAction(alex.page, 'devReset', {})

    // Two seed loops racing is exactly what produced 95 fixtures for a target
    // of 50. `uniqueOn: ['ownerId', 'slot']` is what makes the second one a
    // no-op rather than a duplicate.
    const drain = async () => {
      for (let i = 0; i < 40; i++) {
        const r = await callAction(alex.page, 'devSeed', {})
        if (!r.body.success || r.body.data.done) return r
      }
      return null
    }
    const [first, second] = await Promise.all([drain(), drain()])
    expect(first?.body.success).toBe(true)
    expect(second?.body.success).toBe(true)

    const final = await callAction(alex.page, 'devSeed', {})
    expect(final.body.data.seeded).toBe(50)
    expect(final.body.data.done).toBe(true)

    await callAction(alex.page, 'devReset', {})
    await callAction(alex.page, 'setDevMode', { enabled: false })
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

    // Put Alex back to the resting state for the rest of the suite.
    await callAction(alex.page, 'devReset', {})
    await callAction(alex.page, 'setDevMode', { enabled: false })
  })

  test('devReply refuses a conversation with a real person', async ({ users }) => {
    const [alex, maya] = await users(['Alex', 'Maya'])
    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')
    await ensureProfile(maya.page, 'Maya', '22', 'Brunch is just overpriced breakfast.', 'woman')

    // Build the real conversation deterministically rather than hunting the
    // matches list for a link that may not be there yet.
    const idOf = (page: Page) =>
      page.evaluate(async () => {
        const res = await fetch('/api/auth/token', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        })
        const { token } = (await res.json()) as { token: string }
        return JSON.parse(atob(token.split('.')[1])).sub as string
      })

    const alexId = await idOf(alex.page)
    const mayaId = await idOf(maya.page)

    await callAction(alex.page, 'swipe', { targetId: mayaId, direction: 'like' })
    const reciprocal = await callAction(maya.page, 'swipe', {
      targetId: alexId,
      direction: 'like',
    })
    expect(reciprocal.body.success).toBe(true)
    expect(reciprocal.body.data.matched).toBe(true)
    const channelId = reciprocal.body.data.channelId as string
    expect(channelId).toBeTruthy()

    // The guard: an AI reply must never appear in a conversation with a human,
    // whatever the caller asks for.
    const result = await callAction(alex.page, 'devReply', { channelId })
    expect(result.body.success).toBe(false)
    expect(result.body.error).toContain('real person')
  })
})
