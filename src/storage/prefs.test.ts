// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { loadPrefs, savePrefs, loadApiKey, saveApiKey } from './prefs'
import { DEFAULT_CONFIG, DEFAULT_TAGS } from '../types'
import type { ScoutConfig } from '../types'

beforeEach(() => {
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// loadPrefs – defaults when storage is empty
// ---------------------------------------------------------------------------
describe('loadPrefs – empty storage', () => {
  it('returns a clone of DEFAULT_CONFIG when localStorage is empty', () => {
    const prefs = loadPrefs()
    expect(prefs).toEqual(DEFAULT_CONFIG)
  })

  it('returns a new object (not the same reference as DEFAULT_CONFIG)', () => {
    const prefs = loadPrefs()
    expect(prefs).not.toBe(DEFAULT_CONFIG)
  })

  it('returned tags are not the same array reference as DEFAULT_TAGS', () => {
    const prefs = loadPrefs()
    expect(prefs.tags).not.toBe(DEFAULT_TAGS)
  })
})

// ---------------------------------------------------------------------------
// savePrefs / loadPrefs round-trip
// ---------------------------------------------------------------------------
describe('savePrefs / loadPrefs round-trip', () => {
  it('round-trips a fully specified config', () => {
    const config: ScoutConfig = {
      tags: DEFAULT_TAGS,
      tester: 'yuden',
      environment: 'stg / Chrome 137 / Win11',
      defaultTimeboxMinutes: 60,
      language: 'en',
      ai: { provider: 'openai', baseUrl: 'https://api.openai.com' },
      licenseKey: 'TEST-KEY-123',
    }
    savePrefs(config)
    const loaded = loadPrefs()
    expect(loaded.tester).toBe('yuden')
    expect(loaded.environment).toBe('stg / Chrome 137 / Win11')
    expect(loaded.defaultTimeboxMinutes).toBe(60)
    expect(loaded.language).toBe('en')
    expect(loaded.ai.provider).toBe('openai')
    expect(loaded.ai.baseUrl).toBe('https://api.openai.com')
    expect(loaded.licenseKey).toBe('TEST-KEY-123')
    expect(loaded.tags).toEqual(DEFAULT_TAGS)
  })

  it('round-trips the default config unchanged', () => {
    savePrefs(DEFAULT_CONFIG)
    const loaded = loadPrefs()
    expect(loaded).toEqual(DEFAULT_CONFIG)
  })
})

// ---------------------------------------------------------------------------
// Corrupted JSON falls back to defaults
// ---------------------------------------------------------------------------
describe('loadPrefs – corrupted storage', () => {
  it('returns DEFAULT_CONFIG when localStorage contains invalid JSON', () => {
    localStorage.setItem('scout.prefs.v1', 'not valid json {{{')
    const prefs = loadPrefs()
    expect(prefs).toEqual(DEFAULT_CONFIG)
  })

  it('returns DEFAULT_CONFIG when localStorage contains empty object string', () => {
    localStorage.setItem('scout.prefs.v1', 'undefined')
    const prefs = loadPrefs()
    // 'undefined' is not valid JSON, so it throws → fallback
    expect(prefs).toEqual(DEFAULT_CONFIG)
  })
})

// ---------------------------------------------------------------------------
// Partial stored prefs merge over defaults
// ---------------------------------------------------------------------------
describe('loadPrefs – partial prefs merge', () => {
  it('merges a partial config over DEFAULT_CONFIG', () => {
    const partial = { tester: 'alice', language: 'en' }
    localStorage.setItem('scout.prefs.v1', JSON.stringify(partial))
    const loaded = loadPrefs()
    expect(loaded.tester).toBe('alice')
    expect(loaded.language).toBe('en')
    // defaults preserved for unset fields
    expect(loaded.defaultTimeboxMinutes).toBe(DEFAULT_CONFIG.defaultTimeboxMinutes)
    expect(loaded.tags).toEqual(DEFAULT_TAGS)
  })

  it('merges nested ai object — partial ai override keeps missing ai fields as defaults', () => {
    const partial = { ai: { provider: 'anthropic' } }
    localStorage.setItem('scout.prefs.v1', JSON.stringify(partial))
    const loaded = loadPrefs()
    expect(loaded.ai.provider).toBe('anthropic')
    // baseUrl not in partial, so should fall back to DEFAULT_CONFIG.ai.baseUrl
    expect(loaded.ai.baseUrl).toBe(DEFAULT_CONFIG.ai.baseUrl)
  })

  it('merges nested ai object — partial ai with baseUrl only keeps provider as default', () => {
    const partial = { ai: { baseUrl: 'http://localhost:11434' } }
    localStorage.setItem('scout.prefs.v1', JSON.stringify(partial))
    const loaded = loadPrefs()
    expect(loaded.ai.baseUrl).toBe('http://localhost:11434')
    expect(loaded.ai.provider).toBe(DEFAULT_CONFIG.ai.provider)
  })

  it('empty tags array falls back to DEFAULT_TAGS', () => {
    const partial = { tags: [], tester: 'bob' }
    localStorage.setItem('scout.prefs.v1', JSON.stringify(partial))
    const loaded = loadPrefs()
    expect(loaded.tags).toEqual(DEFAULT_TAGS)
  })

  it('non-empty tags array from storage is used', () => {
    const customTags = [
      { name: 'BUG', key: 'b', color: '#e5484d', labelJa: 'バグ', labelEn: 'Bug' },
    ]
    const partial = { tags: customTags }
    localStorage.setItem('scout.prefs.v1', JSON.stringify(partial))
    const loaded = loadPrefs()
    expect(loaded.tags).toEqual(customTags)
  })
})

// ---------------------------------------------------------------------------
// loadApiKey / saveApiKey round-trip
// ---------------------------------------------------------------------------
describe('loadApiKey / saveApiKey', () => {
  it('returns empty string when no key is stored', () => {
    expect(loadApiKey()).toBe('')
  })

  it('round-trips an API key', () => {
    saveApiKey('sk-test-abc123')
    expect(loadApiKey()).toBe('sk-test-abc123')
  })

  it('removes the key from storage when empty string is saved', () => {
    saveApiKey('sk-test-abc123')
    saveApiKey('')
    expect(loadApiKey()).toBe('')
    // ensure the key is actually removed (not set to empty string)
    expect(localStorage.getItem('scout.apiKey.v1')).toBeNull()
  })

  it('stores API key separately from prefs', () => {
    savePrefs(DEFAULT_CONFIG)
    saveApiKey('my-secret-key')
    // prefs should not contain the API key
    const raw = localStorage.getItem('scout.prefs.v1')
    expect(raw).not.toContain('my-secret-key')
  })

  it('overwrites an existing API key', () => {
    saveApiKey('old-key')
    saveApiKey('new-key')
    expect(loadApiKey()).toBe('new-key')
  })
})

// ---------------------------------------------------------------------------
// localStorage reset between tests (sanity)
// ---------------------------------------------------------------------------
describe('localStorage isolation between tests', () => {
  it('localStorage is empty at start of this test', () => {
    expect(localStorage.length).toBe(0)
  })

  it('set in one test does not bleed into another', () => {
    savePrefs({ ...DEFAULT_CONFIG, tester: 'should-not-bleed' })
    // localStorage.clear() in beforeEach handles cleanup
  })

  it('previous test tester value is gone', () => {
    const loaded = loadPrefs()
    expect(loaded.tester).toBe(DEFAULT_CONFIG.tester)
  })
})
