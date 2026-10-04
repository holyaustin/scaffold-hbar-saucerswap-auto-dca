// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPyth, PythStructs} from "../interfaces/IPyth.sol";

/// @dev Test-only Pyth. Update payloads are `abi.encode(id, price, conf, expo, publishTime)`.
contract MockPyth is IPyth {
    uint256 public constant FEE_PER_UPDATE = 3;

    mapping(bytes32 => PythStructs.Price) private prices;
    mapping(bytes32 => bool) private known;

    /// @dev Demo switch: while true every read behaves as if the price were too old.
    bool public simulateStale;

    error PriceFeedNotFound();
    error StalePrice();

    function setPrice(bytes32 id, int64 price, uint64 conf, int32 expo, uint256 publishTime) public {
        prices[id] = PythStructs.Price(price, conf, expo, publishTime);
        known[id] = true;
    }

    function setSimulateStale(bool stale) external {
        simulateStale = stale;
    }

    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (PythStructs.Price memory) {
        if (!known[id]) revert PriceFeedNotFound();
        if (simulateStale) revert StalePrice();
        PythStructs.Price memory p = prices[id];
        if (block.timestamp > p.publishTime + age) revert StalePrice();
        return p;
    }

    function getUpdateFee(bytes[] calldata updateData) external pure returns (uint256) {
        return FEE_PER_UPDATE * updateData.length;
    }

    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        require(msg.value >= FEE_PER_UPDATE * updateData.length, "fee");
        for (uint256 i = 0; i < updateData.length; ++i) {
            (bytes32 id, int64 price, uint64 conf, int32 expo, uint256 publishTime) =
                abi.decode(updateData[i], (bytes32, int64, uint64, int32, uint256));
            setPrice(id, price, conf, expo, publishTime);
        }
    }
}
