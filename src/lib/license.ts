/**
 * Signed license tokens (offline-verifiable, Ed25519).
 *
 * Format: `SCOUT1.<base64url(payload JSON)>.<base64url(signature)>`
 * The signature covers the ASCII bytes of `SCOUT1.<base64url(payload)>`
 * (prefix included for domain separation).
 *
 * Threat model — stated honestly:
 * - Forging a key without the private key: cryptographically prevented.
 * - Tampering with this client to skip the check: NOT preventable in any
 *   fully client-side app; the renewal endpoint + revocation is where
 *   long-term enforcement lives.
 * - Public keys are keyed by `kid` so signing keys can be rotated without
 *   invalidating issued licenses.
 */
import { ed25519 } from '@noble/curves/ed25519.js'

export interface LicensePayload {
  /** payload schema version */
  v: 1
  /** license id (revocation handle) */
  lid: string
  /** licensee (email) */
  sub: string
  plan: 'pro'
  /** issued at (unix seconds) */
  iat: number
  /** expires at (unix seconds) */
  exp: number
  /** signing key id */
  kid: string
}

export type LicenseStatus = 'none' | 'invalid' | 'valid' | 'grace' | 'expired'

export interface LicenseInfo {
  status: LicenseStatus
  payload: LicensePayload | null
  /** machine-readable reason for invalid */
  reason?: string
}

export const TOKEN_PREFIX = 'SCOUT1'

/** Days after exp during which Pro stays unlocked (offline-first grace). */
export const GRACE_DAYS = 14

/**
 * Production signing public keys (hex), keyed by kid. Generate a keypair with
 * `node tools/license-keygen.mjs gen-keypair` and either replace the k1 value
 * or set VITE_LICENSE_PUBKEY_K1 at build time. The committed default is a
 * placeholder that validates nothing real.
 */
export const PUBLIC_KEYS: Record<string, string> = {
  k1:
    (import.meta.env?.VITE_LICENSE_PUBKEY_K1 as string | undefined) ??
    '0000000000000000000000000000000000000000000000000000000000000000',
}

// --- base64url helpers (no padding) ---

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function b64urlDecode(text: string): Uint8Array | null {
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

// --- parsing / verification ---

interface ParsedToken {
  payloadB64: string
  payload: LicensePayload
  signature: Uint8Array
}

export function parseLicense(token: string): ParsedToken | null {
  const parts = token.trim().split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null
  const payloadBytes = b64urlDecode(parts[1])
  const signature = b64urlDecode(parts[2])
  if (!payloadBytes || !signature || signature.length !== 64) return null
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes))
  } catch {
    return null
  }
  if (!isPayload(payload)) return null
  return { payloadB64: parts[1], payload, signature }
}

function isPayload(p: unknown): p is LicensePayload {
  if (typeof p !== 'object' || p === null) return false
  const o = p as Record<string, unknown>
  return (
    o.v === 1 &&
    typeof o.lid === 'string' &&
    o.lid.length > 0 &&
    typeof o.sub === 'string' &&
    o.plan === 'pro' &&
    typeof o.iat === 'number' &&
    typeof o.exp === 'number' &&
    typeof o.kid === 'string'
  )
}

export interface VerifyOptions {
  /** unix seconds; defaults to now */
  now?: number
  /** kid → public key hex; defaults to PUBLIC_KEYS */
  keys?: Record<string, string>
  graceDays?: number
}

export function verifyLicense(token: string | null | undefined, opts: VerifyOptions = {}): LicenseInfo {
  if (!token || !token.trim()) return { status: 'none', payload: null }
  const parsed = parseLicense(token)
  if (!parsed) return { status: 'invalid', payload: null, reason: 'malformed' }

  const keys = opts.keys ?? PUBLIC_KEYS
  const pubHex = keys[parsed.payload.kid]
  if (!pubHex) return { status: 'invalid', payload: null, reason: 'unknown-kid' }
  const pub = hexToBytes(pubHex)
  if (!pub || pub.length !== 32) return { status: 'invalid', payload: null, reason: 'bad-pubkey' }

  const message = new TextEncoder().encode(`${TOKEN_PREFIX}.${parsed.payloadB64}`)
  let ok = false
  try {
    ok = ed25519.verify(parsed.signature, message, pub)
  } catch {
    ok = false
  }
  if (!ok) return { status: 'invalid', payload: null, reason: 'bad-signature' }

  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const graceSeconds = (opts.graceDays ?? GRACE_DAYS) * 86400
  if (now < parsed.payload.exp) return { status: 'valid', payload: parsed.payload }
  if (now < parsed.payload.exp + graceSeconds) return { status: 'grace', payload: parsed.payload }
  return { status: 'expired', payload: parsed.payload }
}

/** Entitlement check used by Pro feature gates. */
export function isPro(info: LicenseInfo): boolean {
  return (info.status === 'valid' || info.status === 'grace') && info.payload?.plan === 'pro'
}

/** Convenience: verify straight from a stored token. */
export function licenseFromToken(token: string | null | undefined): LicenseInfo {
  return verifyLicense(token)
}
