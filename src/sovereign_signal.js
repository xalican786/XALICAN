// src/sovereign_signal.js — SSC: All 6 broadcast channels
// Channel 1: Mempool broadcast (PRIMARY — zero balance, zero contracts)
// Channel 2: IPFS PubSub via Infura HTTP (zero balance, zero contracts)
// Channels 3-5: Post-first-revenue (bloXroute, MEV-Share, on-chain SSC)

import { ethers }  from 'ethers'
import {
  EXECUTOR_WALLET, TREASURY, CHAINS, HOT_LAYOUT as H,
  IPFS_API, IPFS_KEY, IPFS_SECRET, IPFS_TOPIC,
  BLOXROUTE_URL, BLOXROUTE_KEY, MEVSHARE_URL,
  SSC_ADDRESSES,
} from './config.js'
import { dutchPrice } from './speed.js'

// Active auctions: bundleId -> { bundle, paidBuyers: Set, expiresAt }
const AUCTIONS = new Map()
const PENDING  = new Map()  // txHash -> { bundleId, amount }

// ── SIGNAL ENCODING ───────────────────────────────────────────────────────────
const ABI = ethers.AbiCoder.defaultAbiCoder()
function encodeSignal(bundle) {
  return ABI.encode(
    ['bytes32','uint256','uint256','uint256','bytes32','address','bytes32'],
    [
      bundle.bundleId,
      BigInt(Math.floor(bundle.apparentProfit)),
      BigInt(Math.floor(dutchPrice(bundle.auctionPrice, 0))),
      BigInt(bundle.expiresAt),
      bundle.commitment,
      TREASURY,
      bundle.bundleId,  // bundleRef = bundleId for simplicity
    ]
  )
}

// ── CHANNEL 1: MEMPOOL BROADCAST ─────────────────────────────────────────────
// Zero gas price — visible in mempool, never confirmed — free
export async function broadcastMempool(bundle, providers) {
  const data   = encodeSignal(bundle)
  const nonce  = Date.now() % 100000  // arbitrary nonce — tx never confirms
  
  // Sign once with ARB chainId — bots decode the data regardless of chainId
  const signed = await EXECUTOR_WALLET.signTransaction({
    to:       ethers.ZeroAddress,
    value:    0n,
    data,
    gasLimit: 21000n,
    gasPrice: 0n,
    nonce:    BigInt(nonce),
    chainId:  42161n,
    type:     0,
  })
  
  // Submit to ARB, BASE, POL simultaneously — these 3 cover max MEV bot density
  const targets = providers.filter(p =>
    ['arb-mainnet','base-mainnet','polygon-mainnet'].includes(p.chain.name)
  )
  await Promise.allSettled(
    targets.map(p => p.http?.broadcastTransaction(signed).catch(() => {}))
  )
}

// ── CHANNEL 2: IPFS PUBSUB ────────────────────────────────────────────────────
// Uses Infura IPFS HTTP API — no js-ipfs node needed (saves 130MB RAM)
export async function broadcastIPFS(bundle) {
  if (!IPFS_KEY) return  // skip if no IPFS credentials
  
  const msg     = Buffer.from(JSON.stringify({
    id: bundle.bundleId.slice(0,10),
    p:  bundle.apparentProfit,
    c:  bundle.commitment,
    e:  bundle.expiresAt,
    t:  TREASURY,
  })).toString('base64')
  
  const topic = encodeURIComponent(IPFS_TOPIC)
  await fetch(`${IPFS_API}?arg=${topic}&arg=${msg}`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${IPFS_KEY}:${IPFS_SECRET}`).toString('base64'),
    },
    signal: AbortSignal.timeout(2000),
  }).catch(() => {})  // non-fatal
}

// ── CHANNEL 3: BLOXROUTE (post-first-revenue) ─────────────────────────────────
export async function broadcastBloXroute(bundle) {
  if (!BLOXROUTE_KEY) return
  await fetch(BLOXROUTE_URL, {
    method:  'POST',
    headers: { 'Authorization': BLOXROUTE_KEY, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ bundleId: bundle.bundleId, commitment: bundle.commitment, payTo: TREASURY }),
    signal:  AbortSignal.timeout(2000),
  }).catch(() => {})
}

// ── CHANNEL 4: FLASHBOTS MEV-SHARE (post-first-revenue) ──────────────────────
export async function broadcastMEVShare(bundle) {
  await fetch(`${MEVSHARE_URL}/mev-share`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ hint: { bundle: bundle.bundleId, profit: bundle.apparentProfit } }),
    signal:  AbortSignal.timeout(2000),
  }).catch(() => {})
}

// ── CHANNEL 5: ON-CHAIN SSC (post-first-revenue) ──────────────────────────────
export async function broadcastOnChain(bundle, signersByChain) {
  await Promise.allSettled(
    Object.entries(SSC_ADDRESSES).map(async ([chainId, addr]) => {
      const signer   = signersByChain[chainId]
      if (!signer || !addr) return
      const ssc = new ethers.Contract(addr, [
        'function signal(bytes32,uint256,uint256,uint256,bytes32,bytes32) external',
      ], signer)
      await ssc.signal(
        bundle.bundleId,
        BigInt(Math.floor(bundle.apparentProfit)),
        BigInt(Math.floor(dutchPrice(bundle.auctionPrice, 0))),
        BigInt(bundle.expiresAt),
        bundle.commitment,
        bundle.bundleId,
        { gasLimit: 80000n },
      ).catch(() => {})
    })
  )
}

// ── MASTER BROADCAST ──────────────────────────────────────────────────────────
export async function broadcast(bundle, providers, HOT) {
  AUCTIONS.set(bundle.bundleId, { bundle, paidBuyers: new Set(), calldataRevealed: false })
  
  // Channels 1+2 always active (zero balance)
  await Promise.allSettled([
    broadcastMempool(bundle, providers),
    broadcastIPFS(bundle),
  ])
  
  // Channels 3-5 only after first revenue
  if (HOT[H.FIRST_REV] === 1) {
    await Promise.allSettled([
      broadcastBloXroute(bundle),
      broadcastMEVShare(bundle),
    ])
    // Channel 5 (on-chain) called separately with signers
  }
}

// ── PAYMENT VERIFICATION ──────────────────────────────────────────────────────
// Watches treasury wallet for incoming USDC transfers referencing bundle
export function monitorPayment(bundle, usdcContract, onConfirmed) {
  const filter = usdcContract.filters.Transfer(null, TREASURY)
  
  const handler = (from, to, amount, event) => {
    // Check if amount >= 90% of floor price (allows for gas slippage)
    const minAccept = BigInt(Math.floor(bundle.auctionPrice * 0.9 * 1e6))
    if (amount < minAccept) return
    
    // Reveal calldata to buyer
    if (!AUCTIONS.get(bundle.bundleId)?.calldataRevealed) {
      AUCTIONS.get(bundle.bundleId).calldataRevealed = true
      PENDING.set(event.transactionHash, { bundleId: bundle.bundleId, amount: Number(amount)/1e6 })
      onConfirmed(from, Number(amount)/1e6, bundle.calldata)
    }
  }
  
  usdcContract.on(filter, handler)
  
  // Cleanup after auction expires
  setTimeout(() => {
    usdcContract.off(filter, handler)
    AUCTIONS.delete(bundle.bundleId)
  }, 600 + 5000)  // 600ms auction + 5s buffer
}

export { PENDING }
