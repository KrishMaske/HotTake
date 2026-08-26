/**
 * HotTake's important path, driven with two real signed-in accounts:
 *
 *   profile -> discover -> like -> mutual like -> match -> realtime message
 *
 * plus the permission boundaries the product depends on.
 *
 * These run against a live backend, so the data persists between runs. The
 * spec is written to be re-runnable rather than to assume a clean slate: it
 * onboards only when a profile is missing, and likes only when the other
 * person is still in the stack. What it asserts unconditionally is the state
 * that must hold either way — a match exists, messages arrive live, and the
 * denials deny.
 */

import { test, expect } from 'deepspace/testing'
import type { Page } from '@playwright/test'

/** A 1x1 PNG. Enough to exercise the real upload path without shipping a fixture. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * Call a server action from inside the page, using the same token path the
 * app itself uses. Returns the raw envelope so a spec can assert on failure
 * as easily as on success.
 */
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

/**
 * Onboard through the real UI if this account has no (complete) profile yet.
 *
 * Every fixture account picks all three preferences, so mutual-gender
 * compatibility never removes anyone from these specs' stacks — the rule is
 * covered by its own test rather than being entangled with the happy path.
 */
async function ensureProfile(
  page: Page,
  name: string,
  age: string,
  hotTake: string,
  gender: 'woman' | 'man' | 'nonbinary' = 'woman',
) {
  await page.goto('/discover')
  await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 20_000 })

  // Wait on rendered content, not the URL. ProfileGate shows a spinner at
  // /discover while it decides, so the URL says "discover" a beat before the
  // redirect to /onboarding lands — checking it here reads as "already
  // onboarded" and skips the setup entirely.
  const nameField = page.getByTestId('input-name')
  const stack = page.getByTestId('discovery-card').or(page.getByTestId('discovery-empty'))
  await expect(nameField.or(stack).first()).toBeVisible({ timeout: 20_000 })
  if ((await nameField.count()) === 0) return

  await page.getByTestId('input-name').fill(name)
  await page.getByTestId('input-age').fill(age)
  await page.getByTestId('input-hot-take').fill(hotTake)
  await page.getByTestId(`gender-${gender}`).click()
  for (const want of ['woman', 'man', 'nonbinary']) {
    const chip = page.getByTestId(`interest-${want}`)
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click()
  }

  // Upload runs through R2 — the submit button stays disabled until the key
  // comes back, so waiting for it to enable *is* the upload assertion.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: PIXEL_PNG,
  })
  await expect(page.getByTestId('submit-profile')).toBeEnabled({ timeout: 30_000 })

  await page.getByTestId('submit-profile').click()
  await page.waitForURL(/\/discover/, { timeout: 20_000 })
}

/**
 * Like `targetName` if they are still in the stack. Passes on anyone else so
 * the target actually comes up. Returns whether a match modal appeared.
 */
async function likeIfPresent(page: Page, targetName: string): Promise<boolean> {
  await page.goto('/discover')
  await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 20_000 })
  // The stack renders once both queries land; without this the first
  // count() can race the initial sync and read an empty stack as "caught up".
  await expect(
    page.getByTestId('discovery-card').or(page.getByTestId('discovery-empty')),
  ).toBeVisible({ timeout: 20_000 })

  for (let i = 0; i < 12; i++) {
    const card = page.getByTestId('discovery-card')
    if ((await card.count()) === 0) return false

    const heading = await page.getByTestId('card-name').textContent()
    if (heading?.includes(targetName)) {
      await page.getByTestId('like-button').click()
      // Either a match modal appears, or the card advances.
      await page.waitForTimeout(1200)
      return (await page.getByTestId('match-modal').count()) > 0
    }

    await page.getByTestId('pass-button').click()
    await page.waitForTimeout(700)
  }
  return false
}

