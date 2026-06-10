/**
 * session.md serializer/parser. Spec: plan.md §2.4.
 * Timeline line grammar: `- MM:SS [TAG] text` (one regex, kept intentionally simple).
 */
import type { Session, TimelineEntry, TbsMinutes, TagCounts, Debrief } from '../types'
import { SCHEMA_VERSION } from '../types'
import { splitFrontmatter, parseFrontmatter, writeFrontmatter } from './frontmatter'
import { formatClock, parseClock } from './time'

export const TIMELINE_RE = /^- (\d{2,}:\d{2}) \[(\w+)\] (.+)$/

export function serializeSession(s: Session): string {
  const fm = writeFrontmatter([
    { key: 'charter', value: s.charterId },
    { key: 'charter_title', value: s.charterTitle },
    { key: 'started', value: s.started },
    { key: 'ended', value: s.ended },
    { key: 'duration_minutes', value: s.durationMinutes },
    { key: 'paused_minutes', value: s.pausedMinutes },
    { key: 'tester', value: s.tester },
    { key: 'environment', value: s.environment },
    {
      key: 'tbs',
      value: {
        test: s.tbs.test,
        bug_investigation: s.tbs.bug_investigation,
        setup: s.tbs.setup,
      },
      comment: 'モード滞在時間から自動算出（分）',
    },
    { key: 'coverage_percent', value: s.coveragePercent },
    { key: 'counts', value: s.counts, inline: true },
    { key: 'schema', value: s.schema },
  ])

  const lines: string[] = []
  for (const e of s.entries) {
    lines.push(`- ${formatClock(e.atSeconds)} [${e.tag}] ${e.text}`)
    for (const a of e.attachments) lines.push(`  ![](${a})`)
    for (const d of e.details) lines.push(`  - ${d}`)
  }

  const parts = [fm, lines.join('\n')]
  if (s.debrief) {
    const db: string[] = ['## デブリーフ']
    for (const r of s.debrief.remainingIssues) db.push(`- 残課題: ${r}`)
    if (s.debrief.notes.trim()) {
      for (const line of s.debrief.notes.trim().split('\n')) db.push(`- 所感: ${line}`)
    }
    parts.push(db.join('\n'))
  }
  return parts.filter((p) => p !== '').join('\n') + '\n'
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

export function parseSession(text: string, dirName: string): Session {
  const split = splitFrontmatter(text)
  const fm = split ? parseFrontmatter(split.frontmatter) : {}
  const body = split ? split.body : text

  const tbsRaw = (fm['tbs'] ?? {}) as Record<string, unknown>
  const tbs: TbsMinutes = {
    test: asNumber(tbsRaw['test']),
    bug_investigation: asNumber(tbsRaw['bug_investigation']),
    setup: asNumber(tbsRaw['setup']),
  }
  const countsRaw = (fm['counts'] ?? {}) as Record<string, unknown>
  const counts: TagCounts = {}
  for (const [k, v] of Object.entries(countsRaw)) counts[k] = asNumber(v)

  const { entries, debrief } = parseBody(body)

  const coverage = fm['coverage_percent']

  return {
    dirName,
    charterId: asString(fm['charter']),
    charterTitle: asString(fm['charter_title']),
    started: asString(fm['started']),
    ended: typeof fm['ended'] === 'string' ? fm['ended'] : null,
    durationMinutes: asNumber(fm['duration_minutes']),
    pausedMinutes: asNumber(fm['paused_minutes']),
    tester: asString(fm['tester']),
    environment: asString(fm['environment']),
    tbs,
    coveragePercent: typeof coverage === 'number' ? coverage : null,
    counts,
    entries,
    debrief,
    schema: asString(fm['schema'], SCHEMA_VERSION),
  }
}

function parseBody(body: string): { entries: TimelineEntry[]; debrief: Debrief | null } {
  const entries: TimelineEntry[] = []
  let debrief: Debrief | null = null
  let inDebrief = false
  let current: TimelineEntry | null = null

  for (const rawLine of body.split(/\r?\n/)) {
    if (/^##\s*デブリーフ\s*$/.test(rawLine) || /^##\s*Debrief\s*$/i.test(rawLine)) {
      inDebrief = true
      debrief = { coveragePercent: null, remainingIssues: [], notes: '' }
      current = null
      continue
    }
    if (inDebrief && debrief) {
      const m = /^-\s+(残課題|所感|Remaining|Notes):\s*(.*)$/i.exec(rawLine)
      if (m) {
        const label = m[1].toLowerCase()
        if (label === '残課題' || label === 'remaining') debrief.remainingIssues.push(m[2])
        else debrief.notes = debrief.notes ? `${debrief.notes}\n${m[2]}` : m[2]
      }
      continue
    }

    const top = TIMELINE_RE.exec(rawLine)
    if (top) {
      const at = parseClock(top[1])
      current = {
        atSeconds: at ?? 0,
        tag: top[2],
        text: top[3],
        attachments: [],
        details: [],
      }
      entries.push(current)
      continue
    }
    if (current) {
      const img = /^\s+!\[[^\]]*\]\(([^)]+)\)\s*$/.exec(rawLine)
      if (img) {
        current.attachments.push(img[1])
        continue
      }
      const detail = /^\s+-\s+(.+)$/.exec(rawLine)
      if (detail) {
        current.details.push(detail[1])
        continue
      }
    }
  }
  return { entries, debrief }
}

/** Recompute tag counts from entries (frontmatter `counts` is derived data). */
export function computeCounts(entries: TimelineEntry[]): TagCounts {
  const counts: TagCounts = { bug: 0, finding: 0, question: 0, idea: 0, praise: 0 }
  for (const e of entries) {
    const k = e.tag.toLowerCase()
    counts[k] = (counts[k] ?? 0) + 1
  }
  return counts
}

/** Extract inline #labels from entry text (report aggregation). */
export function extractLabels(entries: TimelineEntry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) {
    for (const m of e.text.matchAll(/(?:^|\s)#([^\s#@]+)/g)) {
      out.set(m[1], (out.get(m[1]) ?? 0) + 1)
    }
  }
  return out
}

/** Detect Drive conflict copies like "session (1).md" / "session のコピー.md". */
export function isConflictCopyName(fileName: string): boolean {
  return /^session[ _]?(\(\d+\)|-[\w.]+のコピー|のコピー| copy| - copy.*)\.md$/i.test(fileName)
}
