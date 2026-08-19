// src/db.js — sql-asm.js database
// Pure JS SQLite — no native bindings — Railway compatible
// Stores: executions, bundles, auctions, buyer log, snapshots

import { createRequire } from 'module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

const require  = createRequire(import.meta.url)
const initSqlJs = require('sql.js')

const DB_PATH  = '/data/xalican.db.bin'
const DATA_DIR = '/data'
let DB = null

export async function initDB() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  
  const SQL = await initSqlJs()
  
  if (existsSync(DB_PATH)) {
    DB = new SQL.Database(readFileSync(DB_PATH))
    console.log('[DB] Loaded:', DB_PATH)
  } else {
    DB = new SQL.Database()
    console.log('[DB] New database:', DB_PATH)
  }
  
  DB.run(`
    CREATE TABLE IF NOT EXISTS executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER, chainId INTEGER, bundleType TEXT,
      profit REAL, flashUsed REAL, mode TEXT,
      txHash TEXT, blockNumber INTEGER
    );
    CREATE TABLE IF NOT EXISTS auctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER, bundleId TEXT, bundleType TEXT,
      startPrice REAL, finalPrice REAL,
      buyerCount INTEGER, sold INTEGER
    );
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER, type TEXT, amount REAL, bridge TEXT,
      recipient TEXT, status TEXT, reference TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_exec_ts ON executions(ts);
    CREATE INDEX IF NOT EXISTS idx_auct_ts ON auctions(ts);
  `)
  
  // Flush to disk every 30 seconds
  setInterval(flush, 30_000)
}

function flush() {
  if (!DB) return
  try { writeFileSync(DB_PATH, Buffer.from(DB.export())) } catch {}
}

export function recordExecution(data) {
  if (!DB) return
  DB.run(
    'INSERT INTO executions (ts,chainId,bundleType,profit,flashUsed,mode,txHash,blockNumber) VALUES (?,?,?,?,?,?,?,?)',
    [Date.now(), data.chainId||137, data.bundleType||'AEE', data.profit||0, data.flash||0, data.mode||'AEE', data.txHash||'', data.block||0]
  )
}

export function recordAuction(data) {
  if (!DB) return
  DB.run(
    'INSERT INTO auctions (ts,bundleId,bundleType,startPrice,finalPrice,buyerCount,sold) VALUES (?,?,?,?,?,?,?)',
    [Date.now(), data.bundleId||'', data.bundleType||'', data.startPrice||0, data.finalPrice||0, data.buyerCount||0, data.sold?1:0]
  )
}

export function recordTransfer(data) {
  if (!DB) return
  DB.run(
    'INSERT INTO transfers (ts,type,amount,bridge,recipient,status,reference) VALUES (?,?,?,?,?,?,?)',
    [Date.now(), data.type||'', data.amount||0, data.bridge||'modempay', data.recipient||'', data.status||'', data.reference||'']
  )
}

export function getExecutions(limit = 100) {
  if (!DB) return []
  return DB.exec(`SELECT * FROM executions ORDER BY ts DESC LIMIT ${limit}`)[0]?.values || []
}

export function getAuctions(limit = 100) {
  if (!DB) return []
  return DB.exec(`SELECT * FROM auctions ORDER BY ts DESC LIMIT ${limit}`)[0]?.values || []
}

export function exportSnapshot() {
  const execs    = getExecutions(1000)
  const auctions = getAuctions(1000)
  const snapshot = { ts: Date.now(), executions: execs, auctions, version: '1.0.0' }
  try {
    writeFileSync('/data/snapshot.json', JSON.stringify(snapshot))
    return { ok: true, sizeKB: Math.round(JSON.stringify(snapshot).length/1024) }
  } catch(e) { return { ok: false, error: e.message } }
}

export async function flushDB() { flush() }
