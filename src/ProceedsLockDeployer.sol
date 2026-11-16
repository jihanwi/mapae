// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ProceedsLock} from "./ProceedsLock.sol";

/// @title ProceedsLockDeployer
/// @notice Holds the ProceedsLock creation bytecode outside MapaeFactory (decision 56): the
///         factory constructor already creates OfferingDeployer and StackDeployer, so carrying the
///         lock bytecode there too would leave the factory initcode under 4 KiB of EIP-3860
///         headroom. Deployed once, passed to the MapaeFactory constructor. Permissionless by
///         design (same pattern as StackDeployer): a direct call just creates an unregistered
///         lock anyone could deploy themselves.
contract ProceedsLockDeployer {
    function deploy(address beneficiary, uint64 startTimestamp, uint64 durationSeconds, uint64 cliffSeconds)
        external
        returns (ProceedsLock)
    {
        return new ProceedsLock(beneficiary, startTimestamp, durationSeconds, cliffSeconds);
    }
}
