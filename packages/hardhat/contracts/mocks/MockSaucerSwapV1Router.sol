// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockHrc719Token} from "./MockHrc719Token.sol";

/// @dev Test-only SaucerSwap V1 router for HBAR swaps. Like the real one it works in tinybar inside the EVM
///      (a JSON-RPC client sends weibar, 10^10 times larger), and it refuses to pay an unassociated account.
contract MockSaucerSwapV1Router {
    uint256 public constant WEIBAR_PER_TINYBAR = 1e10;

    uint256 public tokensPerTinybar = 100;
    /// @dev Test switch: pays 10% less than `getAmountsOut` quoted, like a pool that moved after the quote.
    bool public drift;

    function setRate(uint256 rate) external {
        tokensPerTinybar = rate;
    }

    function setDrift(bool value) external {
        drift = value;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts) {
        require(path.length == 2, "path");
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn * tokensPerTinybar;
    }

    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts)
    {
        require(deadline >= block.timestamp, "EXPIRED");
        MockHrc719Token token = MockHrc719Token(path[1]);
        require(token.associatedAccounts(to), "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT");

        uint256 tinybar = msg.value / WEIBAR_PER_TINYBAR;
        amounts = new uint256[](2);
        amounts[0] = tinybar;
        amounts[1] = tinybar * tokensPerTinybar;
        if (drift) amounts[1] = (amounts[1] * 90) / 100;
        require(amounts[1] >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        token.mint(to, amounts[1]);
    }
}
