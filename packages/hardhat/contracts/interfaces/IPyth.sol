// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Subset of Pyth's `PythStructs`, ABI-identical to the official SDK.
library PythStructs {
    struct Price {
        int64 price; // price * 10^expo
        uint64 conf; // confidence interval, same scale as price
        int32 expo; // power-of-ten exponent (usually negative)
        uint256 publishTime; // unix seconds
    }
}

/// @notice Subset of the Pyth Core EVM interface used by the vault.
/// @dev https://docs.pyth.network/price-feeds/core/contract-addresses/evm
interface IPyth {
    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (PythStructs.Price memory price);

    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 feeAmount);

    function updatePriceFeeds(bytes[] calldata updateData) external payable;
}
