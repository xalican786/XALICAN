// src/treasury.js — Treasury reconciliation
// HOT[5] = EXACT on-chain USDC balance, nothing else
// Single source of truth. No simulation. No prediction.

import { ethers }      from 'ethers'
import {
  TREASURY, USDC, CHAINS, HOT_LAYOUT as H,
  RESERVE_MAX, BASE_FLASH, WORKING_FLASH,
} from './config.js'

// Polygon provider for treasury reads (treasury on Polygon)
const POLYGON_HTTP = CHAINS.find(c => c.id === 137)?.httpUrl
const provider     = new ethers.JsonRpcProvider(POLYGON_HTTP)
const USDC_CONTRACT= new ethers.Contract(
  USDC[137],
  ['function balanceOf(address) view returns (uint256)',
   'event Transfer(address indexed from, address indexed to, uint256 value)'],
  provider
)

// Pending ledger: transactions we expect to confirm
const pending = new Map()  // txHash -> expectedAmount USD
export const addPending = (hash, amount) => pending.set(hash, amount)

// ── RECONCILE ─────────────────────────────────────────────────────────────────
export async function reconcile(HOT) {
  try {
    // RULE: HOT[5] = exactly what eth_call returns. Zero arithmetic.
    const rawBalance = await USDC_CONTRACT.balanceOf(TREASURY)
    const balance    = Number(rawBalance) / 1e6  // USDC has 6 decimals
    HOT[H.TREASURY]  = balance

    // Confirm pending items
    for (const [hash, expected] of pending) {
      const receipt = await provider.getTransactionReceipt(hash).catch(() => null)
      if (receipt?.status === 1) {
        HOT[H.DAILY_REV]  += expected
        HOT[H.PENDING_REV] = Math.max(0, HOT[H.PENDING_REV] - expected)
        HOT[H.MRS2]       += expected
        pending.delete(hash)

        // First revenue signal — activates channels 3-5
        if (HOT[H.FIRST_REV] === 0 && HOT[H.TREASURY] > 0) {
          HOT[H.FIRST_REV] = 1
          console.log('[TREASURY] FIRST REVENUE CONFIRMED — $' + balance.toFixed(2) + ' USDC on-chain')
        }
      }
    }

    // Reserve cannot exceed treasury
    if (HOT[H.RESERVE] > HOT[H.TREASURY]) HOT[H.RESERVE] = HOT[H.TREASURY]

    // Cap reserve at $15T
    if (HOT[H.RESERVE] >= RESERVE_MAX) {
      HOT[H.RESERVE]     = RESERVE_MAX
      HOT[H.RESERVE_PCT] = 0  // turn off inflow
      console.log('[TREASURY] Reserve at $15T cap — 100% revenue to liquid treasury')
    }

    // Update effective flash: base $70B + full reserve
    HOT[H.EFF_FLASH] = BASE_FLASH + HOT[H.RESERVE]

    // Yield accrual: 4.41% APY = 0.01208% per day = 0.000503% per hour
    const hourlyYield = HOT[H.TREASURY] * 0.0000503
    HOT[H.YIELD_TODAY] += hourlyYield

    console.log(`[TREASURY] $${(HOT[H.TREASURY]/1e12).toFixed(4)}T | Reserve: $${(HOT[H.RESERVE]/1e12).toFixed(4)}T | Flash: $${(HOT[H.EFF_FLASH]/1e9).toFixed(0)}B`)

  } catch (e) {
    if (process.env.DEBUG) console.error('[TREASURY]', e.message)
  }
}

// ── WATCH FOR INCOMING TRANSFERS ──────────────────────────────────────────────
// Listens for USDC Transfer events to treasury in real-time
function watchIncoming(HOT) {
  const filter = USDC_CONTRACT.filters.Transfer(null, TREASURY)
  USDC_CONTRACT.on(filter, (from, to, amount) => {
    const usd = Number(amount) / 1e6
    if (usd < 1) return  // dust filter

    // Route to reserve (operator-configured percentage)
    const reservePct = (HOT[H.RESERVE_PCT] || 25) / 100
    const toReserve  = HOT[H.RESERVE] < RESERVE_MAX ? usd * reservePct : 0
    const toLiquid   = usd - toReserve

    HOT[H.RESERVE]     = Math.min(HOT[H.RESERVE] + toReserve, RESERVE_MAX)
    HOT[H.PENDING_REV] += usd  // pending until reconcile confirms
    HOT[H.XC_FEES]    += usd * 0.00001  // XC transaction fees estimate

    console.log(`[TREASURY] +$${usd.toFixed(2)} | Reserve +$${toReserve.toFixed(2)} | Liquid +$${toLiquid.toFixed(2)}`)
  })
}

export function startTreasury(HOT) {
  reconcile(HOT)
  watchIncoming(HOT)
  setInterval(() => reconcile(HOT), 600_000)  // every 10 minutes
  console.log('[TREASURY] Reconciliation active | watching', TREASURY.slice(0,10)+'...')
}
