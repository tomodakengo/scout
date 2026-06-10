/**
 * S2 — session execution (plan.md §1.3). Keyboard-first:
 *   - empty input + tag key (b/i/q/n/p…) → tag prefix mode
 *   - F1-F3 mode toggle (TBS metrics), F9 screenshot, Enter records
 *   - "> text" appends a detail bullet (repro/expected/actual) to the last entry
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useApp } from '../appContext'
import { tx } from '../lib/i18n'
import { formatClock } from '../lib/time'
import { ScreenCapture } from '../lib/capture'
import { AnnotationModal } from '../components/AnnotationModal'
import type { SessionMode, TagDef } from '../types'

const MODE_ORDER: SessionMode[] = ['test', 'bug_investigation', 'setup']
const MODE_DEFAULT_TAG: Record<SessionMode, string> = {
  test: 'TEST',
  bug_investigation: 'NOTE',
  setup: 'SETUP',
}

export function SessionRun() {
  const { ws, config, lang, runner, navigate } = useApp()
  const snap = useSyncExternalStore(runner.subscribe, runner.getSnapshot)
  const [input, setInput] = useState('')
  const [pendingTag, setPendingTag] = useState<string | null>(null)
  const [captureActive, setCaptureActive] = useState(false)
  const [annotating, setAnnotating] = useState<{ blob: Blob; serial: string } | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const thumbUrlsRef = useRef<string[]>([])
  const [ending, setEnding] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<ScreenCapture>()
  if (!captureRef.current) captureRef.current = new ScreenCapture()
  const capture = captureRef.current

  const tagByKey = new Map<string, TagDef>(config.tags.map((t) => [t.key, t]))
  const tagDefs = new Map<string, TagDef>(config.tags.map((t) => [t.name, t]))

  // auto-scroll timeline to the newest entry
  useEffect(() => {
    const el = timelineRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [snap.entries.length])

  // load attachment thumbnails as object URLs
  useEffect(() => {
    let cancelled = false
    const missing: string[] = []
    for (const e of snap.entries) {
      for (const a of e.attachments) {
        if (!(a in thumbs)) missing.push(a)
      }
    }
    if (missing.length === 0) return
    void (async () => {
      const added: Record<string, string> = {}
      for (const rel of missing) {
        const blob = await ws.readAttachment(snap.dirName, rel.replace(/^attachments\//, ''))
        if (blob) {
          const url = URL.createObjectURL(blob)
          added[rel] = url
          thumbUrlsRef.current.push(url)
        }
      }
      if (!cancelled && Object.keys(added).length > 0) setThumbs((t) => ({ ...t, ...added }))
    })()
    return () => {
      cancelled = true
    }
  }, [snap.entries, snap.dirName, ws, thumbs])

  // revoke object URLs + stop capture on unmount
  useEffect(
    () => () => {
      capture.stop()
    },
    [capture],
  )
  useEffect(
    () => () => {
      for (const url of thumbUrlsRef.current) URL.revokeObjectURL(url)
      thumbUrlsRef.current = []
    },
    [],
  )

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
    setToast(message)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500)
  }, [])
  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
    },
    [],
  )

  const takeScreenshot = useCallback(async () => {
    if (annotating) return
    if (snap.status === 'paused') {
      showToast(
        tx(lang, {
          ja: '一時停止中はスクリーンショットを撮れません',
          en: 'Screenshots are disabled while paused',
        }),
      )
      return
    }
    if (!capture.active) {
      showToast(
        tx(lang, {
          ja: '画面共有が開始されていません — 📷ボタンで開始してください',
          en: 'Screen share is not active — start it with the 📷 button',
        }),
      )
      return
    }
    try {
      const blob = await capture.grabFrame()
      const serial = runner.nextSerial()
      // the untouched original is always persisted (immutable evidence, plan §2.5)
      await ws.writeAttachment(snap.dirName, `${serial}-fullscreen.png`, blob)
      setAnnotating({ blob, serial })
    } catch {
      showToast(
        tx(lang, {
          ja: 'スクリーンショットの取得に失敗しました',
          en: 'Failed to capture a screenshot',
        }),
      )
    }
  }, [capture, annotating, runner, ws, snap.dirName, snap.status, lang, showToast])

  // global keys: F1-F3 modes, F9 screenshot — inert while annotating
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1' || e.key === 'F2' || e.key === 'F3') {
        e.preventDefault()
        if (!annotating) runner.setMode(MODE_ORDER[Number(e.key[1]) - 1])
      } else if (e.key === 'F9') {
        e.preventDefault()
        void takeScreenshot()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runner, takeScreenshot, annotating])

  const commitInput = () => {
    const text = input.trim()
    if (!text) return
    if (text.startsWith('>') && snap.entries.length > 0) {
      runner.addDetail(snap.entries.length - 1, text.replace(/^>\s*/, ''))
    } else {
      const tag = pendingTag ?? MODE_DEFAULT_TAG[snap.mode]
      runner.addEntry(tag, text)
      // nudge correct TBS accounting: a bug found in test mode usually means
      // investigation time starts now
      if (tag === 'BUG' && snap.mode === 'test') {
        showToast(
          tx(lang, {
            ja: 'バグ調査に入るなら F2 でモード切替（TBS計測）',
            en: 'Switching to investigation? Press F2 to track it in TBS',
          }),
        )
      }
    }
    setInput('')
    setPendingTag(null)
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitInput()
      return
    }
    if (e.key === 'Escape') {
      setPendingTag(null)
      return
    }
    // tag prefix mode: single tag key on an empty input selects the tag
    if (input === '' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const def = tagByKey.get(e.key)
      if (def) {
        e.preventDefault()
        setPendingTag((cur) => (cur === def.name ? null : def.name))
      }
    }
  }

  const onAnnotationSave = async (annotated: Blob) => {
    if (!annotating) return
    const { serial } = annotating
    await ws.writeAttachment(snap.dirName, `${serial}-annotated.png`, annotated)
    runner.recordAttachment(`${serial}-annotated.png`)
    setAnnotating(null)
    inputRef.current?.focus()
  }

  const onAnnotationCancel = () => {
    if (!annotating) return
    runner.recordAttachment(`${annotating.serial}-fullscreen.png`)
    setAnnotating(null)
    inputRef.current?.focus()
  }

  const endSession = async () => {
    if (ending) return
    if (!window.confirm(tx(lang, { ja: 'セッションを終了しますか？', en: 'End the session?' }))) return
    setEnding(true)
    capture.stop()
    const session = await runner.end()
    navigate({ name: 'debrief', session })
  }

  const timeboxSec = snap.timeboxMinutes * 60
  const over = snap.elapsedSeconds > timeboxSec
  const progress = Math.min(1, snap.elapsedSeconds / timeboxSec)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* header */}
      <div className="app-header" style={{ gap: 16 }}>
        <span className={`timer${over ? ' over' : ''}`}>
          ⏱ {formatClock(snap.elapsedSeconds)} / {formatClock(timeboxSec)}
        </span>
        <div className="progress">
          <div style={{ width: `${progress * 100}%`, background: over ? 'var(--red)' : undefined }} />
        </div>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {snap.charter?.title}
        </span>
        <span className="spacer" />
        {snap.status === 'running' ? (
          <button onClick={() => runner.pause()}>
            ⏸ {tx(lang, { ja: '一時停止', en: 'Pause' })}
          </button>
        ) : (
          <button className="primary" onClick={() => runner.resume()}>
            ▶ {tx(lang, { ja: '再開', en: 'Resume' })}
          </button>
        )}
        <button className="danger" onClick={() => void endSession()} disabled={ending}>
          {tx(lang, { ja: '終了', en: 'End' })}
        </button>
      </div>

      {/* mode switch */}
      <div className="row" style={{ padding: '6px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <span className="muted small">{tx(lang, { ja: 'モード', en: 'Mode' })}:</span>
        <div className="mode-switch">
          {MODE_ORDER.map((m, i) => (
            <button
              key={m}
              className={snap.mode === m ? 'active' : ''}
              onClick={() => runner.setMode(m)}
              title={`F${i + 1}`}
            >
              {tx(lang, MODE_LABEL[m])} <kbd>F{i + 1}</kbd>
            </button>
          ))}
        </div>
        <LiveTbsBar modeSeconds={snap.modeSeconds} />
        <span className="spacer" />
        {snap.flushError && (
          <span className="small" style={{ color: 'var(--red)' }}>
            ⚠ {tx(lang, { ja: '保存エラー', en: 'Save error' })}: {snap.flushError}
          </span>
        )}
        <span className="muted small">
          {tx(lang, { ja: '一時停止合計', en: 'Paused total' })}: {formatClock(snap.pausedSeconds)}
        </span>
      </div>

      {/* timeline */}
      <div className="timeline" ref={timelineRef}>
        {snap.entries.length === 0 && (
          <p className="muted">
            {tx(lang, {
              ja: 'メモを入力してEnterで記録します。空の入力欄でタグキー（b/i/q…）を押すとタグ付きで記録できます。',
              en: 'Type a note and press Enter. Press a tag key (b/i/q…) on the empty input to tag the note.',
            })}
          </p>
        )}
        {snap.entries.map((e, i) => {
          const def = tagDefs.get(e.tag)
          return (
            <div key={i}>
              <div className="timeline-entry">
                <span className="ts">{formatClock(e.atSeconds)}</span>
                <span className="tag-chip" style={{ background: def?.color ?? 'var(--text-dim)' }}>
                  {e.tag}
                </span>
                <span>{e.text}</span>
              </div>
              {e.details.map((d, j) => (
                <div className="timeline-sub" key={j}>
                  └ {d}
                </div>
              ))}
              {e.attachments.map((a) =>
                thumbs[a] ? (
                  <img
                    key={a}
                    className="timeline-thumb"
                    src={thumbs[a]}
                    alt={a}
                    onClick={() => window.open(thumbs[a], '_blank')}
                  />
                ) : (
                  <div className="timeline-sub" key={a}>
                    📷 {a}
                  </div>
                ),
              )}
            </div>
          )
        })}
      </div>

      {/* input bar */}
      <div className="note-bar">
        <div className="row">
          {pendingTag && (
            <span className="tag-chip" style={{ background: tagDefs.get(pendingTag)?.color ?? 'var(--accent)' }}>
              {pendingTag}
            </span>
          )}
          <input
            ref={inputRef}
            className="note-input"
            style={{ flex: 1 }}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={tx(lang, {
              ja: 'メモを入力... (Enterで記録 / 「> 」で直前の項目に補足)',
              en: 'Type a note… (Enter to record / "> " adds detail to the last entry)',
            })}
            disabled={snap.status !== 'running'}
          />
          {captureActive ? (
            <button onClick={() => void takeScreenshot()} title="F9">
              📷 <kbd>F9</kbd>
            </button>
          ) : (
            <button
              onClick={() =>
                void capture
                  .start(() => {
                    setCaptureActive(false)
                    showToast(
                      tx(lang, {
                        ja: '画面共有が終了しました — スクショには再開が必要です',
                        en: 'Screen share ended — restart it to take screenshots',
                      }),
                    )
                  })
                  .then(() => setCaptureActive(true))
                  .catch(() => setCaptureActive(false))
              }
            >
              📷 {tx(lang, { ja: '画面共有を開始', en: 'Start screen share' })}
            </button>
          )}
        </div>
        <div className="muted small">
          {config.tags.map((t) => (
            <span key={t.name} style={{ marginRight: 10 }}>
              <kbd>{t.key}</kbd> {tx(lang, { ja: t.labelJa, en: t.labelEn })}
            </span>
          ))}
          <span style={{ marginRight: 10 }}>
            <kbd>F9</kbd> 📷
          </span>
        </div>
      </div>

      {/* transient feedback toast */}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {/* pause overlay */}
      {snap.status === 'paused' && !ending && (
        <div className="modal-backdrop" onClick={() => runner.resume()}>
          <div className="modal" style={{ textAlign: 'center', width: 360 }}>
            <h2>{tx(lang, { ja: '一時停止中', en: 'Paused' })}</h2>
            <p className="muted">
              {tx(lang, {
                ja: '中断時間はセッション時間から除外されます',
                en: 'Paused time is excluded from the session duration',
              })}
            </p>
            <button className="primary" onClick={() => runner.resume()}>
              ▶ {tx(lang, { ja: '再開', en: 'Resume' })}
            </button>
          </div>
        </div>
      )}

      {/* annotation modal */}
      {annotating && (
        <AnnotationModal
          image={annotating.blob}
          onSave={(b) => void onAnnotationSave(b)}
          onCancel={onAnnotationCancel}
          lang={lang}
        />
      )}
    </div>
  )
}

