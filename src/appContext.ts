/** App-level context shared by all screens. */
import { createContext, useContext } from 'react'
import type { Session, ScoutConfig } from './types'
import type { Workspace, PermissionState } from './storage/store'
import type { SessionRunner } from './state/sessionRunner'
import type { Lang } from './lib/i18n'

export type Screen =
  | { name: 'home' }
  | { name: 'run' }
  | { name: 'debrief'; session: Session }
  | { name: 'report'; session: Session }
  | { name: 'settings'; onboarding?: boolean }

export interface AppState {
  ws: Workspace
  /** effective config (shared config.yaml merged over local prefs) */
  config: ScoutConfig
  /** persist to localStorage and, when connected, .scout/config.yaml */
  updateConfig: (config: ScoutConfig) => Promise<void>
  lang: Lang
  screen: Screen
  navigate: (screen: Screen) => void
  runner: SessionRunner
  /** folder connection status shown in the header (plan.md §1.2) */
  permission: PermissionState
  /** re-check / re-request folder permission (user gesture) */
  reconnectFolder: () => Promise<void>
  /** pick a (new) root folder */
  pickFolder: () => Promise<void>
}

export const AppCtx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('AppCtx missing')
  return ctx
}
