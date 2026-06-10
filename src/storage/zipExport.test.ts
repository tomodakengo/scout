// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { exportSessionZip, downloadText } from './zipExport'
import { Workspace } from './store'
import { serializeSession } from '../lib/sessionFile'
import { SCHEMA_VERSION, type Session } from '../types'

function makeSession(dirName: string): Session {
  return {
    dirName,
    charterId: '2026-0001',
    charterTitle: '決済フロー',
    started: '2026-06-10T14:30:00+09:00',
    ended: '2026-06-10T16:00:00+09:00',
    durationMinutes: 90,
    pausedMinutes: 0,
    tester: 'yuden',
    environment: 'stg',
    tbs: { test: 60, bug_investigation: 20, setup: 10 },
    coveragePercent: 70,
    counts: { bug: 1 },
    entries: [
      {
        atSeconds: 720,
        tag: 'BUG',
        text: 'i18n漏れ',
        attachments: ['attachments/0001-annotated.png'],
        details: ['再現: 全角入力'],
      },
    ],
    debrief: null,
    schema: SCHEMA_VERSION,
  }
}

describe('exportSessionZip', () => {
  it('packs session.md and referenced attachments', async () => {
    const ws = new Workspace()
    const dirName = '2026-06-10-1430-zip-test'
    await ws.writeSessionFile(dirName, serializeSession(makeSession(dirName)))
    await ws.writeAttachment(
      dirName,
      '0001-annotated.png',
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    )

    // sanity: the attachment must be readable before export
    expect(await ws.readAttachment(dirName, '0001-annotated.png')).not.toBeNull()

    const blob = await exportSessionZip(ws, dirName)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())

    const sessionFile = zip.file(`${dirName}/session.md`)
    expect(sessionFile).not.toBeNull()
    const text = await sessionFile!.async('string')
    expect(text).toContain('- 12:00 [BUG] i18n漏れ')
    expect(text).toContain('schema: scout/1')

    const attachment = zip.file(`${dirName}/attachments/0001-annotated.png`)
    expect(attachment).not.toBeNull()
    expect((await attachment!.async('uint8array')).length).toBe(3)
  })
})

describe('downloadText', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates an object URL and clicks a temporary anchor', () => {
    const createUrl = vi.fn(() => 'blob:fake')
    const revokeUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createUrl, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeUrl, configurable: true })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadText('# report', 'report.md')

    expect(createUrl).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
  })
})
