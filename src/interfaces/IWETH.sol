// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IWETH
/// @notice Minimal wrapped-ETH surface (WETH9 / GIWA predeploy 0x4200…0006).
interface IWETH is IERC20 {
    function deposit() external payable;

    function withdraw(uint256 amount) external;
}
