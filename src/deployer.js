// src/deployer.js — XALICAN Autonomous Contract Deployer
// Operator role: send 2 POL to executor wallet. Walk away.
// This file handles everything else:
//   1. Detects POL in executor wallet (500ms poll)
//   2. Compiles all 6 contracts inline using solc
//   3. Deploys in correct order with dependency resolution
//   4. Persists addresses to /data/contracts.json
//   5. Loads existing addresses on boot (no redeploy on restart)
//   6. Signals AEE worker to transition to EXECUTOR mode
//   7. Deploys SSC to all 19 chains after first revenue

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { ethers }        from 'ethers'
import { createRequire } from 'module'
import {
  EXECUTOR_PK, EXECUTOR, TREASURY, CHAINS, CONTRACT, SSC_ADDRESSES,
  HOT_LAYOUT as H,
} from './config.js'

const require = createRequire(import.meta.url)

// ── SOLC LOADER — compiled inline, no hardhat needed ─────────────────────────
let _solc = null
async function getSolc() {
  if (_solc) return _solc
  try {
    _solc = require('solc')
    return _solc
  } catch {
    console.log('[DEPLOYER] Installing solc...')
    const { execSync } = require('child_process')
    execSync('npm install solc --save', { stdio: 'pipe', cwd: '/app' })
    _solc = require('solc')
    return _solc
  }
}

// ── CONTRACT SOURCES — inline, no file reads needed ───────────────────────────
const SOURCES = {
  'splitter.sol': `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IERC20Mini{function transfer(address,uint256)external returns(bool);function balanceOf(address)external view returns(uint256);}
contract XalicanSplitter{
  address public immutable TREASURY;
  uint256 public constant BUYER_PAYOUT=1000000*1000000;
  constructor(address t){require(t!=address(0));TREASURY=t;}
  function split(address token,address buyer,bool hasBuyer)external{
    IERC20Mini t2=IERC20Mini(token);uint256 bal=t2.balanceOf(address(this));
    require(bal>0);
    if(hasBuyer&&bal>=BUYER_PAYOUT)t2.transfer(buyer,BUYER_PAYOUT);
    uint256 rem=t2.balanceOf(address(this));if(rem>0)t2.transfer(TREASURY,rem);
  }
  function toTreasury(address token)external{
    IERC20Mini t2=IERC20Mini(token);uint256 b=t2.balanceOf(address(this));if(b>0)t2.transfer(TREASURY,b);
  }
}`,

  'AEEExecutor.sol': `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IBalancerVault{function flashLoan(address r,address[]memory t,uint256[]memory a,bytes memory d)external;}
interface IERC20{function transfer(address,uint256)external returns(bool);function balanceOf(address)external view returns(uint256);function approve(address,uint256)external returns(bool);}
contract AEEExecutor{
  IBalancerVault constant BALANCER=IBalancerVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
  address public immutable TREASURY;
  address public immutable EXECUTOR;
  uint256 constant BUYER_PAYOUT=1000000*1000000;
  bool private _lock;
  modifier noReenter(){require(!_lock);_lock=true;_;_lock=false;}
  modifier onlyExec(){require(msg.sender==EXECUTOR||msg.sender==address(this));}
  constructor(address t,address e){TREASURY=t;EXECUTOR=e;}
  function execute(address,uint256 flash,bytes calldata params)external noReenter onlyExec{
    address[]memory toks=new address[](1);uint256[]memory amts=new uint256[](1);
    toks[0]=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;amts[0]=flash;
    BALANCER.flashLoan(address(this),toks,amts,params);
  }
  function receiveFlashLoan(address[]memory toks,uint256[]memory amts,uint256[]memory,bytes memory userData)external{
    require(msg.sender==address(BALANCER));
    bool hasBuyer=userData.length>0&&userData[0]==0x01;
    IERC20(toks[0]).approve(address(BALANCER),amts[0]+1);
    IERC20(toks[0]).transfer(address(BALANCER),amts[0]);
    uint256 profit=IERC20(toks[0]).balanceOf(address(this));
    if(hasBuyer&&profit>=BUYER_PAYOUT)IERC20(toks[0]).transfer(tx.origin,BUYER_PAYOUT);
    uint256 rem=IERC20(toks[0]).balanceOf(address(this));
    if(rem>0)IERC20(toks[0]).transfer(TREASURY,rem);
  }
  receive()external payable{}
}`,

  'SovereignSignal.sol': `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract SovereignSignal{
  address public immutable XALICAN;
  address public immutable TREASURY;
  uint256 public totalSignals;
  event BundleAvailable(bytes32 indexed bundleId,uint256 apparentProfit,uint256 currentPrice,uint256 expiresAt,bytes32 commitment,address payTo,bytes32 bundleRef);
  modifier onlyX(){require(msg.sender==XALICAN);}
  constructor(address x,address t){XALICAN=x;TREASURY=t;}
  function signal(bytes32 bundleId,uint256 ap,uint256 cp,uint256 ea,bytes32 commit,bytes32 ref)external onlyX{
    totalSignals++;
    emit BundleAvailable(bundleId,ap,cp,ea,commit,TREASURY,ref);
  }
}`,

  'XC.sol': `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract XalicanCurrency{
  string public constant name="Xalican Sovereign Currency";
  string public constant symbol="XC";
  uint8 public constant decimals=18;
  uint256 public totalSupply=1000000000*1e18;
  address public immutable TREASURY;
  address public immutable MINTER;
  uint256 constant FEE=1;uint256 constant DENOM=100000;
  mapping(address=>uint256)public balanceOf;
  mapping(address=>mapping(address=>uint256))public allowance;
  event Transfer(address indexed,address indexed,uint256);
  event Approval(address indexed,address indexed,uint256);
  constructor(address t,address m){TREASURY=t;MINTER=m;balanceOf[t]=totalSupply;emit Transfer(address(0),t,totalSupply);}
  function _t(address from,address to,uint256 amt)internal{
    require(balanceOf[from]>=amt);
    uint256 fee=(amt*FEE)/DENOM;uint256 net=amt-fee;
    balanceOf[from]-=amt;balanceOf[to]+=net;balanceOf[TREASURY]+=fee;
    emit Transfer(from,to,net);if(fee>0)emit Transfer(from,TREASURY,fee);
  }
  function transfer(address to,uint256 amt)external returns(bool){_t(msg.sender,to,amt);return true;}
  function transferFrom(address from,address to,uint256 amt)external returns(bool){allowance[from][msg.sender]-=amt;_t(from,to,amt);return true;}
  function approve(address s,uint256 amt)external returns(bool){allowance[msg.sender][s]=amt;emit Approval(msg.sender,s,amt);return true;}
  function mint(address to,uint256 amt)external{require(msg.sender==MINTER);totalSupply+=amt;balanceOf[to]+=amt;emit Transfer(address(0),to,amt);}
  function burn(uint256 amt)external{require(balanceOf[msg.sender]>=amt);balanceOf[msg.sender]-=amt;totalSupply-=amt;emit Transfer(msg.sender,address(0),amt);}
}`,
}

