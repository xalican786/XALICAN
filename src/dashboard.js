// src/dashboard.js — Express + WebSocket, 32 tabs, HOT broadcast
// WS open to all (no PIN on upgrade) — PIN only on REST endpoints
// fullState() reads all HOT slots — zero fake data

import { createRequire }    from 'module'
import { createServer }     from 'http'
import { existsSync }       from 'fs'
import { fileURLToPath }    from 'url'
import path                 from 'path'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const _req  = createRequire(import.meta.url)
const express             = _req(path.join(__dir, '../node_modules/express'))
const { WebSocketServer } = _req(path.join(__dir, '../node_modules/ws'))

import { getExecutions, getAuctions, exportSnapshot, recordTransfer, flushDB } from './db.js'
import { getBridges, getBridgeMode, send }  from './settlement.js'
import {
  CHAINS, PORT, DASHBOARD_PIN, EXECUTOR, TREASURY, SYSTEM, VERSION,
  HOT_LAYOUT as H, getPropTarget, PROP_LABELS, USB_VAULT_PIN,
} from './config.js'

const cleanPin = s => String(s||'').replace(/[^0-9a-zA-Z]/g,'')
const PIN      = cleanPin(DASHBOARD_PIN)

let SAB_REF = null, CHAINS_REF = [], AEE_W = null
const WS_CLIENTS = new Set()

const H_ = H  // alias for brevity in fullState

function hot() { return SAB_REF ? new Float64Array(SAB_REF) : null }

// ── FULL STATE — 100% HOT reads, zero fake data ───────────────────────────────
function fullState() {
  const H2 = hot()
  if (!H2) return { type:'state', ts:Date.now(), booting:true }

  const propeller   = H2[H_.PROPELLER]
  const target      = propeller >= 100 ? H2[H_.P100_TARGET] : getPropTarget(propeller)
  const rev         = H2[H_.DAILY_REV]
  const treasury    = H2[H_.TREASURY]
  const reserve     = H2[H_.RESERVE]
  const effFlash    = H2[H_.EFF_FLASH] || 70e9
  const memMB       = process.memoryUsage().heapUsed / 1024 / 1024 | 0

  const chains = CHAINS_REF.map((c, i) => ({
    name:   c.name,
    id:     c.id,
    active: H2[70 + i] > 0,
    gas:    H2[50 + i] > 0 ? H2[50 + i].toFixed(1) : '0',
  }))

  return {
    type:'state', ts:Date.now(),
    // Core
    propeller, target,
    propLabel: PROP_LABELS[propeller] || `P${propeller}`,
    dailyRevenue: rev,
    revPct: target > 0 ? Math.min(rev/target*100, 100) : 0,
    pendingRevenue: H2[H_.PENDING_REV],
    // Flash & Reserve
    flashBase:    70e9,
    flashEffective: effFlash,
    flashBoost:   effFlash - 70e9,
    reserve, reservePct: Math.min(reserve/15e12*100, 100),
    reserveMax:   15e12, reserveFull: reserve >= 15e12,
    reserveAllocPct: H2[H_.RESERVE_PCT],
    // Treasury
    treasury, liquidTreasury: Math.max(0, treasury-reserve),
    yieldToday: H2[H_.YIELD_TODAY],
    // Executions
    execToday: H2[H_.EXEC_TODAY]|0, execTotal: H2[H_.EXEC_TOTAL]|0,
    aeeExecs:  H2[H_.AEE_EXECS]|0, buyerExecs: H2[H_.BUYER_EXECS]|0,
    cyclesToday: H2[H_.CYCLES_TODAY]|0,
    etaMins:   H2[H_.ETA_MINS],
    // AEE
    aeeMode:   H2[H_.AEE_MODE]===1?'EXECUTOR':'FACILITATOR',
    aeeRatio:  H2[H_.AEE_RATIO]|0,
    firstRev:  H2[H_.FIRST_REV]===1,
    bootstrap: H2[H_.BOOTSTRAP]===1,
    contractsDeployed: H2[H_.CONTRACTS]|0,
    // MRS
    mrs1: H2[H_.MRS1], mrs2: H2[H_.MRS2], mrs4: H2[H_.MRS4],
    mrs5: H2[H_.MRS5], mrs7: H2[H_.MRS7], xcFees: H2[H_.XC_FEES],
    bundlesSold: H2[H_.BUNDLES_SOLD]|0,
    synthToday: H2[H_.SYNTH_TODAY]|0,
    naturalToday: H2[H_.NATURAL_TODAY]|0,
    // MRS7
    mrs7SynthPct: H2[H_.MRS7_SYNTH_PCT],
    mrs7SynthVal: H2[H_.MRS7_SYNTH_VAL],
    mrs7Deployed: H2[H_.MRS7_DEPLOYED],
    // XC
    xcSupply:  H2[H_.XC_SUPPLY],
    xcUSD:     H2[H_.XC_USD],
    xcGold:    H2[H_.XC_GOLD],
    xcHolders: H2[H_.XC_HOLDERS]|0,
    xcVol:     H2[H_.XC_VOL],
    // Signals
    crashSignal: H2[H_.CRASH],
    cloakActive: H2[H_.CLOAK]===1,
    darkPool:    H2[H_.DARK_POOL]===1,
    oracleDevs:  H2[H_.ORACLE_DEVS]|0,
    // Chains
    chainCount: CHAINS_REF.length,
    activeWS:   chains.filter(c=>c.active).length,
    chains,
    // System
    memMB, memCap: 200,
    executor: EXECUTOR, treasury_addr: TREASURY,
    version: VERSION, wsClients: WS_CLIENTS.size,
    uptime: H2[H_.UPTIME]|0,
    p100Target: H2[H_.P100_TARGET],
  }
}

