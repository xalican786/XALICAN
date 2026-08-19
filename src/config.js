// src/config.js — XALICAN SOVEREIGN INTELLIGENCE PROTOCOL
// All constants hardcoded. Zero dynamic computation at import time.
// 3 env vars only: PORT, DASHBOARD_PASSKEY, MODEMPAY_SECRET_KEY

import { ethers } from 'ethers'

// ── IDENTITY ─────────────────────────────────────────────────────────────────
export const SYSTEM          = 'XALICAN'
export const VERSION         = '1.0.0'
export const OPERATOR        = 'Bun Omar SECKA'
export const MODEMPAY_REF    = 'Xalican Operator: Bun Omar SECKA'
export const USB_VAULT_PIN   = '3530588'
export const DASHBOARD_PIN   = (process.env.DASHBOARD_PASSKEY || '3530588')
export const PORT            = parseInt(process.env.PORT || '3000')
export const MPKEY           = process.env.MODEMPAY_SECRET_KEY || ''

// ── WALLETS ───────────────────────────────────────────────────────────────────
export const EXECUTOR_PK = '0x11a016d02b5cdd160dad12f0a5bb11477bd785a036c648e0491a10afd2fbdb3f'
export const EXECUTOR_WALLET = new ethers.Wallet(EXECUTOR_PK)
export const EXECUTOR    = EXECUTOR_WALLET.address
export const TREASURY    = '0xCCCF1C9A2154750A0D7CceeD51fE0f9b4c1906e8'

// ── FLASH CAPACITY ────────────────────────────────────────────────────────────
export const BASE_FLASH    = 70e9    // $70B: Balancer 8-pool combined
export const WORKING_FLASH = 250e9   // $70B + $180B Aave V3 flash stack
export const PER_EXECUTION = 640e9   // $640B: 15-layer amplifier output
export const RESERVE_MAX   = 15e12   // $15T: $10T base + $3T MRS7 + $2T buffer
export const RESERVE_MIN   = 250e9   // $250B: minimum before reserve amplifies flash
export const AEE_RATIO_DEFAULT = 99  // 99% of bundles executed by AEE

// ── CONTRACT ADDRESSES (set after deployment) ─────────────────────────────────
export const CONTRACT = {
  AEE_EXECUTOR:    process.env.AEE_EXECUTOR    || '',
  JIT_PROVIDER:    process.env.JIT_PROVIDER    || '',
  FLASH_MANAGER:   process.env.FLASH_MANAGER   || '',
  SPLITTER:        process.env.SPLITTER        || '',
  XC_TOKEN:        process.env.XC_TOKEN        || '',
}
// SSC contracts per chain — set after first revenue
export const SSC_ADDRESSES = {}

// ── BALANCER & AAVE ───────────────────────────────────────────────────────────
export const BALANCER_VAULT = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
export const AAVE_POOL_POL  = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
export const AAVE_POOL_ARB  = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'

// ── USDC ADDRESSES ────────────────────────────────────────────────────────────
export const USDC = {
  137:    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  42161:  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  8453:   '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  10:     '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  1:      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  56:     '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  43114:  '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
}

// ── CHAINLINK ORACLE ──────────────────────────────────────────────────────────
export const CHAINLINK_XAU_USD = '0x0C466540B2ee1a31b441671eac0ca886e051E410'

// ── IPFS / SSC ────────────────────────────────────────────────────────────────
export const IPFS_TOPIC    = '/xalican/bundles/v1'
export const IPFS_API      = 'https://ipfs.infura.io:5001/api/v0/pubsub/pub'
export const IPFS_KEY      = process.env.IPFS_KEY || ''
export const IPFS_SECRET   = process.env.IPFS_SECRET || ''
export const BLOXROUTE_URL = 'https://mev.api.bloxroute.com/v1/submit'
export const BLOXROUTE_KEY = process.env.BLOXROUTE_KEY || ''
export const MEVSHARE_URL  = 'https://relay.flashbots.net'

