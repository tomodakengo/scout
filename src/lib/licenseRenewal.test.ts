/**
 * Tests for src/lib/licenseRenewal.ts
 *
 * Uses a Map-backed fake storage and vi.fn() stubs for fetchFn.
 * Signing replicates tools/license-keygen.mjs.
 */

import { describe, it, expect, vi } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  maybeRenewLicense,
  isRenewalDue,
  RENEW_WINDOW_DAYS,
} from './licenseRenewal'
import { TOKEN_PREFIX, type LicensePayload } from './license'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function genKeypair() {
  const priv = ed25519.utils.randomSecretKey()
  const pub = ed25519.getPublicKey(priv)
  const pubHex = Buffer.from(pub).toString('hex')
  return { priv, pubHex }
}

function signToken(payload: LicensePayload, privKey: Uint8Array): string {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const payloadB64 = Buffer.from(payloadBytes).toString('base64url')
  const message = new TextEncoder().encode(`${TOKEN_PREFIX}.${payloadB64}`)
  const sig = ed25519.sign(message, privKey)
  const sigB64 = Buffer.from(sig).toString('base64url')
  return `${TOKEN_PREFIX}.${payloadB64}.${sigB64}`
}

function makePayload(
  overrides: Partial<LicensePayload> = {},
  nowSec: number = Math.floor(Date.now() / 1000),
): LicensePayload {
  return {
    v: 1,
    lid: 'lid-renewal-001',
    sub: 'user@example.com',
    plan: 'pro',
    iat: nowSec,
    exp: nowSec + 365 * 86400,
    kid: 'k1',
    ...overrides,
  }
}

/** Minimal Map-backed storage stub. */
function makeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    _map: map,
  }
}

/** Make a Response-like object. */
function makeResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

const RENEWAL_URL = 'https://renew.example.com/license'

// ---------------------------------------------------------------------------
// Skipped — no url / no token / invalid token
// ---------------------------------------------------------------------------

describe('maybeRenewLicense — skipped conditions', () => {
  it('skips with no-url when url is empty', async () => {
    const result = await maybeRenewLicense('any-token', { url: '' })
    expect(result).toEqual({ outcome: 'skipped', reason: 'no-url' })
  })

  it('skips with no-url when url is undefined (and DEFAULT_RENEWAL_URL is empty)', async () => {
    // DEFAULT_RENEWAL_URL is '' in the test environment (no VITE env var)
    const result = await maybeRenewLicense('any-token', {})
    expect(result).toEqual({ outcome: 'skipped', reason: 'no-url' })
  })

  it('skips with no-token when token is null', async () => {
    const result = await maybeRenewLicense(null, { url: RENEWAL_URL })
    expect(result).toEqual({ outcome: 'skipped', reason: 'no-token' })
  })

  it('skips with no-token when token is empty string', async () => {
    const result = await maybeRenewLicense('', { url: RENEWAL_URL })
    expect(result).toEqual({ outcome: 'skipped', reason: 'no-token' })
  })

  it('skips with no-token when token is whitespace', async () => {
    const result = await maybeRenewLicense('   ', { url: RENEWAL_URL })
    expect(result).toEqual({ outcome: 'skipped', reason: 'no-token' })
  })

  it('skips with invalid-token when token is malformed', async () => {
    const result = await maybeRenewLicense('not-a-valid-token', { url: RENEWAL_URL })
    expect(result).toEqual({ outcome: 'skipped', reason: 'invalid-token' })
  })

  it('skips with invalid-token when token has bad signature', async () => {
    const { pubHex } = genKeypair()
    const { priv: otherPriv } = genKeypair() // wrong key
    const now = Math.floor(Date.now() / 1000)
    const payload = makePayload({}, now)
    const token = signToken(payload, otherPriv)

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      verifyOpts: { keys: { k1: pubHex } },
    })
    expect(result).toEqual({ outcome: 'skipped', reason: 'invalid-token' })
  })
})

// ---------------------------------------------------------------------------
// Skipped — not due
// ---------------------------------------------------------------------------

