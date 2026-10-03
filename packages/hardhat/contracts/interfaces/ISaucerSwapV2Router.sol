// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice SaucerSwap V2 swap router. Note the `deadline` field in the params struct.
/// @dev https://docs.saucerswap.finance/developers/v2/swap/swap-tokens-for-tokens
interface ISaucerSwapV2Router {
    struct ExactInputParams {
        bytes path; // token (20 bytes) | fee (3 bytes) | token (20 bytes) | ...
        address recipient;
        uint256 deadline; // unix seconds
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