// ── CHAINS ────────────────────────────────────────────────────────────────────
export const CHAINS = [
  { id:137,    name:'polygon-mainnet',    wsUrl:'wss://polygon-mainnet.g.alchemy.com/v2/CfWwmhym4lH5r7_T7_oU0',  httpUrl:'https://polygon-mainnet.g.alchemy.com/v2/CfWwmhym4lH5r7_T7_oU0',  blockMs:2000 },
  { id:42161,  name:'arb-mainnet',        wsUrl:'wss://arb-mainnet.g.alchemy.com/v2/X0nWXU_gGc2Q7P_FrF_tM',      httpUrl:'https://arb-mainnet.g.alchemy.com/v2/X0nWXU_gGc2Q7P_FrF_tM',      blockMs:250  },
  { id:8453,   name:'base-mainnet',       wsUrl:'wss://base-mainnet.g.alchemy.com/v2/3aotTt1Kv1x-fWDF7_kab',     httpUrl:'https://base-mainnet.g.alchemy.com/v2/3aotTt1Kv1x-fWDF7_kab',     blockMs:2000 },
  { id:10,     name:'opt-mainnet',        wsUrl:'wss://opt-mainnet.g.alchemy.com/v2/sGjcCN-W3Ls8XQNNqSsNn',      httpUrl:'https://opt-mainnet.g.alchemy.com/v2/sGjcCN-W3Ls8XQNNqSsNn',      blockMs:2000 },
  { id:1,      name:'eth-mainnet',        wsUrl:'wss://eth-mainnet.g.alchemy.com/v2/jKhd0hz6ZYWaDlacqh_dx',       httpUrl:'https://eth-mainnet.g.alchemy.com/v2/jKhd0hz6ZYWaDlacqh_dx',       blockMs:12000},
  { id:56,     name:'bnb-mainnet',        wsUrl:'wss://bnb-mainnet.g.alchemy.com/v2/6iqYCCQwSTR6b-tJKucS-',      httpUrl:'https://bnb-mainnet.g.alchemy.com/v2/6iqYCCQwSTR6b-tJKucS-',      blockMs:3000 },
  { id:43114,  name:'avax-mainnet',       wsUrl:'wss://avax-mainnet.g.alchemy.com/v2/qbhq33J1d5gA1fa2F9oTc',     httpUrl:'https://avax-mainnet.g.alchemy.com/v2/qbhq33J1d5gA1fa2F9oTc',     blockMs:2000 },
  { id:81457,  name:'blast-mainnet',      wsUrl:'wss://blast-mainnet.g.alchemy.com/v2/Oq9vY_8X2kD3mN5pL7rA1',   httpUrl:'https://blast-mainnet.g.alchemy.com/v2/Oq9vY_8X2kD3mN5pL7rA1',   blockMs:2000 },
  { id:324,    name:'zksync-mainnet',     wsUrl:'wss://zksync-mainnet.g.alchemy.com/v2/B4tJ2_9P6wE1mX3nR8sC5',  httpUrl:'https://zksync-mainnet.g.alchemy.com/v2/B4tJ2_9P6wE1mX3nR8sC5',  blockMs:1000 },
  { id:534352, name:'scroll-mainnet',     wsUrl:'wss://scroll-mainnet.g.alchemy.com/v2/K7mN3_2Q9pF4xL6tW1vB8',  httpUrl:'https://scroll-mainnet.g.alchemy.com/v2/K7mN3_2Q9pF4xL6tW1vB8',  blockMs:3000 },
  { id:59144,  name:'linea-mainnet',      wsUrl:'wss://linea-mainnet.g.alchemy.com/v2/P2wR5_7M4kH9nX1yC3qE6',   httpUrl:'https://linea-mainnet.g.alchemy.com/v2/P2wR5_7M4kH9nX1yC3qE6',   blockMs:2000 },
  { id:5000,   name:'mantle-mainnet',     wsUrl:'wss://mantle-mainnet.g.alchemy.com/v2/T9pL4_1N7gC2mW6xK8vD3',  httpUrl:'https://mantle-mainnet.g.alchemy.com/v2/T9pL4_1N7gC2mW6xK8vD3',  blockMs:2000 },
  { id:100,    name:'gnosis-mainnet',     wsUrl:'wss://gnosis-mainnet.g.alchemy.com/v2/W3xK8_5P2nM7tL1yR4qA9',  httpUrl:'https://gnosis-mainnet.g.alchemy.com/v2/W3xK8_5P2nM7tL1yR4qA9',  blockMs:5000 },
  { id:480,    name:'worldchain-mainnet', wsUrl:'wss://worldchain-mainnet.g.alchemy.com/v2/R6mD9_4K1nP8yX2wC5vQ7',httpUrl:'https://worldchain-mainnet.g.alchemy.com/v2/R6mD9_4K1nP8yX2wC5vQ7',blockMs:2000 },
  { id:80094,  name:'berachain-mainnet',  wsUrl:'wss://berachain-mainnet.g.alchemy.com/v2/N1yW6_8M3pL5xK2tR9vC4',httpUrl:'https://berachain-mainnet.g.alchemy.com/v2/N1yW6_8M3pL5xK2tR9vC4',blockMs:2000 },
  { id:1301,   name:'unichain-mainnet',   wsUrl:'wss://unichain-mainnet.g.alchemy.com/v2/C5pK2_7N9mQ4yL1xW6tR3',httpUrl:'https://unichain-mainnet.g.alchemy.com/v2/C5pK2_7N9mQ4yL1xW6tR3',blockMs:1000 },
  { id:1329,   name:'sei-mainnet',        wsUrl:'wss://sei-mainnet.g.alchemy.com/v2/Q8nM3_5K2pW7xR1yL4tC9',    httpUrl:'https://sei-mainnet.g.alchemy.com/v2/Q8nM3_5K2pW7xR1yL4tC9',    blockMs:400  },
  { id:146,    name:'sonic-mainnet',      wsUrl:'wss://sonic-mainnet.g.alchemy.com/v2/V4tR9_2M7kN3pL8yX1wC6',  httpUrl:'https://sonic-mainnet.g.alchemy.com/v2/V4tR9_2M7kN3pL8yX1wC6',  blockMs:1000 },
  { id:64165,  name:'sonic-mainnet-2',    wsUrl:'wss://sonic-mainnet.g.alchemy.com/v2/Y7pL4_9K2mN5xW3tR8yC1',  httpUrl:'https://sonic-mainnet.g.alchemy.com/v2/Y7pL4_9K2mN5xW3tR8yC1',  blockMs:1000 },
  { id:1151111081099710, name:'solana-mainnet', wsUrl:'wss://solana-mainnet.g.alchemy.com/v2/H2wC7_5P4nM9xL3kR6yQ8', httpUrl:'https://solana-mainnet.g.alchemy.com/v2/H2wC7_5P4nM9xL3kR6yQ8', blockMs:400 },
]

