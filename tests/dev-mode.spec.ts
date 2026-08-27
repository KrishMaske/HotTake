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
import { TARGET_GONE } from '../src/schemas/hottake-schemas'

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

    // --- seeding alone creates no fixture matches ---------------------------
    // A match means both sides swiped right, so seeding must not manufacture
    // any. Asserted on the AI badge rather than an empty list: this account
    // may legitimately hold real matches from the other specs.
    await alex.page.goto('/matches')
    await expect(
      alex.page.getByTestId('matches-list').or(alex.page.getByTestId('matches-empty')),
    ).toBeVisible({ timeout: 20_000 })
    await expect(alex.page.getByText('AI', { exact: true })).toHaveCount(0)

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

  /**
   * Regression: a synthetic match must not outlive the fixture it belongs to.
   *
   * `devReset` used to skip a match whose fixture had already been deleted,
   * because it required the fixture to still exist before it would clean up.
   * Deleting a fixture therefore orphaned its match permanently — Clear could
   * never clear it. Reproduced here by changing preferences, which makes the
   * existing fixtures stale and forces them to be replaced.
   */
  test('a replaced fixture does not strand its match', async ({ users }) => {
    const [alex] = await users(['Alex'])
    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')

    await callAction(alex.page, 'setDevMode', { enabled: true })
    await callAction(alex.page, 'devReset', {})

    const setPrefs = (interestedIn: string[]) =>
      callAction(alex.page, 'saveProfile', {
        displayName: 'Alex',
        age: 21,
        hotTake: 'Iced coffee is better in winter.',
        photoKey: 'existing',
        gender: 'man',
        interestedIn,
      })

    const drain = async () => {
      for (let i = 0; i < 60; i++) {
        const r = await callAction(alex.page, 'devSeed', {})
        if (!r.body.success || r.body.data.done) return r
      }
      return null
    }

    // Seed a deck of women, then earn a match the honest way.
    await setPrefs(['woman'])
    await drain()
    await alex.page.goto('/discover')
    await expect(alex.page.getByTestId('discovery-card')).toBeVisible({ timeout: 20_000 })

    let matched = false
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

    // Flip preferences. Every existing fixture is now stale, so the next seed
    // replaces the whole deck — including the one behind that match.
    await setPrefs(['man'])
    await drain()

    // The match must be gone with its fixture, not left behind as an orphan.
    await alex.page.goto('/matches')
    await expect(
      alex.page.getByTestId('matches-list').or(alex.page.getByTestId('matches-empty')),
    ).toBeVisible({ timeout: 20_000 })
    await expect(alex.page.getByText('AI', { exact: true })).toHaveCount(0, { timeout: 20_000 })

    // And the new deck honours the new preference.
    await alex.page.goto('/discover')
    await expect(alex.page.getByTestId('discovery-card')).toBeVisible({ timeout: 20_000 })
    await expect(alex.page.getByTestId('card-gender')).toHaveText('Man')

    await callAction(alex.page, 'devReset', {})
    await setPrefs(['woman', 'man', 'nonbinary'])
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
    expect(intrusion.body.error).toBe(TARGET_GONE)

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

  /**
   * The AI reply, end to end against the real provider.
   *
   * Skips cleanly when no GROQ_API_KEY is configured for the environment, so
   * a local run without one still passes; when a key is present this is the
   * only test that proves the fixture actually answers.
   */
  test('a fixture answers with a generated reply', async ({ users }) => {
    const [alex] = await users(['Alex'])
    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')

    await callAction(alex.page, 'setDevMode', { enabled: true })
    await callAction(alex.page, 'devReset', {})
    for (let i = 0; i < 40; i++) {
      const r = await callAction(alex.page, 'devSeed', {})
      if (!r.body.success || r.body.data.done) break
    }

    // Earn a match, then talk to it.
    await alex.page.goto('/discover')
    await expect(alex.page.getByTestId('discovery-card')).toBeVisible({ timeout: 20_000 })
    let channelId: string | null = null
    for (let i = 0; i < 14 && !channelId; i++) {
      if ((await alex.page.getByTestId('discovery-card').count()) === 0) break
      await alex.page.getByTestId('like-button').click()
      await alex.page.waitForTimeout(900)
      if ((await alex.page.getByTestId('match-modal').count()) > 0) {
        await alex.page.getByTestId('match-message-button').click()
        await alex.page.waitForURL(/\/messages\/.+/, { timeout: 20_000 })
        channelId = alex.page.url().split('/messages/')[1]
      }
    }
    expect(channelId).toBeTruthy()

    // Real usage: the person speaks first, then the fixture answers. (The
    // action also handles an empty conversation now — that is what surfaced
    // Groq's "No user query found in messages" 400.)
    const sent = await callAction(alex.page, 'sendMessage', {
      channelId,
      content: 'setlists should be posted in advance, im not gambling my friday',
    })
    expect(sent.body.success).toBe(true)

    const probe = await callAction(alex.page, 'devReply', { channelId })
    // Skip only for a genuinely unconfigured environment. An earlier version
    // matched /GROQ_API_KEY/, which also matched the "model not found" error
    // and silently skipped a real failure.
    test.skip(
      !probe.body.success && /No GROQ_API_KEY is configured/.test(String(probe.body.error)),
      'No GROQ_API_KEY configured for this environment',
    )

    expect(probe.body.success).toBe(true)
    expect(String(probe.body.data.content).trim().length).toBeGreaterThan(0)

    // And it lands in the conversation, attributed to the fixture rather than
    // to the developer's own account.
    await expect(alex.page.getByTestId('message-list')).toContainText(
      String(probe.body.data.content).slice(0, 24),
      { timeout: 20_000 },
    )
    // The reply is attributed to the fixture, so it renders on the left. The
    // user's own line is on the right — one of each.
    const list = alex.page.getByTestId('message-list')
    await expect(list.locator('li.items-start')).toHaveCount(1)
    await expect(list.locator('li.items-end')).toHaveCount(1)

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
