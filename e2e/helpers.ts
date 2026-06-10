import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Force fallback mode (no File System Access) so the app never opens a native
 * folder picker; data lives in IndexedDB for the lifetime of the context.
 * Must be called before the first page.goto().
 */
export async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error intentional capability removal
    delete window.showDirectoryPicker
  })
}

/** First-run onboarding → home. */
export async function completeOnboarding(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'はじめる' }).click()
  await expect(page.getByRole('button', { name: /新規チャーター/ })).toBeVisible()
}

/** Create a charter from home and return its title. */
export async function createCharter(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: /新規チャーター/ }).click()
  await page.locator('#cm-title').fill(title)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('#cm-title')).toBeHidden()
  await expect(page.getByText(title).first()).toBeVisible()
}

/** Start the first session and wait for the S2 note input. */
export async function startSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: /開始/ }).first().click()
  await expect(page.getByPlaceholder(/メモを入力/)).toBeVisible()
}
