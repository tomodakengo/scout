import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { Workspace } from './store'
import { idbSet } from './idb'
import { serializeSession } from '../lib/sessionFile'
import { DEFAULT_CONFIG, SCHEMA_VERSION, type Charter, type Session } from '../types'

// All tests run against fallback mode (no FS handle → fake IndexedDB).
// The IDB connection is module-scoped, so data accumulates across tests in
// this file: every test uses unique ids/dirNames and asserts presence.

let seq = 0
function uniq(prefix: string): string {
  return `${prefix}-${String(++seq).padStart(3, '0')}`
}

function makeCharter(id: string, over: Partial<Charter> = {}): Charter {
  return {
    id,
    title: `チャーター ${id}`,
    area: 'checkout',
    priority: 'medium',
    risks: ['リスクA'],
    timeboxMinutes: 60,
    status: 'active',
    created: '2026-06-10',
    mission: 'ミッション本文',
    outOfScope: '',
    slug: `slug-${id}`,
    ...over,
  }
}

function makeSession(dirName: string, over: Partial<Session> = {}): Session {
  return {
    dirName,
    charterId: '2026-0001',
    charterTitle: '決済フロー',
    started: '2026-06-10T14:30:00+09:00',
    ended: '2026-06-10T16:00:00+09:00',
    durationMinutes: 90,
    pausedMinutes: 5,
    tester: 'yuden',
    environment: 'stg / Chrome',
    tbs: { test: 56, bug_investigation: 25, setup: 9 },
    coveragePercent: 70,
    counts: { bug: 1, finding: 0, question: 0, idea: 0, praise: 0 },
    entries: [
      { atSeconds: 720, tag: 'BUG', text: 'i18n漏れ #i18n', attachments: [], details: [] },
    ],
    debrief: null,
    schema: SCHEMA_VERSION,
    ...over,
  }
}

describe('Workspace (fallback mode)', () => {
  it('reports fallback mode with no folder', async () => {
    const ws = new Workspace()
    expect(ws.mode).toBe('fallback')
    expect(ws.rootName).toBeNull()
    expect(await ws.permissionState()).toBe('disconnected')
  })

  it('charter save/list round-trip, sorted by id', async () => {
    const ws = new Workspace()
    const idB = uniq('2026-9')
    const idA = uniq('2026-9')
    await ws.saveCharter(makeCharter(idB))
    await ws.saveCharter(makeCharter(idA))
    const all = await ws.listCharters()
    const mine = all.filter((c) => c.id === idA || c.id === idB)
    expect(mine.map((c) => c.id)).toEqual([idB, idA].sort())
    expect(mine[0].risks).toEqual(['リスクA'])
    expect(mine[0].mission).toBe('ミッション本文')
  })

  it('session write/load round-trip preserves the timeline', async () => {
    const ws = new Workspace()
    const dirName = uniq('2026-06-10-1430-roundtrip')
    const session = makeSession(dirName)
    await ws.writeSessionFile(dirName, serializeSession(session))
    const loaded = await ws.loadSession(dirName)
    expect(loaded).not.toBeNull()
    expect(loaded!.charterId).toBe('2026-0001')
    expect(loaded!.entries).toHaveLength(1)
    expect(loaded!.entries[0].text).toContain('i18n漏れ')
    expect(loaded!.tbs.bug_investigation).toBe(25)
    expect(await ws.listSessionDirs()).toContain(dirName)
  })

  it('attachments round-trip as blobs', async () => {
    const ws = new Workspace()
    const dirName = uniq('2026-06-10-1430-attach')
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
    await ws.writeAttachment(dirName, '0001-fullscreen.png', png)
    const back = await ws.readAttachment(dirName, '0001-fullscreen.png')
    expect(back).not.toBeNull()
    expect(back!.size).toBe(4)
    expect(await ws.readAttachment(dirName, 'missing.png')).toBeNull()
  })

  it('detects Drive conflict copies next to session.md', async () => {
    const ws = new Workspace()
    const dirName = uniq('2026-06-10-1430-conflict')
    await ws.writeSessionFile(dirName, serializeSession(makeSession(dirName)))
    // plant a conflict copy the way a sync client would
    await idbSet('blobs', `sessions/${dirName}/session (1).md`, 'conflicting copy')
    expect(await ws.detectConflictCopies(dirName)).toEqual(['session (1).md'])

    const clean = uniq('2026-06-10-1430-clean')
    await ws.writeSessionFile(clean, serializeSession(makeSession(clean)))
    expect(await ws.detectConflictCopies(clean)).toEqual([])
  })

  it('rebuilds index.json from sessions/ when the cache is corrupt', async () => {
    const ws = new Workspace()
    const dirName = uniq('2026-06-10-1430-rebuild')
    await ws.writeSessionFile(dirName, serializeSession(makeSession(dirName)))
    await idbSet('blobs', '.scout/index.json', '{not json')
    const index = await ws.loadIndex()
    expect(index.schema).toBe(SCHEMA_VERSION)
    expect(index.sessions.some((s) => s.dirName === dirName)).toBe(true)
  })

  it('upsertIndexEntry inserts, replaces, and keeps newest-first order', async () => {
    const ws = new Workspace()
    const older = uniq('idx')
    const newer = uniq('idx')
    const base = {
      charterId: '2026-0001',
      charterTitle: 't',
      durationMinutes: 60,
      counts: { bug: 0 },
    }
    await ws.upsertIndexEntry({ ...base, dirName: older, started: '2026-06-01T10:00:00+09:00' })
    await ws.upsertIndexEntry({ ...base, dirName: newer, started: '2026-06-09T10:00:00+09:00' })
    // replace the newer entry with updated counts
    await ws.upsertIndexEntry({
      ...base,
      dirName: newer,
      started: '2026-06-09T10:00:00+09:00',
      counts: { bug: 3 },
    })
    const index = await ws.loadIndex()
    const mine = index.sessions.filter((s) => s.dirName === older || s.dirName === newer)
    expect(mine.map((s) => s.dirName)).toEqual([newer, older])
    expect(mine[0].counts.bug).toBe(3)
    expect(index.sessions.filter((s) => s.dirName === newer)).toHaveLength(1)
  })

  it('shared config round-trips through .scout/config.yaml', async () => {
    const ws = new Workspace()
    const custom = {
      ...DEFAULT_CONFIG,
      defaultTimeboxMinutes: 45,
      tags: [{ name: 'RISK', key: 'r', color: '#123456', labelJa: 'リスク', labelEn: 'Risk' }],
    }
    await ws.saveSharedConfig(custom)
    const merged = await ws.loadSharedConfig(structuredClone(DEFAULT_CONFIG))
    expect(merged.defaultTimeboxMinutes).toBe(45)
    expect(merged.tags).toHaveLength(1)
    expect(merged.tags[0]).toEqual(custom.tags[0])
    // personal fields come from the base, not the shared file
    expect(merged.language).toBe(DEFAULT_CONFIG.language)
  })

  it('draft save/load/delete/list', async () => {
    const ws = new Workspace()
    const key = uniq('draft')
    await ws.saveDraft(key, { elapsedSeconds: 12 })
    expect(await ws.loadDraft<{ elapsedSeconds: number }>(key)).toEqual({ elapsedSeconds: 12 })
    expect(await ws.listDraftKeys()).toContain(key)
    await ws.deleteDraft(key)
    expect(await ws.loadDraft(key)).toBeUndefined()
    expect(await ws.listDraftKeys()).not.toContain(key)
  })
})
