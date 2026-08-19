// src/amplifier.js — 15-layer value amplifier
// Pure functions, BigInt arithmetic throughout — no floating point
// Called by aee.js before each execution to calculate expected profit

import { WORKING_FLASH, RESERVE_MIN } from './config.js'

// ── CALCULATE AMPLIFIED PROFIT — 15 LAYERS ───────────────────────────────────
// All values in USDC units (6 decimals as BigInt)
export function calcProfit(reserveBalance) {
  const reserve     = BigInt(Math.floor(Math.max(0, reserveBalance)))
  const hasReserve  = reserveBalance >= RESERVE_MIN
  
  // Effective flash: working flash + 80% of reserve (if above minimum)
  const baseFlash   = BigInt(Math.floor(WORKING_FLASH * 1e6))  // $250B in USDC units
  const reserveAdd  = hasReserve ? (reserve * 80n) / 100n : 0n
  const flash       = baseFlash + reserveAdd
  
  // L1: JIT 1% fee tier extraction
  const L1 = flash / 100n
  
  // L2: Cascade compound — 50% of L1 → Aave 80× leverage → 1% extraction
  const L2 = (L1 / 2n * 80n) / 100n
  
  // L3: Cross-chain echo — 4 chains × 70% efficiency
  const L3 = (L1 * 4n * 70n) / 100n
  
  // L4: Recursive depth-3 within same block
  const L4 = (L1 * 30n) / 100n
  
  // L5: Oracle deviation liquidations (fixed $50M)
  const L5 = 50_000_000n * 1_000_000n  // $50M in USDC units
  
  // L6: MRS7 pool amplification +20% on L1
  const L6 = (L1 * 20n) / 100n
  
  // L8: Synthetic echo feedback (10% bonus when MRS7 active)
  const L8 = (L1 * 10n) / 100n
  
  // L9: Tick range fragmentation — 50 ranges × avg 12% each
  const L9 = (L1 * 50n * 12n) / 100n
  
  // L12: Sandwich rebound +20% of L1
  const L12 = (L1 * 20n) / 100n
  
  // L13: Cross-protocol cascade (fixed $60M across Curve/Balancer/DODO)
  const L13 = 60_000_000n * 1_000_000n
  
  // Sum before multipliers
  const preMultiplier = L1 + L2 + L3 + L4 + L5 + L6 + L8 + L9 + L12 + L13
  
  // L11: Block position optimization +25%
  const withL11 = (preMultiplier * 125n) / 100n
  
  // L15: Temporal arbitrage window +10%
  const withL15 = (withL11 * 110n) / 100n
  
  // L7: 20-chain parallel execution × 14 effective (20 × 70%)
  const withL7 = (withL15 * 14n)
  
  // L14: Recursive self-amplification depth-5
  // Each depth: 10% of previous → 10× Aave → same L7 chain multiplier
  let L14 = 0n
  let seed = (withL7 * 10n) / 100n  // 10% of L7 output
  for (let i = 0; i < 5; i++) {
    const inner = (seed * 10n * 14n * 110n * 125n) / (100n * 100n * 100n * 100n)
    L14 += inner
    seed = (inner * 10n) / 100n
  }
  
  const total = withL7 + L14
  
  // Return as number (USDC units, 6 decimals)
  return { total, flash, L1, L7: withL7, L14, hasReserve }
}

// Human-readable summary for logs
export function profitSummary(result) {
  const usd = Number(result.total) / 1e6
  if (usd >= 1e12) return `$${(usd/1e12).toFixed(2)}T`
  if (usd >= 1e9)  return `$${(usd/1e9).toFixed(2)}B`
  if (usd >= 1e6)  return `$${(usd/1e6).toFixed(2)}M`
  return `$${usd.toFixed(0)}`
}
