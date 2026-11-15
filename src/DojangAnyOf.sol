// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IDojang} from "./interfaces/IDojang.sol";

/// @title DojangAnyOf
/// @notice IDojang that accepts an account when EITHER source says it is verified.
///         Testnet (v3.2): a = DojangEASAdapter (official GIWA Dojang, TESTNET_FAUCET
///         attester), b = MockDojang (demo self-verify). Mainnet does NOT use this
///         composer: the CurveFactory takes a DojangEASAdapter (UPBIT_KOREA) alone.
/// @dev Each source is called inside try/catch and a failure counts as false, so one
///      source going down never blocks the other (and never reverts the caller).
contract DojangAnyOf is IDojang {
    error ZeroAddress();

    IDojang public immutable a;
    IDojang public immutable b;

    constructor(IDojang a_, IDojang b_) {
        if (address(a_) == address(0) || address(b_) == address(0)) revert ZeroAddress();
        a = a_;
        b = b_;
    }

    /// @inheritdoc IDojang
    function isVerified(address account) external view returns (bool) {
        try a.isVerified(account) returns (bool ok) {
            if (ok) return true;
        } catch {}
        try b.isVerified(account) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }
}
