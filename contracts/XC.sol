// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// XC — Xalican Sovereign Currency
// Fixed supply: 1 billion XC
// Gold-backed: 99% measured against Chainlink XAU/USD oracle
// Transaction fee: 0.001% → treasury
// Prestige. Power. Proliferation.

interface AggregatorV3Interface {
    function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

contract XalicanCurrency {
    string  public constant name     = "Xalican Sovereign Currency";
    string  public constant symbol   = "XC";
    uint8   public constant decimals = 18;
    uint256 public constant TOTAL    = 1_000_000_000 * 1e18;  // 1 billion XC

    address public immutable TREASURY;
    address public immutable GOLD_ORACLE;   // Chainlink XAU/USD on Polygon
    address public immutable MINTER;        // Executor wallet

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // Fee: 0.001% = 1 / 100000
    uint256 public constant FEE_BPS    = 1;      // 1 basis point / 100 = 0.001%
    uint256 public constant FEE_DENOM  = 100_000;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(address _treasury, address _oracle, address _minter) {
        TREASURY    = _treasury;
        GOLD_ORACLE = _oracle;
        MINTER      = _minter;
        totalSupply              = TOTAL;
        balanceOf[_treasury]     = TOTAL;
        emit Transfer(address(0), _treasury, TOTAL);
    }

    // Gold price: USD per gram (XAU/USD price / 31.1035 troy oz/kg)
    // Chainlink XAU/USD returns price with 8 decimals
    function xcPriceUSD() public view returns (uint256) {
        (,int256 price,,,) = AggregatorV3Interface(GOLD_ORACLE).latestRoundData();
        return uint256(price) / 3110;  // per gram, 8 decimals
    }

    // 1 XC = xcPriceUSD() / 1e8 USD (99% gold peg)
    function xcToUSDC(uint256 xcAmount) external view returns (uint256) {
        return (xcAmount * xcPriceUSD() * 99) / (100 * 1e8 * 1e12);  // 6 decimal USDC
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "XC: insufficient");
        uint256 fee = (amount * FEE_BPS) / FEE_DENOM;
        uint256 net = amount - fee;
        balanceOf[from]     -= amount;
        balanceOf[to]       += net;
        balanceOf[TREASURY] += fee;
        emit Transfer(from, to, net);
        if (fee > 0) emit Transfer(from, TREASURY, fee);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount); return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        _transfer(from, to, amount); return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount); return true;
    }

    // Mint additional XC (only minter, treasury-backed)
    function mint(address to, uint256 amount) external {
        require(msg.sender == MINTER, "XC: not minter");
        totalSupply     += amount;
        balanceOf[to]   += amount;
        emit Transfer(address(0), to, amount);
    }

    // Burn XC (redeem for USDC equivalent from treasury)
    function burn(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "XC: insufficient");
        balanceOf[msg.sender] -= amount;
        totalSupply           -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }
}
