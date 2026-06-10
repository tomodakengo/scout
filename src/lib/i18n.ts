/**
 * Inline bilingual text helper. Japanese-first product (plan.md §0); rather
 * than a central key dictionary, each call site carries both languages:
 *   tx(lang, { ja: '設定', en: 'Settings' })
 */
export type Lang = 'ja' | 'en'

export interface Bi {
  ja: string
  en: string
}

export function tx(lang: Lang, bi: Bi): string {
  return lang === 'ja' ? bi.ja : bi.en
}
