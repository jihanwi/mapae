// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IOffering} from "./interfaces/IOffering.sol";
import {Offering} from "./Offering.sol";

/// @title OfferingDeployer
/// @notice Holds the (large) Offering+MembershipToken creation bytecode so the
///         factory's runtime stays under the EIP-170 24,576-byte limit. The
///         factory deploys one instance in its constructor and delegates all
///         `new Offering(...)` calls here.
/// @dev Permissionless by design: calling deploy() directly just creates an
///      unregistered Offering, which anyone could do anyway by deploying the
///      contract themselves. Registration/validation stays in the factory.
contract OfferingDeployer {
    function deploy(IOffering.OfferingParams calldata p) external returns (Offering) {
        return new Offering(p);
    }
}