function broadcast(data) {
  const p = JSON.stringify(data)
  for (const ws of WS_CLIENTS) {
    if (ws.readyState === 1) try { ws.send(p) } catch { WS_CLIENTS.delete(ws) }
  }
}

// 500ms broadcast loop
setInterval(() => { if (WS_CLIENTS.size > 0) broadcast(fullState()) }, 500)

// ── EXPRESS ───────────────────────────────────────────────────────────────────
const app = express()
const srv = createServer(app)
const wss = new WebSocketServer({ server: srv, perMessageDeflate: false })

app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dir, '../dashboard')))

// Serve dashboard HTML
app.get('/', (_, res) => {
  const p = path.join(__dir, '../dashboard/xalican.html')
  existsSync(p) ? res.sendFile(p) : res.status(404).send('xalican.html not found')
})

// No-auth diagnostics
app.get('/ping', (_, res) => {
  const H2 = hot()
  res.json({
    ok:true, system:SYSTEM, ts:Date.now(),
    wsClients:WS_CLIENTS.size, uptime:H2?H2[H_.UPTIME]|0:0,
    propeller:H2?H2[H_.PROPELLER]:0, rev:H2?H2[H_.DAILY_REV]:0,
    reserve:H2?H2[H_.RESERVE]:0, flash:H2?H2[H_.EFF_FLASH]:0,
    firstRev:H2?H2[H_.FIRST_REV]===1:false, aeeMode:H2?H2[H_.AEE_MODE]:0,
  })
})

// Auth middleware
const auth = (req, res, next) => {
  const p = cleanPin(req.headers['x-pin'] || req.query.pin || req.body?.pin || '')
  if (p !== PIN) return res.status(401).json({ error:'Invalid PIN' })
  next()
}

// ── REST API ──────────────────────────────────────────────────────────────────
app.get('/api/state',      auth, (_, res) => res.json(fullState()))
app.get('/api/executions', auth, (req, res) => { try{res.json(getExecutions(parseInt(req.query.limit)||100))}catch{res.json([])} })
app.get('/api/auctions',   auth, (req, res) => { try{res.json(getAuctions(parseInt(req.query.limit)||100))}catch{res.json([])} })
app.get('/api/bridges',    auth, (_,res) => res.json({ bridges:getBridges(), modes:Object.fromEntries(getBridges().map(b=>[b,getBridgeMode(b)])) }))

app.post('/api/propeller', auth, (req, res) => {
  const { level } = req.body
  if (typeof level !== 'number') return res.status(400).json({ error:'Level required' })
  const H2 = hot(); if (!H2) return res.status(503).json({ error:'not ready' })
  H2[H_.PROPELLER] = level
  const target = level >= 100 ? H2[H_.P100_TARGET] : getPropTarget(level)
  broadcast({ type:'propeller', level, target, label: PROP_LABELS[level] || `Level ${level}` })
  res.json({ ok:true, level, target })
})

app.post('/api/p100', auth, (req, res) => {
  const { target } = req.body
  if (typeof target !== 'number' || target <= 0) return res.status(400).json({ error:'Target required' })
  const H2 = hot(); if (!H2) return res.status(503).json({ error:'not ready' })
  H2[H_.P100_TARGET] = target; H2[H_.PROPELLER] = 100
  broadcast({ type:'propeller', level:100, target, label:`P100 Custom` })
  res.json({ ok:true, target })
})

