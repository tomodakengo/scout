import { describe, it, expect } from 'vitest'
import type { Session, Charter } from '../types'
import { buildReport, buildBugTicket } from './reportFormats'
import type { ReportOptions } from './reportFormats'

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const CHARTER: Charter = {
  id: '2026-0001',
  title: '決済フローの異常系を探索する',
  area: 'checkout/payment',
  priority: 'high',
  risks: ['i18n漏れ'],
  timeboxMinutes: 90,
  status: 'active',
  created: '2026-06-10',
  mission: '異常系を洗い出す',
  outOfScope: '3Dセキュア提供側',
  slug: 'payment-error-paths',
}

const SESSION: Session = {
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
  counts: { bug: 1, finding: 1, setup: 1 },
  entries: [
    {
      atSeconds: 3 * 60 + 0, // 03:00
      tag: 'SETUP',
      text: 'テスト環境にログイン、テストカード4種を準備',
      attachments: [],
      details: [],
    },
    {
      atSeconds: 12 * 60 + 0, // 12:00  (plan.md shows 00:12 wall-clock elapsed)
      tag: 'BUG',
      text: '全角入力時のエラーメッセージがi18n漏れ #i18n',
      attachments: ['attachments/0012-annotated.png'],
      details: [
        '再現: カード番号欄に「１２３４」→ 確定',
        '期待: 日本語エラー',
        '実際: "Invalid card number"',
      ],
    },
    {
      atSeconds: 25 * 60 + 0, // 25:00
      tag: 'FINDING',
      text: 'バリデーションは堅いが文言系の網羅が弱い #validation',
      attachments: [],
      details: [],
    },
  ],
  debrief: {
    coveragePercent: 70,
    remainingIssues: ['ネットワーク切断系は未着手'],
    notes: 'フォームバリデーションは堅いが文言系が弱い',
  },
  schema: 'scout/1',
}

const BUG_ENTRY = SESSION.entries[1]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function report(fmt: ReportOptions['format'], lang: ReportOptions['lang'] = 'ja'): string {
  return buildReport(SESSION, CHARTER, { format: fmt, lang })
}

function ticket(fmt: ReportOptions['format'], lang: ReportOptions['lang'] = 'ja'): string {
  return buildBugTicket(BUG_ENTRY, SESSION, { format: fmt, lang })
}

// ---------------------------------------------------------------------------
// Tests: buildReport — headings by format
// ---------------------------------------------------------------------------

describe('buildReport – markdown (ja)', () => {
  const r = report('markdown')

  it('contains markdown h2 headings in Japanese', () => {
    expect(r).toContain('## サマリ')
    expect(r).toContain('## バグ一覧')
    expect(r).toContain('## タイムライン')
    expect(r).toContain('## メトリクス')
  })

  it('summary table contains charter title', () => {
    expect(r).toContain('決済フローの異常系を探索する')
  })

  it('summary table contains tester and environment', () => {
    expect(r).toContain('yuden')
    expect(r).toContain('stg / Chrome 137 / Win11')
  })

  it('summary table contains coverage', () => {
    expect(r).toContain('70%')
  })

  it('bug list contains formatted clock and bug text', () => {
    // fixture: atSeconds = 12*60 = 720 → formatClock produces "12:00"
    expect(r).toContain('12:00')
    expect(r).toContain('全角入力時のエラーメッセージがi18n漏れ')
  })

  it('bug list contains attachment path', () => {
    expect(r).toContain('attachments/0012-annotated.png')
  })

  it('timeline contains all entry tags and texts', () => {
    expect(r).toContain('[SETUP]')
    expect(r).toContain('[BUG]')
    expect(r).toContain('[FINDING]')
  })

  it('metrics contains TBS values', () => {
    expect(r).toContain('56')  // test minutes
    expect(r).toContain('25')  // bug_investigation minutes
    expect(r).toContain('9')   // setup minutes
  })

  it('metrics contains inline label #i18n aggregation', () => {
    expect(r).toContain('#i18n')
  })

  it('uses GFM pipe table syntax', () => {
    expect(r).toMatch(/\|.*\|/)
    expect(r).toMatch(/\|.*---.*\|/)
  })
})

describe('buildReport – jira (ja)', () => {
  const r = report('jira')

  it('uses Jira h2. headings in Japanese', () => {
    expect(r).toContain('h2. サマリ')
    expect(r).toContain('h2. バグ一覧')
    expect(r).toContain('h2. タイムライン')
    expect(r).toContain('h2. メトリクス')
  })

  it('uses Jira double-pipe table headers', () => {
    expect(r).toMatch(/\|\|.+\|\|/)
  })

  it('uses * bullet style', () => {
    expect(r).toMatch(/^\* /m)
  })
})

