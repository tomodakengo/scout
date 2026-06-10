import { describe, it, expect } from 'vitest'
import {
  serializeSession,
  parseSession,
  TIMELINE_RE,
  computeCounts,
  extractLabels,
  isConflictCopyName,
} from './sessionFile'
import type { Session, TimelineEntry } from '../types'
import { SCHEMA_VERSION } from '../types'

// ---------------------------------------------------------------------------
// Helper: build a minimal full Session matching plan.md §2.4 example
// ---------------------------------------------------------------------------
function makeSampleSession(): Session {
  return {
    dirName: '2026-06-10-1430-payment-error-paths',
    charterId: '2026-0001',
    charterTitle: '決済フローの異常系を探索する',
    started: '2026-06-10T14:30:00+09:00',
    ended: '2026-06-10T16:05:00+09:00',
    durationMinutes: 90,
    pausedMinutes: 5,
    tester: 'yuden',
    environment: 'stg / Chrome 137 / Win11',
    tbs: { test: 56, bug_investigation: 25, setup: 9 },
    coveragePercent: 70,
    counts: { bug: 3, finding: 5, question: 2, idea: 1, praise: 0 },
    entries: [
      {
        atSeconds: 3 * 60,
        tag: 'SETUP',
        text: 'テスト環境にログイン、テストカード4種を準備',
        attachments: [],
        details: [],
      },
      {
        atSeconds: 11 * 60,
        tag: 'TEST',
        text: 'カード番号に全角数字を入力 → エラーは出るが文言が英語',
        attachments: [],
        details: [],
      },
      {
        atSeconds: 12 * 60,
        tag: 'BUG',
        text: '全角入力時のエラーメッセージがi18n漏れ #i18n',
        attachments: ['attachments/0012-annotated.png'],
        details: ['再現: カード番号欄に「１２３４」→ 確定', '期待: 日本語エラー / 実際: "Invalid card number"'],
      },
      {
        atSeconds: 25 * 60,
        tag: 'QUESTION',
        text: '3Dセキュア失敗時のリトライ上限は仕様？ @PMに確認',
        attachments: [],
        details: [],
      },
      {
        atSeconds: 31 * 60,
        tag: 'IDEA',
        text: '通信断タイミング×決済ステップの組合せ → 別チャーター候補',
        attachments: [],
        details: [],
      },
    ],
    debrief: {
      coveragePercent: 70,
      remainingIssues: ['ネットワーク切断系は未着手（→ charter 2026-0003 起票）'],
      notes: 'フォームバリデーションは堅いが、文言系の網羅が弱い',
    },
    schema: SCHEMA_VERSION,
  }
}

