// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockSaucerSwapRouter} from "./MockSaucerSwapRouter.sol";

/// @dev Test and demo only. Mirrors SaucerSwap's QuoterV2 `quoteExactInput` using the mock router's rate,
///      so the web app's pool-versus-oracle check works without a live pool.
contract MockSaucerSwapQuoter {
    MockSaucerSwapRouter public immutable router;

    constructor(MockSaucerSwapRouter router_) {
        router = router_;
    }

    function quoteExactInput(bytes memory, uint256 amountIn)
        external
        view
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        )
    {
        amountOut = (amountIn * router.rateNumerator()) / router.rateDenominator();
        sqrtPriceX96AfterList = new uint160[](0);
        initializedTicksCrossedList = new uint32[](0);
        gasEstimate = 0;
    }
}
