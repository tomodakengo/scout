/**
 * Workspace: the single entry point for reading/writing the et-sessions folder.
 *
 * Two modes (plan.md §1.6, §2.5):
 * - 'fs'      : File System Access API against a user-picked folder.
 * - 'fallback': no FS Access support (or no folder picked yet). Everything is
 *               kept in IndexedDB under path-like keys and exported as zip.
 *
 * Layout (plan.md §2.2):
 *   charters/{id}-{slug}.md
 *   sessions/{YYYY-MM-DD-HHmm-slug}/session.md|report.md|attachments/*
 *   .scout/config.yaml | index.json
 */
import type { Charter, Session, ScoutIndex, SessionIndexEntry, ScoutConfig } from '../types'
import { SCHEMA_VERSION } from '../types'
import { parseCharter, serializeCharter, charterFileName } from '../lib/charterFile'
import { parseSession, isConflictCopyName } from '../lib/sessionFile'
import { parseConfigYaml, serializeConfigYaml } from '../lib/configFile'
import * as fs from './fs'
import { idbGet, idbSet, idbDelete, idbKeys, saveRootHandle, loadRootHandle, clearRootHandle } from './idb'

export type WorkspaceMode = 'fs' | 'fallback'
export type PermissionState = 'granted' | 'prompt' | 'disconnected'

export class Workspace {
  private root: FileSystemDirectoryHandle | null = null

  get mode(): WorkspaceMode {
    return this.root ? 'fs' : 'fallback'
  }

  get rootName(): string | null {
    return this.root?.name ?? null
  }

  /** Restore the previously-picked folder handle from IndexedDB (no prompt). */
  static async restore(): Promise<Workspace> {
    const ws = new Workspace()
    if (!fs.supportsFsAccess()) return ws
    try {
      const handle = await loadRootHandle()
      if (handle) ws.root = handle
    } catch {
      // corrupted handle — stay in fallback until the user reconnects
    }
    return ws
  }

  async permissionState(): Promise<PermissionState> {
    if (!this.root) return 'disconnected'
    return (await fs.verifyPermission(this.root, false)) ? 'granted' : 'prompt'
  }

  /** Re-request permission for the stored handle (must run in a user gesture). */
  async requestPermission(): Promise<boolean> {
    if (!this.root) return false
    return fs.verifyPermission(this.root, true)
  }

  /** Let the user pick (or change) the root folder. Returns false on cancel. */
  async pickFolder(): Promise<boolean> {
    const handle = await fs.pickRootDirectory()
    if (!handle) return false
    this.root = handle
    await saveRootHandle(handle)
    return true
  }

  async disconnect(): Promise<void> {
    this.root = null
    await clearRootHandle()
  }

  // ---------- low-level path IO (mode-dispatching) ----------

  private async writeText(path: string[], name: string, content: string): Promise<void> {
    if (this.root) {
      const dir = await fs.ensureDir(this.root, path)
      await fs.writeFile(dir, name, content)
    } else {
      await idbSet('blobs', [...path, name].join('/'), content)
    }
  }

  private async writeBlob(path: string[], name: string, blob: Blob): Promise<void> {
    if (this.root) {
      const dir = await fs.ensureDir(this.root, path)
      await fs.writeFile(dir, name, blob)
    } else {
      await idbSet('blobs', [...path, name].join('/'), blob)
    }
  }

  private async readText(path: string[], name: string): Promise<string | null> {
    if (this.root) {
      const dir = await fs.getDir(this.root, path)
      if (!dir) return null
      return fs.readTextFile(dir, name)
    }
    const v = await idbGet<string | Blob>('blobs', [...path, name].join('/'))
    if (v === undefined) return null
    return typeof v === 'string' ? v : await v.text()
  }

  async readAttachment(dirName: string, fileName: string): Promise<Blob | null> {
    if (this.root) {
      const dir = await fs.getDir(this.root, ['sessions', dirName, 'attachments'])
      if (!dir) return null
      return fs.readBlobFile(dir, fileName)
    }
    const v = await idbGet<string | Blob>(
      'blobs',
      ['sessions', dirName, 'attachments', fileName].join('/'),
    )
    return v instanceof Blob ? v : null
  }

  private async listFileNames(path: string[]): Promise<string[]> {
    if (this.root) {
      const dir = await fs.getDir(this.root, path)
      if (!dir) return []
      return fs.listFiles(dir)
    }
    const prefix = path.join('/') + '/'
    const keys = await idbKeys('blobs')
    return keys
      .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map((k) => k.slice(prefix.length))
      .sort()
  }

