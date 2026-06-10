#!/usr/bin/env node
/**
 * scout license issuing CLI (vendor-side).
 *
 *   node tools/license-keygen.mjs gen-keypair
 *       → prints a new Ed25519 keypair (hex). Keep the private key OUT of the
 *         repo (secret manager / wrangler secret). Put the public key into
 *         src/lib/license.ts PUBLIC_KEYS (or VITE_LICENSE_PUBKEY_K1).
 *
 *   node tools/license-keygen.mjs sign --key <priv-hex> --email <sub> \
 *       [--days 365] [--lid <id>] [--kid k1]
 *       → prints a signed SCOUT1 token.
 *
 *   node tools/license-keygen.mjs verify --pub <pub-hex> --token <token>
 *       → verifies and prints the payload.
 */
import { ed25519 } from '@noble/curves/ed25519.js'
import { randomUUID } from 'node:crypto'

const PREFIX = 'SCOUT1'

const hex = (bytes) => Buffer.from(bytes).toString('hex')
const fromHex = (h) => new Uint8Array(Buffer.from(h, 'hex'))
const b64url = (bytes) => Buffer.from(bytes).toString('base64url')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) {
    if (fallback !== undefined) return fallback
    console.error(`missing --${name}`)
    process.exit(1)
  }
  return process.argv[i + 1]
}

function signToken({ privHex, email, days, lid, kid }) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    v: 1,
    lid,
    sub: email,
    plan: 'pro',
    iat: now,
    exp: now + days * 86400,
    kid,
  }
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  const message = new TextEncoder().encode(`${PREFIX}.${payloadB64}`)
  const sig = ed25519.sign(message, fromHex(privHex))
  return { token: `${PREFIX}.${payloadB64}.${b64url(sig)}`, payload }
}

const cmd = process.argv[2]
switch (cmd) {
  case 'gen-keypair': {
    const priv = ed25519.utils.randomSecretKey()
    const pub = ed25519.getPublicKey(priv)
    console.log('private (SECRET — wrangler secret / vault):', hex(priv))
    console.log('public  (PUBLIC_KEYS / VITE_LICENSE_PUBKEY_K1):', hex(pub))
    break
  }
  case 'sign': {
    const { token, payload } = signToken({
      privHex: arg('key'),
      email: arg('email'),
      days: Number(arg('days', '365')),
      lid: arg('lid', randomUUID()),
      kid: arg('kid', 'k1'),
    })
    console.error('payload:', JSON.stringify(payload))
    console.log(token)
    break
  }
  case 'verify': {
    const token = arg('token')
    const [prefix, payloadB64, sigB64] = token.split('.')
    if (prefix !== PREFIX) {
      console.error('bad prefix')
      process.exit(1)
    }
    const ok = ed25519.verify(
      new Uint8Array(Buffer.from(sigB64, 'base64url')),
      new TextEncoder().encode(`${PREFIX}.${payloadB64}`),
      fromHex(arg('pub')),
    )
    console.log('signature:', ok ? 'VALID' : 'INVALID')
    console.log('payload:', Buffer.from(payloadB64, 'base64url').toString())
    process.exit(ok ? 0 : 1)
  }
  default:
    console.error('usage: license-keygen.mjs <gen-keypair|sign|verify> [options]')
    process.exit(1)
}
