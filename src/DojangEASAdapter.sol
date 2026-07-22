// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IDojang} from "./interfaces/IDojang.sol";
import {IEAS, IDojangScroll} from "./interfaces/IEAS.sol";

/// @title DojangEASAdapter
/// @notice IDojang backed by the real Dojang attestation stack on GIWA:
///         DojangScroll (official convenience lookup) resolves the account's
///         Verified Address attestation UID, then the EAS predeploy provides
///         the attestation body for full independent validation — existence,
///         schema match, recipient match, not revoked, not expired, and
///         `bool isVerified` decoded true.
///
///         Liveness defense (M3): every external call is wrapped in try/catch
///         and every failure path returns false. Fail-closed is preserved
///         (false = rejected), but an adapter or dependency failure can never
///         make Offering.commit() revert permanently — with all MAPAE modules
///         non-upgradeable, this containment is the only safety net.
///         (Confirmed live: DojangScroll's UID getter reverts with a custom
///         error for accounts with no attestation, so the try/catch is
///         exercised on the very first unverified user.)
contract DojangEASAdapter is IDojang {
    error ZeroAddress();

    IEAS public immutable eas;
    IDojangScroll public immutable scroll;
    bytes32 public immutable schemaUid;

    constructor(IEAS eas_, IDojangScroll scroll_, bytes32 schemaUid_) {
        if (address(eas_) == address(0) || address(scroll_) == address(0)) revert ZeroAddress();
        eas = eas_;
        scroll = scroll_;
        schemaUid = schemaUid_;
    }

    /// @inheritdoc IDojang
    function isVerified(address account) external view returns (bool) {
        bytes32 uid;
        try scroll.getVerifiedAddressAttestationUid(account, schemaUid) returns (bytes32 u) {
            uid = u;
        } catch {
            return false; // no attestation (live behavior: revert) or scroll down
        }
        if (uid == bytes32(0)) return false;

        IEAS.Attestation memory a;
        try eas.getAttestation(uid) returns (IEAS.Attestation memory att) {
            a = att;
        } catch {
            return false;
        }

        if (a.schema != schemaUid) return false;
        if (a.recipient != account) return false;
        if (a.revocationTime != 0) return false;
        if (a.expirationTime != 0 && a.expirationTime <= block.timestamp) return false;

        // Manual decode of `bool isVerified`: strict word == 1. abi.decode would
        // revert on corrupted data — a revert here is exactly what the liveness
        // defense must avoid, so corrupted data simply reads as "not verified".
        bytes memory d = a.data;
        if (d.length < 32) return false;
        uint256 word;
        assembly ("memory-safe") {
            word := mload(add(d, 32))
        }
        return word == 1;
    }
}
