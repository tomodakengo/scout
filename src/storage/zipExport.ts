/** Zip export — the download path for fallback mode, and a portable export for fs mode. */
import JSZip from 'jszip'
import { serializeSession } from '../lib/sessionFile'
import type { Workspace } from './store'

export async function exportSessionZip(ws: Workspace, dirName: string): Promise<Blob> {
  const zip = new JSZip()
  const session = await ws.loadSession(dirName)
  const folder = zip.folder(dirName)!

  if (session) {
    folder.file('session.md', serializeSession(session))
    const attachmentNames = new Set<string>()
    for (const e of session.entries) {
      for (const a of e.attachments) {
        attachmentNames.add(a.replace(/^attachments\//, ''))
      }
    }
    for (const name of attachmentNames) {
      const blob = await ws.readAttachment(dirName, name)
      if (blob) folder.folder('attachments')!.file(name, blob)
    }
  }
  return zip.generateAsync({ type: 'blob' })
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function downloadText(text: string, fileName: string): void {
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), fileName)
}
