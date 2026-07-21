// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockKRW
/// @notice Testnet stand-in for a KRW stablecoin. Anyone can mint via the
///         faucet, capped per call. Not for production use.
contract MockKRW is ERC20 {
    /// @notice Maximum amount mintable in a single faucet call (10,000,000 KRWs).
    uint256 public constant FAUCET_CAP = 10_000_000e18;

    error FaucetCapExceeded(uint256 requested, uint256 cap);

    event FaucetDrip(address indexed to, uint256 amount);

    constructor() ERC20("Mock KRW Stable", "KRWs") {}

    /// @notice Mint `amount` tokens to the caller, up to FAUCET_CAP per call.
    function faucet(uint256 amount) external {
        if (amount > FAUCET_CAP) revert FaucetCapExceeded(amount, FAUCET_CAP);
        _mint(msg.sender, amount);
        emit FaucetDrip(msg.sender, amount);
    }
}
