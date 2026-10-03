// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISaucerSwapV2Router} from "../interfaces/ISaucerSwapV2Router.sol";
import {MockToken} from "./MockToken.sol";

/// @dev Test-only router. Pays out `rateNumerator / rateDenominator` raw tokenOut per raw tokenIn
///      and enforces `amountOutMinimum` the same way the real router does.
contract MockSaucerSwapRouter is ISaucerSwapV2Router {
    uint256 public rateNumerator = 1;
    uint256 public rateDenominator = 1;

    function setRate(uint256 numerator, uint256 denominator) external {
        rateNumerator = numerator;
        rateDenominator = denominator;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        require(params.deadline >= block.timestamp, "Transaction too old");
        uint256 length = params.path.length;
        address tokenIn = address(bytes20(params.path[:20]));
        address tokenOut = address(bytes20(params.path[length - 20:]));

        IERC20(tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        amountOut = (params.amountIn * rateNumerator) / rateDenominator;
        require(amountOut >= params.amountOutMinimum, "Too little received");
        MockToken(tokenOut).mint(params.recipient, amountOut);
    }
}
