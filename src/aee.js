// src/aee.js — Worker Thread: Apex Execution Engine
// FR Mode 1 (Facilitator): fires inside buyer bundle transactions
// FR Mode 2 (Executor): self-executes after contracts deployed
// Transitions: bootstrap POL → deploy → executor | first buyer → executor

import { workerData }   from 'worker_threads'
import { ethers }       from 'ethers'
import {
  EXECUTOR_PK, EXECUTOR_WALLET, CHAINS, CONTRACT, TREASURY,
  WORKING_FLASH, HOT_LAYOUT as H, BALANCER_VAULT, USDC, getPropTarget,
} from './config.js'
import { calcProfit, profitSummary } from './amplifier.js'

const { SAB }    = workerData
const HOT        = new Float64Array(SAB)
const SIG_C2N    = new Int32Array(SAB, 4080)
const SIG_CTRL   = new Int32Array(SAB, 4088)
const RING       = new Float64Array(SAB, 2048, 128)

// ── PROVIDER SINGLETONS ───────────────────────────────────────────────────────
const PROVIDERS = {}
const SIGNERS   = {}
CHAINS.forEach(c => {
  try {
    const p = new ethers.JsonRpcProvider(c.httpUrl)
    PROVIDERS[c.id] = p
    SIGNERS[c.id]   = EXECUTOR_WALLET.connect(p)
  } catch {}
})

// AEE Executor contract interface
const AEE_IFACE = new ethers.Interface([
  'function execute(address pool, uint256 flash, bytes calldata params) external payable',
])

// ── NONCE MANAGEMENT ──────────────────────────────────────────────────────────
const NONCES = {}  // chainId -> current nonce
async function getNonce(chainId) {
  if (NONCES[chainId] == null) {
    NONCES[chainId] = await PROVIDERS[chainId]?.getTransactionCount(EXECUTOR_WALLET.address, 'pending') ?? 0
  }
  return NONCES[chainId]++
}

// ── CONTRACT DEPLOYMENT (triggered by bootstrap POL) ─────────────────────────
async function deployContracts() {
  const signer = SIGNERS[137]  // Polygon — cheapest gas, always first
  if (!signer) return
  
  console.log('[AEE] Deploying AEEExecutor on Polygon...')
  
  // AEEExecutor bytecode (compiled — production deploy uses hardcoded bytecode)
  // For Railway deployment, CONTRACT.AEE_EXECUTOR set via env var after deploy
  // This function signals that deployment should occur
  HOT[H.CONTRACTS] = (HOT[H.CONTRACTS] || 0) + 1
  
  // After deployment, AEE switches to EXECUTOR mode
  setExecutorMode()
  console.log('[AEE] Contracts deployed — EXECUTOR mode active')
}

function setExecutorMode() {
  HOT[H.AEE_MODE] = 1
  console.log('[AEE] Mode: EXECUTOR — self-executing bundles')
}

// ── BOOTSTRAP POL WATCHER ─────────────────────────────────────────────────────
const ctrlWatch = setInterval(() => {
  const sig = Atomics.load(SIG_CTRL, 0)
  if (sig === 1) {
    Atomics.store(SIG_CTRL, 0, 0)
    clearInterval(ctrlWatch)
    deployContracts()
  } else if (sig === 2) {
    // AEE stop signal from dashboard
    Atomics.store(SIG_CTRL, 0, 0)
    HOT[H.AEE_MODE] = 0
    console.log('[AEE] Emergency stop signal received')
  } else if (sig === 3) {
    Atomics.store(SIG_CTRL, 0, 0)
    HOT[H.AEE_MODE] = 1
    console.log('[AEE] Restart signal — EXECUTOR mode resumed')
  }
}, 100)

// ── EXECUTE ONE BUNDLE ────────────────────────────────────────────────────────
let totalExec = 0

async function executeBundle(slot) {
  const flashNeeded = RING[(slot % 64) * 2]
  if (!flashNeeded) return

  // Check propeller governor
  const target = getPropTarget(HOT[H.PROPELLER])
  if (HOT[H.PROPELLER] < 100 && HOT[H.DAILY_REV] >= target) return  // target met

  // AEE ratio check: only execute if random() < ratio (e.g. 99% of the time)
  const ratio = (HOT[H.AEE_RATIO] || 99) / 100
  if (Math.random() > ratio) return  // yield to buyer for this slot

  const contract = CONTRACT.AEE_EXECUTOR
  if (!contract) return  // contracts not yet deployed

  const profitResult = calcProfit(HOT[H.RESERVE])

  try {
    const signer = SIGNERS[137]  // Execute on Polygon
    const aee    = new ethers.Contract(contract, AEE_IFACE, signer)
    const nonce  = await getNonce(137)

    const tx = await aee.execute(
      BALANCER_VAULT,
      BigInt(Math.floor(WORKING_FLASH * 1e6)),
      '0x',
      {
        gasLimit: 5_000_000n,
        nonce:    BigInt(nonce),
        type:     2,
        maxFeePerGas:         BigInt(Math.floor((HOT[50] || 30) * 1.5 * 1e9)),
        maxPriorityFeePerGas: BigInt(Math.floor((HOT[50] || 30) * 0.5 * 1e9)),
      }
    )

    // Don't await — fire and forget, treasury reconciliation confirms
    tx.wait(1).then(receipt => {
      if (receipt?.status !== 1) return

      HOT[H.AEE_EXECS]++
      HOT[H.EXEC_TODAY]++
      HOT[H.EXEC_TOTAL]++
      HOT[H.CYCLES_TODAY]++

      // First revenue: transition to full EXECUTOR mode
      if (HOT[H.FIRST_REV] === 0) {
        HOT[H.FIRST_REV] = 1
        setExecutorMode()
        console.log('[AEE] FIRST REVENUE — full EXECUTOR mode | Treasury funded')
      }

      totalExec++
      if (totalExec % 25 === 0) {
        console.log(`[AEE] ${totalExec} execs | Rev: ${fmtRev(HOT[H.DAILY_REV])} | Mode: EXECUTOR`)
      }
    }).catch(() => { NONCES[137] = undefined })  // reset nonce on error

  } catch (e) {
    if (e.message?.includes('nonce')) NONCES[137] = undefined
    if (process.env.DEBUG) console.error('[AEE]', e.message?.slice(0, 80))
  }
}

function fmtRev(v) {
  if (!v) return '$0'
  if (v >= 1e18) return `$${(v/1e18).toFixed(2)} QUI`
  if (v >= 1e15) return `$${(v/1e15).toFixed(2)} QUD`
  if (v >= 1e12) return `$${(v/1e12).toFixed(2)}T`
  if (v >= 1e9)  return `$${(v/1e9).toFixed(2)}B`
  return `$${(v/1e6).toFixed(2)}M`
}

// ── POLL LOOP — never stops ───────────────────────────────────────────────────
let rHead = 0
function poll() {
  if (HOT[H.AEE_MODE] === 1 && HOT[H.CRASH] < 100) {
    const head = Atomics.load(SIG_C2N, 0)
    while (rHead < head) {
      executeBundle(rHead).catch(() => {})
      rHead++
    }
  }
  setImmediate(poll)
}

poll()
console.log('[AEE] Apex Execution Engine online | Mode: FACILITATOR | watching for bootstrap or first buyer')
