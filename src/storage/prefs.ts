/**
 * Personal settings live in localStorage only (never written to the shared
 * session folder): tester name, environment, language, AI provider + key, license.
 */
import type { ScoutConfig } from '../types'
import { DEFAULT_CONFIG } from '../types'

const PREFS_KEY = 'scout.prefs.v1'
const API_KEY_KEY = 'scout.apiKey.v1'

export function loadPrefs(): ScoutConfig {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return structuredClone(DEFAULT_CONFIG)
    const parsed = JSON.parse(raw) as Partial<ScoutConfig>
    return {
      ...structuredClone(DEFAULT_CONFIG),
      ...parsed,
      ai: { ...DEFAULT_CONFIG.ai, ...(parsed.ai ?? {}) },
      tags: parsed.tags && parsed.tags.length > 0 ? parsed.tags : DEFAULT_CONFIG.tags,
    }
  } catch {
    return structuredClone(DEFAULT_CONFIG)
  }
}

export function savePrefs(config: ScoutConfig): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(config))
}

/** API key is stored separately so prefs can be exported/inspected without it. */
export function loadApiKey(): string {
  return localStorage.getItem(API_KEY_KEY) ?? ''
}

export function saveApiKey(key: string): void {
  if (key) localStorage.setItem(API_KEY_KEY, key)
  else localStorage.removeItem(API_KEY_KEY)
}
