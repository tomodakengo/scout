/**
 * CharterModal — create / edit a charter.
 * Fields per plan.md §2.3: title, area, priority, risks, timebox_minutes,
 * status, mission, out of scope.
 */
import { useEffect, useRef, useState } from 'react'
import type { Charter, CharterStatus } from '../types'
import { useApp } from '../appContext'
import { tx } from '../lib/i18n'
import { slugify } from '../lib/slug'

export interface CharterModalProps {
  charter: Charter
  onSave: (c: Charter) => Promise<void>
  onClose: () => void
}

export function CharterModal({ charter, onSave, onClose }: CharterModalProps) {
  const { lang } = useApp()

  const [title, setTitle] = useState(charter.title)
  const [area, setArea] = useState(charter.area)
  const [priority, setPriority] = useState(charter.priority)
  const [risksText, setRisksText] = useState(charter.risks.join('\n'))
  const [timeboxMinutes, setTimeboxMinutes] = useState(charter.timeboxMinutes)
  const [status, setStatus] = useState<CharterStatus>(charter.status)
  const [mission, setMission] = useState(charter.mission)
  const [outOfScope, setOutOfScope] = useState(charter.outOfScope)
  const [saving, setSaving] = useState(false)
  const [titleError, setTitleError] = useState(false)

  const titleInputRef = useRef<HTMLInputElement>(null)

  // Focus title on open
  useEffect(() => {
    titleInputRef.current?.focus()
  }, [])

  // Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = async () => {
    if (title.trim() === '') {
      setTitleError(true)
      titleInputRef.current?.focus()
      return
    }
    setTitleError(false)
    setSaving(true)
    try {
      // Recompute slug only when existing slug is the default placeholder.
      // This preserves slugs for charters that already have sessions referencing them.
      const newSlug = charter.slug === 'charter' ? slugify(title.trim()) : charter.slug

      const updated: Charter = {
        ...charter,
        title: title.trim(),
        area: area.trim(),
        priority,
        risks: risksText
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0),
        timeboxMinutes,
        status,
        mission: mission.trim(),
        outOfScope: outOfScope.trim(),
        slug: newSlug,
      }
      await onSave(updated)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const isNew = charter.slug === 'charter'
  const modalTitle = isNew
    ? tx(lang, { ja: '新規チャーター', en: 'New charter' })
    : tx(lang, { ja: 'チャーターを編集', en: 'Edit charter' })

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <h2>{modalTitle}</h2>

        {/* Title */}
        <div className="field">
          <label htmlFor="cm-title">
            {tx(lang, { ja: 'タイトル *', en: 'Title *' })}
          </label>
          <input
            id="cm-title"
            ref={titleInputRef}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (e.target.value.trim()) setTitleError(false)
            }}
            placeholder={tx(lang, {
              ja: '例: 決済フローの異常系を探索する',
              en: 'e.g. Explore payment error paths',
            })}
            style={titleError ? { borderColor: 'var(--red)' } : undefined}
          />
          {titleError && (
            <span className="small" style={{ color: 'var(--red)' }}>
              {tx(lang, { ja: 'タイトルは必須です', en: 'Title is required' })}
            </span>
          )}
        </div>

        {/* Area */}
        <div className="field">
          <label htmlFor="cm-area">
            {tx(lang, { ja: 'エリア', en: 'Area' })}
          </label>
          <input
            id="cm-area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder={tx(lang, { ja: '例: checkout/payment', en: 'e.g. checkout/payment' })}
          />
        </div>

        {/* Priority */}
        <div className="field">
          <label htmlFor="cm-priority">
            {tx(lang, { ja: '優先度', en: 'Priority' })}
          </label>
          <select
            id="cm-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Charter['priority'])}
          >
            <option value="high">{tx(lang, { ja: '高', en: 'High' })}</option>
            <option value="medium">{tx(lang, { ja: '中', en: 'Medium' })}</option>
            <option value="low">{tx(lang, { ja: '低', en: 'Low' })}</option>
          </select>
        </div>

        {/* Risks */}
        <div className="field">
          <label htmlFor="cm-risks">
            {tx(lang, { ja: 'リスク（1行1件）', en: 'Risks (one per line)' })}
          </label>
          <textarea
            id="cm-risks"
            rows={4}
            value={risksText}
            onChange={(e) => setRisksText(e.target.value)}
            placeholder={tx(lang, {
              ja: '例: i18n漏れ\n二重決済',
              en: 'e.g. i18n gaps\ndouble payment',
            })}
          />
        </div>

        {/* Timebox */}
        <div className="field">
          <label htmlFor="cm-timebox">
            {tx(lang, { ja: 'タイムボックス（分）', en: 'Timebox (minutes)' })}
          </label>
          <input
            id="cm-timebox"
            type="number"
            min={1}
            max={480}
            value={timeboxMinutes}
            onChange={(e) => setTimeboxMinutes(Math.max(1, Number(e.target.value)))}
          />
        </div>

        {/* Status */}
        <div className="field">
          <label htmlFor="cm-status">
            {tx(lang, { ja: 'ステータス', en: 'Status' })}
          </label>
          <select
            id="cm-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as CharterStatus)}
          >
            <option value="draft">{tx(lang, { ja: 'ドラフト', en: 'Draft' })}</option>
            <option value="active">{tx(lang, { ja: 'アクティブ', en: 'Active' })}</option>
            <option value="done">{tx(lang, { ja: '完了', en: 'Done' })}</option>
          </select>
        </div>

        {/* Mission */}
        <div className="field">
          <label htmlFor="cm-mission">
            {tx(lang, { ja: 'ミッション', en: 'Mission' })}
          </label>
          <textarea
            id="cm-mission"
            rows={4}
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            placeholder={tx(lang, {
              ja: '決済フォーム〜完了画面までの異常系を探索し、未知リスクを洗い出す。',
              en: 'Explore the payment form through to the confirmation screen for edge cases.',
            })}
          />
        </div>

        {/* Out of scope */}
        <div className="field">
          <label htmlFor="cm-oos">
            {tx(lang, { ja: 'スコープ外', en: 'Out of scope' })}
          </label>
          <textarea
            id="cm-oos"
            rows={3}
            value={outOfScope}
            onChange={(e) => setOutOfScope(e.target.value)}
            placeholder={tx(lang, {
              ja: '例: 3Dセキュア提供側の挙動そのもの',
              en: 'e.g. The 3D Secure provider behavior itself',
            })}
          />
        </div>

        {/* Actions */}
        <div className="row" style={{ marginTop: 4 }}>
          <span className="spacer" />
          <button onClick={onClose} disabled={saving}>
            {tx(lang, { ja: 'キャンセル', en: 'Cancel' })}
          </button>
          <button
            className="primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving
              ? tx(lang, { ja: '保存中…', en: 'Saving…' })
              : tx(lang, { ja: '保存', en: 'Save' })}
          </button>
        </div>
      </div>
    </div>
  )
}