const MODE_LABEL: Record<SessionMode, { ja: string; en: string }> = {
  test: { ja: 'テスト', en: 'Test' },
  bug_investigation: { ja: 'バグ調査', en: 'Bug investigation' },
  setup: { ja: 'セットアップ', en: 'Setup' },
}

const MODE_COLOR: Record<SessionMode, string> = {
  test: '#0091ff',
  bug_investigation: '#e5484d',
  setup: '#7d8590',
}

/** Live per-mode time split, so TBS is visible while testing (not only in debrief). */
function LiveTbsBar({ modeSeconds }: { modeSeconds: Record<SessionMode, number> }) {
  const total = MODE_ORDER.reduce((sum, m) => sum + modeSeconds[m], 0)
  if (total === 0) return null
  const pct = (m: SessionMode) => Math.round((modeSeconds[m] / total) * 100)
  return (
    <span
      className="live-tbs"
      title={MODE_ORDER.map((m) => `${m}: ${pct(m)}%`).join(' / ')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <span className="tbs-bar" style={{ width: 120, height: 10 }}>
        {MODE_ORDER.map((m) => (
          <span
            key={m}
            style={{ width: `${(modeSeconds[m] / total) * 100}%`, background: MODE_COLOR[m] }}
          />
        ))}
      </span>
      <span className="muted small" style={{ fontVariantNumeric: 'tabular-nums' }}>
        T{pct('test')} / B{pct('bug_investigation')} / S{pct('setup')}
      </span>
    </span>
  )
}