app.post('/api/reserve-allocation', auth, (req, res) => {
  const { pct } = req.body
  if (typeof pct !== 'number' || pct < 0 || pct > 100) return res.status(400).json({ error:'0-100' })
  const H2 = hot(); if (!H2) return res.status(503).json({ error:'not ready' })
  H2[H_.RESERVE_PCT] = pct
  broadcast({ type:'reserve', pct })
  res.json({ ok:true, pct })
})

app.post('/api/reserve-transfer', auth, (req, res) => {
  const { amount } = req.body
  if (!amount || amount <= 0) return res.status(400).json({ error:'Amount required' })
  const H2 = hot(); if (!H2) return res.status(503).json({ error:'not ready' })
  const transfer = Math.min(amount, H2[H_.RESERVE])
  H2[H_.RESERVE]  = Math.max(0, H2[H_.RESERVE] - transfer)
  H2[H_.PENDING_RESERVE] = transfer
  broadcast({ type:'reserve-transfer', amount:transfer })
  res.json({ ok:true, transferred:transfer, newReserve:H2[H_.RESERVE] })
})

app.post('/api/aee-ratio', auth, (req, res) => {
  const { ratio } = req.body
  if (typeof ratio !== 'number' || ratio < 0 || ratio > 100) return res.status(400).json({ error:'0-100' })
  const H2 = hot(); if (!H2) return res.status(503).json({ error:'not ready' })
  H2[H_.AEE_RATIO] = ratio
  broadcast({ type:'aee-ratio', ratio })
  res.json({ ok:true, ratio })
})

app.post('/api/mrs7', auth, (req, res) => {
  const { synthPct, synthVal } = req.body
  const H2 = hot(); if (!H2) return res.status(503).json({ error:'not ready' })
  if (synthPct !== undefined) H2[H_.MRS7_SYNTH_PCT] = Math.min(100, Math.max(0, synthPct))
  if (synthVal !== undefined) H2[H_.MRS7_SYNTH_VAL] = Math.max(10000, synthVal)
  res.json({ ok:true, synthPct:H2[H_.MRS7_SYNTH_PCT], synthVal:H2[H_.MRS7_SYNTH_VAL] })
})

app.post('/api/target-timeframe', auth, (req, res) => {
  const { targetValue, minutes } = req.body
  if (!targetValue || !minutes) return res.status(400).json({ error:'targetValue and minutes required' })
  const H2 = hot(); if (!H2) return res.status(503).json({ error:'not ready' })
  const perExec     = (H2[H_.EFF_FLASH] || 70e9) * 0.01 * 14  // rough L1×L7
  const needed      = targetValue - H2[H_.DAILY_REV]
  const cyclesNeeded= needed / perExec
  const cyclesAvail = minutes * 60 * 92  // 92 cycles/second
  const achievable  = cyclesAvail >= cyclesNeeded
  res.json({ ok:true, suggestion:{ targetValue, minutes, cyclesNeeded:Math.ceil(cyclesNeeded), achievable, currentRate:perExec*92*60 } })
})

app.post('/api/transfer', auth, async (req, res) => {
  const { bridge='modempay', ...params } = req.body
  try {
    const result = await send(bridge, params)
    recordTransfer({ type:params.type||'', amount:params.amount||0, bridge, recipient:params.phone||params.accountNumber||params.address||'', status:'submitted', reference:result.reference||'' })
    broadcast({ type:'transfer', amount:params.amount, bridge, status:'submitted' })
    res.json(result)
  } catch(e) { res.status(500).json({ error:e.message }) }
})

// ── CONTROL ENDPOINTS (10 operations) ─────────────────────────────────────────
const ctrl = (sig) => (_, res) => {
  const H2 = hot(); if (!H2) return res.status(503).json({ error:'not ready' })
  Atomics.store(new Int32Array(SAB_REF, 4088), 0, sig)
  res.json({ ok:true })
}

