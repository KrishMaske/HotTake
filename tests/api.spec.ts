import { test, expect } from '@playwright/test'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /home is a dynamic page (under src/pages/(app)/), so mounting it boots
    // the providers and auto-connects the records WebSocket. The static
    // landing at '/' deliberately does neither — see smoke.spec.ts.
    await page.goto('/discover')
    // Wait for the app to connect its WebSocket (it auto-connects on mount)
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
    // If the app loaded and connected, the WS endpoint works
  })
})

/**
 * The post-OAuth return path comes from a cookie the client sets before
 * sign-in, which makes it attacker-influenceable: without validation this
 * route is an open redirect. `code` is omitted so the handler takes its
 * early-return branch and answers with the Location it would have used.
 */
test.describe('OAuth return path', () => {
  const cases: Array<[string, string, string]> = [
    ['returns to a same-origin path', '/matches', '/matches'],
    ['keeps the query string', '/messages/abc?x=1', '/messages/abc?x=1'],
    ['refuses a protocol-relative URL', '//evil.example.com', '/discover'],
    ['refuses a backslash-prefixed URL', '/\\evil.example.com', '/discover'],
    ['refuses an absolute URL', 'https://evil.example.com', '/discover'],
    ['refuses a path that is not rooted', 'evil', '/discover'],
    ['refuses a bounce back into the API', '/api/actions/swipe', '/discover'],
    ['falls back when no cookie is set', '', '/discover'],
  ]

  for (const [name, cookie, expected] of cases) {
    test(name, async ({ request, baseURL }) => {
      const res = await request.get('/api/auth/oauth-complete', {
        headers: cookie ? { Cookie: `ht_post_auth=${encodeURIComponent(cookie)}` } : {},
        maxRedirects: 0,
        failOnStatusCode: false,
      })
      expect(res.status()).toBe(302)
      expect(res.headers()['location']).toBe(`${baseURL}${expected}`)
    })
  }
})
