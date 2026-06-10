/**
 * scout license renewal endpoint — Cloudflare Worker example.
 *
 * Deploy:
 *   1. wrangler secret put LICENSE_PRIVATE_KEY   (hex from gen-keypair)
 *   2. (optional) create a KV namespace REVOKED and bind it; put license ids
 *      (lid) you want to revoke as keys.
 *   3. set ALLOWED_ORIGIN to the app origin.
 *
 * POST /renew { token } → { token } (re-signed, exp extended) or 4xx.
 *
 * This endpoint is the long-term enforcement point: revoked or unpaid
 * licenses simply stop renewing and expire after the offline grace period.
 * It never sees session data — only the license token.
 */
import { ed25519 } from '@noble/curves/ed25519.js'

const PREFIX = 'SCOUT1'
const RENEW_DAYS = 365
/** refuse to renew tokens that expired longer ago than this */
const MAX_RENEW_AFTER_EXP_DAYS = 90
const ALLOWED_ORIGIN = 'https://tomodakengo.github.io'

const b64urlToBytes = (s) => new Uint8Array(Buffer.from(s, 'base64url'))
const bytesToB64url = (b) => Buffer.from(b).toString('base64url')
const fromHex = (h) => new Uint8Array(Buffer.from(h, 'hex'))

function corsHeaders() {
  return {
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  })
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
    if (request.method !== 'POST') return json(405, { error: 'method' })

    const { token } = await request.json().catch(() => ({}))
    if (typeof token !== 'string') return json(400, { error: 'token-required' })

    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== PREFIX) return json(400, { error: 'malformed' })

    const priv = fromHex(env.LICENSE_PRIVATE_KEY)
    const pub = ed25519.getPublicKey(priv)
    const message = new TextEncoder().encode(`${PREFIX}.${parts[1]}`)
    let ok = false
    try {
      ok = ed25519.verify(b64urlToBytes(parts[2]), message, pub)
    } catch {
      ok = false
    }
    if (!ok) return json(403, { error: 'bad-signature' })

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    const now = Math.floor(Date.now() / 1000)
    if (now > payload.exp + MAX_RENEW_AFTER_EXP_DAYS * 86400) {
      return json(403, { error: 'too-old' })
    }

    // revocation: a KV entry under the license id blocks renewal
    if (env.REVOKED && (await env.REVOKED.get(payload.lid))) {
      return json(403, { error: 'revoked' })
    }

    // TODO billing integration: look up payload.sub / payload.lid in your
    // payment provider (Stripe subscription status etc.) and refuse renewal
    // for lapsed subscriptions:
    // if (!(await subscriptionActive(payload.lid))) return json(403, { error: 'unpaid' })

    const renewed = { ...payload, iat: now, exp: now + RENEW_DAYS * 86400 }
    const renewedB64 = bytesToB64url(new TextEncoder().encode(JSON.stringify(renewed)))
    const sig = ed25519.sign(new TextEncoder().encode(`${PREFIX}.${renewedB64}`), priv)
    return json(200, { token: `${PREFIX}.${renewedB64}.${bytesToB64url(sig)}` })
  },
}
