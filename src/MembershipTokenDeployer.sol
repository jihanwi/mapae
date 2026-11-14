// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MembershipToken} from "./MembershipToken.sol";

/// @title MembershipTokenDeployer
/// @notice External (linked) library that holds MembershipToken's creation
///         bytecode so it is not embedded in Offering's initcode — and, in
///         turn, not in OfferingDeployer's runtime or MapaeFactory's initcode
///         (EIP-170 / EIP-3860 headroom, 지시서 v3.1 C8).
/// @dev Called via DELEGATECALL from Offering's constructor, so the CREATE
///      executes from the Offering's own address and nonce: the token address,
///      `minter`/`offering` wiring and every event are byte-for-byte identical
///      to the previous inline `new MembershipToken(...)`. Pure bytecode
///      relocation, zero behaviour change.
library MembershipTokenDeployer {
    function deploy(
        string memory name_,
        string memory symbol_,
        address minter_,
        uint256 transferLockDuration_,
        uint16 holdingCapBps_,
        address[] memory capExempt_
    ) external returns (MembershipToken) {
        return new MembershipToken(name_, symbol_, minter_, transferLockDuration_, holdingCapBps_, capExempt_);
    }
}
