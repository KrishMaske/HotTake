/**
 * Seeds the three demo accounts so a first-time visitor has someone to swipe
 * on. Not part of the suite `deepspace test run` executes by default — run it
 * deliberately, and point it at whichever environment needs seeding:
 *
 *   DEEPSPACE_BASE_URL=https://hottake.app.space \
 *     npx playwright test --config tests/playwright.config.ts tests/seed-demo.spec.ts
 *
 * It drives the real profile editor rather than writing records directly, so
 * it exercises the same upload + validation path a user would.
 */

import { test, expect } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { gradientPng } from './helpers/gradient-png'

interface DemoProfile {
  account: string
  name: string
  age: string
  hotTake: string
  gender: 'woman' | 'man' | 'nonbinary'
  from: [number, number, number]
  to: [number, number, number]
}

const DEMO: DemoProfile[] = [
  {
    account: 'Alex',
    name: 'Alex',
    age: '21',
    hotTake: 'Iced coffee is better in winter.',
    gender: 'man',
    from: [255, 90, 60],
    to: [120, 24, 74],
  },
  {
    account: 'Maya',
    name: 'Maya',
    age: '22',
    hotTake: 'Brunch is just overpriced breakfast.',
    gender: 'woman',
    from: [56, 132, 255],
    to: [22, 30, 96],
  },
  {
    account: 'Casey',
    name: 'Casey',
    age: '23',
    hotTake: 'Pineapple belongs on pizza and this is not brave.',
    gender: 'nonbinary',
    from: [255, 176, 46],
    to: [140, 32, 40],
  },
]

/** Fill the profile editor and save, whether it's onboarding or an edit. */
async function writeProfile(page: Page, profile: DemoProfile) {
  await page.goto('/profile')
  await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 20_000 })

  const nameField = page.getByTestId('input-name')
  const editButton = page.getByTestId('edit-profile')
  await expect(nameField.or(editButton).first()).toBeVisible({ timeout: 20_000 })

  // An onboarded account lands on the read-only profile view; open the editor.
  if ((await editButton.count()) > 0) await editButton.click()
  await expect(nameField).toBeVisible({ timeout: 20_000 })

  await nameField.fill(profile.name)
  await page.getByTestId('input-age').fill(profile.age)
  await page.getByTestId('input-hot-take').fill(profile.hotTake)
  await page.getByTestId(`gender-${profile.gender}`).click()
  for (const want of ['woman', 'man', 'nonbinary']) {
    const chip = page.getByTestId(`interest-${want}`)
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click()
  }

  await page.locator('input[type="file"]').setInputFiles({
    name: `${profile.name.toLowerCase()}.png`,
    mimeType: 'image/png',
    buffer: gradientPng({ from: profile.from, to: profile.to }),
  })

  // The button unlocks only once the upload returns a key.
  await expect(page.getByTestId('submit-profile')).toBeEnabled({ timeout: 40_000 })
  await page.getByTestId('submit-profile').click()
  await expect(page.getByTestId('profile-photo')).toBeVisible({ timeout: 30_000 })
}

test('seed demo profiles', async ({ users }) => {
  test.setTimeout(300_000)
  const accounts = await users(DEMO.map((d) => d.account))

  for (const [index, profile] of DEMO.entries()) {
    await writeProfile(accounts[index].page, profile)
  }
})
