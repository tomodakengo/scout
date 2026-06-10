import { describe, it, expect } from 'vitest'
import {
  splitFrontmatter,
  parseFrontmatter,
  writeFrontmatter,
  type FmWriteEntry,
} from './frontmatter'

// ---------------------------------------------------------------------------
// splitFrontmatter
// ---------------------------------------------------------------------------
describe('splitFrontmatter', () => {
  it('splits a simple frontmatter block', () => {
    const text = '---\nkey: value\n---\nbody text\n'
    const result = splitFrontmatter(text)
    expect(result).not.toBeNull()
    expect(result!.frontmatter).toBe('key: value')
    expect(result!.body).toBe('body text\n')
  })

  it('returns null when there is no frontmatter', () => {
    expect(splitFrontmatter('no frontmatter here')).toBeNull()
  })

  it('handles CRLF line endings', () => {
    const text = '---\r\nkey: value\r\n---\r\nbody\r\n'
    const result = splitFrontmatter(text)
    expect(result).not.toBeNull()
    expect(result!.frontmatter).toBe('key: value')
  })

  it('returns empty body when no body follows', () => {
    const text = '---\nkey: value\n---\n'
    const result = splitFrontmatter(text)
    expect(result).not.toBeNull()
    expect(result!.body).toBe('')
  })
})

// ---------------------------------------------------------------------------
// parseFrontmatter – scalars
// ---------------------------------------------------------------------------
describe('parseFrontmatter – scalars', () => {
  it('parses a plain string value', () => {
    const fm = parseFrontmatter('name: Alice')
    expect(fm['name']).toBe('Alice')
  })

  it('parses an integer', () => {
    const fm = parseFrontmatter('count: 42')
    expect(fm['count']).toBe(42)
  })

  it('parses a float', () => {
    const fm = parseFrontmatter('ratio: 3.14')
    expect(fm['ratio']).toBe(3.14)
  })

  it('parses null literal', () => {
    const fm = parseFrontmatter('ended: null')
    expect(fm['ended']).toBeNull()
  })

  it('parses tilde as null', () => {
    const fm = parseFrontmatter('ended: ~')
    expect(fm['ended']).toBeNull()
  })

  it('parses empty value as null', () => {
    // a key with blank rest but no indented children
    // (a key followed immediately by an empty rest means block mode, which
    //  produces an empty array when no list items follow)
    const fm = parseFrontmatter('x: 0')
    expect(fm['x']).toBe(0)
  })

  it('parses double-quoted string', () => {
    const fm = parseFrontmatter('env: "stg / Chrome 137 / Win11"')
    expect(fm['env']).toBe('stg / Chrome 137 / Win11')
  })

  it('parses single-quoted string', () => {
    const fm = parseFrontmatter("env: 'hello world'")
    expect(fm['env']).toBe('hello world')
  })
})

// ---------------------------------------------------------------------------
// parseFrontmatter – comments stripped
// ---------------------------------------------------------------------------
describe('parseFrontmatter – comment stripping', () => {
  it('strips trailing comment from scalar value', () => {
    const fm = parseFrontmatter('status: active # draft | active | done')
    expect(fm['status']).toBe('active')
  })

  it('strips trailing comment from key-only line', () => {
    const fm = parseFrontmatter('tbs: # モード滞在時間\n  test: 56\n  setup: 9')
    expect((fm['tbs'] as Record<string, unknown>)['test']).toBe(56)
  })

  it('does not strip # inside a double-quoted string', () => {
    const fm = parseFrontmatter('msg: "hello #world"')
    expect(fm['msg']).toBe('hello #world')
  })

  it('does not strip # inside a single-quoted string', () => {
    const fm = parseFrontmatter("msg: 'hello #world'")
    expect(fm['msg']).toBe('hello #world')
  })
})