// ── SWAP EVENT SIGNATURES ─────────────────────────────────────────────────────
export const SWAP_SIG_V3 = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
export const SWAP_SIG_V4 = '0x40b83f9d24b9c9f2c5e2f3b8a1d7e4c6f8b2a9d3c5e7f1b4a6d8e2c4f6b8a0d'
export const MIN_SWAP_USD = 10_000  // $10K minimum qualifying swap

// ── PROPELLER TABLE ───────────────────────────────────────────────────────────
// Levels: 0.1-0.5=SSP, 1-5=SP, 6-36=P range
// P15 default = level 21 = $10 QUD/day
export function getPropTarget(lvl) {
  if (lvl <= 0)   return 0
  if (lvl <= 0.1) return 100_000
  if (lvl <= 0.2) return 250_000
  if (lvl <= 0.3) return 500_000
  if (lvl <= 0.4) return 750_000
  if (lvl <= 0.5) return 1e6
  if (lvl <= 1)   return 5e6
  if (lvl <= 2)   return 15e6
  if (lvl <= 3)   return 50e6
  if (lvl <= 4)   return 150e6
  if (lvl <= 5)   return 500e6
  if (lvl <= 6)   return 500e6
  if (lvl <= 7)   return 1e9
  if (lvl <= 8)   return 5e9
  if (lvl <= 9)   return 50e9
  if (lvl <= 10)  return 100e9
  if (lvl <= 11)  return 500e9
  if (lvl <= 12)  return 2e12
  if (lvl <= 13)  return 5e12
  if (lvl <= 14)  return 10e12
  if (lvl <= 15)  return 50e12
  if (lvl <= 16)  return 100e12
  if (lvl <= 17)  return 500e12
  if (lvl <= 18)  return 1e15
  if (lvl <= 19)  return 2e15
  if (lvl <= 20)  return 5e15
  if (lvl <= 21)  return 10e15    // P15 DEFAULT
  if (lvl <= 22)  return 20e15
  if (lvl <= 23)  return 50e15
  if (lvl <= 24)  return 100e15
  if (lvl <= 25)  return 200e15
  if (lvl <= 26)  return 500e15
  if (lvl <= 27)  return 1e18     // P21 = 1 QUI
  if (lvl <= 28)  return 5e18
  if (lvl <= 29)  return 10e18
  if (lvl <= 30)  return 50e18
  if (lvl <= 31)  return 100e18
  if (lvl <= 32)  return 200e18
  if (lvl <= 33)  return 300e18
  if (lvl <= 34)  return 400e18
  if (lvl <= 35)  return 450e18
  if (lvl <= 36)  return 500e18   // P30 = 500 QUI
  if (lvl >= 100) return Infinity  // P100 = operator set via HOT[18]
  return 500e18
}

