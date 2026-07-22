// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IEAS} from "../src/interfaces/IEAS.sol";
import {DojangEASAdapter} from "../src/DojangEASAdapter.sol";
import {MockEAS, MockDojangScroll} from "../src/mocks/MockEAS.sol";

contract DojangEASAdapterTest is Test {
    bytes32 internal constant SCHEMA = 0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08;
    bytes32 internal constant UID = keccak256("attestation-1");

    MockEAS internal eas;
    MockDojangScroll internal scroll;
    DojangEASAdapter internal adapter;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.warp(1_750_000_000);
        eas = new MockEAS();
        scroll = new MockDojangScroll();
        adapter = new DojangEASAdapter(eas, scroll, SCHEMA);
    }

    function _attest(address recipient, bytes32 schema, uint64 revocationTime, uint64 expirationTime, bytes memory data)
        internal
    {
        scroll.setUid(recipient, SCHEMA, UID);
        eas.setAttestation(
            IEAS.Attestation({
                uid: UID,
                schema: schema,
                time: uint64(block.timestamp),
                expirationTime: expirationTime,
                revocationTime: revocationTime,
                refUID: bytes32(0),
                recipient: recipient,
                attester: makeAddr("dojang"),
                revocable: true,
                data: data
            })
        );
    }

    function test_Verified_HappyPath() public {
        _attest(alice, SCHEMA, 0, 0, abi.encode(true));
        assertTrue(adapter.isVerified(alice));
    }

    function test_Verified_WithFutureExpiry() public {
        _attest(alice, SCHEMA, 0, uint64(block.timestamp + 365 days), abi.encode(true));
        assertTrue(adapter.isVerified(alice));
    }

    function test_NoAttestation_False() public view {
        // Live scroll REVERTS on absent attestations — mock mirrors that;
        // the adapter's try/catch turns it into false.
        assertFalse(adapter.isVerified(bob));
    }

    function test_Revoked_False() public {
        _attest(alice, SCHEMA, uint64(block.timestamp - 1), 0, abi.encode(true));
        assertFalse(adapter.isVerified(alice));
    }

    function test_Expired_False() public {
        _attest(alice, SCHEMA, 0, uint64(block.timestamp), abi.encode(true)); // expires exactly now
        assertFalse(adapter.isVerified(alice));
    }

    function test_WrongSchema_False() public {
        _attest(alice, keccak256("other-schema"), 0, 0, abi.encode(true));
        assertFalse(adapter.isVerified(alice));
    }

    function test_RecipientMismatch_False() public {
        // Scroll claims alice has UID, but the attestation is for bob.
        _attest(bob, SCHEMA, 0, 0, abi.encode(true));
        scroll.setUid(alice, SCHEMA, UID);
        assertFalse(adapter.isVerified(alice));
    }

    function test_DataFalse_False() public {
        _attest(alice, SCHEMA, 0, 0, abi.encode(false));
        assertFalse(adapter.isVerified(alice));
    }

    // ------------------------------------------------------------------
    // Liveness defense: failures return false, never revert
    // ------------------------------------------------------------------

    function test_EASRevert_ReturnsFalse() public {
        _attest(alice, SCHEMA, 0, 0, abi.encode(true));
        eas.setRevertMode(true);
        assertFalse(adapter.isVerified(alice)); // no revert bubbles up
    }

    function test_ScrollRevert_ReturnsFalse() public {
        _attest(alice, SCHEMA, 0, 0, abi.encode(true));
        scroll.setRevertMode(true);
        assertFalse(adapter.isVerified(alice));
    }

    function test_CorruptedData_ReturnsFalse() public {
        // Empty data
        _attest(alice, SCHEMA, 0, 0, "");
        assertFalse(adapter.isVerified(alice));
        // Word != 1 (not a canonical bool true)
        _attest(alice, SCHEMA, 0, 0, abi.encode(uint256(2)));
        assertFalse(adapter.isVerified(alice));
        // Short garbage
        _attest(alice, SCHEMA, 0, 0, hex"deadbeef");
        assertFalse(adapter.isVerified(alice));
    }

    function test_UidWithoutAttestation_ReturnsFalse() public {
        // Scroll points at a UID the EAS has never seen (empty struct).
        scroll.setUid(alice, SCHEMA, keccak256("dangling"));
        assertFalse(adapter.isVerified(alice));
    }
}
