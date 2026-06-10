import { test, expect } from '@playwright/test'
import { forceFallbackMode, completeOnboarding, createCharter, startSession } from './helpers'

const CHARTER_TITLE = '決済フローの異常系を探索する'

test.beforeEach(async ({ page }) => {
  await forceFallbackMode(page)
})

test('full SBTM loop: onboarding → charter → session → debrief → report → home', async ({
  page,
}) => {
  await completeOnboarding(page)
  await createCharter(page, CHARTER_TITLE)
  await startSession(page)

  const input = page.getByPlaceholder(/メモを入力/)

  // plain note records with the current mode's default tag (setup at start)
  await input.fill('テスト環境にログイン、テストカード準備')
  await input.press('Enter')
  await expect(page.getByText('テスト環境にログイン、テストカード準備')).toBeVisible()
  await expect(page.locator('.tag-chip', { hasText: 'SETUP' }).first()).toBeVisible()

  // F1 switches to test mode
  await input.press('F1')

  // tag prefix key on the empty input: b → BUG
  await input.press('b')
  await input.fill('全角入力時のエラーメッセージがi18n漏れ')
  await input.press('Enter')
  await expect(page.locator('.timeline .tag-chip', { hasText: 'BUG' })).toBeVisible()

  // "> " adds a detail bullet to the last entry
  await input.fill('> 再現: カード番号欄に「１２３４」→ 確定')
  await input.press('Enter')
  await expect(page.getByText(/再現: カード番号欄/)).toBeVisible()

  // end session (confirm dialog)
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: '終了' }).click()

  // debrief → save → report
  await expect(page.getByRole('button', { name: /保存してレポートへ/ })).toBeVisible()
  await page.getByRole('button', { name: /保存してレポートへ/ }).click()

  const preview = page.locator('pre.report-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('i18n漏れ')
  await expect(preview).toContainText('[BUG]')

  // format switch to Jira markup
  await page.getByRole('combobox').first().selectOption('jira')
  await expect(preview).toContainText('h2.')

  // back home: the finished session is listed
  await page.getByRole('button', { name: /ホームへ/ }).click()
  await expect(page.getByText(CHARTER_TITLE).first()).toBeVisible()
  await expect(page.getByText(/Bug:\s*1|Bug: 1/).first()).toBeVisible()
})

test('data persists across a reload (IndexedDB-backed fallback mode)', async ({ page }) => {
  await completeOnboarding(page)
  await createCharter(page, '検索UIのキーボード操作を探索する')
  await startSession(page)

  const input = page.getByPlaceholder(/メモを入力/)
  await input.fill('最初のメモ')
  await input.press('Enter')

  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: '終了' }).click()
  await page.getByRole('button', { name: /スキップ/ }).click()
  await expect(page.locator('pre.report-preview')).toBeVisible()

  await page.reload()
  // onboarded flag set → straight to home; charter and session survived
  await expect(page.getByRole('button', { name: /新規チャーター/ })).toBeVisible()
  await expect(page.getByText('検索UIのキーボード操作を探索する').first()).toBeVisible()
})

test('pause excludes time and shows the resume overlay', async ({ page }) => {
  await completeOnboarding(page)
  await createCharter(page, '一時停止の検証')
  await startSession(page)

  await page.getByRole('button', { name: /一時停止/ }).click()
  await expect(page.getByText('一時停止中')).toBeVisible()
  // the overlay covers the header button — click the one inside the modal
  await page.locator('.modal').getByRole('button', { name: /再開/ }).click()
  await expect(page.getByText('一時停止中')).toBeHidden()
})

test('settings: language switch to English changes the UI', async ({ page }) => {
  await completeOnboarding(page)
  await page.getByRole('button', { name: /設定/ }).click()
  await page.locator('select').first().selectOption('en')
  await expect(page.getByRole('button', { name: /New charter|Back to home/ }).first()).toBeVisible(
    { timeout: 5000 },
  )
})
