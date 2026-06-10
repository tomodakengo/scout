/**
 * Tests for src/lib/license.ts
 *
 * Signing replicates tools/license-keygen.mjs:
 *   message = utf8("SCOUT1.<payloadB64url>")
 *   sig = ed25519.sign(message, privKey)
 *   token = "SCOUT1.<payloadB64url>.<sigB64url>"
 */

import { describe, it, expect } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  verifyLicense,
  isPro,
  b64urlEncode,
  b64urlDecode,
  hexToBytes,
  TOKEN_PREFIX,
  GRACE_DAYS,
  type LicensePayload,
} from './license'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function genKeypair() {
  const priv = ed25519.utils.randomSecretKey()
  const pub = ed25519.getPublicKey(priv)
  const pubHex = Buffer.from(pub).toString('hex')
  return { priv, pubHex }
}

function makePayload(overrides: Partial<LicensePayload> & { exp?: number } = {}, nowSec: number = Math.floor(Date.now() / 1000)): LicensePayload {
  return {
    v: 1,
    lid: 'lid-test-001',
    sub: 'user@example.com',
    plan: 'pro',
    iat: nowSec,
    exp: nowSec + 365 * 86400,
    kid: 'k1',
    ...overrides,
  }
}

function signToken(payload: LicensePayload, privKey: Uint8Array): string {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const payloadB64 = Buffer.from(payloadBytes).toString('base64url')
  const message = new TextEncoder().encode(`${TOKEN_PREFIX}.${payloadB64}`)
  const sig = ed25519.sign(message, privKey)
  const sigB64 = Buffer.from(sig).toString('base64url')
  return `${TOKEN_PREFIX}.${payloadB64}.${sigB64}`
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('verifyLicense — happy path', () => {
  it('returns status valid for a correctly signed token with exp in the future', () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const payload = makePayload({}, now)
    const token = signToken(payload, priv)

    const info = verifyLicense(token, { now, keys: { k1: pubHex } })

    expect(info.status).toBe('valid')
    expect(info.payload).not.toBeNull()
    expect(info.payload!.sub).toBe('user@example.com')
    expect(info.payload!.lid).toBe('lid-test-001')
    expect(info.payload!.plan).toBe('pro')
  })

  it('isPro returns true for valid status', () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const token = signToken(makePayload({}, now), priv)
    const info = verifyLicense(token, { now, keys: { k1: pubHex } })
    expect(isPro(info)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Grace period
// ---------------------------------------------------------------------------

describe('verifyLicense — grace period', () => {
  it('returns grace when now is between exp and exp + GRACE_DAYS', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    const exp = base - 1 // expired 1 second ago
    const payload = makePayload({ exp }, base)
    const token = signToken(payload, priv)

    // now is 1 second past exp, well within the 14-day grace window
    const now = base + 1
    const info = verifyLicense(token, { now, keys: { k1: pubHex } })

    expect(info.status).toBe('grace')
    expect(isPro(info)).toBe(true)
  })

  it('isPro returns true during grace', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    const exp = base
    const payload = makePayload({ exp }, base)
    const token = signToken(payload, priv)
    const now = base + 86400 // 1 day into grace
    const info = verifyLicense(token, { now, keys: { k1: pubHex } })
    expect(isPro(info)).toBe(true)
  })

  it('honours a custom graceDays=0 so expired is reached immediately', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    const exp = base - 1
    const payload = makePayload({ exp }, base)
    const token = signToken(payload, priv)

    const info = verifyLicense(token, { now: base + 1, keys: { k1: pubHex }, graceDays: 0 })
    expect(info.status).toBe('expired')
  })

  it('honours a custom graceDays=30 extending the window', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    const exp = base - 20 * 86400 // 20 days ago
    const payload = makePayload({ exp }, base)
    const token = signToken(payload, priv)

    // Within 30-day custom window → grace
    const info = verifyLicense(token, { now: base, keys: { k1: pubHex }, graceDays: 30 })
    expect(info.status).toBe('grace')
  })
})

// ---------------------------------------------------------------------------
// Expired
// ---------------------------------------------------------------------------

