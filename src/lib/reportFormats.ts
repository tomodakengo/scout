/**
 * Report generation for finished sessions. Spec: plan.md §1.5.
 * Supports 4 output formats × 2 languages.
 */
import type { Session, Charter, TimelineEntry } from '../types'
import { formatClock } from './time'
import { extractLabels } from './sessionFile'

export type ReportFormat = 'markdown' | 'jira' | 'confluence' | 'backlog'
export interface ReportOptions {
  format: ReportFormat
  lang: 'ja' | 'en'
}

// ---------------------------------------------------------------------------
// i18n label maps
// ---------------------------------------------------------------------------

interface Labels {
  summary: string
  bugs: string
  timeline: string
  metrics: string
  charter: string
  started: string
  ended: string
  duration: string
  paused: string
  tester: string
  environment: string
  coverage: string
  tagCounts: string
  inlineLabels: string
  tbsMinutes: string
  tbsTest: string
  tbsBugInv: string
  tbsSetup: string
  tbsTotal: string
  tbsPct: string
  attachments: string
  noEntries: string
  repro: string
  expected: string
  actual: string
  min: string
}

const JA: Labels = {
  summary: 'サマリ',
  bugs: 'バグ一覧',
  timeline: 'タイムライン',
  metrics: 'メトリクス',
  charter: 'チャーター',
  started: '開始',
  ended: '終了',
  duration: '実施時間（分）',
  paused: '一時停止（分）',
  tester: 'テスター',
  environment: '環境',
  coverage: 'カバレッジ',
  tagCounts: 'タグ集計',
  inlineLabels: 'インラインラベル',
  tbsMinutes: 'TBSメトリクス（分）',
  tbsTest: 'テスト',
  tbsBugInv: 'バグ調査',
  tbsSetup: 'セットアップ',
  tbsTotal: '合計',
  tbsPct: '割合',
  attachments: '添付',
  noEntries: '（なし）',
  repro: '再現手順',
  expected: '期待結果',
  actual: '実際の挙動',
  min: '分',
}

const EN: Labels = {
  summary: 'Summary',
  bugs: 'Bugs',
  timeline: 'Timeline',
  metrics: 'Metrics',
  charter: 'Charter',
  started: 'Started',
  ended: 'Ended',
  duration: 'Duration (min)',
  paused: 'Paused (min)',
  tester: 'Tester',
  environment: 'Environment',
  coverage: 'Coverage',
  tagCounts: 'Tag Counts',
  inlineLabels: 'Inline Labels',
  tbsMinutes: 'TBS Metrics (min)',
  tbsTest: 'Test',
  tbsBugInv: 'Bug Investigation',
  tbsSetup: 'Setup',
  tbsTotal: 'Total',
  tbsPct: 'Percentage',
  attachments: 'Attachments',
  noEntries: '(none)',
  repro: 'Steps to Reproduce',
  expected: 'Expected',
  actual: 'Actual',
  min: 'min',
}

function labels(lang: 'ja' | 'en'): Labels {
  return lang === 'ja' ? JA : EN
}

// ---------------------------------------------------------------------------
// Format primitives: heading, bullet, table
// Each returns a formatted string for its respective wiki/markup dialect.
// ---------------------------------------------------------------------------

type RowData = string[]

function heading2(text: string, fmt: ReportFormat): string {
  switch (fmt) {
    case 'markdown':
      return `## ${text}`
    case 'jira':
    case 'confluence':
      return `h2. ${text}`
    case 'backlog':
      return `** ${text}`
  }
}

function heading3(text: string, fmt: ReportFormat): string {
  switch (fmt) {
    case 'markdown':
      return `### ${text}`
    case 'jira':
    case 'confluence':
      return `h3. ${text}`
    case 'backlog':
      return `*** ${text}`
  }
}

function bullet(text: string, fmt: ReportFormat): string {
  switch (fmt) {
    case 'markdown':
    case 'jira':
    case 'confluence':
      return `* ${text}`
    case 'backlog':
      return `- ${text}`
  }
}

