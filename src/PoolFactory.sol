// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MapaePool} from "./MapaePool.sol";
import {MembershipToken} from "./MembershipToken.sol";

/// @title PoolFactory
/// @notice One MapaePool per MembershipToken (D7). Creation is restricted to
///         the token's own offering — otherwise an attacker could front-run
///         settle() with a pool carrying hostile fee parameters and brick the
///         at-par listing.
contract PoolFactory {
    error PoolExists(address token, address pool);
    error NotTokenOffering(address caller, address offering);

    event PoolCreated(address indexed token, address indexed pool, address indexed creator);

    mapping(address token => address pool) public poolOf;
    address[] internal _allPools;

    function createPool(MembershipToken token, IERC20 krw, address creator, uint16 royaltyBps, uint16 burnBps)
        external
        returns (MapaePool pool)
    {
        if (poolOf[address(token)] != address(0)) revert PoolExists(address(token), poolOf[address(token)]);
        if (msg.sender != token.offering()) revert NotTokenOffering(msg.sender, token.offering());

        pool = new MapaePool(token, krw, creator, royaltyBps, burnBps);
        poolOf[address(token)] = address(pool);
        _allPools.push(address(pool));
        emit PoolCreated(address(token), address(pool), creator);
    }

    function allPools() external view returns (address[] memory) {
        return _allPools;
    }
}
