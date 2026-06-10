/**
 * S3 Debrief screen — post-session review. Plan.md §1.4.
 * Allows editing TBS metrics, coverage, remaining issues, and PROOF notes
 * before finalizing and navigating to the Report screen.
 */
import { useState } from 'react'
import type { Session, TbsMinutes, Charter } from '../types'
import { useApp } from '../appContext'
import { tx } from '../lib/i18n'
import { serializeSession } from '../lib/sessionFile'
import { slugify, nextCharterId } from '../lib/slug'
import { localDateStamp } from '../lib/time'

export function Debrief({ session }: { session: Session }) {
  const { ws, config, lang, navigate, runner } = useApp()

  // Local editable TBS copy (minutes)
  const [tbs, setTbs] = useState<TbsMinutes>({
    test: session.tbs.test,
    bug_investigation: session.tbs.bug_investigation,
    setup: session.tbs.setup,
  })

  // Coverage slider
  const [coverage, setCoverage] = useState<number>(session.coveragePercent ?? 70)

  // Remaining issues list
  const [issues, setIssues] = useState<string[]>(
    session.debrief?.remainingIssues.length
      ? [...session.debrief.remainingIssues]
      : [''],
  )

  // Per-issue charter-created flag
  const [charterCreated, setCharterCreated] = useState<boolean[]>(() =>
    (session.debrief?.remainingIssues.length
      ? session.debrief.remainingIssues
      : ['']
    ).map(() => false),
  )

  // PROOF notes
  const [notes, setNotes] = useState<string>(session.debrief?.notes ?? '')

  const [saving, setSaving] = useState(false)

  // TBS bar computed values
  const tbsTotal = tbs.test + tbs.bug_investigation + tbs.setup || 1
  const testPct = Math.round((tbs.test / tbsTotal) * 100)
  const bugPct = Math.round((tbs.bug_investigation / tbsTotal) * 100)
  const setupPct = 100 - testPct - bugPct

  function updateTbs(key: keyof TbsMinutes, val: string) {
    const n = Math.max(0, parseInt(val, 10) || 0)
    setTbs((prev) => ({ ...prev, [key]: n }))
  }

  function setIssue(i: number, val: string) {
    setIssues((prev) => prev.map((v, idx) => (idx === i ? val : v)))
  }

  function addIssue() {
    setIssues((prev) => [...prev, ''])
    setCharterCreated((prev) => [...prev, false])
  }

  function removeIssue(i: number) {
    setIssues((prev) => prev.filter((_, idx) => idx !== i))
    setCharterCreated((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function makeCharter(i: number) {
    const title = issues[i].trim()
    if (!title) return
    const existingCharters: Charter[] = await ws.listCharters()
    const ids = existingCharters.map((c) => c.id)
    const year = new Date().getFullYear()
    const id = nextCharterId(ids, year)
    const newCharter: Charter = {
      id,
      title,
      area: '',
      priority: 'medium',
      risks: [],
      timeboxMinutes: config.defaultTimeboxMinutes,
      status: 'draft',
      created: localDateStamp(),
      mission: title,
      outOfScope: '',
      slug: slugify(title),
    }
    await ws.saveCharter(newCharter)
    setCharterCreated((prev) => prev.map((v, idx) => (idx === i ? true : v)))
  }

  async function finalize(withEdits: boolean) {
    setSaving(true)
    try {
      let updated: Session
      if (withEdits) {
        const nonEmptyIssues = issues.filter((s) => s.trim() !== '')
        updated = {
          ...session,
          tbs,
          coveragePercent: coverage,
          debrief: {
            coveragePercent: coverage,
            remainingIssues: nonEmptyIssues,
            notes,
          },
        }
      } else {
        updated = session
      }
      await ws.writeSessionFile(updated.dirName, serializeSession(updated))
      runner.reset()
      navigate({ name: 'report', session: updated })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <h1 style={{ margin: 0, fontSize: 18 }}>
        {tx(lang, { ja: 'セッション終了 — デブリーフ', en: 'Session Ended — Debrief' })}
      </h1>

      {/* TBS Metrics Card */}
      <div className="card">
        <h2>{tx(lang, { ja: 'TBSメトリクス（自動計測・編集可）', en: 'TBS Metrics (auto-measured, editable)' })}</h2>

        {/* Stacked bar */}
        <div className="tbs-bar" style={{ marginBottom: 10 }}>
          <div
            title={tx(lang, { ja: `テスト ${testPct}%`, en: `Test ${testPct}%` })}
            style={{ width: `${testPct}%`, background: '#0091ff' }}
          />
          <div
            title={tx(lang, { ja: `バグ調査 ${bugPct}%`, en: `Bug investigation ${bugPct}%` })}
            style={{ width: `${bugPct}%`, background: '#e5484d' }}
          />
          <div
            title={tx(lang, { ja: `セットアップ ${setupPct}%`, en: `Setup ${setupPct}%` })}
            style={{ width: `${setupPct}%`, background: '#7d8590' }}
          />
        </div>

        {/* Percentage labels */}
        <div className="row small muted" style={{ marginBottom: 12 }}>
          <span style={{ color: '#0091ff' }}>
            {tx(lang, { ja: 'テスト', en: 'Test' })} {testPct}%
          </span>
          <span style={{ color: '#e5484d' }}>
            {tx(lang, { ja: 'バグ調査', en: 'Bug investigation' })} {bugPct}%
          </span>
          <span style={{ color: '#7d8590' }}>
            {tx(lang, { ja: 'セットアップ', en: 'Setup' })} {setupPct}%
          </span>
        </div>

        {/* Editable inputs */}
        <div className="row">
          <div className="field">
            <label>{tx(lang, { ja: 'テスト（分）', en: 'Test (min)' })}</label>
            <input
              type="number"
              min={0}
              style={{ width: 80 }}
              value={tbs.test}
              onChange={(e) => updateTbs('test', e.target.value)}
            />
          </div>
          <div className="field">
            <label>{tx(lang, { ja: 'バグ調査（分）', en: 'Bug inv. (min)' })}</label>
            <input
              type="number"
              min={0}
              style={{ width: 80 }}
              value={tbs.bug_investigation}
              onChange={(e) => updateTbs('bug_investigation', e.target.value)}
            />
          </div>
          <div className="field">
            <label>{tx(lang, { ja: 'セットアップ（分）', en: 'Setup (min)' })}</label>
            <input
              type="number"
              min={0}
              style={{ width: 80 }}
              value={tbs.setup}
              onChange={(e) => updateTbs('setup', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Charter Coverage */}
      <div className="card">
        <h2>{tx(lang, { ja: 'チャーターカバレッジ', en: 'Charter Coverage' })}</h2>
        <p className="small muted" style={{ margin: '0 0 10px' }}>
          {tx(lang, { ja: '主目的をどの程度カバーしましたか？', en: 'How well did you cover the charter goal?' })}
        </p>
        <div className="row">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={coverage}
            onChange={(e) => setCoverage(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ minWidth: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {coverage}%
          </span>
        </div>
      </div>

      {/* Remaining Issues */}
      <div className="card">
        <h2>
          {tx(lang, { ja: '残課題 / 次のチャーター候補', en: 'Remaining Issues / Next Charter Candidates' })}
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {issues.map((issue, i) => (
            <div key={i} className="row">
              <input
                type="text"
                value={issue}
                placeholder={tx(lang, { ja: '残課題・次のチャーター候補を入力', en: 'Enter remaining issue or next charter candidate' })}
                style={{ flex: 1 }}
                onChange={(e) => setIssue(i, e.target.value)}
              />
              {charterCreated[i] ? (
                <span className="small" style={{ color: '#30a46c', whiteSpace: 'nowrap' }}>
                  ✓ {tx(lang, { ja: 'チャーター作成済', en: 'Charter created' })}
                </span>
              ) : (
                <button
                  disabled={!issue.trim()}
                  onClick={() => void makeCharter(i)}
                  title={tx(lang, { ja: 'このテキストをチャーターとして保存', en: 'Save as charter' })}
                >
                  {tx(lang, { ja: '+チャーター化', en: 'Make charter' })}
                </button>
              )}
              {issues.length > 1 && (
                <button
                  onClick={() => removeIssue(i)}
                  title={tx(lang, { ja: '削除', en: 'Remove' })}
                  style={{ padding: '4px 8px' }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <div>
            <button onClick={addIssue}>
              + {tx(lang, { ja: '行を追加', en: 'Add row' })}
            </button>
          </div>
        </div>
      </div>

      {/* PROOF Notes */}
      <div className="card">
        <h2>{tx(lang, { ja: '所感', en: 'Notes (PROOF)' })}</h2>
        <textarea
          rows={5}
          style={{ width: '100%', resize: 'vertical' }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={tx(lang, {
            ja: 'PROOF: Past（過去）/ Results（結果）/ Obstacles（障害）/ Outlook（見通し）/ Feelings（所感）',
            en: 'PROOF: Past / Results / Obstacles / Outlook / Feelings',
          })}
        />
      </div>

      {/* Action Buttons */}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          disabled={saving}
          onClick={() => void finalize(false)}
        >
          {tx(lang, { ja: 'スキップ', en: 'Skip' })}
        </button>
        <button
          className="primary"
          disabled={saving}
          onClick={() => void finalize(true)}
        >
          {tx(lang, { ja: '保存してレポートへ', en: 'Save & go to report' })}
        </button>
      </div>
    </div>
  )
}
