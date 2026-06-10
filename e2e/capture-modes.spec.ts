/**
 * Regression suite for S2 capture + mode hardening.
 * Graduates the probe findings from exploratory.spec.ts into hard assertions.
 */
import { test, expect } from '@playwright/test'
import { forceFallbackMode, fakeDisplayMedia, completeOnboarding, createCharter, startSession } from './helpers'

test.beforeEach(async ({ page }) => {
  await forceFallbackMode(page)
  await fakeDisplayMedia(page)
  await completeOnboarding(page)
  await createCharter(page, 'キャプチャ・モード回帰')
  await startSession(page)
})

test('a. F9 without active share shows not-active toast', async ({ page }) => {
  // No share started — press F9 directly
  await page.keyboard.press('F9')
  const toast = page.locator('div.toast[role="status"]')
  await expect(toast).toBeVisible()
  await expect(toast).toHaveText(/画面共有が開始されていません/)
})

test('b. F9 while paused shows paused toast and does NOT open annotation modal', async ({ page }) => {
  await page.getByRole('button', { name: /画面共有を開始/ }).click()
  await expect(page.getByRole('button', { name: /📷/ }).filter({ hasText: 'F9' })).toBeVisible()

  // Pause the session
  await page.getByRole('button', { name: /一時停止/ }).click()
  await expect(page.getByText('一時停止中')).toBeVisible()

  await page.keyboard.press('F9')

  const toast = page.locator('div.toast[role="status"]')
  await expect(toast).toBeVisible()
  await expect(toast).toHaveText(/一時停止中はスクリーンショットを撮れません/)

  // annotation modal must NOT appear
  await expect(page.getByRole('button', { name: /矩形/ })).not.toBeVisible()
})

test('c. external share end → restart button reappears AND ended toast shown', async ({ page }) => {
  await page.getByRole('button', { name: /画面共有を開始/ }).click()
  await expect(page.getByRole('button', { name: /📷/ }).filter({ hasText: 'F9' })).toBeVisible()

  // Simulate browser "Stop sharing" bar
  await page.evaluate(() => {
    const s = (window as unknown as { __fakeStream: MediaStream }).__fakeStream
    const track = s.getVideoTracks()[0]
    track.stop()
    track.dispatchEvent(new Event('ended'))
  })

  // Restart button should reappear
  await expect(page.getByRole('button', { name: /画面共有を開始/ })).toBeVisible()

  // Ended toast should appear
  const toast = page.locator('div.toast[role="status"]')
  await expect(toast).toBeVisible()
  await expect(toast).toHaveText(/画面共有が終了しました/)
})

test('d. F2 while annotation modal is open does NOT change the active mode', async ({ page }) => {
  // Switch to テスト mode (F1)
  await page.keyboard.press('F1')
  await expect(page.locator('.mode-switch button.active')).toHaveText(/テスト/)

  // Start share then open annotation modal
  await page.getByRole('button', { name: /画面共有を開始/ }).click()
  await expect(page.getByRole('button', { name: /📷/ }).filter({ hasText: 'F9' })).toBeVisible()

  await page.keyboard.press('F9')
  await expect(page.getByRole('button', { name: /矩形/ })).toBeVisible()

  // Press F2 while modal is open — should be ignored
  await page.keyboard.press('F2')

  // Cancel the modal
  await page.keyboard.press('Escape')

  // Mode must still be テスト
  await expect(page.locator('.mode-switch button.active')).toHaveText(/テスト/)
})

test('e. recording a BUG entry in test mode shows F2 hint toast', async ({ page }) => {
  // Ensure テスト mode
  await page.keyboard.press('F1')

  const input = page.getByPlaceholder(/メモを入力/)

  // Press 'b' on empty input to select BUG tag
  await input.focus()
  await input.press('b')
  // Type the bug description and submit
  await input.fill('再現手順: 〇〇をクリックするとクラッシュ')
  await input.press('Enter')

  const toast = page.locator('div.toast[role="status"]')
  await expect(toast).toBeVisible()
  await expect(toast).toHaveText(/バグ調査に入るなら F2 でモード切替/)
})

test('f. live TBS bar appears after ~1.5s in a mode', async ({ page }) => {
  // Activate a mode so time starts accumulating
  await page.keyboard.press('F1')

  // Wait long enough for at least 1 second of mode time to register
  await page.waitForTimeout(1500)

  // span.live-tbs containing .tbs-bar should be visible in the mode row
  const liveTbs = page.locator('span.live-tbs')
  await expect(liveTbs).toBeVisible()
  await expect(liveTbs.locator('.tbs-bar')).toBeVisible()
})