// ---------------------------------------------------------------------------
// parseFrontmatter – string lists
// ---------------------------------------------------------------------------
describe('parseFrontmatter – string lists', () => {
  it('parses a list of strings', () => {
    const fm = parseFrontmatter('risks:\n  - i18n漏れ\n  - 二重決済')
    expect(fm['risks']).toEqual(['i18n漏れ', '二重決済'])
  })

  it('parses a list with one item', () => {
    const fm = parseFrontmatter('tags:\n  - alpha')
    expect(fm['tags']).toEqual(['alpha'])
  })

  it('parses an empty list (no items)', () => {
    const fm = parseFrontmatter('items:\n')
    expect(fm['items']).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// parseFrontmatter – nested map (tbs:)
// ---------------------------------------------------------------------------
describe('parseFrontmatter – nested map', () => {
  it('parses a nested map', () => {
    const fm = parseFrontmatter('tbs:\n  test: 56\n  bug_investigation: 25\n  setup: 9')
    expect(fm['tbs']).toEqual({ test: 56, bug_investigation: 25, setup: 9 })
  })

  it('parses a nested map with comment', () => {
    const fm = parseFrontmatter(
      'tbs: # モード滞在時間から自動算出（分）\n  test: 56\n  setup: 9',
    )
    expect(fm['tbs']).toEqual({ test: 56, setup: 9 })
  })
})

// ---------------------------------------------------------------------------
// parseFrontmatter – inline map
// ---------------------------------------------------------------------------
describe('parseFrontmatter – inline map', () => {
  it('parses inline map { bug: 3, finding: 5 }', () => {
    const fm = parseFrontmatter('counts: { bug: 3, finding: 5 }')
    expect(fm['counts']).toEqual({ bug: 3, finding: 5 })
  })

  it('parses inline map with zeros', () => {
    const fm = parseFrontmatter('counts: { bug: 0, praise: 0 }')
    expect(fm['counts']).toEqual({ bug: 0, praise: 0 })
  })

  it('parses inline map with one entry', () => {
    const fm = parseFrontmatter('x: { a: 1 }')
    expect(fm['x']).toEqual({ a: 1 })
  })
})

// ---------------------------------------------------------------------------
// writeFrontmatter
// ---------------------------------------------------------------------------
describe('writeFrontmatter', () => {
  it('writes opening and closing ---', () => {
    const out = writeFrontmatter([{ key: 'k', value: 'v' }])
    expect(out.startsWith('---\n')).toBe(true)
    expect(out.endsWith('---')).toBe(true)
  })

  it('writes a string scalar', () => {
    const out = writeFrontmatter([{ key: 'name', value: 'Alice' }])
    expect(out).toContain('name: Alice')
  })

  it('quotes strings that need quoting (number-like)', () => {
    const out = writeFrontmatter([{ key: 'v', value: '42' }])
    // '42' looks numeric so must be quoted
    expect(out).toContain('"42"')
  })

  it('quotes empty string', () => {
    const out = writeFrontmatter([{ key: 'v', value: '' }])
    expect(out).toContain('""')
  })

  it('writes null as null', () => {
    const out = writeFrontmatter([{ key: 'ended', value: null }])
    expect(out).toContain('ended: null')
  })

  it('writes a number', () => {
    const out = writeFrontmatter([{ key: 'n', value: 42 }])
    expect(out).toContain('n: 42')
  })

  it('writes a list', () => {
    const out = writeFrontmatter([{ key: 'risks', value: ['a', 'b'] }])
    expect(out).toContain('risks:')
    expect(out).toContain('  - a')
    expect(out).toContain('  - b')
  })

  it('writes an inline map', () => {
    const out = writeFrontmatter([{ key: 'counts', value: { bug: 3 }, inline: true }])
    expect(out).toContain('counts: { bug: 3 }')
  })

  it('writes a block map when inline is false', () => {
    const out = writeFrontmatter([{ key: 'tbs', value: { test: 56, setup: 9 }, inline: false }])
    expect(out).toContain('tbs:')
    expect(out).toContain('  test: 56')
    expect(out).toContain('  setup: 9')
  })

  it('appends a comment', () => {
    const out = writeFrontmatter([{ key: 'status', value: 'active', comment: 'draft | active | done' }])
    expect(out).toContain('# draft | active | done')
  })
})

// ---------------------------------------------------------------------------
// Round-trip: writeFrontmatter output parses back to the same values
// ---------------------------------------------------------------------------
describe('round-trip', () => {
  it('scalar string round-trip', () => {
    const entries: FmWriteEntry[] = [{ key: 'name', value: 'yuden' }]
    const written = writeFrontmatter(entries)
    // written is just the frontmatter block (---...---), parse the inner part
    const split = splitFrontmatter(written + '\n')
    expect(split).not.toBeNull()
    const fm = parseFrontmatter(split!.frontmatter)
    expect(fm['name']).toBe('yuden')
  })

  it('number round-trip', () => {
    const entries: FmWriteEntry[] = [{ key: 'duration_minutes', value: 90 }]
    const written = writeFrontmatter(entries)
    const split = splitFrontmatter(written + '\n')
    const fm = parseFrontmatter(split!.frontmatter)
    expect(fm['duration_minutes']).toBe(90)
  })

  it('null round-trip', () => {
    const entries: FmWriteEntry[] = [{ key: 'ended', value: null }]
    const written = writeFrontmatter(entries)
    const split = splitFrontmatter(written + '\n')
    const fm = parseFrontmatter(split!.frontmatter)
    expect(fm['ended']).toBeNull()
  })

  it('string list round-trip', () => {
    const entries: FmWriteEntry[] = [{ key: 'risks', value: ['i18n漏れ', '二重決済'] }]
    const written = writeFrontmatter(entries)
    const split = splitFrontmatter(written + '\n')
    const fm = parseFrontmatter(split!.frontmatter)
    expect(fm['risks']).toEqual(['i18n漏れ', '二重決済'])
  })

  it('inline map round-trip', () => {
    const entries: FmWriteEntry[] = [
      { key: 'counts', value: { bug: 3, finding: 5 }, inline: true },
    ]
    const written = writeFrontmatter(entries)
    const split = splitFrontmatter(written + '\n')
    const fm = parseFrontmatter(split!.frontmatter)
    expect(fm['counts']).toEqual({ bug: 3, finding: 5 })
  })

  it('block nested map round-trip', () => {
    const entries: FmWriteEntry[] = [
      { key: 'tbs', value: { test: 56, bug_investigation: 25, setup: 9 } },
    ]
    const written = writeFrontmatter(entries)
    const split = splitFrontmatter(written + '\n')
    const fm = parseFrontmatter(split!.frontmatter)
    expect(fm['tbs']).toEqual({ test: 56, bug_investigation: 25, setup: 9 })
  })

  it('quoted string round-trip (value that needs quoting)', () => {
    const entries: FmWriteEntry[] = [{ key: 'env', value: 'stg / Chrome 137 / Win11' }]
    const written = writeFrontmatter(entries)
    const split = splitFrontmatter(written + '\n')
    const fm = parseFrontmatter(split!.frontmatter)
    expect(fm['env']).toBe('stg / Chrome 137 / Win11')
  })

  it('round-trip preserves comment text but parses value without it', () => {
    const entries: FmWriteEntry[] = [
      { key: 'status', value: 'active', comment: 'draft | active | done' },
    ]
    const written = writeFrontmatter(entries)
    const split = splitFrontmatter(written + '\n')
    const fm = parseFrontmatter(split!.frontmatter)
    expect(fm['status']).toBe('active')
  })

  it('full multi-field round-trip', () => {
    const entries: FmWriteEntry[] = [
      { key: 'charter', value: '2026-0001' },
      { key: 'started', value: '2026-06-10T14:30:00+09:00' },
      { key: 'ended', value: null },
      { key: 'duration_minutes', value: 90 },
      { key: 'paused_minutes', value: 5 },
      { key: 'tester', value: 'yuden' },
      { key: 'environment', value: 'stg / Chrome 137 / Win11' },
      {
        key: 'tbs',
        value: { test: 56, bug_investigation: 25, setup: 9 },
        comment: 'モード滞在時間から自動算出（分）',
      },
      { key: 'coverage_percent', value: 70 },
      { key: 'counts', value: { bug: 3, finding: 5, question: 2, idea: 1, praise: 0 }, inline: true },
      { key: 'schema', value: 'scout/1' },
    ]
    const written = writeFrontmatter(entries)
    const split = splitFrontmatter(written + '\n')
    expect(split).not.toBeNull()
    const fm = parseFrontmatter(split!.frontmatter)

    expect(fm['charter']).toBe('2026-0001')
    expect(fm['started']).toBe('2026-06-10T14:30:00+09:00')
    expect(fm['ended']).toBeNull()
    expect(fm['duration_minutes']).toBe(90)
    expect(fm['paused_minutes']).toBe(5)
    expect(fm['tester']).toBe('yuden')
    expect(fm['environment']).toBe('stg / Chrome 137 / Win11')
    expect(fm['tbs']).toEqual({ test: 56, bug_investigation: 25, setup: 9 })
    expect(fm['coverage_percent']).toBe(70)
    expect(fm['counts']).toEqual({ bug: 3, finding: 5, question: 2, idea: 1, praise: 0 })
    expect(fm['schema']).toBe('scout/1')
  })
})
