/**
 * IndexedDB layer. Two jobs:
 * 1. persist the root directory handle across reloads (handles are structured-cloneable)
 * 2. act as the primary store while a session is running (crash recovery), and as
 *    the only store in zip-fallback mode (attachments included).
 */

const DB_NAME = 'scout'
const DB_VERSION = 1
const STORES = ['handles', 'drafts', 'blobs', 'kv'] as const
type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  await tx(store, 'readwrite', (s) => s.put(value, key))
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(key))
}

export async function idbKeys(store: StoreName): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys())
  return keys.map(String)
}

// --- typed helpers ---

export async function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await idbSet('handles', 'root', handle)
}

export async function loadRootHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return idbGet<FileSystemDirectoryHandle>('handles', 'root')
}

export async function clearRootHandle(): Promise<void> {
  await idbDelete('handles', 'root')
}
