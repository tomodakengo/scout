import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScoutConfig } from './types'
import { Workspace, type PermissionState } from './storage/store'
import { loadPrefs, savePrefs } from './storage/prefs'
import { SessionRunner } from './state/sessionRunner'
import { AppCtx, useApp, type AppState, type Screen } from './appContext'
import { tx } from './lib/i18n'
import { supportsFsAccess } from './storage/fs'
import { Home } from './screens/Home'
import { SessionRun } from './screens/SessionRun'
import { Debrief } from './screens/Debrief'
import { Report } from './screens/Report'
import { Settings } from './screens/Settings'

const ONBOARDED_KEY = 'scout.onboarded.v1'

export function App() {
  const [ws, setWs] = useState<Workspace | null>(null)
  const [config, setConfig] = useState<ScoutConfig>(() => loadPrefs())
  const [screen, setScreen] = useState<Screen>(() =>
    localStorage.getItem(ONBOARDED_KEY) ? { name: 'home' } : { name: 'settings', onboarding: true },
  )
  const [permission, setPermission] = useState<PermissionState>('disconnected')
  const runnerRef = useRef<SessionRunner>()
  if (!runnerRef.current) runnerRef.current = new SessionRunner()
  const runner = runnerRef.current

  // boot: restore folder handle, merge shared config when readable
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const restored = await Workspace.restore()
      if (cancelled) return
      setWs(restored)
      const perm = await restored.permissionState()
      if (cancelled) return
      setPermission(perm)
      if (perm === 'granted') {
        const merged = await restored.loadSharedConfig(loadPrefs())
        if (!cancelled) setConfig(merged)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // permission can lapse while the tab is hidden — re-check on focus
  useEffect(() => {
    if (!ws) return
    const check = () => void ws.permissionState().then(setPermission)
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [ws])

  const navigate = useCallback((s: Screen) => {
    if (s.name === 'home' || s.name === 'run') localStorage.setItem(ONBOARDED_KEY, '1')
    setScreen(s)
  }, [])

  const updateConfig = useCallback(
    async (c: ScoutConfig) => {
      setConfig(c)
      savePrefs(c)
      if (ws && (await ws.permissionState()) === 'granted') {
        try {
          await ws.saveSharedConfig(c)
        } catch {
          // folder write failed — prefs are still saved locally
        }
      }
    },
    [ws],
  )

  const reconnectFolder = useCallback(async () => {
    if (!ws) return
    const ok = await ws.requestPermission()
    setPermission(ok ? 'granted' : await ws.permissionState())
    if (ok) setConfig(await ws.loadSharedConfig(loadPrefs()))
  }, [ws])

  const pickFolder = useCallback(async () => {
    if (!ws) return
    const picked = await ws.pickFolder()
    if (picked) {
      setPermission('granted')
      const merged = await ws.loadSharedConfig(loadPrefs())
      setConfig(merged)
      savePrefs(merged)
      await ws.saveSharedConfig(merged)
    }
  }, [ws])

  const lang = config.language

  const state = useMemo<AppState | null>(
    () =>
      ws
        ? {
            ws,
            config,
            updateConfig,
            lang,
            screen,
            navigate,
            runner,
            permission,
            reconnectFolder,
            pickFolder,
          }
        : null,
    [ws, config, updateConfig, lang, screen, navigate, runner, permission, reconnectFolder, pickFolder],
  )

  if (!state || !ws) {
    return <div className="screen muted">loading…</div>
  }

  return (
    <AppCtx.Provider value={state}>
      {screen.name !== 'run' && <Header />}
      {screen.name !== 'run' && <FolderBar />}
      {screen.name === 'home' && <Home />}
      {screen.name === 'run' && <SessionRun />}
      {screen.name === 'debrief' && <Debrief session={screen.session} />}
      {screen.name === 'report' && <Report session={screen.session} />}
      {screen.name === 'settings' && <Settings onboarding={screen.onboarding} />}
    </AppCtx.Provider>
  )
}

function Header() {
  const { lang, navigate, screen } = useApp()
  return (
    <header className="app-header">
      <span className="brand" style={{ cursor: 'pointer' }} onClick={() => navigate({ name: 'home' })}>
        scout
      </span>
      <span className="muted small">{tx(lang, { ja: '探索的テストセッションレコーダー', en: 'Exploratory testing session recorder' })}</span>
      <span className="spacer" />
      {screen.name !== 'settings' && (
        <button onClick={() => navigate({ name: 'settings' })}>
          ⚙ {tx(lang, { ja: '設定', en: 'Settings' })}
        </button>
      )}
    </header>
  )
}

/** Folder connection status — always visible right under the header (plan.md §1.2). */
function FolderBar() {
  const { ws, lang, permission, reconnectFolder, pickFolder } = useApp()
  const supported = supportsFsAccess()

  if (!supported) {
    return (
      <div className="folder-bar">
        <span className="dot gray" />
        {tx(lang, {
          ja: 'このブラウザはフォルダ保存に未対応のため、データはブラウザ内に保存されます（zipエクスポート可）',
          en: 'This browser does not support folder access; data is stored in the browser (zip export available)',
        })}
      </div>
    )
  }
  if (permission === 'disconnected') {
    return (
      <div className="folder-bar warn">
        <span className="dot red" />
        {tx(lang, { ja: '保存先フォルダが未設定です', en: 'No save folder selected' })}
        <button onClick={() => void pickFolder()}>
          {tx(lang, { ja: 'フォルダを選択', en: 'Choose folder' })}
        </button>
      </div>
    )
  }
  if (permission === 'prompt') {
    return (
      <div className="folder-bar warn">
        <span className="dot red" />
        {tx(lang, {
          ja: `フォルダ「${ws.rootName}」へのアクセス許可が切れています`,
          en: `Permission for folder “${ws.rootName}” has lapsed`,
        })}
        <button className="primary" onClick={() => void reconnectFolder()}>
          {tx(lang, { ja: '再許可', en: 'Re-authorize' })}
        </button>
      </div>
    )
  }
  return (
    <div className="folder-bar">
      <span className="dot green" />
      {tx(lang, { ja: '保存先', en: 'Save folder' })}: {ws.rootName}
      <button onClick={() => void pickFolder()}>{tx(lang, { ja: '変更', en: 'Change' })}</button>
    </div>
  )
}
