// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IEAS, IDojangScroll} from "../src/interfaces/IEAS.sol";
import {DojangEASAdapter} from "../src/DojangEASAdapter.sol";
import {GiwaSepolia} from "../src/Constants.sol";

/// @notice Fork check of the v3.2 adapter against the live DojangScroll and EAS on GIWA
///         Sepolia. Runs only with GIWA_SEPOLIA_RPC_URL set; (a) and (c) also need
///         DOJANG_VERIFIED_WALLET (a wallet with a live TESTNET_FAUCET attestation; testnet
///         attestations expire after 30 days, so find a current one: docs/DEPLOY_V3_2.md).
contract DojangForkTest is Test {
    DojangEASAdapter internal adapter;
    DojangEASAdapter internal wrong; // v3.1 bug: schema UID in the attester slot
    address internal wallet;
    bool internal haveWallet;

    function setUp() public {
        string memory rpc = vm.envOr("GIWA_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        IEAS eas = IEAS(GiwaSepolia.EAS);
        IDojangScroll scroll = IDojangScroll(GiwaSepolia.DOJANG_SCROLL);
        adapter = new DojangEASAdapter(
            eas, scroll, GiwaSepolia.ATTESTER_TESTNET_FAUCET, GiwaSepolia.VERIFIED_ADDRESS_SCHEMA_UID
        );
        wrong = new DojangEASAdapter(
            eas, scroll, GiwaSepolia.VERIFIED_ADDRESS_SCHEMA_UID, GiwaSepolia.VERIFIED_ADDRESS_SCHEMA_UID
        );
        wallet = vm.envOr("DOJANG_VERIFIED_WALLET", address(0));
        haveWallet = wallet != address(0);
    }

    /// (a) a wallet with a live official attestation reads true
    function test_Fork_VerifiedWallet_True() public {
        if (!haveWallet) vm.skip(true);
        assertTrue(adapter.isVerified(wallet));
    }

    /// (b) an address without an attestation reads false (no revert)
    function test_Fork_Dead_False() public view {
        assertFalse(adapter.isVerified(address(0xdead)));
    }

    /// (c) the v3.1 configuration (schema UID as the attester ID) reads false for (a)'s wallet
    function test_Fork_SchemaUidAsAttester_False() public {
        if (!haveWallet) vm.skip(true);
        assertFalse(wrong.isVerified(wallet));
    }
}
