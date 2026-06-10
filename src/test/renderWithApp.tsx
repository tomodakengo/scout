/**
 * Shared harness for component tests: renders UI inside an AppCtx provider
 * backed by an in-memory (fallback-mode) Workspace and a fresh SessionRunner.
 * jsdom-only — test files using this must declare `// @vitest-environment jsdom`.
 */
import type { ReactElement } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { AppCtx, type AppState, type Screen } from '../appContext'
import { Workspace } from '../storage/store'
import { SessionRunner } from '../state/sessionRunner'
import { DEFAULT_CONFIG, type ScoutConfig } from '../types'
import { vi } from 'vitest'

export interface TestAppOptions {
  config?: Partial<ScoutConfig>
  ws?: Workspace
  runner?: SessionRunner
  screen?: Screen
  permission?: AppState['permission']
}

export interface TestApp {
  state: AppState
  navigate: ReturnType<typeof vi.fn>
  updateConfig: ReturnType<typeof vi.fn>
}

export function makeAppState(opts: TestAppOptions = {}): TestApp {
  const navigate = vi.fn()
  const updateConfig = vi.fn(async () => {})
  const config: ScoutConfig = { ...structuredClone(DEFAULT_CONFIG), ...opts.config }
  const state: AppState = {
    // a plain `new Workspace()` is fallback mode: everything in (fake) IndexedDB
    ws: opts.ws ?? new Workspace(),
    config,
    updateConfig,
    lang: config.language,
    screen: opts.screen ?? { name: 'home' },
    navigate,
    runner: opts.runner ?? new SessionRunner(),
    permission: opts.permission ?? 'disconnected',
    reconnectFolder: vi.fn(async () => {}),
    pickFolder: vi.fn(async () => {}),
  }
  return { state, navigate, updateConfig }
}

export function renderWithApp(
  ui: ReactElement,
  opts: TestAppOptions = {},
): RenderResult & { app: TestApp } {
  const app = makeAppState(opts)
  const result = render(<AppCtx.Provider value={app.state}>{ui}</AppCtx.Provider>)
  return Object.assign(result, { app })
}
