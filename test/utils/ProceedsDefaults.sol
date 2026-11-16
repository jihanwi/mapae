// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MapaeFactory} from "../../src/MapaeFactory.sol";

/// @dev Decision 56 test defaults. The band allows 100% upfront so that pre-56 tests keep their
///      proceeds expectations (the whole issuer share paid at settle, an empty lock); the
///      ProceedsLock tests use the testnet band (30% max upfront) explicitly.
function TEST_PROCEEDS_BAND() pure returns (MapaeFactory.ProceedsBand memory) {
    return MapaeFactory.ProceedsBand({
        maxUpfrontBps: 10_000, minLockDuration: 1 hours, maxLockDuration: 1095 days, maxLockCliff: 180 days
    });
}

/// @dev The deployment band of DeployV3_2_L1 on GIWA Sepolia.
function TESTNET_PROCEEDS_BAND() pure returns (MapaeFactory.ProceedsBand memory) {
    return MapaeFactory.ProceedsBand({
        maxUpfrontBps: 3000, minLockDuration: 1 hours, maxLockDuration: 1095 days, maxLockCliff: 180 days
    });
}
