/**
 * SessionRunner — the running-session engine behind S2.
 *
 * Owns the timer (1s tick), TBS mode stopwatch, pause bookkeeping, the
 * timeline, and persistence: IndexedDB draft on every mutation (crash
 * recovery) plus session.md flush on entry commit and every 30s (plan.md §2.5,
 * append-only friendly: we rewrite the whole file but its content only grows).
 *
 * Framework-free; React subscribes via useSyncExternalStore.
 */
import type { Charter, Session, SessionMode, TimelineEntry, ScoutConfig, TbsMinutes } from '../types'
import { SCHEMA_VERSION } from '../types'
import { serializeSession, computeCounts } from '../lib/sessionFile'
import { sessionDirStamp, isoWithOffset } from '../lib/time'
import { attachmentSerial } from '../lib/slug'
import type { Workspace } from '../storage/store'

export type RunnerStatus = 'idle' | 'running' | 'paused' | 'ended'

export interface RunnerSnapshot {
  status: RunnerStatus
  dirName: string
  charter: Charter | null
  /** active seconds (pauses excluded) */
  elapsedSeconds: number
  pausedSeconds: number
  timeboxMinutes: number
  mode: SessionMode
  modeSeconds: Record<SessionMode, number>
  entries: TimelineEntry[]
  attachmentCounter: number
  /** last flush error, surfaced in the header */
  flushError: string | null
}

interface DraftShape {
  dirName: string
  charterId: string
  charterTitle: string
  started: string
  elapsedSeconds: number
  pausedSeconds: number
  timeboxMinutes: number
  mode: SessionMode
  modeSeconds: Record<SessionMode, number>
  entries: TimelineEntry[]
  attachmentCounter: number
  tester: string
  environment: string
}

const FLUSH_INTERVAL_MS = 30_000

export class SessionRunner {
  private snapshot: RunnerSnapshot = SessionRunner.idleSnapshot()
  private listeners = new Set<() => void>()
  private tickHandle: number | null = null
  private flushHandle: number | null = null
  private started = ''
  private tester = ''
  private environment = ''
  private ws: Workspace | null = null
  private dirty = false

  private static idleSnapshot(): RunnerSnapshot {
    return {
      status: 'idle',
      dirName: '',
      charter: null,
      elapsedSeconds: 0,
      pausedSeconds: 0,
      timeboxMinutes: 90,
      mode: 'test',
      modeSeconds: { test: 0, bug_investigation: 0, setup: 0 },
      entries: [],
      attachmentCounter: 0,
      flushError: null,
    }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): RunnerSnapshot => this.snapshot