test.describe('HotTake important path', () => {
  // Two sign-ins, two onboardings with a real upload each, and a walk through
  // the discovery stack — comfortably past Playwright's 30s default.
  test.describe.configure({ timeout: 180_000 })

  test('two users can profile, match, and message in realtime', async ({ users }) => {
    const [alex, maya] = await users(['Alex', 'Maya'])

    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')
    await ensureProfile(maya.page, 'Maya', '22', 'Brunch is just overpriced breakfast.', 'woman')

    // --- discovery + reciprocal matching ------------------------------------
    // Alex likes Maya. Whether this is the first or the second half of the
    // pair depends on prior runs, so both sides like and we assert on the
    // resulting match, not on which click produced it.
    // Alex likes first. On a clean database this creates no match yet.
    await likeIfPresent(alex.page, 'Maya')

    // Park Alex on the matches screen BEFORE Maya reciprocates, and leave it
    // there. Anything that appears below arrives over the records socket.
    await alex.page.goto('/matches')
    await expect(
      alex.page.getByTestId('matches-list').or(alex.page.getByTestId('matches-empty')),
    ).toBeVisible({ timeout: 20_000 })

    await likeIfPresent(maya.page, 'Alex')

    // Alex's page has not been navigated or reloaded since before Maya's like.
    // (On a re-run against an existing match this passes immediately rather
    // than proving the live transition — the messaging assertion below is the
    // one that always exercises realtime.)
    await expect(alex.page.getByTestId('matches-list')).toContainText('Maya', {
      timeout: 20_000,
    })

    await maya.page.goto('/matches')
    await expect(maya.page.getByTestId('matches-list')).toContainText('Alex', {
      timeout: 20_000,
    })

    // --- realtime messaging -------------------------------------------------
    await maya.page.getByTestId('matches-list').getByText('Alex').first().click()
    await expect(maya.page.getByTestId('message-input')).toBeVisible({ timeout: 20_000 })

    await alex.page.getByTestId('matches-list').getByText('Maya').first().click()
    await expect(alex.page.getByTestId('message-input')).toBeVisible({ timeout: 20_000 })

    const line = `your hot take is terrible ${Date.now()}`
    await maya.page.getByTestId('message-input').fill(line)
    await maya.page.getByTestId('message-send').click()

    // Alex's conversation is already open and is never reloaded — the message
    // has to arrive over the records socket.
    await expect(alex.page.getByTestId('message-list')).toContainText(line, {
      timeout: 20_000,
    })
  })

  test('a user cannot swipe on themselves', async ({ users }) => {
    const [alex] = await users(['Alex'])
    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')

    const me = await alex.page.evaluate(async () => {
      const res = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const { token } = (await res.json()) as { token: string }
      return JSON.parse(atob(token.split('.')[1])).sub as string
    })

    const result = await callAction(alex.page, 'swipe', { targetId: me, direction: 'like' })
    expect(result.body.success).toBe(false)
    expect(result.body.error).toContain('cannot swipe on yourself')
  })

  test('profile validation is enforced server-side, not just in the form', async ({ users }) => {
    const [alex] = await users(['Alex'])
    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')

    // The form blocks this, but the form is not the boundary.
    const underage = await callAction(alex.page, 'saveProfile', {
      displayName: 'Alex',
      age: 15,
      hotTake: 'Nope.',
      photoKey: 'whatever',
      gender: 'man',
      interestedIn: ['woman'],
    })
    expect(underage.body.success).toBe(false)
    expect(underage.body.error).toContain('18 or older')

    const longTake = await callAction(alex.page, 'saveProfile', {
      displayName: 'Alex',
      age: 21,
      hotTake: 'x'.repeat(400),
      photoKey: 'whatever',
      gender: 'man',
      interestedIn: ['woman'],
    })
    expect(longTake.body.success).toBe(false)
    expect(longTake.body.error).toContain('140 characters')
  })

  test('a stranger cannot post into a conversation they are not part of', async ({ users }) => {
    const [alex, maya] = await users(['Alex', 'Maya'])
    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')
    await ensureProfile(maya.page, 'Maya', '22', 'Brunch is just overpriced breakfast.', 'woman')

    // A channel id that does not belong to Alex — the action must refuse on
    // the participants check rather than on the id being unguessable.
    const bogus = await callAction(alex.page, 'sendMessage', {
      channelId: 'not-a-real-channel',
      content: 'let me in',
    })
    expect(bogus.body.success).toBe(false)
    expect(bogus.body.error).toContain('No such conversation')
  })

  /**
   * The load-bearing permission test: a real, existing conversation between
   * two other people, and a third signed-in member who is not in it.
   *
   * This is the case client-side hiding would get wrong. Casey has a valid
   * session and the real channel id, so nothing about the UI is protecting
   * anything here — only `read: 'collaborator'` on `matches`/`messages` and
   * the participants check inside `sendMessage`.
   */
  test('a third member cannot reach a conversation between two others', async ({ users }) => {
    const [alex, maya, casey] = await users(['Alex', 'Maya', 'Casey'])

    await ensureProfile(alex.page, 'Alex', '21', 'Iced coffee is better in winter.', 'man')
    await ensureProfile(maya.page, 'Maya', '22', 'Brunch is just overpriced breakfast.', 'woman')
    await ensureProfile(casey.page, 'Casey', '23', 'Pineapple belongs on pizza.', 'nonbinary')

    await likeIfPresent(alex.page, 'Maya')
    await likeIfPresent(maya.page, 'Alex')

    // Lift the real channel id out of Maya's own matches list.
    await maya.page.goto('/matches')
    await expect(maya.page.getByTestId('matches-list')).toContainText('Alex', { timeout: 20_000 })
    await maya.page.getByTestId('matches-list').getByText('Alex').first().click()
    await maya.page.waitForURL(/\/messages\/.+/, { timeout: 20_000 })
    const channelId = maya.page.url().split('/messages/')[1]
    expect(channelId).toBeTruthy()

    // 1. Reading: the match row is never delivered to Casey, so the app can
    //    only conclude the conversation does not exist for them.
    await casey.page.goto(`/messages/${channelId}`)
    await expect(casey.page.getByText('Conversation not found')).toBeVisible({ timeout: 20_000 })

    // 2. Writing: a direct call to the action with the real channel id.
    const intrusion = await callAction(casey.page, 'sendMessage', {
      channelId,
      content: 'I heard you two were arguing',
    })
    expect(intrusion.body.success).toBe(false)
    expect(intrusion.body.error).toContain('not in this conversation')

    // 3. And nothing Casey did leaked into the real conversation.
    await expect(maya.page.getByTestId('message-list')).not.toContainText(
      'I heard you two were arguing',
    )
  })

  test('actions reject unauthenticated callers', async ({ page }) => {
    // No session at all: the action route must 401 before any handler runs.
    const res = await page.request.post('/api/actions/swipe', {
      data: { targetId: 'someone', direction: 'like' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(401)
  })
})
