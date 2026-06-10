// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionRunner, type DraftShape } from './sessionRunner'
import { Workspace } from '../storage/store'
import { DEFAULT_CONFIG, type Charter } from '../types'

// Only fake the interval clock the runner uses; fake-indexeddb and the
// flush promises need real setTimeout/microtasks to make progress.
const settle = () => new Promise((r) => setTimeout(r, 25))

function makeCharter(over: Partial<Charter> = {}): Charter {
  return {
    id: '2026-0001',
    title: '決済フローの異常系を探索する',
    area: 'checkout/payment',
    priority: 'high',
    risks: ['i18n漏れ'],
    timeboxMinutes: 90,
    status: 'active',
    created: '2026-06-08',
    mission: '異常系を探索する',
    outOfScope: '',
    slug: 'payment-error-paths',
    ...over,
  }
}

describe('SessionRunner', () => {
  let runner: SessionRunner
  let ws: Workspace

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    runner = new SessionRunner()
    ws = new Workspace() // fallback mode → fake IndexedDB
  })

  afterEach(() => {
    runner.reset()
    vi.useRealTimers()
  })

  it('start: running in setup mode with a spec-compliant dirName', () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    const s = runner.getSnapshot()
    expect(s.status).toBe('running')
    expect(s.mode).toBe('setup')
    expect(s.dirName).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-payment-error-paths$/)
    expect(s.timeboxMinutes).toBe(90)
    expect(s.entries).toEqual([])
  })

  it('ticks elapsed time and attributes it to the active mode', () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    vi.advanceTimersByTime(3000)
    expect(runner.getSnapshot().elapsedSeconds).toBe(3)
    expect(runner.getSnapshot().modeSeconds.setup).toBe(3)

    runner.setMode('test')
    vi.advanceTimersByTime(2000)
    expect(runner.getSnapshot().modeSeconds.test).toBe(2)
    expect(runner.getSnapshot().modeSeconds.setup).toBe(3)
    expect(runner.getSnapshot().elapsedSeconds).toBe(5)
  })

  it('pause excludes time from elapsed and counts it separately', () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    vi.advanceTimersByTime(10_000)
    runner.pause()
    vi.advanceTimersByTime(7000)
    expect(runner.getSnapshot().status).toBe('paused')
    expect(runner.getSnapshot().elapsedSeconds).toBe(10)
    expect(runner.getSnapshot().pausedSeconds).toBe(7)

    runner.resume()
    vi.advanceTimersByTime(1000)
    expect(runner.getSnapshot().elapsedSeconds).toBe(11)
    expect(runner.getSnapshot().pausedSeconds).toBe(7)
  })

  it('setMode is ignored while paused', () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    runner.pause()
    runner.setMode('test')
    expect(runner.getSnapshot().mode).toBe('setup')
  })

  it('addEntry stamps the current elapsed time and flushes session.md', async () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    vi.advanceTimersByTime(65_000)
    runner.addEntry('BUG', '全角入力時のエラーメッセージがi18n漏れ #i18n')
    await settle()

    const snap = runner.getSnapshot()
    expect(snap.entries).toHaveLength(1)
    expect(snap.entries[0].atSeconds).toBe(65)

    const onDisk = await ws.loadSession(snap.dirName)
    expect(onDisk).not.toBeNull()
    expect(onDisk!.entries).toHaveLength(1)
    expect(onDisk!.entries[0].tag).toBe('BUG')
    expect(onDisk!.entries[0].atSeconds).toBe(65)
    expect(onDisk!.counts.bug).toBe(1)
  })

  it('addDetail nests bullets under the targeted entry', async () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    runner.addEntry('BUG', 'エラー文言が英語')
    runner.addDetail(0, '再現: カード番号欄に「１２３４」→ 確定')
    runner.addDetail(0, '期待: 日本語エラー / 実際: "Invalid card number"')
    await settle()

    const onDisk = await ws.loadSession(runner.getSnapshot().dirName)
    expect(onDisk!.entries[0].details).toHaveLength(2)
    expect(onDisk!.entries[0].details[0]).toContain('再現')
  })

  it('nextSerial issues zero-padded serials', () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    expect(runner.nextSerial()).toBe('0001')
    expect(runner.nextSerial()).toBe('0002')
  })

  it('recordAttachment anchors to the last entry, or creates a NOTE on an empty timeline', () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    runner.recordAttachment('0001-fullscreen.png')
    let entries = runner.getSnapshot().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].tag).toBe('NOTE')
    expect(entries[0].attachments).toEqual(['attachments/0001-fullscreen.png'])

    runner.addEntry('BUG', 'レイアウト崩れ')
    runner.recordAttachment('0002-annotated.png')
    entries = runner.getSnapshot().entries
    expect(entries).toHaveLength(2)
    expect(entries[1].attachments).toEqual(['attachments/0002-annotated.png'])
  })

  it('end finalizes session.md, upserts the index, and clears the draft', async () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    vi.advanceTimersByTime(90_000)
    runner.addEntry('FINDING', 'バリデーションは堅い')
    await settle()
    const dirName = runner.getSnapshot().dirName

    const session = await runner.end()
    expect(session.ended).not.toBeNull()
    expect(session.durationMinutes).toBe(2) // 90s rounds to 2
    expect(session.counts.finding).toBe(1)

    const onDisk = await ws.loadSession(dirName)
    expect(onDisk!.ended).not.toBeNull()

    const index = await ws.loadIndex()
    expect(index.sessions.some((e) => e.dirName === dirName)).toBe(true)

    expect(await ws.loadDraft(dirName)).toBeUndefined()
  })

  it('persists a crash-recovery draft and resumes from it paused', async () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    vi.advanceTimersByTime(30_000)
    runner.setMode('test')
    runner.addEntry('TEST', '探索メモ')
    await settle()
    const dirName = runner.getSnapshot().dirName

    const draft = await ws.loadDraft<DraftShape>(dirName)
    expect(draft).toBeDefined()
    expect(draft!.entries).toHaveLength(1)
    expect(draft!.elapsedSeconds).toBe(30)

    // simulate a reload: a fresh runner resumes from the draft
    const revived = new SessionRunner()
    revived.resumeFromDraft(draft!, makeCharter(), ws)
    const s = revived.getSnapshot()
    expect(s.status).toBe('paused')
    expect(s.elapsedSeconds).toBe(30)
    expect(s.mode).toBe('test')
    expect(s.entries).toHaveLength(1)
    revived.reset()
  })

  it('flush surfaces write errors and retries dirty state on the next flush', async () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    runner.addEntry('TEST', '1st')
    await settle()

    const original = ws.writeSessionFile.bind(ws)
    const spy = vi
      .spyOn(ws, 'writeSessionFile')
      .mockRejectedValueOnce(new Error('disk detached'))
    runner.addEntry('TEST', '2nd')
    await settle()
    expect(runner.getSnapshot().flushError).toContain('disk detached')

    spy.mockImplementation(original)
    await runner.flush()
    await settle()
    expect(runner.getSnapshot().flushError).toBeNull()
    const onDisk = await ws.loadSession(runner.getSnapshot().dirName)
    expect(onDisk!.entries).toHaveLength(2)
  })

  it('reset returns the runner to idle', () => {
    runner.start(makeCharter(), DEFAULT_CONFIG, ws)
    runner.reset()
    expect(runner.getSnapshot().status).toBe('idle')
    expect(runner.getSnapshot().entries).toEqual([])
  })
})
