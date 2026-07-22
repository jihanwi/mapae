// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IEAS (minimal)
/// @notice Subset of the Ethereum Attestation Service predeploy used by the
///         Dojang adapter. Struct layout matches the canonical EAS v1
///         Attestation (github.com/ethereum-attestation-service/eas-contracts).
interface IEAS {
    struct Attestation {
        bytes32 uid;
        bytes32 schema;
        uint64 time;
        uint64 expirationTime;
        uint64 revocationTime;
        bytes32 refUID;
        address recipient;
        address attester;
        bool revocable;
        bytes data;
    }

    function getAttestation(bytes32 uid) external view returns (Attestation memory);
}

/// @title IDojangScroll (minimal)
/// @notice Dojang's convenience lookup contract on GIWA. ABI confirmed against
///         the live GIWA Sepolia deployment (impl v0.5.1 behind an ERC-1967
///         proxy at 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9).
/// @dev getVerifiedAddressAttestationUid REVERTS (custom error) when the
///      account has no attestation — callers must try/catch.
interface IDojangScroll {
    function isVerified(address account, bytes32 schemaUid) external view returns (bool);
    function getVerifiedAddressAttestationUid(address account, bytes32 schemaUid) external view returns (bytes32);
}
