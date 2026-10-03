// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only Hedera Schedule Service. Tests copy this contract's runtime code to 0x16b.
///      It records scheduled calls and lets a test fire them, mimicking the network.
contract MockHSS {
    struct Scheduled {
        address to;
        uint256 expirySecond;
        uint256 gasLimit;
        bytes callData;
    }

    Scheduled[] private scheduledCalls;
    mapping(uint256 => bool) public busySecond;
    bool public failScheduling;

    function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64, bytes memory callData)
        external
        returns (int64, address)
    {
        if (failScheduling) return (366, address(0));
        scheduledCalls.push(Scheduled(to, expirySecond, gasLimit, callData));
        return (22, address(uint160(0x5c0000 + scheduledCalls.length)));
    }

    function hasScheduleCapacity(uint256 expirySecond, uint256) external view returns (bool) {
        return !busySecond[expirySecond];
    }

    function setBusy(uint256 second, bool busy) external {
        busySecond[second] = busy;
    }

    function setFailScheduling(bool fail) external {
        failScheduling = fail;
    }

    function count() external view returns (uint256) {
        return scheduledCalls.length;
    }

    function scheduledAt(uint256 index) external view returns (address, uint256, uint256, bytes memory) {
        Scheduled storage s = scheduledCalls[index];
        return (s.to, s.expirySecond, s.gasLimit, s.callData);
    }

    /// @dev Execute a recorded call as the network would, bubbling up any revert.
    function fire(uint256 index) external {
        Scheduled storage s = scheduledCalls[index];
        (bool ok, bytes memory ret) = s.to.call(s.callData);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
