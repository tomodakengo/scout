// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CharterModal } from './CharterModal'
import { AppCtx, type AppState } from '../appContext'
import { Workspace } from '../storage/store'
import { SessionRunner } from '../state/sessionRunner'
import { DEFAULT_CONFIG, type Charter } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCharter(overrides: Partial<Charter> = {}): Charter {
  return {
    id: '2026-0001',
    title: '',
    area: '',
    priority: 'medium',
    risks: [],
    timeboxMinutes: 90,
    status: 'active',
    created: '2026-06-10',
    mission: '',
    outOfScope: '',
    slug: 'charter', // default placeholder — same shape Home builds
    ...overrides,
  }
}

function renderModal(
  charter: Charter,
  onSave: (c: Charter) => Promise<void>,
  onClose: () => void,
  langOverride: 'ja' | 'en' = 'en',
) {
  const state: AppState = {
    ws: new Workspace(),
    config: { ...DEFAULT_CONFIG, language: langOverride },
    updateConfig: vi.fn(async () => {}),
    lang: langOverride,
    screen: { name: 'home' },
    navigate: vi.fn(),
    runner: new SessionRunner(),
    permission: 'disconnected',
    reconnectFolder: vi.fn(async () => {}),
    pickFolder: vi.fn(async () => {}),
  }
  return render(
    <AppCtx.Provider value={state}>
      <CharterModal charter={charter} onSave={onSave} onClose={onClose} />
    </AppCtx.Provider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CharterModal', () => {
  let onSave: ReturnType<typeof vi.fn>
  let onClose: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSave = vi.fn(async () => {})
    onClose = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  // ---- title required validation ----

  it('blocks save and shows error when title is empty', async () => {
    const user = userEvent.setup()
    renderModal(makeCharter(), onSave, onClose)

    // Title input is empty; click Save
    const saveBtn = screen.getByRole('button', { name: /save/i })
    await user.click(saveBtn)

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/title is required/i)).toBeInTheDocument()
  })

  it('save button is not disabled by default (validation fires on click)', () => {
    renderModal(makeCharter(), onSave, onClose)
    const saveBtn = screen.getByRole('button', { name: /save/i })
    expect(saveBtn).not.toBeDisabled()
  })

  it('error clears once title is typed', async () => {
    const user = userEvent.setup()
    renderModal(makeCharter(), onSave, onClose)

    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(screen.getByText(/title is required/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/title/i), 'My title')
    expect(screen.queryByText(/title is required/i)).not.toBeInTheDocument()
  })

  // ---- filling fields and saving calls onSave correctly ----

  it('calls onSave with correct Charter when all fields are filled', async () => {
    const user = userEvent.setup()
    renderModal(makeCharter(), onSave, onClose)

    await user.type(screen.getByLabelText(/title/i), 'Explore payment error paths')
    await user.clear(screen.getByLabelText(/area/i))
    await user.type(screen.getByLabelText(/area/i), 'checkout/payment')

    // Risks — one per line
    const risksTA = screen.getByLabelText(/risks/i)
    await user.clear(risksTA)
    await user.type(risksTA, 'i18n gaps{Enter}double payment')

    // Timebox — use fireEvent.change for number inputs (userEvent has quirks with type="number")
    const timeboxInput = screen.getByLabelText(/timebox/i)
    fireEvent.change(timeboxInput, { target: { value: '60' } })

    // Save
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))

    const saved = onSave.mock.calls[0][0] as Charter
    expect(saved.title).toBe('Explore payment error paths')
    expect(saved.area).toBe('checkout/payment')
    expect(saved.risks).toEqual(['i18n gaps', 'double payment'])
    // slug is recomputed from title when original slug === 'charter'
    expect(saved.slug).toBe('explore-payment-error-paths')
    expect(saved.timeboxMinutes).toBe(60)
  })

  // ---- existing charter with non-default slug keeps its slug ----

  it('preserves non-default slug after editing title', async () => {
    const user = userEvent.setup()
    const existing = makeCharter({
      title: 'Old title',
      slug: 'payment-error-paths', // not 'charter' — should be preserved
    })
    renderModal(existing, onSave, onClose)

    const titleInput = screen.getByLabelText(/title/i)
    await user.clear(titleInput)
    await user.type(titleInput, 'Completely new title')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const saved = onSave.mock.calls[0][0] as Charter
    expect(saved.slug).toBe('payment-error-paths')
    expect(saved.title).toBe('Completely new title')
  })

  // ---- Escape key calls onClose ----

  it('calls onClose when Escape is pressed', async () => {
    renderModal(makeCharter(), onSave, onClose)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // ---- priority select round-trip ----

  it('priority select round-trips correctly', async () => {
    const user = userEvent.setup()
    renderModal(makeCharter({ title: 'T', priority: 'medium' }), onSave, onClose)

    const prioritySelect = screen.getByLabelText(/priority/i)
    await user.selectOptions(prioritySelect, 'high')

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect((onSave.mock.calls[0][0] as Charter).priority).toBe('high')
  })

  it('status select round-trips correctly', async () => {
    const user = userEvent.setup()
    renderModal(makeCharter({ title: 'T', status: 'active' }), onSave, onClose)

    const statusSelect = screen.getByLabelText(/status/i)
    await user.selectOptions(statusSelect, 'done')

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect((onSave.mock.calls[0][0] as Charter).status).toBe('done')
  })

  // ---- cancel button calls onClose ----

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup()
    renderModal(makeCharter(), onSave, onClose)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // ---- shows "New charter" heading for slug === 'charter' ----

  it('shows New charter heading when slug is the default placeholder', () => {
    renderModal(makeCharter(), onSave, onClose)
    expect(screen.getByRole('heading', { name: /new charter/i })).toBeInTheDocument()
  })

  it('shows Edit charter heading when slug is non-default', () => {
    renderModal(makeCharter({ slug: 'existing-slug', title: 'Existing' }), onSave, onClose)
    expect(screen.getByRole('heading', { name: /edit charter/i })).toBeInTheDocument()
  })

  // ---- risks parsed correctly: blank lines are filtered out ----

  it('filters blank risk lines when saving', async () => {
    const user = userEvent.setup()
    renderModal(makeCharter(), onSave, onClose)

    await user.type(screen.getByLabelText(/title/i), 'T')
    const risksTA = screen.getByLabelText(/risks/i)
    await user.clear(risksTA)
    // Two real risks with blank lines in between
    await user.type(risksTA, 'risk one{Enter}{Enter}risk two{Enter}')

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect((onSave.mock.calls[0][0] as Charter).risks).toEqual(['risk one', 'risk two'])
  })
})
