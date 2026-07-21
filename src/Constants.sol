// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title GiwaSepolia
/// @notice Canonical GIWA Sepolia addresses for the Dojang attestation stack.
///         See docs/DOJANG.md for how these are consumed (EAS adapter lands in M3).
library GiwaSepolia {
    /// @notice GIWA Sepolia chain ID.
    uint256 internal constant CHAIN_ID = 91_342;

    /// @notice Ethereum Attestation Service predeploy.
    address internal constant EAS = 0x4200000000000000000000000000000000000021;

    /// @notice EAS schema registry predeploy.
    address internal constant SCHEMA_REGISTRY = 0x4200000000000000000000000000000000000020;

    /// @notice DojangScroll convenience lookup contract.
    address internal constant DOJANG_SCROLL = 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9;

    /// @notice Dojang attestation indexer.
    address internal constant ATTESTATION_INDEXER = 0x9C9Bf29880448aB39795a11b669e22A0f1d790ec;

    /// @notice Verified Address schema UID (data: `bool isVerified`).
    bytes32 internal constant VERIFIED_ADDRESS_SCHEMA_UID =
        0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08;
}
