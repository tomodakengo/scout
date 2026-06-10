/**
 * Automatic license renewal client.
 *
 * Privacy contract: this is the ONLY network call the app ever makes, it
 * sends nothing but the license token itself, and it only runs when a
 * renewal URL is configured AND a license is present.
 *
 * Flow: starting RENEW_WINDOW_DAYS before exp (and through the grace
 * period), POST { token } to the renewal endpoint. The server re-validates
 * (billing + revocation) and returns a freshly signed token. The new token
 * is verified locally before being stored — same lid/sub, later exp.
 */
import { verifyLicense, type VerifyOptions } from './license'

export const RENEW_WINDOW_DAYS = 7
/** Min interval between renewal attempts. */
export const RENEW_ATTEMPT_INTERVAL_MS = 6 * 60 * 60 * 1000
const LAST_ATTEMPT_KEY = 'scout.license.lastRenewAttempt.v1'

export const DEFAULT_RENEWAL_URL: string =
  (import.meta.env?.VITE_LICENSE_RENEWAL_URL as string | undefined) ?? ''

export interface RenewalDeps {
  url?: string
  now?: number
  fetchFn?: typeof fetch
  /** verification overrides (tests) */
  verifyOpts?: VerifyOptions
  /** bypass the attempt throttle (the manual "renew now" button) */
  force?: boolean
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

export type RenewalResult =
  | { outcome: 'renewed'; token: string }
  | { outcome: 'skipped'; reason: 'no-url' | 'no-token' | 'not-due' | 'throttled' | 'invalid-token' }
  | { outcome: 'failed'; reason: string }

/** Whether the token is inside the auto-renew window (or past exp). */
export function isRenewalDue(token: string, now: number, verifyOpts?: VerifyOptions): boolean {
  const info = verifyLicense(token, { ...verifyOpts, now })
  if (!info.payload) return false
  if (info.status === 'invalid') return false
  return now >= info.payload.exp - RENEW_WINDOW_DAYS * 86400
}

export async function maybeRenewLicense(
  token: string | null | undefined,
  deps: RenewalDeps = {},
): Promise<RenewalResult> {
  const url = deps.url ?? DEFAULT_RENEWAL_URL
  if (!url) return { outcome: 'skipped', reason: 'no-url' }
  if (!token || !token.trim()) return { outcome: 'skipped', reason: 'no-token' }

  const now = deps.now ?? Math.floor(Date.now() / 1000)
  const info = verifyLicense(token, { ...deps.verifyOpts, now })
  if (info.status === 'invalid' || info.status === 'none') {
    return { outcome: 'skipped', reason: 'invalid-token' }
  }
  if (!deps.force && !isRenewalDue(token, now, deps.verifyOpts)) {
    return { outcome: 'skipped', reason: 'not-due' }
  }

  const storage = deps.storage ?? localStorage
  if (!deps.force) {
    const last = Number(storage.getItem(LAST_ATTEMPT_KEY) ?? 0)
    if (Date.now() - last < RENEW_ATTEMPT_INTERVAL_MS) {
      return { outcome: 'skipped', reason: 'throttled' }
    }
  }
  storage.setItem(LAST_ATTEMPT_KEY, String(Date.now()))

  const fetchFn = deps.fetchFn ?? fetch
  let newToken: string
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) return { outcome: 'failed', reason: `http-${res.status}` }
    const body = (await res.json()) as { token?: unknown }
    if (typeof body.token !== 'string') return { outcome: 'failed', reason: 'malformed-response' }
    newToken = body.token
  } catch {
    return { outcome: 'failed', reason: 'network' }
  }

  // never store a server response we can't verify ourselves
  const renewed = verifyLicense(newToken, { ...deps.verifyOpts, now })
  if (renewed.status !== 'valid' || !renewed.payload || !info.payload) {
    return { outcome: 'failed', reason: 'unverifiable-response' }
  }
  if (renewed.payload.lid !== info.payload.lid || renewed.payload.sub !== info.payload.sub) {
    return { outcome: 'failed', reason: 'identity-mismatch' }
  }
  if (renewed.payload.exp <= info.payload.exp) {
    return { outcome: 'failed', reason: 'not-extended' }
  }
  return { outcome: 'renewed', token: newToken }
}
