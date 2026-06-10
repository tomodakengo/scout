import { test, expect } from '@playwright/test'
import { forceFallbackMode, completeOnboarding, createCharter, startSession } from './helpers'

/**
 * Screenshot flow: getDisplayMedia is auto-granted via the launch flags in
 * playwright.config.ts. Headless environments may still refuse screen
 * capture — in that case the test is skipped rather than failed.
 */
test('F9 screenshot → annotation modal → attachment on the timeline', async ({ page }) => {
  await forceFallbackMode(page)
  await completeOnboarding(page)
  await createCharter(page, 'スクリーンショットの検証')
  await startSession(page)

  const input = page.getByPlaceholder(/メモを入力/)
  await input.fill('スクショ対象のメモ')
  await input.press('Enter')

  await page.getByRole('button', { name: /画面共有を開始/ }).click()

  // capture either became active (button shows F9) or the environment refused
  const f9Button = page.getByRole('button', { name: /📷/ }).filter({ hasText: 'F9' })
  const started = await f9Button
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  test.skip(!started, 'getDisplayMedia unavailable in this environment')

  await page.keyboard.press('F9')

  // annotation modal: draw one rectangle, then save
  await expect(page.getByRole('button', { name: /矩形/ })).toBeVisible()
  const canvas = page.locator('canvas').last()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 30, box.y + 30)
  await page.mouse.down()
  await page.mouse.move(box.x + 150, box.y + 110)
  await page.mouse.up()
  await page.getByRole('button', { name: '保存', exact: true }).click()

  // annotated attachment shows as a thumbnail under the last entry
  await expect(page.locator('img.timeline-thumb')).toBeVisible()
})
