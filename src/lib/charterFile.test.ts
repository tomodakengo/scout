import { describe, it, expect } from 'vitest'
import { charterFileName, serializeCharter, parseCharter } from './charterFile'
import type { Charter } from '../types'

// The plan.md §2.3 example charter
const EXAMPLE_CHARTER: Charter = {
  id: '2026-0001',
  title: '決済フローの異常系を探索する',
  area: 'checkout/payment',
  priority: 'high',
  risks: ['i18n漏れ（多言語環境での導線）', '二重決済（通信断・連打）'],
  timeboxMinutes: 90,
  status: 'active',
  created: '2026-06-08',
  mission:
    '決済フォーム〜完了画面までの異常系入力・通信異常を探索し、\nリリース判定に必要な未知リスクを洗い出す。',
  outOfScope: '- 3Dセキュア提供側の挙動そのもの',
  slug: 'payment-error-paths',
}

// ---------------------------------------------------------------------------
// charterFileName
// ---------------------------------------------------------------------------
describe('charterFileName', () => {
  it('returns {id}-{slug}.md format', () => {
    expect(charterFileName(EXAMPLE_CHARTER)).toBe('2026-0001-payment-error-paths.md')
  })

  it('uses the id and slug from the charter', () => {
    const c: Charter = { ...EXAMPLE_CHARTER, id: '2026-0002', slug: 'search-ui-keyboard' }
    expect(charterFileName(c)).toBe('2026-0002-search-ui-keyboard.md')
  })
})

// ---------------------------------------------------------------------------
// Round-trip: serializeCharter → parseCharter
// ---------------------------------------------------------------------------
describe('serializeCharter / parseCharter round-trip', () => {
  it('round-trips the plan.md §2.3 example charter', () => {
    const serialized = serializeCharter(EXAMPLE_CHARTER)
    const fileName = charterFileName(EXAMPLE_CHARTER)
    const parsed = parseCharter(serialized, fileName)

    expect(parsed.id).toBe(EXAMPLE_CHARTER.id)
    expect(parsed.title).toBe(EXAMPLE_CHARTER.title)
    expect(parsed.area).toBe(EXAMPLE_CHARTER.area)
    expect(parsed.priority).toBe(EXAMPLE_CHARTER.priority)
    expect(parsed.risks).toEqual(EXAMPLE_CHARTER.risks)
    expect(parsed.timeboxMinutes).toBe(EXAMPLE_CHARTER.timeboxMinutes)
    expect(parsed.status).toBe(EXAMPLE_CHARTER.status)
    expect(parsed.created).toBe(EXAMPLE_CHARTER.created)
    expect(parsed.mission).toBe(EXAMPLE_CHARTER.mission)
    expect(parsed.outOfScope).toBe(EXAMPLE_CHARTER.outOfScope)
    expect(parsed.slug).toBe(EXAMPLE_CHARTER.slug)
  })

  it('round-trips Japanese title', () => {
    const serialized = serializeCharter(EXAMPLE_CHARTER)
    const parsed = parseCharter(serialized, charterFileName(EXAMPLE_CHARTER))
    expect(parsed.title).toBe('決済フローの異常系を探索する')
  })

  it('round-trips risks list including Japanese text', () => {
    const serialized = serializeCharter(EXAMPLE_CHARTER)
    const parsed = parseCharter(serialized, charterFileName(EXAMPLE_CHARTER))
    expect(parsed.risks).toEqual(['i18n漏れ（多言語環境での導線）', '二重決済（通信断・連打）'])
  })

  it('round-trips mission body (スコープ)', () => {
    const serialized = serializeCharter(EXAMPLE_CHARTER)
    const parsed = parseCharter(serialized, charterFileName(EXAMPLE_CHARTER))
    expect(parsed.mission).toBe(EXAMPLE_CHARTER.mission)
  })

  it('round-trips out-of-scope section (スコープ外)', () => {
    const serialized = serializeCharter(EXAMPLE_CHARTER)
    const parsed = parseCharter(serialized, charterFileName(EXAMPLE_CHARTER))
    expect(parsed.outOfScope).toBe(EXAMPLE_CHARTER.outOfScope)
  })

  it('omits スコープ外 section when outOfScope is empty', () => {
    const c: Charter = { ...EXAMPLE_CHARTER, outOfScope: '' }
    const serialized = serializeCharter(c)
    expect(serialized).not.toContain('スコープ外')
  })
})

// ---------------------------------------------------------------------------
// charterFileName format: {id}-{slug}.md
// ---------------------------------------------------------------------------
describe('charterFileName format', () => {
  it('joins id and slug with a hyphen and .md extension', () => {
    const c: Charter = { ...EXAMPLE_CHARTER, id: 'X-100', slug: 'my-feature' }
    expect(charterFileName(c)).toBe('X-100-my-feature.md')
  })
})

// ---------------------------------------------------------------------------
// parseCharter slug derivation from filename
// ---------------------------------------------------------------------------
describe('parseCharter slug derivation', () => {
  it('derives slug by stripping {id}- prefix from filename', () => {
    const serialized = serializeCharter(EXAMPLE_CHARTER)
    const parsed = parseCharter(serialized, '2026-0001-payment-error-paths.md')
    expect(parsed.slug).toBe('payment-error-paths')
  })

  it('uses full basename (minus .md) as slug when id prefix is absent', () => {
    const serialized = serializeCharter(EXAMPLE_CHARTER)
    const parsed = parseCharter(serialized, 'standalone-charter.md')
    expect(parsed.slug).toBe('standalone-charter')
  })

  it('strips .md extension from filename in slug derivation', () => {
    const serialized = serializeCharter(EXAMPLE_CHARTER)
    const parsed = parseCharter(serialized, '2026-0001-some-slug.md')
    expect(parsed.slug).not.toContain('.md')
  })
})

