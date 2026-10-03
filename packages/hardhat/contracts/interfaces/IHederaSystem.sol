// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Hedera Schedule Service system contract at 0x16b (HIP-755 / HIP-1215).
/// @dev `scheduleCall` does not revert: it reports failure through `responseCode`.
interface IHederaScheduleService {
    function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes memory callData)
        external
        returns (int64 responseCode, address scheduleAddress);

    function hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) external view returns (bool hasCapacity);
}

/// @notice The one Hedera Token Service function this template needs, at 0x167.
interface IHederaTokenServiceAssociate {
    function associateToken(address account, address token) external returns (int64 responseCode);
}
