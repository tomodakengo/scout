/**
 * S1 Home screen — charter list, recent sessions, draft recovery.
 * plan.md §1.2
 */
import { useCallback, useEffect, useState } from 'react'
import type { Charter, SessionIndexEntry } from '../types'
import type { DraftShape } from '../state/sessionRunner'
import { useApp } from '../appContext'
import { tx } from '../lib/i18n'
import { nextCharterId } from '../lib/slug'
import { localDateStamp } from '../lib/time'
import { CharterModal } from '../components/CharterModal'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatStarted(iso: string): string {
  // Show as YYYY-MM-DD HH:mm local
  try {
    const d = new Date(iso)
    const yyyy = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const da = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mo}-${da} ${hh}:${mi}`
  } catch {
    return iso
  }
}

function formatCounts(counts: Record<string, number>, lang: 'ja' | 'en'): string {
  const bug = counts['BUG'] ?? 0
  const finding = counts['FINDING'] ?? 0
  const bugLabel = lang === 'ja' ? 'Bug' : 'Bug'
  const findingLabel = lang === 'ja' ? '気づき' : 'Finding'
  return `${bugLabel}:${bug} ${findingLabel}:${finding}`
}

// ---------------------------------------------------------------------------
// Draft recovery banner
// ---------------------------------------------------------------------------

interface DraftBannerProps {
  draftKeys: string[]
  onResume: (key: string) => Promise<void>
  onDiscard: (key: string) => Promise<void>
  lang: 'ja' | 'en'
}

function DraftBanner({ draftKeys, onResume, onDiscard, lang }: DraftBannerProps) {
  if (draftKeys.length === 0) return null
  return (
    <div className="card" style={{ borderColor: 'var(--yellow)', background: '#2a1f00' }}>
      <div style={{ color: 'var(--yellow)', fontWeight: 600, marginBottom: 8 }}>
        ⚠ {tx(lang, {
          ja: '前回のセッションが終了されていません',
          en: 'A previous session was not finished',
        })}
      </div>
      {draftKeys.map((key) => (
        <div key={key} className="row" style={{ marginTop: 4 }}>
          <span className="muted small">{key}</span>
          <span className="spacer" />
          <button
            className="primary"
            onClick={() => void onResume(key)}
          >
            {tx(lang, { ja: '再開', en: 'Resume' })}
          </button>
          <button
            className="danger"
            onClick={() => void onDiscard(key)}
          >
            {tx(lang, { ja: '破棄', en: 'Discard' })}
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Charter row
// ---------------------------------------------------------------------------

interface CharterRowProps {
  charter: Charter
  runCount: number
  onStart: (charter: Charter) => void
  onEdit: (charter: Charter) => void
  startDisabled: boolean
  lang: 'ja' | 'en'
}

function CharterRow({ charter, runCount, onStart, onEdit, startDisabled, lang }: CharterRowProps) {
  const statusLabel =
    runCount === 0
      ? tx(lang, { ja: '未実施', en: 'not run' })
      : tx(lang, { ja: `${runCount}回実施`, en: `run ${runCount} times` })

  const statusColor = runCount === 0 ? 'var(--text-dim)' : 'var(--green)'

  return (
    <div className="list-item">
      <span style={{ flex: 1, fontWeight: 500 }}>{charter.title}</span>
      <span
        className="tag-chip"
        style={{ background: statusColor, color: runCount === 0 ? undefined : '#fff' }}
      >
        {statusLabel}
      </span>
      <button onClick={() => onEdit(charter)}>
        {tx(lang, { ja: '編集', en: 'Edit' })}
      </button>
      <button
        className="primary"
        disabled={startDisabled}
        onClick={() => onStart(charter)}
      >
        ▶ {tx(lang, { ja: '開始', en: 'Start' })}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session row
// ---------------------------------------------------------------------------

interface SessionRowProps {
  entry: SessionIndexEntry
  conflictFiles: string[]
  onOpen: (entry: SessionIndexEntry) => Promise<void>
  lang: 'ja' | 'en'
}

function SessionRow({ entry, conflictFiles, onOpen, lang }: SessionRowProps) {
  return (
    <div style={{ marginTop: 8 }}>
      <div className="list-item">
        <span className="muted small" style={{ flexShrink: 0 }}>
          {formatStarted(entry.started)}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.charterTitle}
        </span>
        <span className="muted small" style={{ flexShrink: 0 }}>
          {entry.durationMinutes}min
        </span>
        <span className="muted small" style={{ flexShrink: 0 }}>
          {formatCounts(entry.counts, lang)}
        </span>
        <button onClick={() => void onOpen(entry)}>
          {tx(lang, { ja: '開く', en: 'Open' })}
        </button>
      </div>
      {conflictFiles.length > 0 && (
        <div
          className="small"
          style={{
            color: 'var(--yellow)',
            marginTop: 4,
            paddingLeft: 12,
          }}
        >
          ⚠ {tx(lang, {
            ja: `コンフリクトコピーが検出されました: ${conflictFiles.join(', ')}`,
            en: `Conflict copy detected: ${conflictFiles.join(', ')}`,
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Home screen
// ---------------------------------------------------------------------------

export function Home() {
  const { ws, config, lang, navigate, runner, permission } = useApp()

  const [charters, setCharters] = useState<Charter[]>([])
  const [index, setIndex] = useState<SessionIndexEntry[]>([])
  const [draftKeys, setDraftKeys] = useState<string[]>([])
  const [conflictMap, setConflictMap] = useState<Record<string, string[]>>({})
  const [showDone, setShowDone] = useState(false)
  const [modalCharter, setModalCharter] = useState<Charter | null>(null)
  const [loading, setLoading] = useState(true)

  // Whether the Start button should be disabled:
  // disabled only when permission !== 'granted' AND ws.mode === 'fs'
  const startDisabled = permission !== 'granted' && ws.mode === 'fs'

  // Load everything on mount
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [cs, idx, draftKs] = await Promise.all([
        ws.listCharters(),
        ws.loadIndex(),
        ws.listDraftKeys(),
      ])
      setCharters(cs)
      setIndex(idx.sessions)
      setDraftKeys(draftKs)

      // Check conflict copies for the 10 most recent sessions
      const recent = idx.sessions.slice(0, 10)
      const conflictEntries = await Promise.all(
        recent.map(async (entry) => {
          const files = await ws.detectConflictCopies(entry.dirName)
          return [entry.dirName, files] as [string, string[]]
        }),
      )
      const cmap: Record<string, string[]> = {}
      for (const [dirName, files] of conflictEntries) {
        if (files.length > 0) cmap[dirName] = files
      }
      setConflictMap(cmap)
    } finally {
      setLoading(false)
    }
  }, [ws])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  // Build run count map from index
  const runCountMap: Record<string, number> = {}
  for (const entry of index) {
    runCountMap[entry.charterId] = (runCountMap[entry.charterId] ?? 0) + 1
  }

  // Filter charters
  const visibleCharters = charters.filter((c) => showDone || c.status !== 'done')
  const doneCount = charters.filter((c) => c.status === 'done').length

  // Open a new charter modal
  const handleNewCharter = useCallback(() => {
    const existingIds = charters.map((c) => c.id)
    const newCharter: Charter = {
      id: nextCharterId(existingIds, new Date().getFullYear()),
      title: '',
      area: '',
      priority: 'medium',
      risks: [],
      timeboxMinutes: config.defaultTimeboxMinutes,
      status: 'active',
      created: localDateStamp(),
      mission: '',
      outOfScope: '',
      slug: 'charter',
    }
    setModalCharter(newCharter)
  }, [charters, config.defaultTimeboxMinutes])

  // Save charter from modal
  const handleSaveCharter = useCallback(
    async (c: Charter) => {
      await ws.saveCharter(c)
      await loadAll()
    },
    [ws, loadAll],
  )

  // Start a session
  const handleStart = useCallback(
    (charter: Charter) => {
      runner.start(charter, config, ws)
      navigate({ name: 'run' })
    },
    [runner, config, ws, navigate],
  )

  // Open a past session
  const handleOpen = useCallback(
    async (entry: SessionIndexEntry) => {
      const session = await ws.loadSession(entry.dirName)
      if (!session) return
      navigate({ name: 'report', session })
    },
    [ws, navigate],
  )

  // Resume a draft
  const handleResume = useCallback(
    async (key: string) => {
      const draft = await ws.loadDraft<DraftShape>(key)
      if (!draft) return
      const allCharters = await ws.listCharters()
      const charter = allCharters.find((c) => c.id === draft.charterId) ?? null
      runner.resumeFromDraft(draft, charter, ws)
      navigate({ name: 'run' })
    },
    [ws, runner, navigate],
  )

  // Discard a draft
  const handleDiscard = useCallback(
    async (key: string) => {
      await ws.deleteDraft(key)
      setDraftKeys((prev) => prev.filter((k) => k !== key))
    },
    [ws],
  )

  // Rebuild index
  const handleRebuildIndex = useCallback(async () => {
    const rebuilt = await ws.rebuildIndex()
    setIndex(rebuilt.sessions)
  }, [ws])

  if (loading) {
    return (
      <div className="screen">
        <p className="muted">{tx(lang, { ja: '読み込み中…', en: 'Loading…' })}</p>
      </div>
    )
  }

  return (
    <div className="screen">
      {/* Draft recovery banner */}
      <DraftBanner
        draftKeys={draftKeys}
        onResume={handleResume}
        onDiscard={handleDiscard}
        lang={lang}
      />

      {/* Charters section */}
      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>
            {tx(lang, { ja: 'チャーター', en: 'Charters' })}
          </h2>
          <span className="spacer" />
          <button className="primary" onClick={handleNewCharter}>
            ＋ {tx(lang, { ja: '新規チャーター', en: 'New charter' })}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {visibleCharters.length === 0 && (
            <p className="muted small">
              {tx(lang, {
                ja: 'チャーターがありません。新規作成してください。',
                en: 'No charters yet. Create one to get started.',
              })}
            </p>
          )}
          {visibleCharters.map((c) => (
            <CharterRow
              key={c.id}
              charter={c}
              runCount={runCountMap[c.id] ?? 0}
              onStart={handleStart}
              onEdit={(ch) => setModalCharter(ch)}
              startDisabled={startDisabled}
              lang={lang}
            />
          ))}
        </div>

        {doneCount > 0 && (
          <button
            style={{ marginTop: 12 }}
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone
              ? tx(lang, { ja: '完了済みを隠す', en: 'Hide done charters' })
              : tx(lang, {
                  ja: `完了済みを表示 (${doneCount}件)`,
                  en: `Show done (${doneCount})`,
                })}
          </button>
        )}
      </div>

      {/* Recent sessions section */}
      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>
            {tx(lang, { ja: '最近のセッション', en: 'Recent sessions' })}
          </h2>
          <span className="spacer" />
          <button
            title={tx(lang, { ja: 'インデックスを再構築', en: 'Rebuild index' })}
            onClick={() => void handleRebuildIndex()}
          >
            ↺ {tx(lang, { ja: '再構築', en: 'Rebuild' })}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {index.length === 0 && (
            <p className="muted small">
              {tx(lang, {
                ja: 'セッションがまだありません。',
                en: 'No sessions yet.',
              })}
            </p>
          )}
          {index.map((entry) => (
            <SessionRow
              key={entry.dirName}
              entry={entry}
              conflictFiles={conflictMap[entry.dirName] ?? []}
              onOpen={handleOpen}
              lang={lang}
            />
          ))}
        </div>
      </div>

      {/* Charter modal */}
      {modalCharter && (
        <CharterModal
          charter={modalCharter}
          onSave={handleSaveCharter}
          onClose={() => setModalCharter(null)}
        />
      )}
    </div>
  )
}