  private emit(patch: Partial<RunnerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const fn of this.listeners) fn()
  }

  start(charter: Charter, config: ScoutConfig, ws: Workspace): void {
    const now = new Date()
    this.ws = ws
    this.started = isoWithOffset(now)
    this.tester = config.tester
    this.environment = config.environment
    this.dirty = true
    this.emit({
      ...SessionRunner.idleSnapshot(),
      status: 'running',
      dirName: `${sessionDirStamp(now)}-${charter.slug}`,
      charter,
      timeboxMinutes: charter.timeboxMinutes || config.defaultTimeboxMinutes,
      mode: 'setup',
    })
    this.startTick()
    this.flushHandle = window.setInterval(() => void this.flush(), FLUSH_INTERVAL_MS)
    void this.persistDraft()
  }

  /** Resume a crashed/reloaded session from its IndexedDB draft. */
  resumeFromDraft(draft: DraftShape, charter: Charter | null, ws: Workspace): void {
    this.ws = ws
    this.started = draft.started
    this.tester = draft.tester
    this.environment = draft.environment
    this.dirty = true
    this.emit({
      status: 'paused',
      dirName: draft.dirName,
      charter,
      elapsedSeconds: draft.elapsedSeconds,
      pausedSeconds: draft.pausedSeconds,
      timeboxMinutes: draft.timeboxMinutes,
      mode: draft.mode,
      modeSeconds: draft.modeSeconds,
      entries: draft.entries,
      attachmentCounter: draft.attachmentCounter,
      flushError: null,
    })
    this.flushHandle = window.setInterval(() => void this.flush(), FLUSH_INTERVAL_MS)
  }

  private startTick() {
    this.stopTick()
    this.tickHandle = window.setInterval(() => {
      const s = this.snapshot
      if (s.status === 'running') {
        this.emit({
          elapsedSeconds: s.elapsedSeconds + 1,
          modeSeconds: { ...s.modeSeconds, [s.mode]: s.modeSeconds[s.mode] + 1 },
        })
      } else if (s.status === 'paused') {
        this.emit({ pausedSeconds: s.pausedSeconds + 1 })
      }
    }, 1000)
  }

  private stopTick() {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle)
      this.tickHandle = null
    }
  }

  setMode(mode: SessionMode): void {
    if (this.snapshot.status !== 'running') return
    this.emit({ mode })
    void this.persistDraft()
  }

  pause(): void {
    if (this.snapshot.status !== 'running') return
    this.emit({ status: 'paused' })
    void this.persistDraft()
  }

  resume(): void {
    if (this.snapshot.status !== 'paused') return
    this.emit({ status: 'running' })
    void this.persistDraft()
  }

  addEntry(tag: string, text: string): TimelineEntry {
    const entry: TimelineEntry = {
      atSeconds: this.snapshot.elapsedSeconds,
      tag,
      text,
      attachments: [],
      details: [],
    }
    this.dirty = true
    this.emit({ entries: [...this.snapshot.entries, entry] })
    void this.persistDraft()
    void this.flush()
    return entry
  }

  /** Add a detail bullet (repro/expected/actual) under the i-th entry. */
  addDetail(entryIndex: number, detail: string): void {
    const entries = this.snapshot.entries.map((e, i) =>
      i === entryIndex ? { ...e, details: [...e.details, detail] } : e,
    )
    this.dirty = true
    this.emit({ entries })
    void this.persistDraft()
    void this.flush()
  }

  /** Reserve the next attachment serial ("0001", ...). */
  nextSerial(): string {
    const n = this.snapshot.attachmentCounter + 1
    this.emit({ attachmentCounter: n })
    return attachmentSerial(n)
  }

  /**
   * Record an attachment on the timeline. Attaches to the last entry when one
   * exists; otherwise creates a NOTE entry to anchor it.
   */
  recordAttachment(fileName: string): void {
    const rel = `attachments/${fileName}`
    const entries = [...this.snapshot.entries]
    if (entries.length === 0) {
      entries.push({
        atSeconds: this.snapshot.elapsedSeconds,
        tag: 'NOTE',
        text: 'スクリーンショット',
        attachments: [rel],
        details: [],
      })
    } else {
      const last = entries[entries.length - 1]
      entries[entries.length - 1] = { ...last, attachments: [...last.attachments, rel] }
    }
    this.dirty = true
    this.emit({ entries })
    void this.persistDraft()
    void this.flush()
  }

  /** Build the Session value from current state. */
  toSession(ended: boolean): Session {
    const s = this.snapshot
    const tbs: TbsMinutes = {
      test: Math.round(s.modeSeconds.test / 60),
      bug_investigation: Math.round(s.modeSeconds.bug_investigation / 60),
      setup: Math.round(s.modeSeconds.setup / 60),
    }
    return {
      dirName: s.dirName,
      charterId: s.charter?.id ?? '',
      charterTitle: s.charter?.title ?? '',
      started: this.started,
      ended: ended ? isoWithOffset() : null,
      durationMinutes: Math.round(s.elapsedSeconds / 60),
      pausedMinutes: Math.round(s.pausedSeconds / 60),
      tester: this.tester,
      environment: this.environment,
      tbs,
      coveragePercent: null,
      counts: computeCounts(s.entries),
      entries: s.entries,
      debrief: null,
      schema: SCHEMA_VERSION,
    }
  }

  async flush(): Promise<void> {
    if (!this.ws || !this.dirty || !this.snapshot.dirName) return
    this.dirty = false
    try {
      await this.ws.writeSessionFile(this.snapshot.dirName, serializeSession(this.toSession(false)))
      if (this.snapshot.flushError) this.emit({ flushError: null })
    } catch (e) {
      this.dirty = true
      this.emit({ flushError: e instanceof Error ? e.message : String(e) })
    }
  }

  private async persistDraft(): Promise<void> {
    if (!this.ws || !this.snapshot.dirName) return
    const s = this.snapshot
    const draft: DraftShape = {
      dirName: s.dirName,
      charterId: s.charter?.id ?? '',
      charterTitle: s.charter?.title ?? '',
      started: this.started,
      elapsedSeconds: s.elapsedSeconds,
      pausedSeconds: s.pausedSeconds,
      timeboxMinutes: s.timeboxMinutes,
      mode: s.mode,
      modeSeconds: s.modeSeconds,
      entries: s.entries,
      attachmentCounter: s.attachmentCounter,
      tester: this.tester,
      environment: this.environment,
    }
    try {
      await this.ws.saveDraft(s.dirName, draft)
    } catch {
      // draft persistence is best-effort
    }
  }

  /** End the session: final flush, write index, clear draft. Returns the Session. */
  async end(): Promise<Session> {
    this.stopTick()
    if (this.flushHandle !== null) {
      clearInterval(this.flushHandle)
      this.flushHandle = null
    }
    const session = this.toSession(true)
    this.emit({ status: 'ended' })
    if (this.ws) {
      try {
        await this.ws.writeSessionFile(session.dirName, serializeSession(session))
        await this.ws.upsertIndexEntry({
          dirName: session.dirName,
          charterId: session.charterId,
          charterTitle: session.charterTitle,
          started: session.started,
          durationMinutes: session.durationMinutes,
          counts: session.counts,
        })
        await this.ws.deleteDraft(session.dirName)
      } catch (e) {
        this.emit({ flushError: e instanceof Error ? e.message : String(e) })
      }
    }
    return session
  }

  /** Drop all runner state (after debrief is saved). */
  reset(): void {
    this.stopTick()
    if (this.flushHandle !== null) {
      clearInterval(this.flushHandle)
      this.flushHandle = null
    }
    this.ws = null
    this.snapshot = SessionRunner.idleSnapshot()
    for (const fn of this.listeners) fn()
  }
}

export type { DraftShape }
