// src/detector.js — Worker Thread
// FIXED: Raw WebSocket (ws library) instead of ethers.WebSocketProvider
// FIXED: Each chain fully isolated — one failure never affects others
// FIXED: No eth_getFilterChanges — uses eth_subscribe directly
// FIXED: Solana excluded from EVM log subscription (different protocol)
// FIXED: 401 handled per-chain — logs which key failed, continues others
// FIXED: Auto-reconnect per chain with exponential backoff

import { workerData }   from 'worker_threads'
import { ethers }       from 'ethers'
import { createRequire } from 'module'
import {
  CHAINS, SWAP_SIG_V3, MIN_SWAP_USD, HOT_LAYOUT as H,
} from './config.js'
import { classifySwap } from './speed.js'

const require = createRequire(import.meta.url)
const WS      = require('ws')

const { SAB }   = workerData
const HOT       = new Float64Array(SAB)
const SIG_C2N   = new Int32Array(SAB, 4080)
const RING      = new Float64Array(SAB, 2048, 128)

let ringHead = 0

function writeRing(flashNeeded, profit) {
  const slot       = (ringHead++) % 64
  RING[slot * 2]     = flashNeeded
  RING[slot * 2 + 1] = profit
  Atomics.add(SIG_C2N, 0, 1)
  HOT[H.NATURAL_TODAY]++
}

// ── EVM CHAINS ONLY — Solana uses different protocol ─────────────────────────
const EVM_CHAINS = CHAINS.filter(c => c.id !== 1151111081099710)  // exclude Solana

// ── RAW WS SUBSCRIPTION PER CHAIN ────────────────────────────────────────────
// No ethers.WebSocketProvider — raw eth_subscribe to avoid filter polling bugs
function connectChain(chain, idx) {
  let ws       = null
  let subId    = null
  let alive    = false
  let retryMs  = 1000
  let pingTimer = null
  let pongReceived = false

  function cleanup() {
    alive = false
    if (pingTimer) clearInterval(pingTimer)
    if (ws) { try { ws.terminate() } catch {} ws = null }
    HOT[70 + idx] = 0
  }

  function reconnect() {
    cleanup()
    setTimeout(() => connect(), Math.min(retryMs, 30000))
    retryMs = Math.min(retryMs * 2, 30000)
  }

  function connect() {
    const url = chain.wsUrl
    ws = new WS(url, {
      handshakeTimeout: 10000,
      perMessageDeflate: false,
    })

    ws.on('open', () => {
      alive   = true
      retryMs = 1000  // reset backoff on success

      // Subscribe to Uniswap V3/V4 Swap events
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id:      1,
        method:  'eth_subscribe',
        params:  ['logs', { topics: [SWAP_SIG_V3] }]
      }))

      // Keepalive ping every 20s
      pingTimer = setInterval(() => {
        if (!alive) return
        pongReceived = false
        ws.ping()
        setTimeout(() => {
          if (!pongReceived) {
            console.warn(`[DETECTOR] ${chain.name} ping timeout — reconnecting`)
            reconnect()
          }
        }, 5000)
      }, 20000)

      HOT[70 + idx] = 1
      console.log(`[DETECTOR] ${chain.name} connected`)
    })

    ws.on('pong', () => { pongReceived = true })

    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }

      // Subscription confirmation — save sub ID
      if (msg.id === 1 && msg.result) {
        subId = msg.result
        return
      }

      // Incoming log event
      if (msg.method === 'eth_subscription' && msg.params?.result) {
        const log = msg.params.result
        HOT[70 + idx] = 1  // chain active

        const result = classifySwap(log, chain.id)
        if (!result) return

        writeRing(result.flashNeeded, result.apparentProfit)
      }
    })

    ws.on('error', (err) => {
      const msg = err.message || ''
      if (msg.includes('401')) {
        // Bad API key — do not retry aggressively, log clearly
        console.error(`[DETECTOR] ${chain.name} — 401 UNAUTHORIZED. Check Alchemy API key for this chain.`)
        HOT[70 + idx] = 0
        // Retry after 60s — key might just be rate-limited
        setTimeout(() => connect(), 60000)
        if (ws) { try { ws.terminate() } catch {} ws = null }
      } else {
        // Other errors — reconnect with backoff
        if (process.env.DEBUG) console.error(`[DETECTOR] ${chain.name} error:`, msg.slice(0, 80))
        reconnect()
      }
    })

    ws.on('close', (code, reason) => {
      if (alive) {
        // Only log unexpected closes
        if (code !== 1000 && code !== 1001) {
          if (process.env.DEBUG) console.warn(`[DETECTOR] ${chain.name} closed (${code})`)
        }
        reconnect()
      }
    })
  }

  connect()
}

// ── GAS PRICE MONITOR ─────────────────────────────────────────────────────────
// Uses HTTP (not WS) — separate from swap subscription
// One provider per chain for gas reads only
const HTTP_PROVIDERS = {}
EVM_CHAINS.forEach(c => {
  try {
    HTTP_PROVIDERS[c.id] = new ethers.JsonRpcProvider(c.httpUrl)
  } catch {}
})

setInterval(async () => {
  await Promise.allSettled(EVM_CHAINS.map(async (c, i) => {
    try {
      const p = HTTP_PROVIDERS[c.id]
      if (!p) return
      const fee = await p.getFeeData()
      if (fee?.gasPrice) HOT[50 + i] = Number(fee.gasPrice) / 1e9
    } catch {}
  }))
}, 60_000)

// ── CONNECT ALL EVM CHAINS — each isolated ────────────────────────────────────
EVM_CHAINS.forEach((chain, idx) => {
  // Stagger connections by 150ms to avoid overwhelming Alchemy
  setTimeout(() => connectChain(chain, idx), idx * 150)
})

console.log(`[DETECTOR] Connecting ${EVM_CHAINS.length} EVM chains (Solana excluded from EVM subscriptions)`)
