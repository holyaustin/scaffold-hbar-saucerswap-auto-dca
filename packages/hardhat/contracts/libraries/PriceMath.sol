// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Pure helpers that turn Pyth prices into a minimum acceptable swap output.
/// @dev No function here reverts on bad oracle data. Callers get `ok == false` and decide.
library PriceMath {
    uint256 internal constant BPS = 10_000;

    /// @notice Normalise a Pyth price (`price * 10^expo`) to 18 decimals.
    /// @return ok False when the price is not positive or the exponent is out of range.
    function toWad(int64 price, int32 expo) internal pure returns (bool ok, uint256 wad) {
        if (price <= 0) return (false, 0);
        int256 shift = int256(expo) + 18;
        if (shift < 0 || shift > 36) return (false, 0);
        return (true, uint256(uint64(price)) * 10 ** uint256(shift));
    }

    /// @notice True when `conf / price` is at most `maxConfBps` basis points.
    function confidenceOk(int64 price, uint64 conf, uint16 maxConfBps) internal pure returns (bool) {
        if (price <= 0) return false;
        return uint256(conf) * BPS <= uint256(uint64(price)) * maxConfBps;
    }

    /// @notice How much tokenOut `amountIn` of tokenIn is worth at the oracle prices.
    /// @param amountIn Raw tokenIn units.
    /// @param priceInWad USD price of one whole tokenIn, 18 decimals.
    /// @param priceOutWad USD price of one whole tokenOut, 18 decimals.
    /// @param decimalsIn Decimals of tokenIn.
    /// @param decimalsOut Decimals of tokenOut.
    /// @return Raw tokenOut units.
    function expectedOut(
        uint256 amountIn,
        uint256 priceInWad,
        uint256 priceOutWad,
        uint8 decimalsIn,
        uint8 decimalsOut
    ) internal pure returns (uint256) {
        return Math.mulDiv(amountIn * 10 ** decimalsOut, priceInWad, priceOutWad * 10 ** decimalsIn);
    }

    /// @notice Apply a slippage allowance (in basis points) to an expected amount.
    function applySlippage(uint256 expected, uint16 slippageBps) internal pure returns (uint256) {
        return (expected * (BPS - slippageBps)) / BPS;
    }
}
