import { test, expect } from '@playwright/test'
import { forceFallbackMode, fakeDisplayMedia, completeOnboarding, createCharter, startSession } from './helpers'

test.beforeEach(async ({ page }) => {
  await forceFallbackMode(page)
  await fakeDisplayMedia(page)
  await completeOnboarding(page)
  await createCharter(page, 'スクリーンショットの検証')
  await startSession(page)
})

test('F9 screenshot → annotation modal → draw rect → 保存 → thumbnail visible', async ({ page }) => {
  const input = page.getByPlaceholder(/メモを入力/)
  await input.fill('スクショ対象のメモ')
  await input.press('Enter')

  await page.getByRole('button', { name: /画面共有を開始/ }).click()
  await expect(page.getByRole('button', { name: /📷/ }).filter({ hasText: 'F9' })).toBeVisible()

  await page.keyboard.press('F9')

  // annotation modal appears
  await expect(page.getByRole('button', { name: /矩形/ })).toBeVisible()
  const canvas = page.locator('canvas').last()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 30, box.y + 30)
  await page.mouse.down()
  await page.mouse.move(box.x + 150, box.y + 110)
  await page.mouse.up()
  await page.getByRole('button', { name: '保存', exact: true }).click()

  // annotated attachment shows as a thumbnail under the entry
  await expect(page.locator('img.timeline-thumb')).toBeVisible()
})

test('F9 → annotation modal → Escape (cancel) → original screenshot still recorded', async ({ page }) => {
  const input = page.getByPlaceholder(/メモを入力/)
  await input.fill('キャンセルテスト')
  await input.press('Enter')

  await page.getByRole('button', { name: /画面共有を開始/ }).click()
  await expect(page.getByRole('button', { name: /📷/ }).filter({ hasText: 'F9' })).toBeVisible()

  await page.keyboard.press('F9')

  // annotation modal appears — cancel without drawing
  await expect(page.getByRole('button', { name: /矩形/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // cancel records the fullscreen original, so thumbnail must still appear
  await expect(page.locator('img.timeline-thumb')).toBeVisible()
})
