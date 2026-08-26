import { defineConfig } from '@playwright/test'

/**
 * Port comes from $DEEPSPACE_PORT (set by `deepspace test run [--port N]`),
 * defaulting to 5173. The same port is passed to vite via --strictPort so
 * a busy address fails fast rather than silently rebinding to 5174.
 *
 * To run multiple apps in parallel, give each one a different port:
 *   DEEPSPACE_PORT=5180 npx deepspace dev start  (terminal 1, app A)
 *   DEEPSPACE_PORT=5181 npx deepspace dev start  (terminal 2, app B)
 *   DEEPSPACE_PORT=5180 npx deepspace test run   (terminal 3, against A)
 */
const PORT = Number(process.env.DEEPSPACE_PORT ?? 5173)

/**
 * Set DEEPSPACE_BASE_URL to run the suite against a deployed app instead of a
 * local dev server — the only way to verify the production path (and the only
 * place R2 uploads and the real edge are exercised end to end):
 *
 *   DEEPSPACE_BASE_URL=https://hottake.app.space npx playwright test --config tests/playwright.config.ts
 *
 * When it is set, no local server is started.
 */
const REMOTE_URL = process.env.DEEPSPACE_BASE_URL
const BASE_URL = REMOTE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // seed-demo is a data-seeding utility, not a test of behaviour, so it is
  // excluded from the suite. Naming it on the command line is not enough to
  // override testIgnore, so it opts in explicitly:
  //   DEEPSPACE_SEED=1 npx playwright test --config tests/playwright.config.ts tests/seed-demo.spec.ts
  testIgnore: process.env.DEEPSPACE_SEED ? [] : '**/seed-demo.spec.ts',
  globalSetup: './helpers/global-setup.ts',
  timeout: 30_000,
  retries: 0,
  // One worker on purpose. These specs drive a small pool of *shared* live
  // accounts against a real backend, so two workers running different specs
  // as the same user race on that user's profile, swipes and developer-mode
  // fixtures. Parallelism here buys a minute and costs reproducibility.
  workers: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
  },
  webServer: REMOTE_URL
    ? undefined
    : {
        command: `npx vite --port ${PORT} --strictPort --host`,
        cwd: '..',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 30_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
})
