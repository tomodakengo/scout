// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { Home } from './Home'
import { renderWithApp } from '../test/renderWithApp'
import { Workspace } from '../storage/store'
import { SessionRunner } from '../state/sessionRunner'
import type { Charter, SessionIndexEntry } from '../types'
import type { DraftShape } from '../state/sessionRunner'

// Unique IDs per describe block to avoid cross-test contamination
const CHARTER: Charter = {
  id: '2026-T001',
  title: 'Explore payment error paths',
  area: 'checkout',
  priority: 'high',
  risks: ['i18n gaps'],
  timeboxMinutes: 90,
  status: 'active',
  created: '2026-06-10',
  mission: 'Find edge cases in payment flow',
  outOfScope: '3DS provider',
  slug: 'payment-errors',
}

const INDEX_ENTRY: SessionIndexEntry = {
  dirName: '2026-06-10-1430-payment-errors',
  charterId: '2026-T001',
  charterTitle: 'Explore payment error paths',
  started: '2026-06-10T14:30:00+09:00',
  durationMinutes: 90,
  counts: { bug: 2, finding: 1 },
}

describe('Home screen', () => {
  let ws: Workspace
  let runner: SessionRunner

  beforeEach(() => {
    ws = new Workspace()
    runner = new SessionRunner()
  })

  it('renders charter title with run-count chip', async () => {
    await ws.saveCharter(CHARTER)
    await ws.upsertIndexEntry(INDEX_ENTRY)

    renderWithApp(<Home />, { ws, runner })

    // Charter title appears (may appear multiple times in charter + session row)
    expect(await screen.findAllByText('Explore payment error paths')).not.toHaveLength(0)
    // run-count chip appears (run 1 time; DEFAULT_CONFIG language is 'ja' → "1回実施")
    expect(await screen.findByText(/1回実施/)).toBeInTheDocument()
  })

  it('Start button calls runner.start and navigate({name:"run"})', async () => {
    await ws.saveCharter(CHARTER)

    const startSpy = vi.spyOn(runner, 'start').mockImplementation(() => {})
    const { app } = renderWithApp(<Home />, { ws, runner, permission: 'granted' })

    // Wait for charter to appear
    const startBtn = await screen.findByRole('button', { name: /開始|Start/ })
    fireEvent.click(startBtn)

    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ id: CHARTER.id }), expect.anything(), ws)
    expect(app.navigate).toHaveBeenCalledWith({ name: 'run' })
  })

  it('recent session row renders with counts', async () => {
    await ws.upsertIndexEntry(INDEX_ENTRY)
    // Also need the charter in the index for session row to show
    renderWithApp(<Home />, { ws, runner })

    // Session row shows bug and finding counts
    const countText = await screen.findByText(/Bug:2/)
    expect(countText).toBeInTheDocument()
  })

  it('new-charter button opens the modal', async () => {
    renderWithApp(<Home />, { ws, runner })

    // Wait for loading to finish
    await screen.findByText(/新規チャーター|New charter/, { selector: 'button' })
    const newBtn = screen.getByRole('button', { name: /＋.*新規チャーター|New charter/ })
    fireEvent.click(newBtn)

    // Modal appears - look for the dialog
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('draft banner appears when a draft is seeded, and discard removes it', async () => {
    const dirName = '2026-06-10-1000-draft-session'
    const draft: DraftShape = {
      dirName,
      charterId: '2026-T001',
      charterTitle: 'Explore payment error paths',
      started: '2026-06-10T10:00:00+09:00',
      elapsedSeconds: 300,
      pausedSeconds: 0,
      timeboxMinutes: 90,
      mode: 'test',
      modeSeconds: { test: 300, bug_investigation: 0, setup: 0 },
      entries: [],
      attachmentCounter: 0,
      tester: 'tester',
      environment: 'stg',
    }

    await ws.saveDraft(dirName, draft)
    renderWithApp(<Home />, { ws, runner })

    // Banner should appear with the draft key
    expect(await screen.findByText(dirName)).toBeInTheDocument()
    // Warning text should appear
    expect(await screen.findByText(/前回のセッション|previous session/i)).toBeInTheDocument()

    // Click discard (破棄)
    const discardBtn = screen.getByRole('button', { name: /破棄|Discard/ })
    fireEvent.click(discardBtn)

    // After discard, the draft key should disappear from view
    // (The component filters it out of draftKeys state)
    await waitFor(() => {
      expect(screen.queryByText(dirName)).not.toBeInTheDocument()
    })
  })
})
