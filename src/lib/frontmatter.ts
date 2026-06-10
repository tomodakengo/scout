/**
 * Minimal YAML frontmatter reader/writer covering the subset used by scout files:
 * scalars (string/number/null), string lists ("- item"), one level of nested
 * maps (tbs:), and inline maps ({ bug: 3, finding: 5 }).
 *
 * Deliberately not a full YAML parser — the file spec (plan.md §2.4) keeps the
 * format simple enough to read with hand-rolled rules, which also keeps the
 * door open for other tools to parse these files.
 */

export type FmScalar = string | number | null
export type FmValue = FmScalar | FmScalar[] | Record<string, FmScalar>

export function splitFrontmatter(text: string): { frontmatter: string; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return null
  return { frontmatter: m[1], body: m[2] }
}

function parseScalar(raw: string): FmScalar {
  const t = raw.trim()
  if (t === '' || t === 'null' || t === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  // strip surrounding quotes
  const q = /^"(.*)"$/.exec(t) ?? /^'(.*)'$/.exec(t)
  return q ? q[1] : t
}

/** Strip a trailing comment that is outside quotes (best-effort for our subset). */
function stripComment(line: string): string {
  let inS = false
  let inD = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === "'" && !inD) inS = !inS
    else if (c === '"' && !inS) inD = !inD
    else if (c === '#' && !inS && !inD && (i === 0 || line[i - 1] === ' ')) {
      return line.slice(0, i)
    }
  }
  return line
}

export function parseFrontmatter(fm: string): Record<string, FmValue> {
  const out: Record<string, FmValue> = {}
  const lines = fm.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = stripComment(lines[i])
    if (!line.trim()) {
      i++
      continue
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!kv) {
      i++
      continue
    }
    const key = kv[1]
    const rest = kv[2].trim()
    if (rest === '') {
      // list or nested map follows
      const items: FmScalar[] = []
      const map: Record<string, FmScalar> = {}
      let isMap = false
      let j = i + 1
      while (j < lines.length) {
        const sub = stripComment(lines[j])
        if (!sub.trim()) {
          j++
          continue
        }
        const listItem = /^\s+-\s+(.+)$/.exec(sub)
        const mapItem = /^\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(sub)
        if (listItem) {
          items.push(parseScalar(listItem[1]))
          j++
        } else if (mapItem && /^\s/.test(sub)) {
          isMap = true
          map[mapItem[1]] = parseScalar(mapItem[2])
          j++
        } else {
          break
        }
      }
      out[key] = isMap ? map : items
      i = j
    } else if (rest.startsWith('{')) {
      // inline map: { bug: 3, finding: 5 }
      const inner = rest.replace(/^\{/, '').replace(/\}$/, '')
      const map: Record<string, FmScalar> = {}
      for (const part of inner.split(',')) {
        const m = /^\s*([\w-]+):\s*(.+?)\s*$/.exec(part)
        if (m) map[m[1]] = parseScalar(m[2])
      }
      out[key] = map
      i++
    } else {
      out[key] = parseScalar(rest)
      i++
    }
  }
  return out
}

function needsQuoting(s: string): boolean {
  return (
    s === '' ||
    /^[\s'"#&*?|>%@`{[\]!,-]/.test(s) ||
    /[:#]\s/.test(s) ||
    /\s$/.test(s) ||
    /^(true|false|null|~|yes|no)$/i.test(s) ||
    /^-?\d+(\.\d+)?$/.test(s)
  )
}

function writeScalar(v: FmScalar): string {
  if (v === null) return 'null'
  if (typeof v === 'number') return String(v)
  return needsQuoting(v) ? JSON.stringify(v) : v
}

export interface FmWriteEntry {
  key: string
  value: FmValue
  /** render Record values inline: { a: 1, b: 2 } */
  inline?: boolean
  /** trailing comment */
  comment?: string
}

export function writeFrontmatter(entries: FmWriteEntry[]): string {
  const lines: string[] = ['---']
  for (const { key, value, inline, comment } of entries) {
    const suffix = comment ? `        # ${comment}` : ''
    if (Array.isArray(value)) {
      lines.push(`${key}:${suffix}`)
      for (const item of value) lines.push(`  - ${writeScalar(item)}`)
    } else if (value !== null && typeof value === 'object') {
      if (inline) {
        const inner = Object.entries(value)
          .map(([k, v]) => `${k}: ${writeScalar(v)}`)
          .join(', ')
        lines.push(`${key}: { ${inner} }${suffix}`)
      } else {
        lines.push(`${key}:${suffix}`)
        for (const [k, v] of Object.entries(value)) lines.push(`  ${k}: ${writeScalar(v)}`)
      }
    } else {
      lines.push(`${key}: ${writeScalar(value)}${suffix}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}
