// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IDojang} from "../interfaces/IDojang.sol";

/// @title MockDojang
/// @notice Testnet stand-in for the Dojang Verified Address attestation.
///         The owner flags addresses as verified; the real EAS-backed adapter
///         replaces this in M3.
contract MockDojang is IDojang, Ownable {
    mapping(address account => bool) private _verified;

    event VerifiedSet(address indexed account, bool isVerified);

    constructor() Ownable(msg.sender) {}

    /// @inheritdoc IDojang
    function isVerified(address account) external view returns (bool) {
        return _verified[account];
    }

    /// @notice Set the verified flag for a single account.
    function setVerified(address account, bool verified) external onlyOwner {
        _verified[account] = verified;
        emit VerifiedSet(account, verified);
    }

    /// @notice Mark a batch of accounts as verified (test convenience).
    function setVerifiedBatch(address[] calldata accounts) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            _verified[accounts[i]] = true;
            emit VerifiedSet(accounts[i], true);
        }
    }
}