// ---------------------------------------------------------------------------
// Invalid status / priority fall back
// ---------------------------------------------------------------------------
describe('parseCharter invalid status/priority fallbacks', () => {
  it('invalid status falls back to draft', () => {
    const md = `---\nid: 2026-0001\ntitle: Test\narea: test\npriority: high\nrisks:\ntimebox_minutes: 90\nstatus: invalid\ncreated: 2026-01-01\n---\n## ミッション\nTest\n`
    const parsed = parseCharter(md, '2026-0001-test.md')
    expect(parsed.status).toBe('draft')
  })

  it('invalid priority falls back to medium', () => {
    const md = `---\nid: 2026-0001\ntitle: Test\narea: test\npriority: urgent\nrisks:\ntimebox_minutes: 90\nstatus: active\ncreated: 2026-01-01\n---\n## ミッション\nTest\n`
    const parsed = parseCharter(md, '2026-0001-test.md')
    expect(parsed.priority).toBe('medium')
  })

  it('valid statuses are accepted: draft, active, done', () => {
    for (const status of ['draft', 'active', 'done'] as const) {
      const md = `---\nid: x\ntitle: T\narea: a\npriority: low\nrisks:\ntimebox_minutes: 30\nstatus: ${status}\ncreated: 2026-01-01\n---\n## ミッション\nT\n`
      const parsed = parseCharter(md, 'x-t.md')
      expect(parsed.status).toBe(status)
    }
  })

  it('valid priorities are accepted: high, medium, low', () => {
    for (const priority of ['high', 'medium', 'low'] as const) {
      const md = `---\nid: x\ntitle: T\narea: a\npriority: ${priority}\nrisks:\ntimebox_minutes: 30\nstatus: draft\ncreated: 2026-01-01\n---\n## ミッション\nT\n`
      const parsed = parseCharter(md, 'x-t.md')
      expect(parsed.priority).toBe(priority)
    }
  })
})

// ---------------------------------------------------------------------------
// Missing frontmatter handled
// ---------------------------------------------------------------------------
describe('parseCharter missing frontmatter', () => {
  it('returns defaults when there is no frontmatter', () => {
    const md = `## ミッション\nNo frontmatter here\n`
    const parsed = parseCharter(md, 'no-fm.md')
    expect(parsed.id).toBe('')
    expect(parsed.title).toBe('')
    expect(parsed.status).toBe('draft')
    expect(parsed.priority).toBe('medium')
    expect(parsed.mission).toBe('No frontmatter here')
  })

  it('sets slug from filename when frontmatter is missing', () => {
    const md = `## ミッション\nBody\n`
    const parsed = parseCharter(md, 'no-id-slug.md')
    // id is '' so prefix strip condition fails: slug = full base
    expect(parsed.slug).toBe('no-id-slug')
  })

  it('returns empty risks array when frontmatter is absent', () => {
    const md = `## ミッション\nBody\n`
    const parsed = parseCharter(md, 'test.md')
    expect(parsed.risks).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Mission and out-of-scope section parsing incl. English aliases
// ---------------------------------------------------------------------------
describe('parseCharter section aliases', () => {
  it('parses ## ミッション as mission', () => {
    const md = `---\nid: t\ntitle: T\narea: a\npriority: medium\nrisks:\ntimebox_minutes: 30\nstatus: draft\ncreated: 2026-01-01\n---\n## ミッション\nJapanese mission body\n`
    const parsed = parseCharter(md, 't-t.md')
    expect(parsed.mission).toBe('Japanese mission body')
  })

  it('parses ## Mission (English alias) as mission', () => {
    const md = `---\nid: t\ntitle: T\narea: a\npriority: medium\nrisks:\ntimebox_minutes: 30\nstatus: draft\ncreated: 2026-01-01\n---\n## Mission\nEnglish mission body\n`
    const parsed = parseCharter(md, 't-t.md')
    expect(parsed.mission).toBe('English mission body')
  })

  it('parses ## スコープ外 as outOfScope', () => {
    const md = `---\nid: t\ntitle: T\narea: a\npriority: medium\nrisks:\ntimebox_minutes: 30\nstatus: draft\ncreated: 2026-01-01\n---\n## ミッション\nBody\n## スコープ外\nExcluded stuff\n`
    const parsed = parseCharter(md, 't-t.md')
    expect(parsed.outOfScope).toBe('Excluded stuff')
  })

  it('parses ## Out of scope (English alias) as outOfScope', () => {
    const md = `---\nid: t\ntitle: T\narea: a\npriority: medium\nrisks:\ntimebox_minutes: 30\nstatus: draft\ncreated: 2026-01-01\n---\n## Mission\nBody\n## Out of scope\nExcluded stuff\n`
    const parsed = parseCharter(md, 't-t.md')
    expect(parsed.outOfScope).toBe('Excluded stuff')
  })

  it('returns empty string for outOfScope when section is absent', () => {
    const md = `---\nid: t\ntitle: T\narea: a\npriority: medium\nrisks:\ntimebox_minutes: 30\nstatus: draft\ncreated: 2026-01-01\n---\n## ミッション\nBody only\n`
    const parsed = parseCharter(md, 't-t.md')
    expect(parsed.outOfScope).toBe('')
  })
})