/** Render a table. headers: column names, rows: data rows. */
function table(headers: string[], rows: RowData[], fmt: ReportFormat): string {
  switch (fmt) {
    case 'markdown': {
      const sep = headers.map(() => '---')
      const hRow = `| ${headers.join(' | ')} |`
      const sRow = `| ${sep.join(' | ')} |`
      const dRows = rows.map((r) => `| ${r.join(' | ')} |`)
      return [hRow, sRow, ...dRows].join('\n')
    }
    case 'jira':
    case 'confluence': {
      const hRow = `||${headers.join('||')}||`
      const dRows = rows.map((r) => `|${r.join('|')}|`)
      return [hRow, ...dRows].join('\n')
    }
    case 'backlog': {
      const hRow = `| ${headers.join(' | ')} |h`
      const dRows = rows.map((r) => `| ${r.join(' | ')} |`)
      return [hRow, ...dRows].join('\n')
    }
  }
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function sectionSummary(
  session: Session,
  charter: Charter | null,
  opts: ReportOptions,
): string {
  const L = labels(opts.lang)
  const fmt = opts.format
  const lines: string[] = [heading2(L.summary, fmt)]

  const charterTitle =
    charter?.title ?? session.charterTitle ?? session.charterId ?? '—'
  const ended = session.ended ?? '—'
  const coverage =
    session.coveragePercent != null ? `${session.coveragePercent}%` : '—'

  const rows: RowData[] = [
    [L.charter, charterTitle],
    [L.started, session.started],
    [L.ended, ended],
    [L.duration, String(session.durationMinutes)],
    [L.paused, String(session.pausedMinutes)],
    [L.tester, session.tester],
    [L.environment, session.environment],
    [L.coverage, coverage],
  ]

  // Append tag count summary rows
  for (const [tag, count] of Object.entries(session.counts)) {
    if (count > 0) rows.push([tag.toUpperCase(), String(count)])
  }

  lines.push(table([L.charter, ''], rows, fmt))
  return lines.join('\n')
}

function sectionBugs(session: Session, opts: ReportOptions): string {
  const L = labels(opts.lang)
  const fmt = opts.format
  const bugEntries = session.entries.filter((e) => e.tag === 'BUG')
  const lines: string[] = [heading2(L.bugs, fmt)]

  if (bugEntries.length === 0) {
    lines.push(bullet(L.noEntries, fmt))
    return lines.join('\n')
  }

  for (const e of bugEntries) {
    const clock = formatClock(e.atSeconds)
    lines.push(heading3(`${clock} ${e.text}`, fmt))

    if (e.details.length > 0) {
      for (const d of e.details) {
        lines.push(bullet(d, fmt))
      }
    }

    if (e.attachments.length > 0) {
      lines.push(bullet(`${L.attachments}: ${e.attachments.join(', ')}`, fmt))
    }
  }

  return lines.join('\n')
}

function sectionTimeline(session: Session, opts: ReportOptions): string {
  const L = labels(opts.lang)
  const fmt = opts.format
  const lines: string[] = [heading2(L.timeline, fmt)]

  if (session.entries.length === 0) {
    lines.push(bullet(L.noEntries, fmt))
    return lines.join('\n')
  }

  for (const e of session.entries) {
    const clock = formatClock(e.atSeconds)
    lines.push(bullet(`${clock} [${e.tag}] ${e.text}`, fmt))
  }

  return lines.join('\n')
}

function sectionMetrics(session: Session, opts: ReportOptions): string {
  const L = labels(opts.lang)
  const fmt = opts.format
  const lines: string[] = [heading2(L.metrics, fmt)]

  // TBS table
  const tbs = session.tbs
  const total = tbs.test + tbs.bug_investigation + tbs.setup || 1 // avoid div/0
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`
  const tbsRows: RowData[] = [
    [L.tbsTest, String(tbs.test), pct(tbs.test)],
    [L.tbsBugInv, String(tbs.bug_investigation), pct(tbs.bug_investigation)],
    [L.tbsSetup, String(tbs.setup), pct(tbs.setup)],
    [L.tbsTotal, String(tbs.test + tbs.bug_investigation + tbs.setup), '100%'],
  ]
  lines.push(heading3(L.tbsMinutes, fmt))
  lines.push(table([L.tbsTest.split('/')[0], L.min, L.tbsPct], tbsRows, fmt))

  // Tag counts table
  const tagEntries = Object.entries(session.counts)
  if (tagEntries.length > 0) {
    lines.push(heading3(L.tagCounts, fmt))
    const tagRows: RowData[] = tagEntries.map(([k, v]) => [k.toUpperCase(), String(v)])
    lines.push(table(['Tag', 'Count'], tagRows, fmt))
  }

  // Inline #label aggregation
  const labelMap = extractLabels(session.entries)
  if (labelMap.size > 0) {
    lines.push(heading3(L.inlineLabels, fmt))
    const labelRows: RowData[] = Array.from(labelMap.entries()).map(([k, v]) => [
      `#${k}`,
      String(v),
    ])
    lines.push(table(['Label', 'Count'], labelRows, fmt))
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full session report: summary → bug list → timeline → metrics (plan.md §1.5).
 * Attachments cannot be embedded; referenced by relative path.
 */
