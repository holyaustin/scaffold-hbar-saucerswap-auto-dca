// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockToken} from "./MockToken.sol";

/// @dev Test-only HTS token that also offers the HIP-719 `associate()` / `isAssociated()` facade.
contract MockHrc719Token is MockToken {
    mapping(address => bool) public associatedAccounts;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) MockToken(name_, symbol_, decimals_) {}

    function associate() external returns (uint256) {
        associatedAccounts[msg.sender] = true;
        return 22; // SUCCESS
    }

    function isAssociated() external view returns (bool) {
        return associatedAccounts[msg.sender];
    }
}