describe('maybeRenewLicense — not due', () => {
  it('skips with not-due when exp is far in the future and force is false', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    // exp = now + 30d, well outside the 7d renewal window
    const payload = makePayload({ exp: now + 30 * 86400 }, now)
    const token = signToken(payload, priv)
    const fetchFn = vi.fn()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
    })

    expect(result).toEqual({ outcome: 'skipped', reason: 'not-due' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Successful renewal
// ---------------------------------------------------------------------------

describe('maybeRenewLicense — successful renewal', () => {
  it('posts token and stores the renewed token when server returns valid new token', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    // exp = now + 3d → within the 7d window → renewal due
    const exp = now + 3 * 86400
    const payload = makePayload({ exp }, now)
    const token = signToken(payload, priv)

    // Server returns a fresh token: same lid/sub, later exp
    const newPayload = makePayload({ exp: now + 365 * 86400 }, now)
    const newToken = signToken(newPayload, priv)
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ token: newToken }))
    const storage = makeStorage()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result).toEqual({ outcome: 'renewed', token: newToken })

    // fetch called with correct POST request
    expect(fetchFn).toHaveBeenCalledOnce()
    const [calledUrl, calledInit] = fetchFn.mock.calls[0]
    expect(calledUrl).toBe(RENEWAL_URL)
    expect(calledInit.method).toBe('POST')
    expect(JSON.parse(calledInit.body)).toEqual({ token })
  })
})

// ---------------------------------------------------------------------------
// Throttle and force
// ---------------------------------------------------------------------------

describe('maybeRenewLicense — throttle and force', () => {
  it('throttles a second immediate attempt', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const exp = now + 3 * 86400
    const payload = makePayload({ exp }, now)
    const token = signToken(payload, priv)

    const newPayload = makePayload({ exp: now + 365 * 86400 }, now)
    const newToken = signToken(newPayload, priv)
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ token: newToken }))
    const storage = makeStorage()

    // First call — should succeed
    const first = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })
    expect(first.outcome).toBe('renewed')

    // Simulate calling again immediately (same wall clock)
    // The storage now has a recent lastAttempt timestamp
    const fetchFn2 = vi.fn()
    const second = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn: fetchFn2,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })
    expect(second).toEqual({ outcome: 'skipped', reason: 'throttled' })
    expect(fetchFn2).not.toHaveBeenCalled()
  })

  it('force: true bypasses not-due', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    // far-future exp → normally would be not-due
    const payload = makePayload({ exp: now + 30 * 86400 }, now)
    const token = signToken(payload, priv)

    const newPayload = makePayload({ exp: now + 365 * 86400 }, now)
    const newToken = signToken(newPayload, priv)
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ token: newToken }))
    const storage = makeStorage()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      force: true,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result).toEqual({ outcome: 'renewed', token: newToken })
  })

  it('force: true bypasses throttle', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const exp = now + 3 * 86400
    const payload = makePayload({ exp }, now)
    const token = signToken(payload, priv)

    const newPayload = makePayload({ exp: now + 365 * 86400 }, now)
    const newToken = signToken(newPayload, priv)
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ token: newToken }))
    const storage = makeStorage()

    // First attempt sets the last-attempt timestamp
    await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    // Immediately force again
    const fetchFn2 = vi.fn().mockResolvedValue(makeResponse({ token: newToken }))
    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn: fetchFn2,
      force: true,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result.outcome).toBe('renewed')
    expect(fetchFn2).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

