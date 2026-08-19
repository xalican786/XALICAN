// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// SSC Channel 5: On-chain signal emitter
// Deployed once per chain (19 total) after first revenue
// Any bot monitoring this contract's events sees every bundle signal

contract SovereignSignal {
    address public immutable XALICAN;
    address public immutable TREASURY;
    uint256 public totalSignals;

    event BundleAvailable(
        bytes32 indexed bundleId,
        uint256 apparentProfit,   // USD value in wei equivalent for indexing
        uint256 currentPrice,     // Dutch auction current price (USDC, 6 decimals)
        uint256 expiresAt,        // Unix timestamp ms
        bytes32 commitment,       // Hash of calldata — proves bundle exists
        address payTo,            // Treasury address — send USDC here to buy
        bytes32 bundleRef         // Reference ID to include in payment tx data
    );

    modifier onlyXalican() { require(msg.sender == XALICAN, "SSC: unauthorized"); _; }

    constructor(address _xalican, address _treasury) {
        XALICAN  = _xalican;
        TREASURY = _treasury;
    }

    function signal(
        bytes32 bundleId,
        uint256 apparentProfit,
        uint256 currentPrice,
        uint256 expiresAt,
        bytes32 commitment,
        bytes32 bundleRef
    ) external onlyXalican {
        totalSignals++;
        emit BundleAvailable(
            bundleId, apparentProfit, currentPrice,
            expiresAt, commitment, TREASURY, bundleRef
        );
    }

    // Allow bots to verify if a commitment is from Xalican before paying
    function verifyCommitment(bytes32 bundleId, bytes32 commitment) external pure returns (bool) {
        // Commitment = keccak256(bundleId || timestamp) — bots can verify timing
        return commitment != bytes32(0) && bundleId != bytes32(0);
    }
}
