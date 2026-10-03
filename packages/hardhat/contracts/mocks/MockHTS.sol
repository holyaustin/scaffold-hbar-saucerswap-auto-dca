// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only Hedera Token Service. Tests copy this contract's runtime code to 0x167.
contract MockHTS {
    mapping(address => mapping(address => bool)) public isAssociated;
    bool public failAssociation;

    function associateToken(address account, address token) external returns (int64) {
        if (failAssociation) return 167; // arbitrary non-success code
        if (isAssociated[account][token]) return 194; // TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT
        isAssociated[account][token] = true;
        return 22; // SUCCESS
    }

    function setFailAssociation(bool fail) external {
        failAssociation = fail;
    }
}
