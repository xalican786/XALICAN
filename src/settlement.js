// src/settlement.js — Universal bridge router
// Detects NAME_SECRET_KEY from env vars
// Each bridge needs only: NAME_SECRET_KEY env var + src/adapters/name.js
// Adapter pattern: modempay.js is the template (40 LoC)

import { existsSync }    from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path              from 'path'

const __dir   = path.dirname(fileURLToPath(import.meta.url))
const cleanKey = s => String(s||'').trim().replace(/['"]/g,'')

// Build bridge registry from env vars at boot
const BRIDGES = {}
;(function detectBridges() {
  for (const [k, v] of Object.entries(process.env)) {
    const m = k.match(/^([A-Z][A-Z0-9]+)_SECRET_KEY$/)
    if (m && v) {
      const name = m[1].toLowerCase()
      BRIDGES[name] = cleanKey(v)
    }
  }
  if (Object.keys(BRIDGES).length > 0) {
    console.log('[SETTLEMENT] Bridges:', Object.keys(BRIDGES).join(', '))
  } else {
    console.log('[SETTLEMENT] No bridges — add NAME_SECRET_KEY to Railway Variables')
  }
})()

// Adapter cache
const ADAPTERS = {}

async function loadAdapter(name) {
  if (ADAPTERS[name]) return ADAPTERS[name]
  
  const candidates = [
    path.join(__dir, 'adapters', `${name}.js`),
    path.join(__dir, `${name}.js`),
  ]
  
  for (const p of candidates) {
    if (existsSync(p)) {
      const adapter = await import(p)
      ADAPTERS[name] = adapter
      return adapter
    }
  }
  
  throw new Error(`No adapter for '${name}'. Create src/adapters/${name}.js or set ${name.toUpperCase()}_BASE_URL.`)
}

export async function send(bridge, params) {
  const name = (bridge || 'modempay').toLowerCase()
  const key  = BRIDGES[name]
  if (!key) throw new Error(`Bridge '${name}' not configured. Add ${name.toUpperCase()}_SECRET_KEY.`)
  const adapter = await loadAdapter(name)
  return adapter.send(key, params)
}

export function getBridges() { return Object.keys(BRIDGES) }

export function getBridgeMode(bridge) {
  const key = BRIDGES[(bridge||'modempay').toLowerCase()] || ''
  return key.startsWith('sk_live_') ? 'LIVE' : 'TEST'
}
