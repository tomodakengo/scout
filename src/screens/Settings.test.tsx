// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from './Settings'
import { renderWithApp } from '../test/renderWithApp'
import { loadApiKey } from '../storage/prefs'
import { DEFAULT_TAGS, type ScoutConfig, type TagDef } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: Partial<ScoutConfig> = {
  language: 'en',
  tester: 'alice',
  environment: 'stg',
  ai: { provider: 'none', baseUrl: '' },
  licenseKey: '',
  tags: DEFAULT_TAGS,
  defaultTimeboxMinutes: 90,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Settings screen', () => {
  beforeEach(() => {
    // Clear localStorage between tests so API key / prefs don't leak
    localStorage.clear()
  })

  // ---- onboarding banner and get-started button ----

  it('renders get-started button in onboarding mode', () => {
    const { app } = renderWithApp(<Settings onboarding />, { config: BASE_CONFIG })
    expect(screen.getByRole('heading', { name: /welcome to scout/i })).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /get started/i })
    expect(btn).toBeInTheDocument()
    btn.click()
    expect(app.navigate).toHaveBeenCalledWith({ name: 'home' })
  })

  it('does NOT show onboarding banner without onboarding prop', () => {
    renderWithApp(<Settings />, { config: BASE_CONFIG })
    expect(screen.queryByRole('heading', { name: /welcome to scout/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /get started/i })).not.toBeInTheDocument()
  })

  // ---- back button navigates home (non-onboarding mode) ----

  it('back button calls navigate({ name: home })', async () => {
    const user = userEvent.setup()
    const { app } = renderWithApp(<Settings />, { config: BASE_CONFIG })
    await user.click(screen.getByRole('button', { name: /back to home/i }))
    expect(app.navigate).toHaveBeenCalledWith({ name: 'home' })
  })

  // ---- tester input persists on blur ----

  it('tester input persists via updateConfig on blur', async () => {
    const user = userEvent.setup()
    const { app } = renderWithApp(<Settings />, { config: { ...BASE_CONFIG, tester: '' } })

    const testerInput = screen.getByPlaceholderText(/your-name/i)
    await user.clear(testerInput)
    await user.type(testerInput, 'bob')
    await user.tab() // trigger blur

    await waitFor(() => expect(app.updateConfig).toHaveBeenCalled())
    const saved = app.updateConfig.mock.calls.at(-1)?.[0] as ScoutConfig
    expect(saved.tester).toBe('bob')
  })

  // ---- environment input persists on blur ----

  it('environment input persists via updateConfig on blur', async () => {
    const user = userEvent.setup()
    const { app } = renderWithApp(<Settings />, { config: { ...BASE_CONFIG, environment: '' } })

    const envInput = screen.getByPlaceholderText(/stg \/ Chrome/i)
    await user.clear(envInput)
    await user.type(envInput, 'prod / Firefox')
    await user.tab()

    await waitFor(() => expect(app.updateConfig).toHaveBeenCalled())
    const saved = app.updateConfig.mock.calls.at(-1)?.[0] as ScoutConfig
    expect(saved.environment).toBe('prod / Firefox')
  })

  // ---- language select persists on change ----

  it('language select persists immediately on change', async () => {
    const user = userEvent.setup()
    const { app } = renderWithApp(<Settings />, { config: { ...BASE_CONFIG, language: 'en' } })

    // Find the language select — it contains "日本語" and "English" options
    const langSelect = screen.getAllByRole('combobox').find((el) => {
      return (el as HTMLSelectElement).value === 'en'
    })
    expect(langSelect).toBeDefined()

    await user.selectOptions(langSelect!, 'ja')

    await waitFor(() => expect(app.updateConfig).toHaveBeenCalled())
    const saved = app.updateConfig.mock.calls.at(-1)?.[0] as ScoutConfig
    expect(saved.language).toBe('ja')
  })

  // ---- tag table shows config.tags rows ----

  it('tag table shows one row per config tag', () => {
    const tags: TagDef[] = [
      { name: 'BUG', key: 'b', color: '#e5484d', labelJa: 'バグ', labelEn: 'Bug' },
      { name: 'NOTE', key: 'n', color: '#7d8590', labelJa: 'ノート', labelEn: 'Note' },
    ]
    renderWithApp(<Settings />, { config: { ...BASE_CONFIG, tags } })

    // Each row has an input with the tag name value
    const nameInputs = screen.getAllByPlaceholderText('BUG') as HTMLInputElement[]
    expect(nameInputs.length).toBe(2)
    expect(nameInputs[0].value).toBe('BUG')
    expect(nameInputs[1].value).toBe('NOTE')
  })

  // ---- duplicate single-char key shows validation error, does NOT call updateConfig ----

  it('adding a duplicate key shows validation error and does not call updateConfig', async () => {
    const user = userEvent.setup()
    const tags: TagDef[] = [
      { name: 'BUG', key: 'b', color: '#e5484d', labelJa: 'バグ', labelEn: 'Bug' },
      { name: 'NOTE', key: 'n', color: '#7d8590', labelJa: 'ノート', labelEn: 'Note' },
    ]
    const { app } = renderWithApp(<Settings />, { config: { ...BASE_CONFIG, tags } })

    // Find the key inputs (placeholder "b")
    const keyInputs = screen.getAllByPlaceholderText('b') as HTMLInputElement[]
    // Change the second tag's key to 'b' (duplicate of first)
    await user.clear(keyInputs[1])
    await user.type(keyInputs[1], 'b')

    // Validation errors should appear (both rows get flagged)
    await waitFor(() => {
      expect(screen.getAllByText(/duplicate key/i).length).toBeGreaterThan(0)
    })

    // updateConfig should NOT have been called with the invalid state
    const invalidCalls = app.updateConfig.mock.calls.filter((call) => {
      const cfg = call[0] as ScoutConfig
      const keys = cfg.tags.map((t) => t.key)
      return keys.filter((k) => k === 'b').length > 1
    })
    expect(invalidCalls).toHaveLength(0)
  })

  // ---- deleting a tag row persists ----

  it('deleting a tag row calls updateConfig without that tag', async () => {
    const user = userEvent.setup()
    const tags: TagDef[] = [
      { name: 'BUG', key: 'b', color: '#e5484d', labelJa: 'バグ', labelEn: 'Bug' },
      { name: 'NOTE', key: 'n', color: '#7d8590', labelJa: 'ノート', labelEn: 'Note' },
    ]
    const { app } = renderWithApp(<Settings />, { config: { ...BASE_CONFIG, tags } })

    // Click Del on the first row
    const delButtons = screen.getAllByRole('button', { name: /del/i })
    await user.click(delButtons[0])

    await waitFor(() => expect(app.updateConfig).toHaveBeenCalled())
    const saved = app.updateConfig.mock.calls.at(-1)?.[0] as ScoutConfig
    expect(saved.tags.find((t) => t.name === 'BUG')).toBeUndefined()
    expect(saved.tags.find((t) => t.name === 'NOTE')).toBeDefined()
  })

  // ---- API key writes through to localStorage via saveApiKey ----

  it('API key input writes to localStorage via saveApiKey', async () => {
    const user = userEvent.setup()
    renderWithApp(<Settings />, {
      config: { ...BASE_CONFIG, ai: { provider: 'openai', baseUrl: '' } },
    })

    const apiKeyInput = screen.getByPlaceholderText(/sk-\.\.\./i)
    await user.type(apiKeyInput, 'sk-test-key')

    expect(loadApiKey()).toBe('sk-test-key')
  })

  // ---- provider select persists ----

  it('provider select persists immediately on change', async () => {
    const user = userEvent.setup()
    const { app } = renderWithApp(<Settings />, {
      config: { ...BASE_CONFIG, ai: { provider: 'none', baseUrl: '' } },
    })

    // Find the provider select — it's the combobox containing 'none'
    const providerSelect = screen.getAllByRole('combobox').find((el) => {
      const sel = el as HTMLSelectElement
      return Array.from(sel.options).some((o) => o.value === 'openai')
    })
    expect(providerSelect).toBeDefined()

    await user.selectOptions(providerSelect!, 'anthropic')

    await waitFor(() => expect(app.updateConfig).toHaveBeenCalled())
    const saved = app.updateConfig.mock.calls.at(-1)?.[0] as ScoutConfig
    expect(saved.ai.provider).toBe('anthropic')
  })

  // ---- license key input persists on blur ----

  it('license key input persists via updateConfig on blur', async () => {
    const user = userEvent.setup()
    const { app } = renderWithApp(<Settings />, { config: { ...BASE_CONFIG, licenseKey: '' } })

    const licenseInput = screen.getByPlaceholderText(/SCOUT-XXXX/i)
    await user.clear(licenseInput)
    await user.type(licenseInput, 'SCOUT-1234-ABCD-EFGH')
    await user.tab()

    await waitFor(() => expect(app.updateConfig).toHaveBeenCalled())
    const saved = app.updateConfig.mock.calls.at(-1)?.[0] as ScoutConfig
    expect(saved.licenseKey).toBe('SCOUT-1234-ABCD-EFGH')
  })
})
