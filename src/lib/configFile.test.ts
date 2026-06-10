import { describe, it, expect } from 'vitest'
import { serializeConfigYaml, parseConfigYaml } from './configFile'
import { DEFAULT_TAGS, DEFAULT_CONFIG, SCHEMA_VERSION } from '../types'
import type { ScoutConfig, TagDef } from '../types'

// ---------------------------------------------------------------------------
// Round-trip: serializeConfigYaml → parseConfigYaml preserves all fields
// ---------------------------------------------------------------------------
describe('serializeConfigYaml / parseConfigYaml round-trip', () => {
  it('preserves all DEFAULT_TAGS through a round-trip', () => {
    const yaml = serializeConfigYaml(DEFAULT_CONFIG)
    const result = parseConfigYaml(yaml)
    expect(result.tags).toHaveLength(DEFAULT_TAGS.length)
    for (let i = 0; i < DEFAULT_TAGS.length; i++) {
      expect(result.tags[i]).toEqual(DEFAULT_TAGS[i])
    }
  })

  it('preserves defaultTimeboxMinutes', () => {
    const config: ScoutConfig = { ...DEFAULT_CONFIG, defaultTimeboxMinutes: 45 }
    const yaml = serializeConfigYaml(config)
    const result = parseConfigYaml(yaml)
    expect(result.defaultTimeboxMinutes).toBe(45)
  })

  it('preserves Japanese labelJa values', () => {
    const yaml = serializeConfigYaml(DEFAULT_CONFIG)
    const result = parseConfigYaml(yaml)
    const bug = result.tags.find((t) => t.name === 'BUG')
    expect(bug?.labelJa).toBe('バグ')
  })

  it('preserves all tag fields: name, key, color, labelJa, labelEn', () => {
    const customTag: TagDef = {
      name: 'テスト',
      key: 'x',
      color: '#ff0000',
      labelJa: '日本語ラベル',
      labelEn: 'EnglishLabel',
    }
    const config: ScoutConfig = { ...DEFAULT_CONFIG, tags: [customTag] }
    const yaml = serializeConfigYaml(config)
    const result = parseConfigYaml(yaml)
    expect(result.tags).toHaveLength(1)
    expect(result.tags[0]).toEqual(customTag)
  })

  it('round-trips a tag with a quoted key value (single-char that needs no quoting)', () => {
    // key field is serialized with JSON.stringify so always double-quoted
    const config: ScoutConfig = {
      ...DEFAULT_CONFIG,
      tags: [{ name: 'BUG', key: 'b', color: '#e5484d', labelJa: 'バグ', labelEn: 'Bug' }],
    }
    const yaml = serializeConfigYaml(config)
    // the key should appear quoted in output
    expect(yaml).toContain('"b"')
    const result = parseConfigYaml(yaml)
    expect(result.tags[0].key).toBe('b')
  })

  it('round-trips Japanese labelJa and labelEn across all default tags', () => {
    const yaml = serializeConfigYaml(DEFAULT_CONFIG)
    const result = parseConfigYaml(yaml)
    const expected: Record<string, { ja: string; en: string }> = {
      BUG: { ja: 'バグ', en: 'Bug' },
      FINDING: { ja: '気づき', en: 'Finding' },
      QUESTION: { ja: '疑問', en: 'Question' },
      NOTE: { ja: 'ノート', en: 'Note' },
      PRAISE: { ja: '称賛', en: 'Praise' },
      TEST: { ja: 'テスト', en: 'Test' },
      SETUP: { ja: '準備', en: 'Setup' },
      IDEA: { ja: 'アイデア', en: 'Idea' },
    }
    for (const tag of result.tags) {
      const exp = expected[tag.name]
      if (exp) {
        expect(tag.labelJa).toBe(exp.ja)
        expect(tag.labelEn).toBe(exp.en)
      }
    }
  })

  it('round-trips defaultTimeboxMinutes of 90 (the default)', () => {
    const yaml = serializeConfigYaml(DEFAULT_CONFIG)
    const result = parseConfigYaml(yaml)
    expect(result.defaultTimeboxMinutes).toBe(90)
  })
})

// ---------------------------------------------------------------------------
// Schema line present in output
// ---------------------------------------------------------------------------
describe('serializeConfigYaml schema line', () => {
  it('includes the schema version line', () => {
    const yaml = serializeConfigYaml(DEFAULT_CONFIG)
    expect(yaml).toContain(`schema: ${SCHEMA_VERSION}`)
  })

  it('has schema as the first line', () => {
    const yaml = serializeConfigYaml(DEFAULT_CONFIG)
    expect(yaml.split('\n')[0]).toBe(`schema: ${SCHEMA_VERSION}`)
  })
})

