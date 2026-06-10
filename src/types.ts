/** Core domain types for scout. File format spec: plan.md §2 (schema: scout/1) */

export type CharterStatus = 'draft' | 'active' | 'done'

export interface Charter {
  /** e.g. "2026-0001" */
  id: string
  title: string
  area: string
  priority: 'high' | 'medium' | 'low'
  risks: string[]
  timeboxMinutes: number
  status: CharterStatus
  /** YYYY-MM-DD */
  created: string
  /** ## ミッション body */
  mission: string
  /** ## スコープ外 body */
  outOfScope: string
  /** filename slug, e.g. "payment-error-paths" */
  slug: string
}

/** Session modes for TBS metrics (F1-F3) */
export type SessionMode = 'test' | 'bug_investigation' | 'setup'

/** Built-in tags. config.yaml may extend this set, so entries carry plain strings. */
export const BUILTIN_TAGS = [
  'SETUP',
  'TEST',
  'BUG',
  'QUESTION',
  'IDEA',
  'FINDING',
  'PRAISE',
] as const
export type BuiltinTag = (typeof BUILTIN_TAGS)[number]

export interface TagDef {
  name: string
  /** single-char prefix key pressed on empty input, e.g. "b" for BUG */
  key: string
  /** display color */
  color: string
  labelJa: string
  labelEn: string
}

export interface Attachment {
  /** 4-digit serial within session, e.g. "0012" */
  serial: string
  kind: 'fullscreen' | 'annotated'
  /** file name under attachments/, e.g. "0012-fullscreen.png" */
  fileName: string
}

export interface TimelineEntry {
  /** elapsed seconds from session start (excluding paused time) */
  atSeconds: number
  tag: string
  text: string
  /** attachment file names (relative: "attachments/0012-annotated.png") */
  attachments: string[]
  /** nested bullet lines under a BUG entry: repro / expected / actual etc. */
  details: string[]
}

export interface TbsMinutes {
  test: number
  bug_investigation: number
  setup: number
}

export interface TagCounts {
  [tag: string]: number
}

export interface Debrief {
  coveragePercent: number | null
  /** outstanding issues / next charter candidates */
  remainingIssues: string[]
  /** PROOF free-form notes */
  notes: string
}

export interface Session {
  /** directory name: YYYY-MM-DD-HHmm-{charter-slug} */
  dirName: string
  charterId: string
  charterTitle: string
  /** ISO 8601 with offset */
  started: string
  ended: string | null
  durationMinutes: number
  pausedMinutes: number
  tester: string
  environment: string
  tbs: TbsMinutes
  coveragePercent: number | null
  counts: TagCounts
  entries: TimelineEntry[]
  debrief: Debrief | null
  /** schema version, always "scout/1" for now */
  schema: string
}

/** .scout/config.yaml */
export interface ScoutConfig {
  tags: TagDef[]
  tester: string
  environment: string
  defaultTimeboxMinutes: number
  language: 'ja' | 'en'
  ai: {
    provider: 'none' | 'openai' | 'anthropic' | 'local'
    /** API key lives in browser storage only — never written to the session folder */
    baseUrl: string
  }
  licenseKey: string
}

/** .scout/index.json — rebuildable cache for the home screen list */
export interface SessionIndexEntry {
  dirName: string
  charterId: string
  charterTitle: string
  started: string
  durationMinutes: number
  counts: TagCounts
}

export interface ScoutIndex {
  schema: string
  sessions: SessionIndexEntry[]
}

export const DEFAULT_TAGS: TagDef[] = [
  { name: 'BUG', key: 'b', color: '#e5484d', labelJa: 'バグ', labelEn: 'Bug' },
  { name: 'FINDING', key: 'i', color: '#f5a623', labelJa: '気づき', labelEn: 'Finding' },
  { name: 'QUESTION', key: 'q', color: '#8e4ec6', labelJa: '疑問', labelEn: 'Question' },
  { name: 'NOTE', key: 'n', color: '#7d8590', labelJa: 'ノート', labelEn: 'Note' },
  { name: 'PRAISE', key: 'p', color: '#30a46c', labelJa: '称賛', labelEn: 'Praise' },
  { name: 'TEST', key: 't', color: '#0091ff', labelJa: 'テスト', labelEn: 'Test' },
  { name: 'SETUP', key: 's', color: '#7d8590', labelJa: '準備', labelEn: 'Setup' },
  { name: 'IDEA', key: 'd', color: '#12a594', labelJa: 'アイデア', labelEn: 'Idea' },
]

export const DEFAULT_CONFIG: ScoutConfig = {
  tags: DEFAULT_TAGS,
  tester: '',
  environment: '',
  defaultTimeboxMinutes: 90,
  language: 'ja',
  ai: { provider: 'none', baseUrl: '' },
  licenseKey: '',
}

export const SCHEMA_VERSION = 'scout/1'
