// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only Uniswap-V3-style factory. Like the real one, the token order does not matter.
contract MockPoolFactory {
    mapping(bytes32 => address) private pools;

    function setPool(address a, address b, uint24 fee, address pool) external {
        pools[_key(a, b, fee)] = pool;
    }

    function getPool(address a, address b, uint24 fee) external view returns (address) {
        return pools[_key(a, b, fee)];
    }

    function _key(address a, address b, uint24 fee) private pure returns (bytes32) {
        (address first, address second) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encode(first, second, fee));
    }
}

/// @dev Test-only pool that reports a fixed liquidity.
contract MockPool {
    uint128 public liquidity;

    constructor(uint128 liquidity_) {
        liquidity = liquidity_;
    }
}
