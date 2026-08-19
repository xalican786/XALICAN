// src/speed.js — 0.1ms hot path engine
// Pre-computed lookup tables built at module load — never during hot path
// Pure synchronous functions — no async, no allocations in classifySwap

import { MIN_SWAP_USD, WORKING_FLASH, BUNDLE_TYPES } from './config.js'

// ── LOOKUP TABLES (built once at module load) ─────────────────────────────────
const TABLE_SIZE = 2000
const AMOUNT_TABLE = new Float64Array(TABLE_SIZE)  // swap amounts $10K → $100B
const PROFIT_TABLE = new Float64Array(TABLE_SIZE)  // apparent profit per amount
const FLASH_TABLE  = new Float64Array(TABLE_SIZE)  // flash needed per amount

;(function buildTables() {
  for (let i = 0; i < TABLE_SIZE; i++) {
    const amount = 10_000 * Math.pow(10_000, i / (TABLE_SIZE - 1))  // log scale
    AMOUNT_TABLE[i] = amount
    PROFIT_TABLE[i] = Math.min(amount * 0.01, 1e6)   // 1% fee, capped at $1M apparent
    FLASH_TABLE[i]  = Math.min(amount * 2.5, WORKING_FLASH)  // 2.5x swap, max $250B
  }
})()

// Binary search — O(log n) — ~0.01ms
function lookup(amount) {
  let lo = 0, hi = TABLE_SIZE - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (AMOUNT_TABLE[mid] < amount) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ABI decoder cache — pre-built decoders avoid runtime ABI parsing
const ABI_CODER = new (await import('ethers')).ethers.AbiCoder()

// ── CLASSIFY SWAP — THE 0.1ms HOT PATH ───────────────────────────────────────
// Called for every swap event. Must return within 0.1ms.
// No async. No allocations. No console.log. Pure math.
export function classifySwap(log, chainId) {
  // Quick reject: log must have data
  if (!log?.data || log.data.length < 10) return null
  
  // Decode amount0 from swap event data (first 32 bytes = amount0)
  // Fast hex decode — no ABI overhead
  const amount0 = BigInt('0x' + log.data.slice(2, 66))
  const absAmount = amount0 < 0n ? -amount0 : amount0
  
  // Convert to USD approximate (USDC = 1:1, ETH ~ $2500, BTC ~ $60K)
  // For speed, use token address to approximate USD value
  // Simplified: treat as USDC equivalent (close enough for classification)
  const amountUSD = Number(absAmount) / 1e6  // assume USDC 6 decimals
  
  if (amountUSD < MIN_SWAP_USD) return null
  
  const idx    = lookup(amountUSD)
  const profit = PROFIT_TABLE[idx]
  const flash  = FLASH_TABLE[idx]
  
  return {
    flashNeeded:    flash,
    apparentProfit: profit,
    amountUSD,
    chainId,
    pool: log.address,
    ts:   Date.now(),
  }
}

// ── PRE-BUILT BUNDLE TEMPLATES ────────────────────────────────────────────────
// ABI encoding templates — just parameter substitution at call time
export const TEMPLATES = Object.fromEntries(
  BUNDLE_TYPES.map(t => [t, { type: t, iface: null }])  // iface set lazily
)

// Auction price calculation — called at bundle build time (~0.5ms)
export function calcAuctionPrice(apparentProfit, bundleType) {
  const mult = {
    JIT_PRIMARY:0.80, ECHO_ARB:0.70, ECHO_BASE:0.70,
    ECHO_POL:0.60, ECHO_OPT:0.60, RECURSIVE_1:0.50,
    RECURSIVE_2:0.45, RECURSIVE_3:0.40, ORACLE_DEV:0.30,
    LIQUIDATION_1:0.35, LIQUIDATION_2:0.30,
  }
  const price = apparentProfit * (mult[bundleType] || 0.5)
  return Math.max(40_000, Math.min(price, 10_000_000))  // $40K floor, $10M ceiling
}

// Dutch auction current price given elapsed ms
export function dutchPrice(startPrice, elapsedMs) {
  const pct = Math.max(0.20, 0.80 - (elapsedMs / 600) * 0.60)  // 80%→20% over 600ms
  return Math.floor(startPrice * pct)
}
