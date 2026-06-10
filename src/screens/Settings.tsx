import { useState, useCallback, useRef } from 'react'
import type { ScoutConfig, TagDef } from '../types'
import { useApp } from '../appContext'
import { loadApiKey, saveApiKey } from '../storage/prefs'
import { supportsFsAccess } from '../storage/fs'
import { tx } from '../lib/i18n'
import { verifyLicense } from '../lib/license'
import { maybeRenewLicense, DEFAULT_RENEWAL_URL } from '../lib/licenseRenewal'

export function Settings({ onboarding }: { onboarding?: boolean }) {
  const { ws, config, updateConfig, lang, navigate, permission, reconnectFolder, pickFolder } =
    useApp()

  const [draft, setDraft] = useState<ScoutConfig>(() => structuredClone(config))
  const [apiKey, setApiKey] = useState<string>(() => loadApiKey())
  const [tagErrors, setTagErrors] = useState<Record<number, string>>({})
  const [renewBusy, setRenewBusy] = useState(false)
  const [renewMessage, setRenewMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Track latest draft in a ref to avoid stale closures in debounced calls
  const draftRef = useRef(draft)
  draftRef.current = draft

  const persist = useCallback(
    (next: ScoutConfig) => {
      void updateConfig(next)
    },
    [updateConfig],
  )

  // ---- helpers ----

  function updateField<K extends keyof ScoutConfig>(key: K, value: ScoutConfig[K]) {
    const next = { ...draft, [key]: value }
    setDraft(next)
    return next
  }

  function updateAiField<K extends keyof ScoutConfig['ai']>(
    key: K,
    value: ScoutConfig['ai'][K],
  ) {
    const next = { ...draft, ai: { ...draft.ai, [key]: value } }
    setDraft(next)
    return next
  }

  // ---- tag validation ----

  function validateTags(tags: TagDef[]): Record<number, string> {
    const errors: Record<number, string> = {}
    const seenKeys = new Map<string, number>()
    tags.forEach((tag, i) => {
      if (!tag.name.trim()) {
        errors[i] = tx(lang, { ja: '名前は必須です', en: 'Name is required' })
      }
      if (!tag.key || tag.key.length !== 1) {
        errors[i] = tx(lang, { ja: 'キーは1文字にしてください', en: 'Key must be a single character' })
      } else if (seenKeys.has(tag.key)) {
        const dupIdx = seenKeys.get(tag.key)!
        errors[i] = tx(lang, { ja: `キーが重複しています (行 ${dupIdx + 1})`, en: `Duplicate key (row ${dupIdx + 1})` })
        errors[dupIdx] = tx(lang, { ja: `キーが重複しています (行 ${i + 1})`, en: `Duplicate key (row ${i + 1})` })
      } else {
        seenKeys.set(tag.key, i)
      }
    })
    return errors
  }

  function updateTag(index: number, field: keyof TagDef, value: string) {
    const newTags = draft.tags.map((t, i) =>
      i === index ? { ...t, [field]: field === 'name' ? value.toUpperCase() : value } : t,
    )
    const errors = validateTags(newTags)
    setTagErrors(errors)
    const next = { ...draft, tags: newTags }
    setDraft(next)
    if (Object.keys(errors).length === 0) {
      persist(next)
    }
  }

  function addTag() {
    const newTag: TagDef = { name: '', key: '', color: '#7d8590', labelJa: '', labelEn: '' }
    const newTags = [...draft.tags, newTag]
    const errors = validateTags(newTags)
    setTagErrors(errors)
    setDraft({ ...draft, tags: newTags })
  }

  function deleteTag(index: number) {
    const newTags = draft.tags.filter((_, i) => i !== index)
    const errors = validateTags(newTags)
    setTagErrors(errors)
    const next = { ...draft, tags: newTags }
    setDraft(next)
    if (Object.keys(errors).length === 0) {
      persist(next)
    }
  }

  // ---- permission dot class ----
  const dotClass =
    permission === 'granted' ? 'dot green' : permission === 'prompt' ? 'dot red' : 'dot gray'

  const permissionLabel =
    permission === 'granted'
      ? tx(lang, { ja: '接続中', en: 'Connected' })
      : permission === 'prompt'
        ? tx(lang, { ja: '許可が必要', en: 'Permission needed' })
        : tx(lang, { ja: '未接続', en: 'Disconnected' })

  return (
    <div className="screen" style={{ paddingBottom: onboarding ? 80 : 20 }}>
      {/* Back button (not shown in onboarding) */}
      {!onboarding && (
        <div className="row">
          <button onClick={() => navigate({ name: 'home' })}>
            {tx(lang, { ja: '← ホームへ戻る', en: '← Back to home' })}
          </button>
        </div>
      )}

      {/* 1. Onboarding banner */}
      {onboarding && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <h2>{tx(lang, { ja: 'scout へようこそ', en: 'Welcome to scout' })}</h2>
          <p style={{ margin: '0 0 8px' }}>
            {tx(lang, {
              ja: 'scout はブラウザだけで動く、ローカルファーストの探索的テスト（ET）セッションレコーダーです。',
              en: 'scout is a browser-only, local-first exploratory testing session recorder.',
            })}
          </p>
          <p style={{ margin: 0 }} className="muted small">
            {tx(lang, {
              ja: 'アカウント不要・インストール不要。データはあなたが選んだフォルダにのみ保存され、外部サーバーには一切送信されません。DevToolsで確認できます。',
              en: 'No account, no installation. Data goes only to a folder you choose — never sent to any server. Verifiable in DevTools.',
            })}
          </p>
        </div>
      )}

      {/* 2. Save folder */}
      <div className="card">
        <h2>{tx(lang, { ja: '保存先フォルダ', en: 'Save folder' })}</h2>
        {!supportsFsAccess() ? (
          <div>
            <p style={{ margin: '0 0 8px' }}>
              {tx(lang, {
                ja: 'このブラウザは File System Access API に対応していません。',
                en: 'This browser does not support the File System Access API.',
              })}
            </p>
            <p className="muted small" style={{ margin: 0 }}>
              {tx(lang, {
                ja: 'データはブラウザ（IndexedDB）内に保存され、ZIP でエクスポートできます（フォールバックモード）。',
                en: 'Data is stored in-browser (IndexedDB) and can be exported as a ZIP (fallback mode).',
              })}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row">
              <span className={dotClass} />
              <span style={{ fontWeight: 600 }}>
                {ws.rootName ?? tx(lang, { ja: '(未選択)', en: '(none selected)' })}
              </span>
              <span className="muted small">{permissionLabel}</span>
            </div>
            <div className="row">
              <button onClick={() => void pickFolder()}>
                {ws.rootName
                  ? tx(lang, { ja: 'フォルダを変更', en: 'Change folder' })
                  : tx(lang, { ja: 'フォルダを選択', en: 'Select folder' })}
              </button>
              {permission === 'prompt' && (
                <button onClick={() => void reconnectFolder()}>
                  {tx(lang, { ja: '再許可', en: 'Re-authorize' })}
                </button>
              )}
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              {tx(lang, {
                ja: 'OneDrive / Google Drive の同期フォルダを指定すると、データが自動的にクラウドにバックアップされます（BYO クラウド）。',
                en: 'Point this at a OneDrive / Google Drive synced folder to automatically back up your data to the cloud (bring your own cloud).',
              })}
            </p>
          </div>
        )}
      </div>

      {/* 3. Tester info */}
      <div className="card">
        <h2>{tx(lang, { ja: 'テスター情報', en: 'Tester' })}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label>{tx(lang, { ja: 'テスター名', en: 'Tester name' })}</label>
            <input
              type="text"
              value={draft.tester}
              placeholder={tx(lang, { ja: 'yuden', en: 'your-name' })}
              onChange={(e) => setDraft({ ...draft, tester: e.target.value })}
              onBlur={() => persist({ ...draft })}
            />
          </div>
          <div className="field">
            <label>{tx(lang, { ja: '環境', en: 'Environment' })}</label>
            <input
              type="text"
              value={draft.environment}
              placeholder="stg / Chrome 137 / Win11"
              onChange={(e) => setDraft({ ...draft, environment: e.target.value })}
              onBlur={() => persist({ ...draft })}
            />
          </div>
        </div>
      </div>

      {/* 4. Language */}
      <div className="card">
        <h2>{tx(lang, { ja: '言語', en: 'Language' })}</h2>
        <div className="field">
          <label>{tx(lang, { ja: '表示言語', en: 'Display language' })}</label>
          <select
            value={draft.language}
            style={{ width: 200 }}
            onChange={(e) => {
              const next = updateField('language', e.target.value as 'ja' | 'en')
              persist(next)
            }}
          >
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* 5. Session defaults */}
      <div className="card">
        <h2>{tx(lang, { ja: 'セッション', en: 'Session defaults' })}</h2>
        <div className="field">
          <label>
            {tx(lang, { ja: 'デフォルトタイムボックス（分）', en: 'Default timebox (minutes)' })}
          </label>
          <input
            type="number"
            min={15}
            max={240}
            step={15}
            value={draft.defaultTimeboxMinutes}
            style={{ width: 120 }}
            onChange={(e) => {
              const val = Number(e.target.value)
              if (val >= 15 && val <= 240) {
                setDraft({ ...draft, defaultTimeboxMinutes: val })
              }
            }}
            onBlur={() => persist({ ...draft })}
          />
          <span className="muted small">
            {tx(lang, { ja: '15〜240 分', en: '15 – 240 minutes' })}
          </span>
        </div>
      </div>

      {/* 6. Tags */}
      <div className="card">
        <h2>{tx(lang, { ja: 'タグ', en: 'Tags' })}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table
            className="plain"
            style={{ width: '100%', minWidth: 600, tableLayout: 'fixed' }}
          >
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '23%' }} />
              <col style={{ width: '23%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{tx(lang, { ja: '名前 (大文字)', en: 'Name (uppercase)' })}</th>
                <th>{tx(lang, { ja: 'キー', en: 'Key' })}</th>
                <th>{tx(lang, { ja: '色', en: 'Color' })}</th>
                <th>{tx(lang, { ja: 'ラベル（日本語）', en: 'Label (JA)' })}</th>
                <th>{tx(lang, { ja: 'ラベル（英語）', en: 'Label (EN)' })}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draft.tags.map((tag, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="text"
                      value={tag.name}
                      style={{ width: '100%' }}
                      placeholder="BUG"
                      onChange={(e) => updateTag(i, 'name', e.target.value)}
                    />
                    {tagErrors[i] && (
                      <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 2 }}>
                        {tagErrors[i]}
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      type="text"
                      value={tag.key}
                      maxLength={1}
                      style={{ width: '100%' }}
                      placeholder="b"
                      onChange={(e) => updateTag(i, 'key', e.target.value)}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="color"
                      value={tag.color}
                      style={{ width: 40, height: 32, padding: 2, cursor: 'pointer' }}
                      onChange={(e) => updateTag(i, 'color', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={tag.labelJa}
                      style={{ width: '100%' }}
                      placeholder={tx(lang, { ja: 'バグ', en: 'ラベル' })}
                      onChange={(e) => updateTag(i, 'labelJa', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={tag.labelEn}
                      style={{ width: '100%' }}
                      placeholder="Bug"
                      onChange={(e) => updateTag(i, 'labelEn', e.target.value)}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="danger"
                      style={{ padding: '2px 8px', fontSize: 12 }}
                      onClick={() => deleteTag(i)}
                    >
                      {tx(lang, { ja: '削除', en: 'Del' })}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10 }}>
          <button onClick={addTag}>
            {tx(lang, { ja: '+ 行を追加', en: '+ Add row' })}
          </button>
        </div>
        {Object.keys(tagErrors).length > 0 && (
          <p className="small" style={{ color: 'var(--red)', margin: '8px 0 0' }}>
            {tx(lang, {
              ja: '入力エラーがあります。修正するまで保存されません。',
              en: 'There are validation errors. Changes will not be saved until fixed.',
            })}
          </p>
        )}
      </div>

      {/* 7. AI formatting */}
      <div className="card">
        <h2>{tx(lang, { ja: 'AI 整形', en: 'AI formatting' })}</h2>
        <p className="muted small" style={{ margin: '0 0 12px' }}>
          {tx(lang, {
            ja: 'BYO キー方式。APIキーはこのブラウザにのみ保存され、セッションフォルダには書き込まれません。',
            en: 'Bring your own key. The API key is stored only in this browser and is never written to the session folder.',
          })}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label>{tx(lang, { ja: 'プロバイダ', en: 'Provider' })}</label>
            <select
              value={draft.ai.provider}
              style={{ width: 220 }}
              onChange={(e) => {
                const next = updateAiField(
                  'provider',
                  e.target.value as ScoutConfig['ai']['provider'],
                )
                persist(next)
              }}
            >
              <option value="none">{tx(lang, { ja: 'なし', en: 'None' })}</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="local">{tx(lang, { ja: 'ローカル LLM', en: 'Local LLM' })}</option>
            </select>
          </div>

          {draft.ai.provider === 'local' && (
            <div className="field">
              <label>{tx(lang, { ja: 'ベース URL', en: 'Base URL' })}</label>
              <input
                type="text"
                value={draft.ai.baseUrl}
                placeholder="http://localhost:11434/v1"
                style={{ width: '100%', maxWidth: 400 }}
                onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, baseUrl: e.target.value } })}
                onBlur={() => persist({ ...draft })}
              />
            </div>
          )}

          {draft.ai.provider !== 'none' && (
            <div className="field">
              <label>{tx(lang, { ja: 'API キー', en: 'API key' })}</label>
              <input
                type="password"
                value={apiKey}
                placeholder={
                  draft.ai.provider === 'openai'
                    ? 'sk-...'
                    : draft.ai.provider === 'anthropic'
                      ? 'sk-ant-...'
                      : tx(lang, { ja: 'APIキーを入力', en: 'Enter API key' })
                }
                style={{ width: '100%', maxWidth: 400 }}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  saveApiKey(e.target.value)
                }}
              />
              <span className="muted small">
                {tx(lang, {
                  ja: 'このブラウザにのみ保存されます',
                  en: 'Stored only in this browser',
                })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 8. License */}
      <div className="card">
        <h2>{tx(lang, { ja: 'ライセンス', en: 'License' })}</h2>
        <p className="muted small" style={{ margin: '0 0 12px' }}>
          {tx(lang, {
            ja: 'ライセンスキーを入力すると AI 整形などの Pro 機能が有効になります。',
            en: 'Enter a license key to unlock Pro features such as AI formatting.',
          })}
        </p>
        <div className="field">
          <label>{tx(lang, { ja: 'ライセンスキー', en: 'License key' })}</label>
          <textarea
            rows={3}
            value={draft.licenseKey}
            placeholder="SCOUT-XXXX-XXXX-XXXX"
            style={{ width: '100%', maxWidth: 480, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
            onChange={(e) => {
              setDraft({ ...draft, licenseKey: e.target.value })
              setRenewMessage(null)
            }}
            onBlur={() => persist({ ...draft })}
          />
        </div>

        {/* Live status line */}
        {(() => {
          const info = verifyLicense(draft.licenseKey)
          const { status, payload } = info
          if (status === 'none') {
            return (
              <div className="row" style={{ marginTop: 6 }}>
                <span className="dot gray" />
                <span className="muted small">{tx(lang, { ja: '未設定', en: 'Not set' })}</span>
              </div>
            )
          }
          if (status === 'invalid') {
            return (
              <div style={{ marginTop: 6 }}>
                <div className="row">
                  <span className="dot red" />
                  <span className="small" style={{ color: 'var(--red)' }}>
                    {tx(lang, { ja: '無効なキー', en: 'Invalid key' })}
                  </span>
                </div>
                {info.reason && (
                  <div className="muted small" style={{ marginTop: 2 }}>{info.reason}</div>
                )}
              </div>
            )
          }
          if (status === 'valid' && payload) {
            const planLabel = payload.plan === 'pro' ? 'Pro' : payload.plan
            const expDate = new Date(payload.exp * 1000).toLocaleDateString()
            return (
              <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                <span className="dot green" />
                <span className="small" style={{ color: 'var(--green)' }}>
                  {tx(lang, { ja: '有効', en: 'Valid' })}
                </span>
                <span className="tag-chip" style={{ background: 'var(--accent)' }}>{planLabel}</span>
                <span className="muted small">{payload.sub}</span>
                <span className="muted small">〜{expDate}</span>
              </div>
            )
          }
          if (status === 'grace' && payload) {
            const expDate = new Date((payload.exp + 14 * 86400) * 1000).toLocaleDateString()
            return (
              <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                <span className="tag-chip" style={{ background: 'var(--yellow)', color: '#000' }}>
                  {tx(lang, { ja: `更新猶予期間中（〜${expDate}）`, en: `In grace period (~${expDate})` })}
                </span>
              </div>
            )
          }
          if (status === 'expired' && payload) {
            const expDate = new Date(payload.exp * 1000).toLocaleDateString()
            return (
              <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                <span className="dot red" />
                <span className="small" style={{ color: 'var(--red)' }}>
                  {tx(lang, { ja: '期限切れ', en: 'Expired' })}
                </span>
                <span className="muted small">〜{expDate}</span>
              </div>
            )
          }
          return null
        })()}

        {/* Renew now button */}
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
          <button
            disabled={
              renewBusy ||
              !DEFAULT_RENEWAL_URL ||
              (() => {
                const { status } = verifyLicense(draft.licenseKey)
                return status === 'none' || status === 'invalid'
              })()
            }
            onClick={async () => {
              setRenewBusy(true)
              setRenewMessage(null)
              try {
                const result = await maybeRenewLicense(draft.licenseKey, { force: true })
                if (result.outcome === 'renewed') {
                  const next = { ...draft, licenseKey: result.token }
                  setDraft(next)
                  persist(next)
                  setRenewMessage({
                    type: 'success',
                    text: tx(lang, { ja: '更新しました', en: 'Renewed successfully' }),
                  })
                } else {
                  setRenewMessage({
                    type: 'error',
                    text: result.reason,
                  })
                }
              } finally {
                setRenewBusy(false)
              }
            }}
          >
            {renewBusy
              ? tx(lang, { ja: '更新中…', en: 'Renewing…' })
              : tx(lang, { ja: '今すぐ更新', en: 'Renew now' })}
          </button>
          {renewMessage && (
            <span
              className="small"
              style={{ color: renewMessage.type === 'success' ? 'var(--green)' : 'var(--red)' }}
            >
              {renewMessage.text}
            </span>
          )}
        </div>

        {/* Renewal endpoint note */}
        {!DEFAULT_RENEWAL_URL && (
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            {tx(lang, {
              ja: '自動更新エンドポイント未設定（ビルド時に VITE_LICENSE_RENEWAL_URL を指定）',
              en: 'Renewal endpoint not configured (set VITE_LICENSE_RENEWAL_URL at build time)',
            })}
          </p>
        )}

        {/* Privacy note */}
        <p className="muted small" style={{ margin: '8px 0 0' }}>
          {tx(lang, {
            ja: '自動更新はライセンストークンのみを送信し、セッションデータは一切送信しません',
            en: 'Auto-renewal sends only the license token, never session data',
          })}
        </p>
      </div>

      {/* Onboarding: Get started button at bottom */}
      {onboarding && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <button
            className="primary"
            style={{ fontSize: 16, padding: '10px 32px' }}
            onClick={() => navigate({ name: 'home' })}
          >
            {tx(lang, { ja: 'はじめる', en: 'Get started' })}
          </button>
        </div>
      )}
    </div>
  )
}
