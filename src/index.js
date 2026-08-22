// src/index.js — XALICAN Boot
// FR Hybrid Model: organic (SSC/buyers) + bootstrap (POL)
// SAB initialized here and shared to all workers

import { Worker }        from 'worker_threads'
import { createServer }  from 'http'
import { ethers }        from 'ethers'
import {
  SAB_SIZE, HOT_LAYOUT as H, CHAINS, PROP_DEFAULT,
  BASE_FLASH, WORKING_FLASH, AEE_RATIO_DEFAULT,
  EXECUTOR, TREASURY, SYSTEM, VERSION, getPropTarget,
} from './config.js'
import { initDB }        from './db.js'
import { startTreasury } from './treasury.js'
import { startDashboard }from './dashboard.js'
import { startDeployer } from './deployer.js'
// ...
await initDB()
startDeployer(HOT)  // add this line

// ── SAB — single SharedArrayBuffer for all inter-thread state ────────────────
export const SAB  = new SharedArrayBuffer(SAB_SIZE)
export const HOT  = new Float64Array(SAB)
const SIG_C2N     = new Int32Array(SAB, 4080)
const SIG_N2A     = new Int32Array(SAB, 4084)
const SIG_CTRL    = new Int32Array(SAB, 4088)

// Boot defaults
HOT[H.PROPELLER]  = PROP_DEFAULT   // P15
HOT[H.FLASH_BASE] = BASE_FLASH     // $70B
HOT[H.EFF_FLASH]  = WORKING_FLASH  // $250B working
HOT[H.AEE_RATIO]  = AEE_RATIO_DEFAULT  // 99%
HOT[H.AEE_MODE]   = 0              // FACILITATOR
HOT[H.RESERVE_PCT]= 25             // 25% to reserve
HOT[H.MRS7_SYNTH_PCT] = 0         // 0% synthetic (grows as reserve fills)
HOT[H.MRS7_SYNTH_VAL] = 10e6      // $10M default synthetic swap size

// ── WORKER SPAWNER ────────────────────────────────────────────────────────────
function spawn(file, extra = {}) {
  const w = new Worker(new URL(file, import.meta.url), { workerData: { SAB, ...extra } })
  const tag = file.replace(/.*\//, '').replace('.js','').toUpperCase()
  w.on('error', e  => console.error(`[${tag}] Error:`, e.message?.slice(0,100)))
  w.on('exit',  c  => { if (c !== 0) { console.warn(`[${tag}] Restarting`); setTimeout(() => spawn(file, extra), 2000) } })
  return w
}

// ── BANNER ────────────────────────────────────────────────────────────────────
function banner() {
  console.log('╔══════════════════════════════════════════════════╗')
  console.log(`║   X A L I C A N  — Sovereign Intelligence Protocol  ║`)
  console.log(`║   Version: ${VERSION}  |  Operator: Bun Omar SECKA       ║`)
  console.log(`║   Executor: ${EXECUTOR.slice(0,20)}...                   ║`)
  console.log(`║   Treasury: ${TREASURY.slice(0,20)}...                   ║`)
  console.log(`║   Chains: ${CHAINS.length}  |  Flash: $70B base  |  P15 default  ║`)
  console.log('╚══════════════════════════════════════════════════╝')
}

// ── FR MODEL 2: POL WATCHER ───────────────────────────────────────────────────
// Polls Polygon every 500ms for POL deposit to executor wallet
// When detected: signals AEE worker to deploy contracts immediately
function startPolWatcher() {
  const provider = new ethers.JsonRpcProvider(
    CHAINS.find(c => c.id === 137).httpUrl
  )
  let watching = true
  const iv = setInterval(async () => {
    if (!watching) return
    try {
      const bal = await provider.getBalance(EXECUTOR)
      if (bal > ethers.parseEther('0.001') && HOT[H.BOOTSTRAP] === 0) {
        HOT[H.BOOTSTRAP] = 1
        watching = false
        clearInterval(iv)
        Atomics.store(SIG_CTRL, 0, 1)  // signal AEE to deploy contracts
        console.log('[BOOT] Bootstrap POL detected:', ethers.formatEther(bal), 'POL — AEE deploying')
      }
    } catch {}
  }, 500)
}

// ── MIDNIGHT RESET ────────────────────────────────────────────────────────────
function scheduleMidnight() {
  const now = new Date(), nx = new Date()
  nx.setUTCHours(0, 0, 0, 0)
  nx.setUTCDate(nx.getUTCDate() + 1)
  setTimeout(() => {
    const daily = [H.DAILY_REV,H.EXEC_TODAY,H.CYCLES_TODAY,H.YIELD_TODAY,
                   H.MRS1,H.MRS2,H.MRS4,H.MRS5,H.MRS7,H.XC_FEES,
                   H.BUNDLES_SOLD,H.BUYER_EXECS,H.AEE_EXECS,H.SYNTH_TODAY,H.NATURAL_TODAY]
    daily.forEach(i => HOT[i] = 0)
    console.log('[BOOT] Midnight reset — daily counters cleared')
    scheduleMidnight()
  }, nx - now)
}

// ── MEMORY GUARD ─────────────────────────────────────────────────────────────
function memGuard() {
  const mb = process.memoryUsage().heapUsed / 1024 / 1024
  if (mb > 170 && typeof global.gc === 'function') global.gc()
  if (mb > 190) Atomics.store(SIG_CTRL, 0, 9)  // pressure signal
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
banner()
await initDB()

const detectorW = spawn('./detector.js')
const aeeW      = spawn('./aee.js')
const mrs7W     = spawn('./mrs7.js')

startTreasury(HOT)
startDashboard(SAB, CHAINS, aeeW)
startPolWatcher()
scheduleMidnight()

setInterval(() => HOT[H.UPTIME]++, 1000)
setInterval(memGuard, 5000)

// Simple health HTTP server on 3001 for Railway internal checks
createServer((req, res) => {
  if (req.url !== '/health') { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ok: true, system: SYSTEM, uptime: HOT[H.UPTIME]|0,
    propeller: HOT[H.PROPELLER], rev: HOT[H.DAILY_REV],
    treasury: HOT[H.TREASURY], reserve: HOT[H.RESERVE], flash: HOT[H.EFF_FLASH],
    aeeMode: HOT[H.AEE_MODE], aeeExecs: HOT[H.AEE_EXECS],
    mb: process.memoryUsage().heapUsed/1024/1024|0,
  }))
}).listen(3001).on('error', () => {})

process.on('uncaughtException',  e => console.error('[BOOT] Uncaught:', e.message?.slice(0,120)))
process.on('unhandledRejection', r => console.error('[BOOT] Rejection:', String(r).slice(0,120)))
process.on('SIGTERM', () => { console.log('[BOOT] SIGTERM — shutting down'); process.exit(0) })

console.log(`[BOOT] ${SYSTEM} operational :${process.env.PORT||3000} | FR Hybrid active | waiting for first revenue or POL`)
