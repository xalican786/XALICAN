// src/detector.js — Worker Thread — FINAL
// Uses raw WebSocket (ws library) — no ethers.WebSocketProvider
// Each chain fully isolated — one failure never crashes others
// 401 on Alchemy: auto-switches to public free RPC (no key needed)
// HTTP polling fallback when no WS available
// Solana excluded from EVM subscriptions

import { workerData }    from 'worker_threads'
import { ethers }        from 'ethers'
import { createRequire } from 'module'
import {
  CHAINS, SWAP_SIG_V3, MIN_SWAP_USD, HOT_LAYOUT as H,
} from './config.js'
import { classifySwap } from './speed.js'

const require = createRequire(import.meta.url)
const WS      = require('ws')

const { SAB } = workerData
const HOT     = new Float64Array(SAB)
const SIG_C2N = new Int32Array(SAB, 4080)
const RING    = new Float64Array(SAB, 2048, 128)
let ringHead  = 0

function writeRing(flash, profit) {
  const slot = (ringHead++) % 64
  RING[slot * 2]     = flash
  RING[slot * 2 + 1] = profit
  Atomics.add(SIG_C2N, 0, 1)
  HOT[H.NATURAL_TODAY]++
}

// ── PUBLIC FREE FALLBACK ENDPOINTS (no API key required) ─────────────────────
// Used automatically when Alchemy key is invalid/expired
const PUBLIC = {
  // WebSocket endpoints
  ws: {
    81457:  'wss://blast.drpc.org',
    324:    'wss://mainnet.era.zksync.io/ws',
    534352: 'wss://wss.scroll.io',
    59144:  'wss://wss.linea.build',
    5000:   'wss://wss.mantle.xyz',
    100:    'wss://rpc.gnosischain.com/wss',
    480:    'wss://worldchain-mainnet.g.alchemy.com/v2/demo',
    80094:  'wss://bera-mainnet.drpc.org',
    1301:   'wss://unichain.drpc.org',
    1329:   'wss://evm-ws.sei-apis.com',
    146:    'wss://rpc.soniclabs.com/ws',
    64165:  'wss://rpc.soniclabs.com/ws',
  },
  // HTTP polling fallbacks (when WS unavailable)
  http: {
    81457:  'https://rpc.blast.io',
    324:    'https://mainnet.era.zksync.io',
    534352: 'https://rpc.scroll.io',
    59144:  'https://rpc.linea.build',
    5000:   'https://rpc.mantle.xyz',
    100:    'https://rpc.gnosischain.com',
    480:    'https://worldchain-mainnet.g.alchemy.com/v2/demo',
    80094:  'https://rpc.berachain.com',
    1301:   'https://unichain.drpc.org',
    1329:   'https://evm-rpc.sei-apis.com',
    146:    'https://rpc.soniclabs.com',
    64165:  'https://rpc.soniclabs.com',
  }
}

// EVM only — Solana uses different protocol
const EVM_CHAINS = CHAINS.filter(c => c.id !== 1151111081099710)