  private async listDirNames(path: string[]): Promise<string[]> {
    if (this.root) {
      const dir = await fs.getDir(this.root, path)
      if (!dir) return []
      return fs.listDirs(dir)
    }
    const prefix = path.join('/') + '/'
    const keys = await idbKeys('blobs')
    const dirs = new Set<string>()
    for (const k of keys) {
      if (!k.startsWith(prefix)) continue
      const rest = k.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash > 0) dirs.add(rest.slice(0, slash))
    }
    return [...dirs].sort()
  }

  // ---------- charters ----------

  async listCharters(): Promise<Charter[]> {
    const names = await this.listFileNames(['charters'])
    const out: Charter[] = []
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      const text = await this.readText(['charters'], name)
      if (text !== null) out.push(parseCharter(text, name))
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  async saveCharter(c: Charter): Promise<void> {
    await this.writeText(['charters'], charterFileName(c), serializeCharter(c))
  }

  // ---------- sessions ----------

  async writeSessionFile(dirName: string, content: string): Promise<void> {
    await this.writeText(['sessions', dirName], 'session.md', content)
  }

  async writeReport(dirName: string, content: string): Promise<void> {
    await this.writeText(['sessions', dirName], 'report.md', content)
  }

  async writeAttachment(dirName: string, fileName: string, blob: Blob): Promise<void> {
    await this.writeBlob(['sessions', dirName, 'attachments'], fileName, blob)
  }

  async loadSession(dirName: string): Promise<Session | null> {
    const text = await this.readText(['sessions', dirName], 'session.md')
    if (text === null) return null
    return parseSession(text, dirName)
  }

  async listSessionDirs(): Promise<string[]> {
    return this.listDirNames(['sessions'])
  }

  /** Drive conflict copies in a session dir, e.g. "session (1).md" (plan.md §2.5). */
  async detectConflictCopies(dirName: string): Promise<string[]> {
    const names = await this.listFileNames(['sessions', dirName])
    return names.filter((n) => n !== 'session.md' && isConflictCopyName(n))
  }

  // ---------- index ----------

  async loadIndex(): Promise<ScoutIndex> {
    const text = await this.readText(['.scout'], 'index.json')
    if (text) {
      try {
        const parsed = JSON.parse(text) as ScoutIndex
        if (Array.isArray(parsed.sessions)) return parsed
      } catch {
        // fall through to rebuild
      }
    }
    return this.rebuildIndex()
  }

  /** index.json is a rebuildable cache — scan sessions/ when missing/corrupt. */
  async rebuildIndex(): Promise<ScoutIndex> {
    const dirs = await this.listSessionDirs()
    const sessions: SessionIndexEntry[] = []
    for (const dirName of dirs) {
      const s = await this.loadSession(dirName)
      if (!s) continue
      sessions.push({
        dirName,
        charterId: s.charterId,
        charterTitle: s.charterTitle,
        started: s.started,
        durationMinutes: s.durationMinutes,
        counts: s.counts,
      })
    }
    sessions.sort((a, b) => b.started.localeCompare(a.started))
    const index: ScoutIndex = { schema: SCHEMA_VERSION, sessions }
    await this.writeText(['.scout'], 'index.json', JSON.stringify(index, null, 2))
    return index
  }

  async upsertIndexEntry(entry: SessionIndexEntry): Promise<ScoutIndex> {
    const index = await this.loadIndex()
    const i = index.sessions.findIndex((s) => s.dirName === entry.dirName)
    if (i >= 0) index.sessions[i] = entry
    else index.sessions.unshift(entry)
    index.sessions.sort((a, b) => b.started.localeCompare(a.started))
    await this.writeText(['.scout'], 'index.json', JSON.stringify(index, null, 2))
    return index
  }

  // ---------- config ----------

  /** Merge shareable settings from .scout/config.yaml into the given config. */
  async loadSharedConfig(base: ScoutConfig): Promise<ScoutConfig> {
    const text = await this.readText(['.scout'], 'config.yaml')
    if (!text) return base
    const { tags, defaultTimeboxMinutes } = parseConfigYaml(text)
    return { ...base, tags, defaultTimeboxMinutes }
  }

  async saveSharedConfig(config: ScoutConfig): Promise<void> {
    await this.writeText(['.scout'], 'config.yaml', serializeConfigYaml(config))
  }

  // ---------- drafts (crash recovery, plan.md §2.5) ----------

  async saveDraft(dirName: string, data: unknown): Promise<void> {
    await idbSet('drafts', dirName, data)
  }

  async loadDraft<T>(dirName: string): Promise<T | undefined> {
    return idbGet<T>('drafts', dirName)
  }

  async deleteDraft(dirName: string): Promise<void> {
    await idbDelete('drafts', dirName)
  }

  async listDraftKeys(): Promise<string[]> {
    return idbKeys('drafts')
  }
}
