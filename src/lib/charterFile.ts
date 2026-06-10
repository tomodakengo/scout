/** charter md serializer/parser. Spec: plan.md §2.3. Keys align with tessera (§2.6). */
import type { Charter, CharterStatus } from '../types'
import { splitFrontmatter, parseFrontmatter, writeFrontmatter } from './frontmatter'

export function charterFileName(c: Charter): string {
  return `${c.id}-${c.slug}.md`
}

export function serializeCharter(c: Charter): string {
  const fm = writeFrontmatter([
    { key: 'id', value: c.id },
    { key: 'title', value: c.title },
    { key: 'area', value: c.area },
    { key: 'priority', value: c.priority },
    { key: 'risks', value: c.risks },
    { key: 'timebox_minutes', value: c.timeboxMinutes },
    { key: 'status', value: c.status, comment: 'draft | active | done' },
    { key: 'created', value: c.created },
  ])
  const body: string[] = []
  body.push('## ミッション')
  body.push(c.mission.trim())
  if (c.outOfScope.trim()) {
    body.push('## スコープ外')
    body.push(c.outOfScope.trim())
  }
  return `${fm}\n${body.join('\n')}\n`
}

const STATUSES: CharterStatus[] = ['draft', 'active', 'done']
const PRIORITIES = ['high', 'medium', 'low'] as const

export function parseCharter(text: string, fileName: string): Charter {
  const split = splitFrontmatter(text)
  const fm = split ? parseFrontmatter(split.frontmatter) : {}
  const body = split ? split.body : text

  const sections = parseSections(body)
  const id = typeof fm['id'] === 'string' ? fm['id'] : String(fm['id'] ?? '')
  const status = STATUSES.includes(fm['status'] as CharterStatus)
    ? (fm['status'] as CharterStatus)
    : 'draft'
  const priority = PRIORITIES.includes(fm['priority'] as (typeof PRIORITIES)[number])
    ? (fm['priority'] as (typeof PRIORITIES)[number])
    : 'medium'

  // derive slug from the file name: {id}-{slug}.md
  const base = fileName.replace(/\.md$/, '')
  const slug = base.startsWith(`${id}-`) ? base.slice(id.length + 1) : base

  return {
    id,
    title: typeof fm['title'] === 'string' ? fm['title'] : '',
    area: typeof fm['area'] === 'string' ? fm['area'] : '',
    priority,
    risks: Array.isArray(fm['risks']) ? fm['risks'].map(String) : [],
    timeboxMinutes: typeof fm['timebox_minutes'] === 'number' ? fm['timebox_minutes'] : 90,
    status,
    created: typeof fm['created'] === 'string' ? fm['created'] : '',
    mission: sections.get('ミッション') ?? sections.get('mission') ?? '',
    outOfScope: sections.get('スコープ外') ?? sections.get('out of scope') ?? '',
    slug,
  }
}

function parseSections(body: string): Map<string, string> {
  const out = new Map<string, string>()
  let name: string | null = null
  let buf: string[] = []
  const flush = () => {
    if (name !== null) out.set(name, buf.join('\n').trim())
    buf = []
  }
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line)
    if (h) {
      flush()
      name = h[1]
      continue
    }
    if (name !== null) buf.push(line)
  }
  flush()
  // add lowercase aliases
  for (const [k, v] of [...out]) out.set(k.toLowerCase(), v)
  return out
}