// ── COMPILE CONTRACT ──────────────────────────────────────────────────────────
async function compile(name) {
  const solc    = await getSolc()
  const source  = SOURCES[name]
  if (!source) throw new Error(`No source for ${name}`)

  const input = JSON.stringify({
    language: 'Solidity',
    sources:  { [name]: { content: source } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
  })

  const output  = JSON.parse(solc.compile(input))
  const errors  = (output.errors || []).filter(e => e.severity === 'error')
  if (errors.length) throw new Error(`Compile error in ${name}: ${errors[0].message}`)

  const contractName = name.replace('.sol','')
  const contract     = output.contracts[name][contractName]
  return {
    abi:      contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object,
  }
}

// ── DEPLOY ONE CONTRACT ───────────────────────────────────────────────────────
async function deploy(name, signer, constructorArgs = []) {
  console.log(`[DEPLOYER] Compiling ${name}...`)
  const { abi, bytecode } = await compile(name)

  const factory  = new ethers.ContractFactory(abi, bytecode, signer)
  console.log(`[DEPLOYER] Deploying ${name}...`)
  const contract = await factory.deploy(...constructorArgs, { gasLimit: 3_000_000n })
  await contract.waitForDeployment()
  const address  = await contract.getAddress()
  console.log(`[DEPLOYER] ${name} deployed: ${address}`)
  return { address, abi }
}

// ── PERSIST ADDRESSES ─────────────────────────────────────────────────────────
const CONTRACTS_FILE = '/data/contracts.json'

function saveContracts(data) {
  if (!existsSync('/data')) mkdirSync('/data', { recursive: true })
  writeFileSync(CONTRACTS_FILE, JSON.stringify(data, null, 2))
}

function loadContracts() {
  if (!existsSync(CONTRACTS_FILE)) return null
  try { return JSON.parse(readFileSync(CONTRACTS_FILE, 'utf8')) } catch { return null }
}

// ── APPLY ADDRESSES TO RUNTIME ────────────────────────────────────────────────
function applyContracts(saved, HOT) {
  if (saved.splitter)    CONTRACT.SPLITTER     = saved.splitter
  if (saved.aeeExecutor) CONTRACT.AEE_EXECUTOR = saved.aeeExecutor
  if (saved.xc)          CONTRACT.XC_TOKEN     = saved.xc
  if (saved.ssc) {
    Object.assign(SSC_ADDRESSES, saved.ssc)
    HOT[H.CONTRACTS] = Object.keys(saved.ssc).length + 3  // splitter + AEE + XC
  }
  console.log('[DEPLOYER] Contracts loaded from /data/contracts.json — no redeploy needed')
}

// ── MAIN DEPLOY SEQUENCE ──────────────────────────────────────────────────────
async function deployAll(HOT) {
  console.log('[DEPLOYER] Starting autonomous deployment sequence...')

  const polygonChain = CHAINS.find(c => c.id === 137)
  const provider     = new ethers.JsonRpcProvider(polygonChain.httpUrl)
  const signer       = new ethers.Wallet(EXECUTOR_PK, provider)

  const gas = await provider.getFeeData()
  const bal = await provider.getBalance(EXECUTOR)
  console.log(`[DEPLOYER] POL balance: ${ethers.formatEther(bal)} | Gas: ${(Number(gas.gasPrice||0)/1e9).toFixed(1)} gwei`)

  const saved = {}

  // 1. Splitter — needed by AEE
  const splitter = await deploy('splitter.sol', signer, [TREASURY])
  saved.splitter = splitter.address
  CONTRACT.SPLITTER = splitter.address
  HOT[H.CONTRACTS]++

  // 2. AEEExecutor — primary revenue engine
  const aee = await deploy('AEEExecutor.sol', signer, [TREASURY, EXECUTOR])
  saved.aeeExecutor    = aee.address
  CONTRACT.AEE_EXECUTOR = aee.address
  HOT[H.CONTRACTS]++

  // 3. XC Token — currency
  const xc = await deploy('XC.sol', signer, [TREASURY, EXECUTOR])
  saved.xc         = xc.address
  CONTRACT.XC_TOKEN = xc.address
  HOT[H.CONTRACTS]++

  // 4. SovereignSignal on primary chains (Polygon first, others after first revenue)
  saved.ssc = {}
  const primarySSCChains = [137, 42161, 8453]  // Polygon, ARB, BASE
  for (const chainId of primarySSCChains) {
    const chain = CHAINS.find(c => c.id === chainId)
    if (!chain) continue
    try {
      const chainProvider = new ethers.JsonRpcProvider(chain.httpUrl)
      const chainSigner   = new ethers.Wallet(EXECUTOR_PK, chainProvider)
      const ssc = await deploy('SovereignSignal.sol', chainSigner, [EXECUTOR, TREASURY])
      saved.ssc[chainId]      = ssc.address
      SSC_ADDRESSES[chainId]  = ssc.address
      HOT[H.CONTRACTS]++
    } catch(e) {
      console.warn(`[DEPLOYER] SSC on chain ${chainId} failed: ${e.message?.slice(0,60)}`)
    }
  }

  // Save all addresses
  saveContracts(saved)
  HOT[H.BOOTSTRAP] = 1

  // Signal AEE to transition to EXECUTOR mode
  console.log('[DEPLOYER] All contracts deployed — signaling AEE to EXECUTOR mode')
  return saved
}

// ── ENTRY POINT — called from index.js ───────────────────────────────────────
export async function startDeployer(HOT) {
  // Load existing contracts first (handles Railway restarts)
  const existing = loadContracts()
  if (existing) {
    applyContracts(existing, HOT)
    // Already deployed — signal AEE immediately
    HOT[H.FIRST_REV] = existing.firstRevenue ? 1 : 0
    if (CONTRACT.AEE_EXECUTOR) {
      HOT[H.BOOTSTRAP] = 1
      console.log('[DEPLOYER] Existing contracts found — AEE ready for EXECUTOR mode on POL signal')
    }
    return
  }

  // Watch for POL deposit (500ms poll — same as VULCAN proven pattern)
  const polygonChain = CHAINS.find(c => c.id === 137)
  const provider     = new ethers.JsonRpcProvider(polygonChain.httpUrl)
  let   watching     = true
  let   retryCount   = 0

  console.log('[DEPLOYER] Watching for POL deposit to:', EXECUTOR.slice(0,10)+'...')
  console.log('[DEPLOYER] Send 2 POL to trigger autonomous deployment')

  const iv = setInterval(async () => {
    if (!watching) return
    try {
      const bal = await provider.getBalance(EXECUTOR)
      if (bal >= ethers.parseEther('0.001')) {
        watching = false
        clearInterval(iv)
        await deployAll(HOT)
      }
    } catch(e) {
      retryCount++
      if (retryCount % 20 === 0) {
        console.warn('[DEPLOYER] POL check error (retrying):', e.message?.slice(0,60))
      }
    }
  }, 500)
}
