// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { Report } from './Report'
import { renderWithApp } from '../test/renderWithApp'
import { Workspace } from '../storage/store'
import type { Session } from '../types'
import { saveApiKey } from '../storage/prefs'
import { serializeSession } from '../lib/sessionFile'

// verifyLicense does real Ed25519 verification against built-in public keys,
// which test tokens can't satisfy. Mock at module level (deterministic across
// parallel runs) with the real implementation as the default behavior.
const { mockVerifyLicense } = vi.hoisted(() => ({ mockVerifyLicense: vi.fn() }))
vi.mock('../lib/license', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/license')>()
  mockVerifyLicense.mockImplementation(actual.verifyLicense)
  return { ...actual, verifyLicense: mockVerifyLicense }
})


const SESSION: Session = {
  dirName: '2026-06-10-1430-report-test',
  charterId: '2026-R001',
  charterTitle: 'Report Charter',
  started: '2026-06-10T14:30:00+09:00',
  ended: '2026-06-10T16:00:00+09:00',
  durationMinutes: 90,
  pausedMinutes: 5,
  tester: 'tester-yuden',
  environment: 'stg / Chrome 137',
  tbs: { test: 56, bug_investigation: 25, setup: 9 },
  coveragePercent: 70,
  counts: { bug: 1 },
  entries: [
    {
      atSeconds: 720, // 12:00
      tag: 'BUG',
      text: 'Login fails with fullwidth characters',
      attachments: ['attachments/0001-fullscreen.png'],
      details: ['再現: enter fullwidth chars', '期待: Japanese error message', '実際: English error'],
    },
  ],
  debrief: null,
  schema: 'scout/1',
}

describe('Report screen', () => {
  let ws: Workspace

  beforeEach(async () => {
    ws = new Workspace()
    await ws.writeSessionFile(SESSION.dirName, serializeSession(SESSION))
  })

  afterEach(() => {
    // Clean up localStorage
    saveApiKey('')
  })

  it('preview <pre> contains the report markdown (charter title and MM:SS line)', async () => {
    renderWithApp(<Report session={SESSION} />, { ws })

    // Wait for the pre element to appear
    await waitFor(() => {
      const preEl = document.querySelector('pre.report-preview')
      expect(preEl).toBeInTheDocument()
    })

    const preEl = document.querySelector('pre.report-preview')!
    // Charter title appears in report
    expect(preEl.textContent).toContain('Report Charter')
    // MM:SS format (12:00 for atSeconds=720)
    expect(preEl.textContent).toContain('12:00')
    // markdown heading style
    expect(preEl.textContent).toContain('## ')
  })

  it('switching format to Jira changes preview to h2. syntax', async () => {
    renderWithApp(<Report session={SESSION} />, { ws })

    // Wait for preview to appear
    await waitFor(() => {
      expect(document.querySelector('pre.report-preview')).toBeInTheDocument()
    })

    // Change format to Jira
    const select = screen.getByRole('combobox', { name: /形式|Format/i })
    fireEvent.change(select, { target: { value: 'jira' } })

    await waitFor(() => {
      const preEl = document.querySelector('pre.report-preview')!
      expect(preEl.textContent).toContain('h2. ')
    })
  })

  it('copy button calls clipboard with preview text and shows flash message', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    })

    renderWithApp(<Report session={SESSION} />, { ws })

    await waitFor(() => {
      expect(document.querySelector('pre.report-preview')).toBeInTheDocument()
    })

    const preEl = document.querySelector('pre.report-preview')!
    const expectedText = preEl.textContent ?? ''

    // There are multiple copy buttons (main + per-ticket); get the first one (main copy)
    const copyBtns = screen.getAllByRole('button', { name: /📋.*コピー|Copy/i })
    const copyBtn = copyBtns[0]
    fireEvent.click(copyBtn)

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1)
    })
    expect(writeTextMock).toHaveBeenCalledWith(expectedText)

    // Flash message appears (main copy button text changes to "Copied")
    await waitFor(() => {
      // The main copy button should now say "コピーしました"
      expect(screen.getByText('コピーしました')).toBeInTheDocument()
    })
  })

  it('download button triggers an anchor click', async () => {
    // Stub URL.createObjectURL/revokeObjectURL since jsdom lacks them
    const createObjectURLMock = vi.fn().mockReturnValue('blob:fake-url')
    const revokeObjectURLMock = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURLMock,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURLMock,
      configurable: true,
      writable: true,
    })

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderWithApp(<Report session={SESSION} />, { ws })

    await waitFor(() => {
      expect(document.querySelector('pre.report-preview')).toBeInTheDocument()
    })

    const downloadBtn = screen.getByRole('button', { name: /⬇.*ダウンロード|Download/i })
    fireEvent.click(downloadBtn)

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1)
    })

    clickSpy.mockRestore()
  })

  it('bug-ticket card renders with per-ticket copy button', async () => {
    renderWithApp(<Report session={SESSION} />, { ws })

    // Bug tickets section should appear
    expect(await screen.findByText(/バグチケット|Bug Tickets/)).toBeInTheDocument()

    // Bug entry text should appear
    expect(screen.getByText('Login fails with fullwidth characters')).toBeInTheDocument()

    // Per-ticket copy button
    expect(screen.getByRole('button', { name: /📋.*この1件をコピー|Copy this ticket/ })).toBeInTheDocument()
  })

  it('AI button hidden by default config', async () => {
    renderWithApp(<Report session={SESSION} />, { ws })

    await waitFor(() => {
      expect(document.querySelector('pre.report-preview')).toBeInTheDocument()
    })

    // AI button should NOT be present with default config (provider: 'none', no licenseKey)
    const aiBtn = screen.queryByRole('button', { name: /✨.*AI.*整形|AI Format/i })
    expect(aiBtn).not.toBeInTheDocument()
  })

  it('AI button visible when config has anthropic provider + licenseKey + localStorage API key', async () => {
    saveApiKey('test-api-key-123')

    mockVerifyLicense.mockReturnValue({
      status: 'valid',
      payload: {
        v: 1,
        lid: 'lic-001',
        sub: 'alice@example.com',
        plan: 'pro',
        iat: 1700000000,
        exp: 2000000000,
        kid: 'k1',
      },
    })

    renderWithApp(<Report session={SESSION} />, {
      ws,
      config: {
        ai: { provider: 'anthropic', baseUrl: '' },
        licenseKey: 'valid-license-key',
      },
    })

    await waitFor(() => {
      expect(document.querySelector('pre.report-preview')).toBeInTheDocument()
    })

    // AI button should be present
    expect(screen.getByRole('button', { name: /✨.*AI.*整形|AI Format/i })).toBeInTheDocument()

    mockVerifyLicense.mockReset()
    const actual = await vi.importActual<typeof import('../lib/license')>('../lib/license')
    mockVerifyLicense.mockImplementation(actual.verifyLicense)
  })
})