describe('verifyLicense — expired', () => {
  it('returns expired when now > exp + grace', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    const exp = base - (GRACE_DAYS + 1) * 86400
    const payload = makePayload({ exp }, base)
    const token = signToken(payload, priv)

    const info = verifyLicense(token, { now: base, keys: { k1: pubHex } })

    expect(info.status).toBe('expired')
    expect(isPro(info)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// None
// ---------------------------------------------------------------------------

describe('verifyLicense — none', () => {
  it('returns none for empty string', () => {
    expect(verifyLicense('').status).toBe('none')
  })

  it('returns none for whitespace-only string', () => {
    expect(verifyLicense('   ').status).toBe('none')
  })

  it('returns none for null', () => {
    expect(verifyLicense(null).status).toBe('none')
  })

  it('returns none for undefined', () => {
    expect(verifyLicense(undefined).status).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Malformed tokens
// ---------------------------------------------------------------------------

describe('verifyLicense — malformed', () => {
  it('rejects wrong prefix', () => {
    const { priv, pubHex } = genKeypair()
    const payload = makePayload()
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
    const payloadB64 = Buffer.from(payloadBytes).toString('base64url')
    const message = new TextEncoder().encode(`SCOUT1.${payloadB64}`)
    const sig = ed25519.sign(message, priv)
    const sigB64 = Buffer.from(sig).toString('base64url')
    const token = `BADPFX.${payloadB64}.${sigB64}`

    const info = verifyLicense(token, { keys: { k1: pubHex } })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('malformed')
  })

  it('rejects token with only 2 parts', () => {
    const info = verifyLicense('SCOUT1.abc', { keys: { k1: 'aa'.repeat(32) } })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('malformed')
  })

  it('rejects non-base64 payload segment', () => {
    // The sig must be a valid 64-byte b64url; payload is garbage chars
    const fakeSig = Buffer.alloc(64).toString('base64url')
    const token = `SCOUT1.!!!invalid!!!.${fakeSig}`
    const info = verifyLicense(token, { keys: { k1: 'aa'.repeat(32) } })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('malformed')
  })

  it('rejects non-JSON payload (valid base64 but not JSON)', () => {
    const notJson = Buffer.from('not-json-at-all').toString('base64url')
    const fakeSig = Buffer.alloc(64).toString('base64url')
    const token = `SCOUT1.${notJson}.${fakeSig}`
    const info = verifyLicense(token, { keys: { k1: 'aa'.repeat(32) } })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('malformed')
  })

  it('rejects signature whose base64-decoded length ≠ 64', () => {
    const payload = makePayload()
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
    // Only 32 bytes → length 32 ≠ 64
    const shortSig = Buffer.alloc(32).toString('base64url')
    const token = `SCOUT1.${payloadB64}.${shortSig}`
    const info = verifyLicense(token, { keys: { k1: 'aa'.repeat(32) } })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('malformed')
  })
})

// ---------------------------------------------------------------------------
// Bad payload shape
// ---------------------------------------------------------------------------

describe('verifyLicense — bad payload shape', () => {
  it('rejects payload missing lid', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    // @ts-expect-error intentionally bad shape
    const payload: LicensePayload = makePayload({ lid: undefined }, base)
    // Construct manually since makePayload typing won't allow it cleanly
    const raw = { v: 1, sub: 'u@e.com', plan: 'pro', iat: base, exp: base + 86400, kid: 'k1' }
    const payloadB64 = Buffer.from(JSON.stringify(raw)).toString('base64url')
    const message = new TextEncoder().encode(`SCOUT1.${payloadB64}`)
    const sig = ed25519.sign(message, priv)
    const sigB64 = Buffer.from(sig).toString('base64url')
    const token = `SCOUT1.${payloadB64}.${sigB64}`
    const info = verifyLicense(token, { keys: { k1: pubHex } })
    // parseLicense returns null → malformed
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('malformed')
  })

  it('rejects payload with plan !== "pro"', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    const raw = { v: 1, lid: 'x', sub: 'u@e.com', plan: 'free', iat: base, exp: base + 86400, kid: 'k1' }
    const payloadB64 = Buffer.from(JSON.stringify(raw)).toString('base64url')
    const message = new TextEncoder().encode(`SCOUT1.${payloadB64}`)
    const sig = ed25519.sign(message, priv)
    const sigB64 = Buffer.from(sig).toString('base64url')
    const token = `SCOUT1.${payloadB64}.${sigB64}`
    const info = verifyLicense(token, { keys: { k1: pubHex } })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('malformed')
  })

  it('rejects payload with v !== 1', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    const raw = { v: 2, lid: 'x', sub: 'u@e.com', plan: 'pro', iat: base, exp: base + 86400, kid: 'k1' }
    const payloadB64 = Buffer.from(JSON.stringify(raw)).toString('base64url')
    const message = new TextEncoder().encode(`SCOUT1.${payloadB64}`)
    const sig = ed25519.sign(message, priv)
    const sigB64 = Buffer.from(sig).toString('base64url')
    const token = `SCOUT1.${payloadB64}.${sigB64}`
    const info = verifyLicense(token, { keys: { k1: pubHex } })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('malformed')
  })

  it('rejects payload with empty lid string', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    const raw = { v: 1, lid: '', sub: 'u@e.com', plan: 'pro', iat: base, exp: base + 86400, kid: 'k1' }
    const payloadB64 = Buffer.from(JSON.stringify(raw)).toString('base64url')
    const message = new TextEncoder().encode(`SCOUT1.${payloadB64}`)
    const sig = ed25519.sign(message, priv)
    const sigB64 = Buffer.from(sig).toString('base64url')
    const token = `SCOUT1.${payloadB64}.${sigB64}`
    const info = verifyLicense(token, { keys: { k1: pubHex } })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('malformed')
  })
})

// ---------------------------------------------------------------------------
// Tampered payload (flip char in b64, keep original sig)
// ---------------------------------------------------------------------------

describe('verifyLicense — tampered payload', () => {
  it('detects tampered payload (original sig retained)', () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const payload = makePayload({}, now)
    const token = signToken(payload, priv)

    const parts = token.split('.')
    // Flip one character in the payload segment to break the signature
    const orig = parts[1]
    const flipped = orig.slice(0, -1) + (orig.slice(-1) === 'A' ? 'B' : 'A')
    const tamperedToken = `${parts[0]}.${flipped}.${parts[2]}`

    // The flipped b64 might decode to invalid JSON or wrong payload → malformed or bad-signature
    const info = verifyLicense(tamperedToken, { now, keys: { k1: pubHex } })
    expect(info.status).toBe('invalid')
    // Either malformed (JSON parse failed) or bad-signature
    expect(['malformed', 'bad-signature']).toContain(info.reason)
  })

  it('detects tampered payload when it still decodes to valid JSON', () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    // Use a different payload to sign, then replace payload in the token
    const realPayload = makePayload({ sub: 'real@example.com' }, now)
    const token = signToken(realPayload, priv)

    // Craft a different valid payload and swap it in without re-signing
    const altPayload = makePayload({ sub: 'hacker@evil.com', kid: 'k1' }, now)
    const altPayloadB64 = Buffer.from(JSON.stringify(altPayload)).toString('base64url')
    const parts = token.split('.')
    const tamperedToken = `SCOUT1.${altPayloadB64}.${parts[2]}`

    const info = verifyLicense(tamperedToken, { now, keys: { k1: pubHex } })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('bad-signature')
  })
})

// ---------------------------------------------------------------------------
// Forged token (signed with a different private key)
// ---------------------------------------------------------------------------

describe('verifyLicense — forged token', () => {
  it('rejects a token signed with an unknown private key', () => {
    const { pubHex } = genKeypair()           // trusted key
    const { priv: forgerPriv } = genKeypair() // attacker's key

    const now = Math.floor(Date.now() / 1000)
    const payload = makePayload({}, now)
    const token = signToken(payload, forgerPriv)

    const info = verifyLicense(token, { now, keys: { k1: pubHex } })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('bad-signature')
  })
})

// ---------------------------------------------------------------------------
// Unknown kid
// ---------------------------------------------------------------------------

describe('verifyLicense — unknown kid', () => {
  it('returns unknown-kid when kid not in keys map', () => {
    const { priv } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const payload = makePayload({ kid: 'k99' }, now)
    const token = signToken(payload, priv)

    const info = verifyLicense(token, { now, keys: { k1: 'aa'.repeat(32) } })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('unknown-kid')
  })

  it('returns unknown-kid when keys map is empty', () => {
    const { priv } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const payload = makePayload({}, now)
    const token = signToken(payload, priv)

    const info = verifyLicense(token, { now, keys: {} })
    expect(info.status).toBe('invalid')
    expect(info.reason).toBe('unknown-kid')
  })
})

// ---------------------------------------------------------------------------
// Helper round-trips
// ---------------------------------------------------------------------------

describe('b64urlEncode / b64urlDecode round-trip', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 64, 32])
    const encoded = b64urlEncode(bytes)
    const decoded = b64urlDecode(encoded)
    expect(decoded).not.toBeNull()
    expect(Array.from(decoded!)).toEqual(Array.from(bytes))
  })

  it('produces no padding characters', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const encoded = b64urlEncode(bytes)
    expect(encoded).not.toContain('=')
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
  })

  it('b64urlDecode returns null for invalid base64', () => {
    // atob throws on invalid chars
    const result = b64urlDecode('!!!not-valid-base64!!!')
    expect(result).toBeNull()
  })
})

describe('hexToBytes', () => {
  it('converts a valid hex string', () => {
    const hex = 'deadbeef'
    const bytes = hexToBytes(hex)
    expect(bytes).not.toBeNull()
    expect(Array.from(bytes!)).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('returns null for odd-length hex', () => {
    expect(hexToBytes('abc')).toBeNull()
  })

  it('returns null for non-hex characters', () => {
    expect(hexToBytes('zzzz')).toBeNull()
  })

  it('returns null for empty string', () => {
    // empty string: /^[0-9a-fA-F]+$/.test('') → false → null
    expect(hexToBytes('')).toBeNull()
  })
})