// ── CONNECT ONE CHAIN — isolated, self-healing ────────────────────────────────
function connectChain(chain, idx) {
  let ws          = null
  let retryMs     = 2000
  let pongOk      = true
  let usedFallback= false

  function cleanup() {
    if (ws) { try { ws.terminate() } catch {} ws = null }
    HOT[70 + idx] = 0
  }

  function retry(delay) {
    cleanup()
    setTimeout(connect, Math.min(delay || retryMs, 60000))
    retryMs = Math.min(retryMs * 2, 60000)
  }

  function startHTTPPoll() {
    const url = PUBLIC.http[chain.id] || chain.httpUrl
    if (!url) return
    const provider = new ethers.JsonRpcProvider(url)
    let lastBlock  = 0
    HOT[70 + idx]  = 0.5  // HTTP mode indicator

    setInterval(async () => {
      try {
        const block = await provider.getBlockNumber()
        if (block <= lastBlock) return
        lastBlock = block
        const logs = await provider.getLogs({
          fromBlock: block,
          toBlock:   block,
          topics:    [SWAP_SIG_V3],
        })
        logs.forEach(log => {
          const r = classifySwap(log, chain.id)
          if (r) writeRing(r.flashNeeded, r.apparentProfit)
        })
        HOT[50 + idx] = await provider.getFeeData().then(f => Number(f.gasPrice || 0) / 1e9).catch(() => 0)
      } catch {}
    }, Math.max(chain.blockMs || 2000, 2000))

    console.log(`[DETECTOR] ${chain.name} HTTP polling (no WS available)`)
  }

  function connect() {
    // Try Alchemy first, then public fallback
    const url = usedFallback
      ? (PUBLIC.ws[chain.id] || null)
      : chain.wsUrl

    if (!url) { startHTTPPoll(); return }

    ws = new WS(url, { handshakeTimeout: 12000, perMessageDeflate: false })

    ws.on('open', () => {
      retryMs  = 2000
      pongOk   = true

      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method:  'eth_subscribe',
        params:  ['logs', { topics: [SWAP_SIG_V3] }],
      }))

      // Keepalive ping every 25s
      const pingIv = setInterval(() => {
        if (!ws || ws.readyState !== WS.OPEN) { clearInterval(pingIv); return }
        pongOk = false
        ws.ping()
        setTimeout(() => {
          if (!pongOk) { clearInterval(pingIv); retry(2000) }
        }, 6000)
      }, 25000)

      ws.once('close', () => clearInterval(pingIv))

      HOT[70 + idx] = 1
      console.log(`[DETECTOR] ${chain.name} connected${usedFallback ? ' (public RPC)' : ''}`)
    })

    ws.on('pong', () => { pongOk = true })

    ws.on('message', raw => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }

      // Subscription confirmed
      if (msg.id === 1 && msg.result) return

      // Error response from node
      if (msg.error) {
        if (process.env.DEBUG) console.warn(`[DETECTOR] ${chain.name} node error:`, msg.error.message?.slice(0, 60))
        return
      }

      // Log event
      if (msg.method === 'eth_subscription' && msg.params?.result) {
        HOT[70 + idx] = 1
        const r = classifySwap(msg.params.result, chain.id)
        if (r) writeRing(r.flashNeeded, r.apparentProfit)
      }
    })

    ws.on('error', err => {
      const msg = err.message || ''

      if (msg.includes('401') || msg.includes('403')) {
        if (!usedFallback) {
          console.warn(`[DETECTOR] ${chain.name} Alchemy key rejected — switching to public RPC`)
          usedFallback = true
          cleanup()
          // Try public WS immediately
          if (PUBLIC.ws[chain.id]) {
            setTimeout(connect, 500)
          } else {
            // No public WS — use HTTP polling
            startHTTPPoll()
          }
        } else {
          // Public WS also failed — HTTP polling
          console.warn(`[DETECTOR] ${chain.name} public WS failed — HTTP polling`)
          cleanup()
          startHTTPPoll()
        }
        return
      }

      // Network errors — retry with backoff
      if (process.env.DEBUG) console.warn(`[DETECTOR] ${chain.name}:`, msg.slice(0, 80))
      retry()
    })

    ws.on('close', (code) => {
      if (code !== 1000 && code !== 1001 && ws) retry()
    })
  }

  connect()
}

// ── GAS PRICE MONITOR — HTTP, separate from swap subscriptions ────────────────
const GAS_PROVIDERS = {}
EVM_CHAINS.forEach(c => {
  const url = c.httpUrl || PUBLIC.http[c.id]
  if (url) {
    try { GAS_PROVIDERS[c.id] = new ethers.JsonRpcProvider(url) } catch {}
  }
})

setInterval(async () => {
  await Promise.allSettled(EVM_CHAINS.map(async (c, i) => {
    const p = GAS_PROVIDERS[c.id]
    if (!p) return
    try {
      const fee = await p.getFeeData()
      if (fee?.gasPrice) HOT[50 + i] = Number(fee.gasPrice) / 1e9
    } catch {}
  }))
}, 60_000)

// ── BOOT — stagger connections 200ms apart to avoid rate limiting ─────────────
EVM_CHAINS.forEach((chain, idx) => {
  setTimeout(() => connectChain(chain, idx), idx * 200)
})

console.log(`[DETECTOR] Connecting ${EVM_CHAINS.length} EVM chains | Auto-fallback to public RPCs on 401`)