app.post('/api/control/halt',     auth, (_, res) => {
  const H2=hot(); if(!H2)return res.status(503).json({error:'not ready'})
  H2[H_.CRASH]=1; broadcast({type:'halt'}); res.json({ok:true})
})
app.post('/api/control/resume',   auth, (_, res) => {
  const H2=hot(); if(!H2)return res.status(503).json({error:'not ready'})
  H2[H_.CRASH]=0; broadcast({type:'resume'}); res.json({ok:true})
})
app.post('/api/control/aee-stop', auth, ctrl(2))
app.post('/api/control/aee-restart', auth, ctrl(3))
app.post('/api/control/shutdown', auth, async (_, res) => {
  res.json({ ok:true, message:'Shutting down gracefully' })
  await flushDB()
  setTimeout(() => process.exit(0), 500)
})
app.post('/api/control/midnight', auth, (_, res) => {
  const H2=hot(); if(!H2)return res.status(503).json({error:'not ready'})
  const daily = [H_.DAILY_REV,H_.EXEC_TODAY,H_.CYCLES_TODAY,H_.YIELD_TODAY,H_.MRS1,H_.MRS2,H_.MRS4,H_.MRS5,H_.MRS7,H_.XC_FEES,H_.BUNDLES_SOLD,H_.BUYER_EXECS,H_.AEE_EXECS,H_.SYNTH_TODAY,H_.NATURAL_TODAY]
  daily.forEach(i=>H2[i]=0); broadcast({type:'midnight'}); res.json({ok:true})
})
app.post('/api/control/reconcile', auth, async (_, res) => {
  const { reconcile } = await import('./treasury.js')
  await reconcile(hot())
  res.json({ ok:true, treasury: hot()?.[H_.TREASURY] || 0 })
})
app.post('/api/control/redeploy', auth, ctrl(1))
app.post('/api/control/flush-reserve', auth, (req, res) => {
  const { pin } = req.body
  if (cleanPin(pin) !== USB_VAULT_PIN) return res.status(401).json({ error:'Vault PIN required' })
  const H2=hot(); if(!H2)return res.status(503).json({error:'not ready'})
  const flushed=H2[H_.RESERVE]; H2[H_.RESERVE]=0
  broadcast({type:'reserve-flush',amount:flushed}); res.json({ok:true,flushed})
})
app.post('/api/control/cascade', auth, (req, res) => {
  const{on}=req.body; const H2=hot(); if(!H2)return res.status(503).json({error:'not ready'})
  H2[H_.CRASH]=on?100:0; H2[H_.DARK_POOL]=on?1:0
  broadcast({type:'cascade',active:!!on}); res.json({ok:true,active:!!on})
})

// Vault verification
app.post('/api/vault/verify', auth, (req, res) => {
  const { pin } = req.body
  res.json({ ok: cleanPin(String(pin||'')) === USB_VAULT_PIN })
})

app.post('/api/snapshot', auth, (_, res) => { res.json(exportSnapshot()) })
app.get('/api/snapshot/download', auth, (_, res) => {
  existsSync('/data/snapshot.json') ? res.download('/data/snapshot.json') : res.status(404).json({error:'No snapshot'})
})

// XC Currency endpoints
app.post('/api/xc/convert', auth, (req, res) => {
  const { amount, direction, pin } = req.body
  if (cleanPin(String(pin||'')) !== USB_VAULT_PIN && (direction==='all-to-xc'||direction==='revenue-to-xc'))
    return res.status(401).json({ error:'Vault PIN required for full conversion' })
  const H2=hot(); if(!H2)return res.status(503).json({error:'not ready'})
  broadcast({ type:'xc-convert', amount, direction })
  res.json({ ok:true, amount, direction })
})

// ── WEBSOCKET — open to all, no PIN required ──────────────────────────────────
wss.on('connection', (ws) => {
  WS_CLIENTS.add(ws)
  ws.send(JSON.stringify(fullState()))
  ws.on('close', () => WS_CLIENTS.delete(ws))
  ws.on('error', () => WS_CLIENTS.delete(ws))
  ws.on('message', raw => {
    try {
      const m  = JSON.parse(raw.toString())
      const H2 = hot(); if (!H2) return
      if (m.type === 'propeller' && typeof m.level === 'number') {
        H2[H_.PROPELLER] = m.level
        broadcast({ type:'propeller', level:m.level, target:getPropTarget(m.level) })
      }
      if (m.type === 'p100' && typeof m.target === 'number') {
        H2[H_.P100_TARGET] = m.target; H2[H_.PROPELLER] = 100
        broadcast({ type:'propeller', level:100, target:m.target })
      }
    } catch {}
  })
})

export function startDashboard(SAB, chains, aeeWorker) {
  SAB_REF     = SAB
  CHAINS_REF  = chains || []
  AEE_W       = aeeWorker || null
  srv.listen(PORT, () => {
    console.log(`[DASHBOARD] ${SYSTEM} :${PORT} | PIN:${PIN.length} chars | /ping for status`)
  })
}
