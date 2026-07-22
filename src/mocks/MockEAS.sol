// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IEAS, IDojangScroll} from "../interfaces/IEAS.sol";

/// @title MockEAS / MockDojangScroll
/// @notice Test doubles for the Dojang attestation stack, with revert switches
///         to exercise the adapter's liveness defense. MockDojangScroll mirrors
///         the live contract's behavior of REVERTING on absent attestations.
contract MockEAS is IEAS {
    mapping(bytes32 uid => Attestation) internal _attestations;
    bool public revertMode;

    function setAttestation(Attestation calldata a) external {
        _attestations[a.uid] = a;
    }

    function setRevertMode(bool on) external {
        revertMode = on;
    }

    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        if (revertMode) revert("MockEAS: down");
        return _attestations[uid];
    }
}

contract MockDojangScroll is IDojangScroll {
    error AttestationNotFound(); // mirrors live custom-error revert

    mapping(address account => mapping(bytes32 schema => bytes32 uid)) internal _uids;
    bool public revertMode;

    function setUid(address account, bytes32 schemaUid, bytes32 uid) external {
        _uids[account][schemaUid] = uid;
    }

    function setRevertMode(bool on) external {
        revertMode = on;
    }

    function isVerified(address account, bytes32 schemaUid) external view returns (bool) {
        if (revertMode) revert("MockScroll: down");
        return _uids[account][schemaUid] != bytes32(0);
    }

    function getVerifiedAddressAttestationUid(address account, bytes32 schemaUid) external view returns (bytes32) {
        if (revertMode) revert("MockScroll: down");
        bytes32 uid = _uids[account][schemaUid];
        if (uid == bytes32(0)) revert AttestationNotFound(); // live behavior
        return uid;
    }
}
