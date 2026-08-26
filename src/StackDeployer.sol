// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MembershipToken} from "./MembershipToken.sol";
import {RedeemManager} from "./RedeemManager.sol";
import {MapaeVesting} from "./MapaeVesting.sol";
import {Sponsorship} from "./Sponsorship.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {BuybackVault} from "./BuybackVault.sol";

/// @title StackDeployer
/// @notice Holds the RedeemManager/Vesting/Sponsorship creation bytecode so the
///         factory's runtime stays under the EIP-170 limit (same split pattern
///         as OfferingDeployer). Permissionless by design — direct calls just
///         create unregistered contracts anyone could deploy themselves.
contract StackDeployer {
    function deployVesting(
        address beneficiary,
        uint64 startTimestamp,
        uint64 durationSeconds,
        uint64 cliffSeconds,
        IFeeRouter.UtilityTier tier
    ) external returns (MapaeVesting) {
        return new MapaeVesting(beneficiary, startTimestamp, durationSeconds, cliffSeconds, tier);
    }

    function deployPeripherals(
        MembershipToken token,
        IERC20 krw,
        address creator,
        uint16 sponsorBurnBps,
        uint16 maxSlippageBps,
        IFeeRouter feeRouter,
        IFeeRouter.UtilityTier tier,
        BuybackVault buybackVault
    ) external returns (RedeemManager redeemManager, Sponsorship sponsorship) {
        redeemManager = new RedeemManager(token, creator, krw, feeRouter, tier, buybackVault);
        sponsorship = new Sponsorship(token, krw, creator, sponsorBurnBps, maxSlippageBps, tier, buybackVault);
    }
}