// ---------------------------------------------------------------------------
// Empty / garbage input falls back to DEFAULT_TAGS and 90
// ---------------------------------------------------------------------------
describe('parseConfigYaml fallback behavior', () => {
  it('empty string falls back to DEFAULT_TAGS', () => {
    const result = parseConfigYaml('')
    expect(result.tags).toEqual(DEFAULT_TAGS)
  })

  it('empty string falls back to defaultTimeboxMinutes 90', () => {
    const result = parseConfigYaml('')
    expect(result.defaultTimeboxMinutes).toBe(90)
  })

  it('garbage string falls back to DEFAULT_TAGS', () => {
    const result = parseConfigYaml('!!!not yaml at all%%%\nrandom garbage\n???')
    expect(result.tags).toEqual(DEFAULT_TAGS)
  })

  it('garbage string falls back to defaultTimeboxMinutes 90', () => {
    const result = parseConfigYaml('!!!not yaml at all%%%')
    expect(result.defaultTimeboxMinutes).toBe(90)
  })

  it('invalid defaultTimeboxMinutes (zero) keeps 90', () => {
    const result = parseConfigYaml('default_timebox_minutes: 0\n')
    expect(result.defaultTimeboxMinutes).toBe(90)
  })

  it('invalid defaultTimeboxMinutes (negative) keeps 90', () => {
    const result = parseConfigYaml('default_timebox_minutes: -5\n')
    expect(result.defaultTimeboxMinutes).toBe(90)
  })

  it('invalid defaultTimeboxMinutes (non-numeric) keeps 90', () => {
    const result = parseConfigYaml('default_timebox_minutes: abc\n')
    expect(result.defaultTimeboxMinutes).toBe(90)
  })
})

// ---------------------------------------------------------------------------
// Unknown top-level keys are tolerated
// ---------------------------------------------------------------------------
describe('parseConfigYaml unknown keys tolerated', () => {
  it('does not throw on unknown top-level keys', () => {
    const yaml = `schema: scout/1\nunknown_key: some value\nextra_field: 42\ndefault_timebox_minutes: 60\ntags:\n  - name: BUG\n    key: "b"\n    color: "#e5484d"\n    label_ja: バグ\n    label_en: Bug\n`
    expect(() => parseConfigYaml(yaml)).not.toThrow()
  })

  it('parses known fields correctly even with unknown keys present', () => {
    const yaml = `schema: scout/1\nunknown_key: some value\ndefault_timebox_minutes: 60\ntags:\n  - name: BUG\n    key: "b"\n    color: "#e5484d"\n    label_ja: バグ\n    label_en: Bug\n`
    const result = parseConfigYaml(yaml)
    expect(result.defaultTimeboxMinutes).toBe(60)
    expect(result.tags[0].name).toBe('BUG')
  })
})

// ---------------------------------------------------------------------------
// Tag entries missing optional fields get documented fallbacks
// ---------------------------------------------------------------------------
describe('parseConfigYaml missing optional fields fallbacks', () => {
  it('missing key falls back to empty string', () => {
    const yaml = `tags:\n  - name: FOO\n    color: "#aabbcc"\n    label_ja: フー\n    label_en: Foo\n`
    const result = parseConfigYaml(yaml)
    expect(result.tags[0].key).toBe('')
  })

  it('missing color falls back to #7d8590', () => {
    const yaml = `tags:\n  - name: FOO\n    key: "f"\n    label_ja: フー\n    label_en: Foo\n`
    const result = parseConfigYaml(yaml)
    expect(result.tags[0].color).toBe('#7d8590')
  })

  it('missing labelJa falls back to name', () => {
    const yaml = `tags:\n  - name: FOO\n    key: "f"\n    color: "#aabbcc"\n    label_en: Foo\n`
    const result = parseConfigYaml(yaml)
    expect(result.tags[0].labelJa).toBe('FOO')
  })

  it('missing labelEn falls back to name', () => {
    const yaml = `tags:\n  - name: FOO\n    key: "f"\n    color: "#aabbcc"\n    label_ja: フー\n`
    const result = parseConfigYaml(yaml)
    expect(result.tags[0].labelEn).toBe('FOO')
  })

  it('tag with only name parses with all fallbacks applied', () => {
    const yaml = `tags:\n  - name: MINIMAL\n`
    const result = parseConfigYaml(yaml)
    expect(result.tags[0]).toEqual({
      name: 'MINIMAL',
      key: '',
      color: '#7d8590',
      labelJa: 'MINIMAL',
      labelEn: 'MINIMAL',
    })
  })
})
