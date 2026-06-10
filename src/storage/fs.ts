/**
 * File System Access API adapter. All writes go through here.
 * When the API is unavailable (Firefox/Safari) the app runs in zip-fallback
 * mode: data lives in IndexedDB and is exported as a zip (see zipExport.ts).
 */

export function supportsFsAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function pickRootDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

/** true when we currently hold (or can silently regain) readwrite permission. */
export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
  ask: boolean,
): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  if (!ask) return false
  return (await handle.requestPermission(opts)) === 'granted'
}

export async function ensureDir(
  root: FileSystemDirectoryHandle,
  path: string[],
): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const part of path) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  return dir
}

export async function getDir(
  root: FileSystemDirectoryHandle,
  path: string[],
): Promise<FileSystemDirectoryHandle | null> {
  let dir = root
  for (const part of path) {
    try {
      dir = await dir.getDirectoryHandle(part)
    } catch {
      return null
    }
  }
  return dir
}

export async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: string | Blob,
): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(data)
  await w.close()
}

export async function readTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string | null> {
  try {
    const fh = await dir.getFileHandle(name)
    const f = await fh.getFile()
    return await f.text()
  } catch {
    return null
  }
}

export async function readBlobFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<Blob | null> {
  try {
    const fh = await dir.getFileHandle(name)
    return await fh.getFile()
  } catch {
    return null
  }
}

export async function listFiles(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') names.push(name)
  }
  return names.sort()
}

export async function listDirs(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') names.push(name)
  }
  return names.sort()
}
