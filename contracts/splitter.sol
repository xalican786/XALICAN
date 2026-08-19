// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Immutable splitter — routes 99.9% to treasury, $1M fixed to buyer
// Deployed once per chain. Never redeployed. Cannot be modified.
// 30 lines by design.

interface IERC20Mini {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract XalicanSplitter {
    address public immutable TREASURY;
    uint256 public constant BUYER_PAYOUT_USDC = 1_000_000 * 1_000_000;  // $1M (6 decimals)

    constructor(address _treasury) {
        require(_treasury != address(0), "Splitter: zero treasury");
        TREASURY = _treasury;
    }

    // Called at end of AEE execution — routes profit
    function split(address token, address buyer, bool hasBuyer) external {
        IERC20Mini t   = IERC20Mini(token);
        uint256    bal = t.balanceOf(address(this));
        require(bal > 0, "Splitter: nothing to split");
        if (hasBuyer && bal >= BUYER_PAYOUT_USDC) {
            t.transfer(buyer, BUYER_PAYOUT_USDC);
        }
        uint256 remaining = t.balanceOf(address(this));
        if (remaining > 0) t.transfer(TREASURY, remaining);
    }

    // Direct treasury route (AEE self-execution, no buyer)
    function toTreasury(address token) external {
        IERC20Mini t = IERC20Mini(token);
        uint256 bal  = t.balanceOf(address(this));
        if (bal > 0) t.transfer(TREASURY, bal);
    }
}