describe('buildReport – confluence (ja)', () => {
  const r = report('confluence')

  it('uses h2. headings in Japanese', () => {
    expect(r).toContain('h2. サマリ')
    expect(r).toContain('h2. バグ一覧')
  })

  it('uses double-pipe table headers', () => {
    expect(r).toMatch(/\|\|.+\|\|/)
  })
})

describe('buildReport – backlog (ja)', () => {
  const r = report('backlog')

  it('uses ** for h2 headings in Japanese', () => {
    expect(r).toContain('** サマリ')
    expect(r).toContain('** バグ一覧')
    expect(r).toContain('** タイムライン')
    expect(r).toContain('** メトリクス')
  })

  it('uses - bullets', () => {
    expect(r).toMatch(/^- /m)
  })

  it('uses |h suffix for table header rows', () => {
    // multiline flag so $ matches end of each line in the string
    expect(r).toMatch(/\|h$/m)
  })
})

// ---------------------------------------------------------------------------
// Tests: lang: 'en' switches headings
// ---------------------------------------------------------------------------

describe('buildReport – lang: en heading switch', () => {
  it('markdown uses English headings', () => {
    const r = report('markdown', 'en')
    expect(r).toContain('## Summary')
    expect(r).toContain('## Bugs')
    expect(r).toContain('## Timeline')
    expect(r).toContain('## Metrics')
    expect(r).not.toContain('## サマリ')
  })

  it('jira uses English headings', () => {
    const r = report('jira', 'en')
    expect(r).toContain('h2. Summary')
    expect(r).toContain('h2. Bugs')
  })

  it('backlog uses English headings', () => {
    const r = report('backlog', 'en')
    expect(r).toContain('** Summary')
    expect(r).toContain('** Bugs')
  })
})

// ---------------------------------------------------------------------------
// Tests: buildBugTicket
// ---------------------------------------------------------------------------

describe('buildBugTicket – markdown (ja)', () => {
  const t = ticket('markdown')

  it('contains [BUG] prefix and bug text in title heading', () => {
    expect(t).toContain('[BUG]')
    expect(t).toContain('全角入力時のエラーメッセージがi18n漏れ')
  })

  it('extracts repro from details', () => {
    expect(t).toContain('再現手順')
    expect(t).toContain('カード番号欄に「１２３４」')
  })

  it('extracts expected from details', () => {
    expect(t).toContain('日本語エラー')
  })

  it('extracts actual from details', () => {
    expect(t).toContain('Invalid card number')
  })

  it('lists attachment path', () => {
    expect(t).toContain('attachments/0012-annotated.png')
  })

  it('contains tester name', () => {
    expect(t).toContain('yuden')
  })
})

describe('buildBugTicket – jira (ja)', () => {
  const t = ticket('jira')

  it('uses Jira heading for title', () => {
    expect(t).toContain('h2. [BUG]')
  })

  it('extracts repro section with h3.', () => {
    expect(t).toContain('h3. 再現手順')
  })

  it('extracts expected section with h3.', () => {
    expect(t).toContain('h3. 期待結果')
  })

  it('extracts actual section with h3.', () => {
    expect(t).toContain('h3. 実際の挙動')
  })
})

describe('buildBugTicket – backlog (ja)', () => {
  const t = ticket('backlog')

  it('uses ** for title', () => {
    expect(t).toContain('** [BUG]')
  })

  it('uses *** for subsections', () => {
    expect(t).toContain('*** 再現手順')
  })

  it('uses - bullets', () => {
    expect(t).toMatch(/^- /m)
  })
})

describe('buildBugTicket – lang: en', () => {
  const t = ticket('markdown', 'en')

  it('uses English section labels', () => {
    expect(t).toContain('Steps to Reproduce')
    expect(t).toContain('Expected')
    expect(t).toContain('Actual')
    expect(t).toContain('Attachments')
  })
})

// ---------------------------------------------------------------------------
// Tests: TBS values and percentages appear in metrics
// ---------------------------------------------------------------------------

describe('TBS metrics in report', () => {
  it('markdown ja: TBS section contains test/bug/setup minutes', () => {
    const r = report('markdown')
    expect(r).toContain('56')
    expect(r).toContain('25')
    expect(r).toContain('9')
  })

  it('jira en: TBS section exists with English label', () => {
    const r = report('jira', 'en')
    expect(r).toContain('TBS Metrics')
  })

  it('TBS percentages are computed (test ≈ 62%)', () => {
    const r = report('markdown')
    // total = 56+25+9 = 90; test = 56/90 ≈ 62%
    expect(r).toContain('62%')
  })
})

// ---------------------------------------------------------------------------
// Tests: null charter falls back gracefully
// ---------------------------------------------------------------------------

describe('buildReport – null charter', () => {
  it('markdown: falls back to session.charterTitle', () => {
    const r = buildReport(SESSION, null, { format: 'markdown', lang: 'ja' })
    expect(r).toContain('決済フローの異常系を探索する')
  })
})
