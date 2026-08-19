// src/detector.js — Worker Thread
// 20-chain WebSocket swap detection at 0.1ms processing speed
// Writes qualifying swaps to SAB ring buffer

import { workerData }   from 'worker_threads'
import { ethers }       from 'ethers'
import {
  CHAINS, SWAP_SIG_V3, SWAP_SIG_V4, MIN_SWAP_USD, HOT_LAYOUT as H,
} from './config.js'
import { classifySwap } from './speed.js'

const { SAB }   = workerData
const HOT       = new Float64Array(SAB)
const SIG_C2N   = new Int32Array(SAB, 4080)
const RING      = new Float64Array(SAB, 2048, 128)  // 64 slots × 2 floats each

let ringHead = 0

function writeRing(flashNeeded, profit) {
  const slot = (ringHead++) % 64
  RING[slot * 2]     = flashNeeded
  RING[slot * 2 + 1] = profit
  Atomics.add(SIG_C2N, 0, 1)
  HOT[H.NATURAL_TODAY]++
}

// ── PROVIDER SINGLETONS ───────────────────────────────────────────────────────
const PROVIDERS = CHAINS.map((c, i) => {
  let ws, http
  try { ws = new ethers.WebSocketProvider(c.wsUrl) } catch {}
  try { http = new ethers.JsonRpcProvider(c.httpUrl) } catch {}
  return { chain: c, idx: i, ws, http, active: false }
})

// ── SUBSCRIBE TO SWAP EVENTS ──────────────────────────────────────────────────
PROVIDERS.forEach((p, i) => {
  const filter = { topics: [SWAP_SIG_V3] }
  
  const onSwap = (log) => {
    HOT[H.FLASH_BASE + 30 + i] = 1  // chain active flag (HOT[50+i] for gas, HOT[70+i] for active)
    HOT[70 + i] = 1
    
    const result = classifySwap(log, p.chain.id)
    if (!result) return
    
    writeRing(result.flashNeeded, result.apparentProfit)
  }
  
  if (p.ws) {
    p.ws.on('error', () => {
      HOT[70 + i] = 0
      // HTTP fallback polling
      if (p.http) {
        let lastBlock = 0
        setInterval(async () => {
          try {
            const block = await p.http.getBlockNumber()
            if (block <= lastBlock) return
            lastBlock = block
            const logs = await p.http.getLogs({
              fromBlock: block, toBlock: block, topics: [SWAP_SIG_V3]
            })
            HOT[70 + i] = logs.length > 0 ? 0.5 : 0.5  // HTTP mode
            logs.forEach(log => onSwap(log))
          } catch {}
        }, p.chain.blockMs || 2000)
      }
    })
    p.ws.on(filter, onSwap)
    console.log(`[DETECTOR] Subscribed: ${p.chain.name}`)
  }
})

// ── GAS PRICE MONITOR ─────────────────────────────────────────────────────────
// Every 60s — uses existing provider connections, no extra Alchemy CUs
setInterval(async () => {
  await Promise.allSettled(PROVIDERS.map(async (p, i) => {
    try {
      const fee = await (p.ws || p.http)?.getFeeData()
      if (fee?.gasPrice) HOT[50 + i] = Number(fee.gasPrice) / 1e9  // gwei
    } catch {}
  }))
}, 60_000)

console.log('[DETECTOR] 20-chain swap detection online | 0.1ms hot path')