// ---------------------------------------------------------------------------
// Round-trip: serialize then parse
// ---------------------------------------------------------------------------
describe('serializeSession / parseSession round-trip', () => {
  it('preserves charterId', () => {
    const s = makeSampleSession()
    const text = serializeSession(s)
    const parsed = parseSession(text, s.dirName)
    expect(parsed.charterId).toBe(s.charterId)
  })

  it('preserves charterTitle', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.charterTitle).toBe(s.charterTitle)
  })

  it('preserves started', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.started).toBe(s.started)
  })

  it('preserves ended (non-null)', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.ended).toBe(s.ended)
  })

  it('preserves durationMinutes', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.durationMinutes).toBe(90)
  })

  it('preserves pausedMinutes', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.pausedMinutes).toBe(5)
  })

  it('preserves tester', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.tester).toBe('yuden')
  })

  it('preserves environment', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.environment).toBe('stg / Chrome 137 / Win11')
  })

  it('preserves tbs', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.tbs).toEqual({ test: 56, bug_investigation: 25, setup: 9 })
  })

  it('preserves coveragePercent', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.coveragePercent).toBe(70)
  })

  it('preserves counts', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.counts).toEqual({ bug: 3, finding: 5, question: 2, idea: 1, praise: 0 })
  })

  it('preserves schema', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.schema).toBe(SCHEMA_VERSION)
  })

  it('preserves dirName', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.dirName).toBe(s.dirName)
  })

  it('preserves number of entries', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.entries.length).toBe(5)
  })

  it('preserves entry atSeconds', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.entries[0].atSeconds).toBe(3 * 60)
    expect(parsed.entries[2].atSeconds).toBe(12 * 60)
    expect(parsed.entries[4].atSeconds).toBe(31 * 60)
  })

  it('preserves entry tags', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.entries[0].tag).toBe('SETUP')
    expect(parsed.entries[2].tag).toBe('BUG')
    expect(parsed.entries[4].tag).toBe('IDEA')
  })

  it('preserves entry text', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.entries[2].text).toBe('全角入力時のエラーメッセージがi18n漏れ #i18n')
  })

  it('preserves attachments on BUG entry', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.entries[2].attachments).toEqual(['attachments/0012-annotated.png'])
  })

  it('preserves nested details under BUG entry', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.entries[2].details).toEqual([
      '再現: カード番号欄に「１２３４」→ 確定',
      '期待: 日本語エラー / 実際: "Invalid card number"',
    ])
  })

  it('entries with no attachments/details have empty arrays', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.entries[0].attachments).toEqual([])
    expect(parsed.entries[0].details).toEqual([])
  })

  it('preserves debrief remainingIssues', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.debrief).not.toBeNull()
    expect(parsed.debrief!.remainingIssues).toEqual([
      'ネットワーク切断系は未着手（→ charter 2026-0003 起票）',
    ])
  })

  it('preserves debrief notes', () => {
    const s = makeSampleSession()
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.debrief!.notes).toBe(
      'フォームバリデーションは堅いが、文言系の網羅が弱い',
    )
  })

  it('multi-line debrief notes round-trip', () => {
    const s = makeSampleSession()
    s.debrief!.notes = 'line one\nline two'
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.debrief!.notes).toBe('line one\nline two')
  })

  it('null ended round-trip', () => {
    const s = makeSampleSession()
    s.ended = null
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.ended).toBeNull()
  })

  it('null debrief round-trip', () => {
    const s = makeSampleSession()
    s.debrief = null
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.debrief).toBeNull()
  })

  it('null coveragePercent round-trip', () => {
    const s = makeSampleSession()
    s.coveragePercent = null
    const parsed = parseSession(serializeSession(s), s.dirName)
    expect(parsed.coveragePercent).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// TIMELINE_RE
// ---------------------------------------------------------------------------
describe('TIMELINE_RE', () => {
  it('matches standard line', () => {
    expect(TIMELINE_RE.test('- 00:12 [BUG] text')).toBe(true)
  })

  it('captures clock, tag, and text', () => {
    const m = TIMELINE_RE.exec('- 00:12 [BUG] full text here')
    expect(m).not.toBeNull()
    expect(m![1]).toBe('00:12')
    expect(m![2]).toBe('BUG')
    expect(m![3]).toBe('full text here')
  })

  it('matches >99 minute clocks', () => {
    expect(TIMELINE_RE.test('- 120:45 [TEST] long session')).toBe(true)
  })

  it('matches different tags', () => {
    expect(TIMELINE_RE.test('- 01:00 [SETUP] setup entry')).toBe(true)
    expect(TIMELINE_RE.test('- 00:05 [FINDING] something found')).toBe(true)
    expect(TIMELINE_RE.test('- 00:00 [QUESTION] a question')).toBe(true)
  })

  it('rejects line without leading dash', () => {
    expect(TIMELINE_RE.test('00:12 [BUG] text')).toBe(false)
  })

  it('rejects line without tag brackets', () => {
    expect(TIMELINE_RE.test('- 00:12 BUG text')).toBe(false)
  })

  it('rejects line with wrong clock format (one digit group)', () => {
    expect(TIMELINE_RE.test('- 0:12 [BUG] text')).toBe(false)
  })

  it('rejects line with wrong clock format (seconds > 2 digits)', () => {
    // 3-digit seconds should not match (MM:SS requires exactly 2 digits for SS)
    expect(TIMELINE_RE.test('- 00:123 [BUG] text')).toBe(false)
  })

  it('rejects indented line (sub-item)', () => {
    expect(TIMELINE_RE.test('  - 00:12 [BUG] text')).toBe(false)
  })

  it('rejects empty text', () => {
    expect(TIMELINE_RE.test('- 00:12 [BUG] ')).toBe(false)
  })

  it('rejects missing text', () => {
    expect(TIMELINE_RE.test('- 00:12 [BUG]')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// computeCounts
// ---------------------------------------------------------------------------
describe('computeCounts', () => {
  it('counts each tag', () => {
    const entries: TimelineEntry[] = [
      { atSeconds: 0, tag: 'BUG', text: '', attachments: [], details: [] },
      { atSeconds: 0, tag: 'BUG', text: '', attachments: [], details: [] },
      { atSeconds: 0, tag: 'FINDING', text: '', attachments: [], details: [] },
    ]
    const c = computeCounts(entries)
    expect(c['bug']).toBe(2)
    expect(c['finding']).toBe(1)
  })

  it('normalizes tag to lowercase', () => {
    const entries: TimelineEntry[] = [
      { atSeconds: 0, tag: 'QUESTION', text: '', attachments: [], details: [] },
    ]
    const c = computeCounts(entries)
    expect(c['question']).toBe(1)
  })

  it('initializes built-in tags to 0 even when absent', () => {
    const c = computeCounts([])
    expect(c['bug']).toBe(0)
    expect(c['finding']).toBe(0)
    expect(c['question']).toBe(0)
    expect(c['idea']).toBe(0)
    expect(c['praise']).toBe(0)
  })

  it('handles empty entries', () => {
    const c = computeCounts([])
    expect(Object.values(c).every((v) => v === 0)).toBe(true)
  })

  it('accumulates custom tags', () => {
    const entries: TimelineEntry[] = [
      { atSeconds: 0, tag: 'CUSTOM', text: '', attachments: [], details: [] },
      { atSeconds: 0, tag: 'CUSTOM', text: '', attachments: [], details: [] },
    ]
    const c = computeCounts(entries)
    expect(c['custom']).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// extractLabels
// ---------------------------------------------------------------------------
describe('extractLabels', () => {
  it('finds a #label at the end of text', () => {
    const entries: TimelineEntry[] = [
      { atSeconds: 0, tag: 'BUG', text: 'error #i18n', attachments: [], details: [] },
    ]
    const labels = extractLabels(entries)
    expect(labels.get('i18n')).toBe(1)
  })

  it('finds multiple labels in one entry', () => {
    const entries: TimelineEntry[] = [
      { atSeconds: 0, tag: 'BUG', text: 'something #i18n #payment', attachments: [], details: [] },
    ]
    const labels = extractLabels(entries)
    expect(labels.get('i18n')).toBe(1)
    expect(labels.get('payment')).toBe(1)
  })

  it('accumulates the same label across multiple entries', () => {
    const entries: TimelineEntry[] = [
      { atSeconds: 0, tag: 'BUG', text: 'bug #i18n', attachments: [], details: [] },
      { atSeconds: 60, tag: 'FINDING', text: 'also #i18n', attachments: [], details: [] },
    ]
    const labels = extractLabels(entries)
    expect(labels.get('i18n')).toBe(2)
  })

  it('returns empty map for entries with no labels', () => {
    const entries: TimelineEntry[] = [
      { atSeconds: 0, tag: 'TEST', text: 'plain text', attachments: [], details: [] },
    ]
    const labels = extractLabels(entries)
    expect(labels.size).toBe(0)
  })

  it('does not find standalone # without label text', () => {
    const entries: TimelineEntry[] = [
      { atSeconds: 0, tag: 'NOTE', text: 'just a #', attachments: [], details: [] },
    ]
    const labels = extractLabels(entries)
    expect(labels.size).toBe(0)
  })

  it('handles empty entries array', () => {
    expect(extractLabels([]).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// isConflictCopyName
// ---------------------------------------------------------------------------
describe('isConflictCopyName', () => {
  it('flags "session (1).md"', () => {
    expect(isConflictCopyName('session (1).md')).toBe(true)
  })

  it('flags "session (2).md"', () => {
    expect(isConflictCopyName('session (2).md')).toBe(true)
  })

  it('flags "session のコピー.md"', () => {
    expect(isConflictCopyName('session のコピー.md')).toBe(true)
  })

  it('flags "session copy.md"', () => {
    expect(isConflictCopyName('session copy.md')).toBe(true)
  })

  it('does not flag "session.md"', () => {
    expect(isConflictCopyName('session.md')).toBe(false)
  })

  it('does not flag "session-backup.md"', () => {
    // "session-backup.md" – this has a dash not a space/underscore followed by のコピー or numeric
    // The regex pattern: ^session[ _]?(\(\d+\)|-[\w.]+のコピー|のコピー| copy| - copy.*)\.md$
    // "session-backup.md" — "session" then "-backup.md" doesn't match [ _]? then the alternatives
    expect(isConflictCopyName('session-backup.md')).toBe(false)
  })

  it('does not flag a completely different name', () => {
    expect(isConflictCopyName('report.md')).toBe(false)
  })

  it('is case-insensitive for "copy"', () => {
    expect(isConflictCopyName('session copy.md')).toBe(true)
    expect(isConflictCopyName('session COPY.md')).toBe(true)
  })
})
