/**
 * .scout/config.yaml — the team-shareable part of the config (tag definitions,
 * default timebox). Personal settings (tester name, AI keys, license) stay in
 * browser storage only and are never written to the session folder.
 */
import type { ScoutConfig, TagDef } from '../types'
import { DEFAULT_TAGS, SCHEMA_VERSION } from '../types'

export function serializeConfigYaml(config: ScoutConfig): string {
  const lines: string[] = []
  lines.push(`schema: ${SCHEMA_VERSION}`)
  lines.push(`default_timebox_minutes: ${config.defaultTimeboxMinutes}`)
  lines.push('tags:')
  for (const t of config.tags) {
    lines.push(`  - name: ${t.name}`)
    lines.push(`    key: ${JSON.stringify(t.key)}`)
    lines.push(`    color: ${JSON.stringify(t.color)}`)
    lines.push(`    label_ja: ${t.labelJa}`)
    lines.push(`    label_en: ${t.labelEn}`)
  }
  return lines.join('\n') + '\n'
}

function unquote(s: string): string {
  const m = /^"(.*)"$/.exec(s) ?? /^'(.*)'$/.exec(s)
  return m ? m[1] : s
}

/** Parse config.yaml (the specific shape we write; tolerant of unknown keys). */
export function parseConfigYaml(text: string): { tags: TagDef[]; defaultTimeboxMinutes: number } {
  const tags: TagDef[] = []
  let defaultTimeboxMinutes = 90
  let current: Partial<TagDef> | null = null
  let inTags = false

  const commit = () => {
    if (current && current.name) {
      tags.push({
        name: current.name,
        key: current.key ?? '',
        color: current.color ?? '#7d8590',
        labelJa: current.labelJa ?? current.name,
        labelEn: current.labelEn ?? current.name,
      })
    }
    current = null
  }

  for (const raw of text.split(/\r?\n/)) {
    const top = /^([\w-]+):\s*(.*)$/.exec(raw)
    if (top) {
      commit()
      inTags = top[1] === 'tags'
      if (top[1] === 'default_timebox_minutes') {
        const n = Number(top[2])
        if (Number.isFinite(n) && n > 0) defaultTimeboxMinutes = n
      }
      continue
    }
    if (!inTags) continue
    const item = /^\s+-\s+name:\s*(.+)$/.exec(raw)
    if (item) {
      commit()
      current = { name: unquote(item[1].trim()) }
      continue
    }
    const field = /^\s+([\w-]+):\s*(.+)$/.exec(raw)
    if (field && current) {
      const v = unquote(field[2].trim())
      switch (field[1]) {
        case 'key':
          current.key = v
          break
        case 'color':
          current.color = v
          break
        case 'label_ja':
          current.labelJa = v
          break
        case 'label_en':
          current.labelEn = v
          break
      }
    }
  }
  commit()
  return { tags: tags.length > 0 ? tags : DEFAULT_TAGS, defaultTimeboxMinutes }
}