describe('maybeRenewLicense — failure paths', () => {
  function makeValidDueToken(priv: Uint8Array, now: number) {
    const exp = now + 3 * 86400
    const payload = makePayload({ exp }, now)
    return signToken(payload, priv)
  }

  it('fails with http-XXX when res.ok is false', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const token = makeValidDueToken(priv, now)

    const fetchFn = vi.fn().mockResolvedValue(makeResponse({}, false, 403))
    const storage = makeStorage()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result).toEqual({ outcome: 'failed', reason: 'http-403' })
  })

  it('fails with network when fetch throws', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const token = makeValidDueToken(priv, now)

    const fetchFn = vi.fn().mockRejectedValue(new Error('Network error'))
    const storage = makeStorage()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result).toEqual({ outcome: 'failed', reason: 'network' })
  })

  it('fails with malformed-response when body has no token field', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const token = makeValidDueToken(priv, now)

    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ notToken: 'oops' }))
    const storage = makeStorage()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result).toEqual({ outcome: 'failed', reason: 'malformed-response' })
  })

  it('fails with malformed-response when body.token is a number', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const token = makeValidDueToken(priv, now)

    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ token: 12345 }))
    const storage = makeStorage()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result).toEqual({ outcome: 'failed', reason: 'malformed-response' })
  })

  it('fails with unverifiable-response when returned token signed by unknown key', async () => {
    const { priv, pubHex } = genKeypair()
    const { priv: unknownPriv } = genKeypair() // different private key
    const now = Math.floor(Date.now() / 1000)
    const token = makeValidDueToken(priv, now)

    // New token signed by a key not in our keys map
    const newPayload = makePayload({ exp: now + 365 * 86400 }, now)
    const newToken = signToken(newPayload, unknownPriv)
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ token: newToken }))
    const storage = makeStorage()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result).toEqual({ outcome: 'failed', reason: 'unverifiable-response' })
  })

  it('fails with identity-mismatch when returned token has different lid', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const token = makeValidDueToken(priv, now)

    // New token with different lid
    const newPayload = makePayload({ lid: 'completely-different-lid', exp: now + 365 * 86400 }, now)
    const newToken = signToken(newPayload, priv)
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ token: newToken }))
    const storage = makeStorage()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result).toEqual({ outcome: 'failed', reason: 'identity-mismatch' })
  })

  it('fails with identity-mismatch when returned token has different sub', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const token = makeValidDueToken(priv, now)

    // New token with different sub
    const newPayload = makePayload({ sub: 'other@evil.com', exp: now + 365 * 86400 }, now)
    const newToken = signToken(newPayload, priv)
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ token: newToken }))
    const storage = makeStorage()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result).toEqual({ outcome: 'failed', reason: 'identity-mismatch' })
  })

  it('fails with not-extended when new token exp <= old exp', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const exp = now + 3 * 86400
    const payload = makePayload({ exp }, now)
    const token = signToken(payload, priv)

    // New token with same exp (not later)
    const newPayload = makePayload({ exp }, now)
    const newToken = signToken(newPayload, priv)
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ token: newToken }))
    const storage = makeStorage()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result).toEqual({ outcome: 'failed', reason: 'not-extended' })
  })

  it('fails with not-extended when new token exp is earlier than old exp', async () => {
    const { priv, pubHex } = genKeypair()
    const now = Math.floor(Date.now() / 1000)
    const exp = now + 3 * 86400
    const payload = makePayload({ exp }, now)
    const token = signToken(payload, priv)

    // New token with earlier exp
    const newPayload = makePayload({ exp: now + 1 * 86400 }, now)
    const newToken = signToken(newPayload, priv)
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ token: newToken }))
    const storage = makeStorage()

    const result = await maybeRenewLicense(token, {
      url: RENEWAL_URL,
      now,
      fetchFn,
      verifyOpts: { keys: { k1: pubHex } },
      storage,
    })

    expect(result).toEqual({ outcome: 'failed', reason: 'not-extended' })
  })
})

// ---------------------------------------------------------------------------
// isRenewalDue boundary tests
// ---------------------------------------------------------------------------

describe('isRenewalDue — boundary conditions', () => {
  it('returns true at exactly exp - RENEW_WINDOW_DAYS', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    const exp = base + 30 * 86400
    const payload = makePayload({ exp }, base)
    const token = signToken(payload, priv)

    // now = exp - 7d exactly
    const now = exp - RENEW_WINDOW_DAYS * 86400
    expect(isRenewalDue(token, now, { keys: { k1: pubHex } })).toBe(true)
  })

  it('returns false at exp - RENEW_WINDOW_DAYS - 1s', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    const exp = base + 30 * 86400
    const payload = makePayload({ exp }, base)
    const token = signToken(payload, priv)

    // now = exp - 7d - 1s → just outside the window
    const now = exp - RENEW_WINDOW_DAYS * 86400 - 1
    expect(isRenewalDue(token, now, { keys: { k1: pubHex } })).toBe(false)
  })

  it('returns true when now is past exp (in grace period)', () => {
    const { priv, pubHex } = genKeypair()
    const base = Math.floor(Date.now() / 1000)
    // exp already passed (5 days ago)
    const exp = base - 5 * 86400
    const payload = makePayload({ exp }, base)
    const token = signToken(payload, priv)

    // now = base (5 days after exp), well within 14-day grace
    expect(isRenewalDue(token, base, { keys: { k1: pubHex } })).toBe(true)
  })

  it('returns false for invalid token', () => {
    expect(isRenewalDue('not-a-token', Math.floor(Date.now() / 1000))).toBe(false)
  })
})
