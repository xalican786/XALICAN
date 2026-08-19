// src/bundler.js — 11 bundle types, cryptographic commitments
// Builds all bundles from a qualifying swap in ~0.4ms

import { ethers }     from 'ethers'
import { BUNDLE_TYPES, CONTRACT, TREASURY, WORKING_FLASH } from './config.js'
import { calcAuctionPrice } from './speed.js'

const ABI_CODER = ethers.AbiCoder.defaultAbiCoder()
const IFACE     = new ethers.Interface([
  'function execute(address pool, uint256 flash, bytes calldata params) external',
])

// Build a single bundle
export function buildBundle(swap, bundleType, priceOverride) {
  const auctionPrice = priceOverride ?? calcAuctionPrice(swap.apparentProfit, bundleType)
  
  const params = ABI_CODER.encode(
    ['uint256', 'address', 'uint8', 'bool'],
    [
      BigInt(Math.floor(1_000_000 * 1e6)),  // $1M buyer payout in USDC units
      TREASURY,
      BUNDLE_TYPES.indexOf(bundleType),
      true,  // hasBuyer flag — updated to false when AEE self-executes
    ]
  )
  
  const calldata = IFACE.encodeFunctionData('execute', [
    swap.pool || ethers.ZeroAddress,
    BigInt(Math.floor(WORKING_FLASH * 1e6)),  // $250B
    params,
  ])
  
  const nonce    = BigInt(Date.now()) * 1000n + BigInt(Math.random() * 1000 | 0)
  const bundleId = ethers.keccak256(
    ethers.solidityPacked(
      ['bytes', 'uint256', 'uint256'],
      [calldata, nonce, BigInt(swap.chainId || 137)]
    )
  )
  
  const commitment = ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'uint256'], [bundleId, BigInt(Date.now())])
  )
  
  return {
    bundleId,
    commitment,      // broadcast publicly via SSC
    calldata,        // revealed only after payment confirmed
    apparentProfit:  swap.apparentProfit,
    auctionPrice,
    expiresAt:       Date.now() + 600,  // 600ms window
    bundleType,
    chainId:         swap.chainId || 137,
    pool:            swap.pool,
    createdAt:       Date.now(),
  }
}

// Build all 11 bundle types for one swap
export function buildAllBundles(swap) {
  return BUNDLE_TYPES.map(type => buildBundle(swap, type))
}