export function buildReport(
  session: Session,
  charter: Charter | null,
  opts: ReportOptions,
): string {
  const parts = [
    sectionSummary(session, charter, opts),
    sectionBugs(session, opts),
    sectionTimeline(session, opts),
    sectionMetrics(session, opts),
  ]
  return parts.join('\n\n') + '\n'
}

/**
 * Single bug entry formatted as a standalone ticket.
 * Uses entry.details to populate repro / expected / actual fields when present.
 * Convention (matches plan.md §2.4 example):
 *   details[0] = "再現: …" / "Steps: …"  → repro
 *   details[1] = "期待: …" / "Expected: …" → expected
 *   details[2] = "実際: …" / "Actual: …"  → actual
 * Any detail line matching none of the above prefixes is appended as-is.
 */
export function buildBugTicket(
  entry: TimelineEntry,
  session: Session,
  opts: ReportOptions,
): string {
  const L = labels(opts.lang)
  const fmt = opts.format
  const clock = formatClock(entry.atSeconds)
  const lines: string[] = []

  // Title / summary line
  lines.push(heading2(`[BUG] ${entry.text}`, fmt))
  lines.push(
    bullet(
      `${L.tester}: ${session.tester}  |  ${L.environment}: ${session.environment}  |  ${clock}`,
      fmt,
    ),
  )
  lines.push('')

  // Parse structured details
  let repro: string | null = null
  let expected: string | null = null
  let actual: string | null = null
  const extras: string[] = []

  for (const d of entry.details) {
    if (/^(再現|steps?(\s+to\s+reproduce)?)\s*[:：]/i.test(d)) {
      repro = d.replace(/^[^：:]+[:：]\s*/, '')
    } else if (/^(期待|expected)\s*[:：]/i.test(d)) {
      expected = d.replace(/^[^：:]+[:：]\s*/, '')
    } else if (/^(実際|actual)\s*[:：]/i.test(d)) {
      actual = d.replace(/^[^：:]+[:：]\s*/, '')
    } else {
      extras.push(d)
    }
  }

  if (repro != null) {
    lines.push(heading3(L.repro, fmt))
    lines.push(bullet(repro, fmt))
  }
  if (expected != null) {
    lines.push(heading3(L.expected, fmt))
    lines.push(bullet(expected, fmt))
  }
  if (actual != null) {
    lines.push(heading3(L.actual, fmt))
    lines.push(bullet(actual, fmt))
  }
  if (extras.length > 0) {
    for (const ex of extras) lines.push(bullet(ex, fmt))
  }

  if (entry.attachments.length > 0) {
    lines.push(heading3(L.attachments, fmt))
    for (const att of entry.attachments) {
      lines.push(bullet(att, fmt))
    }
  }

  return lines.join('\n') + '\n'
}
