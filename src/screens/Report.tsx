/**
 * S4 Report screen — view, copy, and download session reports. Plan.md §1.5.
 * Supports Markdown, Jira, Confluence, Backlog text formats and zip export.
 */
import { useState } from 'react'
import type { Session, TimelineEntry } from '../types'
import type { ReportFormat } from '../lib/reportFormats'
import { useApp } from '../appContext'
import { tx } from '../lib/i18n'
import { buildReport, buildBugTicket } from '../lib/reportFormats'
import { exportSessionZip, downloadBlob, downloadText } from '../storage/zipExport'
import { loadApiKey } from '../storage/prefs'
import { isPro, verifyLicense } from '../lib/license'

type FormatOption = ReportFormat | 'zip'

const FORMAT_OPTIONS: { value: FormatOption; label: string }[] = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'jira', label: 'Jira記法' },
  { value: 'confluence', label: 'Confluence' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'zip', label: 'zip' },
]

export function Report({ session }: { session: Session }) {
  const { ws, config, lang, navigate } = useApp()

  const [format, setFormat] = useState<FormatOption>('markdown')
  const [copyFlash, setCopyFlash] = useState(false)
  const [aiMessage, setAiMessage] = useState<string | null>(null)

  const isZip = format === 'zip'
  const textFormat: ReportFormat = isZip ? 'markdown' : (format as ReportFormat)

  const reportText = buildReport(session, null, { format: textFormat, lang })

  // Date + charter title for the header
  const datePrefix = session.started ? session.started.slice(0, 10) : ''
  const reportTitle = [datePrefix, session.charterTitle].filter(Boolean).join(' ')

  const bugEntries: TimelineEntry[] = session.entries.filter((e) => e.tag === 'BUG')

  // Pro gate: the license must carry a valid (or in-grace) Ed25519 signature
  const showAiButton =
    config.ai.provider !== 'none' && isPro(verifyLicense(config.licenseKey)) && !!loadApiKey()

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(reportText)
      setCopyFlash(true)
      setTimeout(() => setCopyFlash(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  function handleDownload() {
    const fileName = format === 'markdown' ? 'report.md' : 'report.txt'
    downloadText(reportText, fileName)
  }

  async function handleSaveReport() {
    // Always writes the Markdown version (canonical derived artifact, plan.md §2.2)
    const md = buildReport(session, null, { format: 'markdown', lang })
    await ws.writeReport(session.dirName, md)
  }

  async function handleZipDownload() {
    const blob = await exportSessionZip(ws, session.dirName)
    downloadBlob(blob, `${session.dirName}.zip`)
  }

  function handleAiFormat() {
    setAiMessage(
      tx(lang, {
        ja: 'AI整形は近日提供予定です',
        en: 'AI formatting coming soon',
      }),
    )
  }

  return (
    <div className="screen">
      {/* Header row */}
      <div className="row">
        <h1 style={{ margin: 0, fontSize: 18, flex: 1 }}>
          {tx(lang, { ja: 'レポート', en: 'Report' })}
          {reportTitle ? ` — ${reportTitle}` : ''}
        </h1>
        <button onClick={() => navigate({ name: 'home' })}>
          ← {tx(lang, { ja: 'ホームへ', en: 'Back to home' })}
        </button>
      </div>

      {/* Format selector */}
      <div className="row">
        <label htmlFor="report-format" className="small muted">
          {tx(lang, { ja: '形式', en: 'Format' })}:
        </label>
        <select
          id="report-format"
          value={format}
          onChange={(e) => setFormat(e.target.value as FormatOption)}
        >
          {FORMAT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {showAiButton && (
          <button onClick={handleAiFormat}>
            ✨ {tx(lang, { ja: 'AIで整形', en: 'AI Format' })}
          </button>
        )}
      </div>

      {/* AI message */}
      {aiMessage && (
        <div className="card small muted" style={{ padding: '10px 16px' }}>
          {aiMessage}
        </div>
      )}

      {/* Preview or zip notice */}
      {isZip ? (
        <div className="card">
          <p className="muted">
            {tx(lang, {
              ja: 'セッションファイル・添付画像をまとめたzipをダウンロードします。',
              en: 'Downloads a zip containing the session file and all attachments.',
            })}
          </p>
          <button onClick={() => void handleZipDownload()}>
            ⬇ {tx(lang, { ja: 'zipダウンロード', en: 'Download zip' })}
          </button>
        </div>
      ) : (
        <>
          <pre className="report-preview">{reportText}</pre>

          {/* Action buttons */}
          <div className="row">
            <button onClick={() => void handleCopy()}>
              {copyFlash
                ? tx(lang, { ja: 'コピーしました', en: 'Copied' })
                : `📋 ${tx(lang, { ja: 'コピー', en: 'Copy' })}`}
            </button>
            <button onClick={handleDownload}>
              ⬇ {tx(lang, { ja: 'ダウンロード', en: 'Download' })}
            </button>
            <button onClick={() => void handleSaveReport()}>
              {tx(lang, { ja: '保存先にreport.mdを保存', en: 'Save report.md to folder' })}
            </button>
          </div>
        </>
      )}

      {/* Bug tickets section */}
      {bugEntries.length > 0 && (
        <div className="card">
          <h2>{tx(lang, { ja: 'バグチケット（個別コピー）', en: 'Bug Tickets (copy individually)' })}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {bugEntries.map((entry, i) => (
              <BugTicketCard
                key={i}
                entry={entry}
                session={session}
                format={textFormat}
                lang={lang}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface BugTicketCardProps {
  entry: TimelineEntry
  session: Session
  format: ReportFormat
  lang: 'ja' | 'en'
}

function BugTicketCard({ entry, session, format, lang }: BugTicketCardProps) {
  const [copied, setCopied] = useState(false)

  const ticketText = buildBugTicket(entry, session, { format, lang })

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(ticketText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
      <div className="row" style={{ width: '100%' }}>
        <span style={{ flex: 1, fontWeight: 600 }}>{entry.text}</span>
        <button onClick={() => void handleCopy()}>
          {copied
            ? tx(lang, { ja: 'コピーしました', en: 'Copied' })
            : `📋 ${tx(lang, { ja: 'この1件をコピー', en: 'Copy this ticket' })}`}
        </button>
      </div>
      {entry.details.length > 0 && (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 16 }}>
          {entry.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