export const PROP_DEFAULT = 21  // P15

// ── PROPELLER LABELS ──────────────────────────────────────────────────────────
export const PROP_LABELS = {
  0.1:'SSP1 $100K', 0.2:'SSP2 $250K', 0.3:'SSP3 $500K', 0.4:'SSP4 $750K', 0.5:'SSP5 $1M',
  1:'SP1 $5M', 2:'SP2 $15M', 3:'SP3 $50M', 4:'SP4 $150M', 5:'SP5 $500M',
  6:'P1 $500M', 7:'P2 $1B', 8:'P3 $5B', 9:'P4 $50B', 10:'P5 $100B',
  11:'P6 $500B', 12:'P7 $2T', 13:'P8 $5T', 14:'P9 $10T', 15:'P10 $50T',
  16:'P11 $100T', 17:'P12 $500T', 18:'P13 $1QUD', 19:'P14 $2QUD', 20:'P15 $5QUD',
  21:'P15 $10QUD ★', 22:'P16 $20QUD', 23:'P17 $50QUD', 24:'P18 $100QUD', 25:'P19 $200QUD',
  26:'P20 $500QUD', 27:'P21 $1QUI', 28:'P22 $5QUI', 29:'P23 $10QUI', 30:'P24 $50QUI',
  31:'P25 $100QUI', 32:'P26 $200QUI', 33:'P27 $300QUI', 34:'P28 $400QUI', 35:'P29 $450QUI',
  36:'P30 $500QUI ★★',
}

// ── SAB LAYOUT ────────────────────────────────────────────────────────────────
export const SAB_SIZE = 4096
export const HOT_LAYOUT = {
  PROPELLER:0, DAILY_REV:1, FLASH_BASE:2, RESERVE:3, CRASH:4,
  TREASURY:5, EXEC_TODAY:6, EXEC_TOTAL:7, UPTIME:8, FIRST_REV:9,
  EFF_FLASH:10, TOTAL_AMP:11, RESERVE_PCT:12, RESERVE_BAL:13,
  MRS7_SYNTH_PCT:14, MRS7_SYNTH_VAL:15, CYCLES_TODAY:16, ETA_MINS:17,
  P100_TARGET:18, YIELD_TODAY:19,
  MRS1:20, MRS2:21, MRS4:22, MRS5:23, MRS7:24, XC_FEES:25,
  BUNDLES_SOLD:26, BUYER_EXECS:27, AEE_EXECS:28, AVG_PAYOUT:29,
  SEARCHER_CNT:30, STAKE_TOTAL:31, MRS7_DEPLOYED:32, SYNTH_TODAY:33, NATURAL_TODAY:34,
  AEE_RATIO:35, AEE_MODE:36, BOOTSTRAP:37, CONTRACTS:38, XC_SUPPLY:39,
  XC_USD:40, XC_GOLD:41, XC_HOLDERS:42, XC_VOL:43,
  CLOAK:44, DARK_POOL:45, BACKUP:46, ORACLE_DEVS:47, PENDING_REV:48, PENDING_RESERVE:49,
  // HOT[50-69]: gas gwei per chain
  // HOT[70-89]: chain WS active flags
  // HOT[90-109]: MRS7 LP value per chain
  // Signal area: INT32 at bytes 4080/4084/4088
}

// ── MEMORY CONFIG ─────────────────────────────────────────────────────────────
export const MEM = { main: 200, aee: 150, detector: 80 }

// ── BUNDLE TYPES ──────────────────────────────────────────────────────────────
export const BUNDLE_TYPES = [
  'JIT_PRIMARY','ECHO_ARB','ECHO_BASE','ECHO_POL','ECHO_OPT',
  'RECURSIVE_1','RECURSIVE_2','RECURSIVE_3',
  'ORACLE_DEV','LIQUIDATION_1','LIQUIDATION_2',
]
