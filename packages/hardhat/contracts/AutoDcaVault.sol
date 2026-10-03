// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPyth, PythStructs} from "./interfaces/IPyth.sol";
import {ISaucerSwapV2Router} from "./interfaces/ISaucerSwapV2Router.sol";
import {IHederaScheduleService, IHederaTokenServiceAssociate} from "./interfaces/IHederaSystem.sol";
import {PriceMath} from "./libraries/PriceMath.sol";

/// @title AutoDcaVault
/// @notice Recurring ("dollar-cost averaging") token buys on SaucerSwap V2 that run themselves.
///
/// How it fits together:
///  - Hedera Token Service (HTS): the vault associates itself with both tokens and holds the deposits.
///  - Hedera Schedule Service (HSS, HIP-1215): after every run the vault schedules its own next run.
///    No keeper bot, no cron, no server.
///  - Pyth: before every swap the vault prices both tokens and derives the minimum output it will
///    accept. A stale, uncertain or invalid price skips the run instead of buying into a bad market.
///  - SaucerSwap V2: the swap itself, with `amountOutMinimum` set from the Pyth-derived floor.
///
/// Every run emits an event (`RunExecuted` or `RunSkipped`). The Hedera mirror node serves these
/// logs, which is the audit trail the frontend displays.
contract AutoDcaVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum SkipReason {
        None,
        StalePrice, // Pyth price missing or older than the plan allows
        LowConfidence, // Pyth confidence interval too wide
        InvalidPrice, // non-positive price, bad exponent, or zero expected output
        SwapFailed // router reverted, usually because the pool price is worse than the oracle floor
    }

    struct CreatePlanParams {
        address tokenIn;
        address tokenOut;
        bytes path; // SaucerSwap path: tokenIn | fee | ... | tokenOut
        uint256 amountPerRun; // raw tokenIn units sold on each run
        uint32 runs;
        uint32 intervalSeconds;
        uint16 maxSlippageBps; // allowed shortfall versus the oracle-implied output
        uint16 maxConfBps; // max Pyth confidence / price, in basis points
        uint32 maxPriceAge; // seconds
        bytes32 priceIdIn; // Pyth feed (USD) for tokenIn
        bytes32 priceIdOut; // Pyth feed (USD) for tokenOut
    }

    struct Plan {
        address owner;
        address tokenIn;
        address tokenOut;
        uint8 decimalsIn;
        uint8 decimalsOut;
        bool active; // false after completion or cancellation
        bool paused;
        bool scheduled; // true when HSS holds the next run, false when a manual `execute` is needed
        uint8 skipsInARow;
        uint16 maxSlippageBps;
        uint16 maxConfBps;
        uint32 maxPriceAge;
        uint32 intervalSeconds;
        uint32 runsRemaining;
        uint32 runsDone;
        uint32 runsSkipped;
        uint64 nextRunAt;
        uint256 amountPerRun;
        uint256 fundsRemaining; // tokenIn not yet sold
        uint256 accruedOut; // tokenOut bought and waiting to be claimed
        bytes32 priceIdIn;
        bytes32 priceIdOut;
        bytes path;
    }

    // ---------------------------------------------------------------------
    // Constants and configuration
    // ---------------------------------------------------------------------

    address internal constant HTS = address(0x167);
    address internal constant HSS = address(0x16b);

    int64 internal constant RC_SUCCESS = 22;
    int64 internal constant RC_TOKEN_ALREADY_ASSOCIATED = 194;
    int64 internal constant RC_SCHEDULE_CALL_FAILED = -1;
    int64 internal constant RC_NO_SCHEDULE_CAPACITY = -2;

    uint8 public constant MAX_CONSECUTIVE_SKIPS = 5;
    uint16 public constant MAX_SLIPPAGE_BPS = 5_000;
    uint32 public constant MAX_RUNS = 365;
    uint256 public constant MAX_SCHEDULE_SECOND_SEARCH = 10;
    uint256 public constant DUE_TOLERANCE = 2; // seconds of clock skew allowed on scheduled runs
    uint256 public constant SWAP_DEADLINE_WINDOW = 300; // seconds

    IPyth public immutable pyth;
    ISaucerSwapV2Router public immutable router;
    uint256 public immutable scheduledCallGasLimit;
    uint32 public immutable minIntervalSeconds;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    uint256 public nextPlanId;
    mapping(uint256 => Plan) private plans;
    mapping(address => uint256[]) private planIdsByOwner;
    mapping(address => bool) public associated;

    // ---------------------------------------------------------------------
    // Events and errors
    // ---------------------------------------------------------------------

    event PlanCreated(
        uint256 indexed planId,
        address indexed owner,
        address tokenIn,
        address tokenOut,
        uint256 amountPerRun,
        uint32 runs,
        uint32 intervalSeconds
    );
    event RunScheduled(uint256 indexed planId, uint256 runAt, address scheduleAddress);
    event ScheduleFailed(uint256 indexed planId, int64 responseCode);
    event RunExecuted(
        uint256 indexed planId, uint256 amountIn, uint256 amountOut, uint256 oracleExpectedOut, uint32 runsRemaining
    );
    event RunSkipped(uint256 indexed planId, SkipReason reason);
    event PlanPaused(uint256 indexed planId, bool automatic);
    event PlanResumed(uint256 indexed planId);
    event PlanCompleted(uint256 indexed planId);
    event PlanCancelled(uint256 indexed planId, uint256 refundedIn);
    event Claimed(uint256 indexed planId, uint256 amountOut);
    event PriceRefreshed(address indexed caller, uint256 fee);

    error InvalidConfig();
    error InvalidTokens();
    error InvalidAmounts();
    error InvalidPolicy();
    error InvalidPath();
    error IntervalTooShort(uint32 given, uint32 minimum);
    error AssociationFailed(address token, int64 responseCode);
    error NotPlanOwner(uint256 planId);
    error InvalidState(uint256 planId);
    error NotDue(uint256 planId, uint64 nextRunAt);
    error NothingToClaim(uint256 planId);
    error InsufficientUpdateFee(uint256 required, uint256 provided);
    error TransferFailed();

    modifier onlyPlanOwner(uint256 planId) {
        if (plans[planId].owner != msg.sender) revert NotPlanOwner(planId);
        _;
    }

    constructor(
        address pyth_,
        address router_,
        uint256 scheduledCallGasLimit_,
        uint32 minIntervalSeconds_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (pyth_ == address(0) || router_ == address(0) || scheduledCallGasLimit_ == 0 || minIntervalSeconds_ == 0) {
            revert InvalidConfig();
        }
        pyth = IPyth(pyth_);
        router = ISaucerSwapV2Router(router_);
        scheduledCallGasLimit = scheduledCallGasLimit_;
        minIntervalSeconds = minIntervalSeconds_;
    }

    /// @notice The vault pays gas for scheduled runs from its own HBAR balance.
    receive() external payable {}

    // ---------------------------------------------------------------------
    // Plan lifecycle
    // ---------------------------------------------------------------------

    /// @notice Deposit the full budget up front and start a plan. The caller must have approved
    ///         `amountPerRun * runs` of `tokenIn` to this vault.
    function createPlan(CreatePlanParams calldata p) external nonReentrant returns (uint256 planId) {
        _validate(p);
        _associate(p.tokenIn);
        _associate(p.tokenOut);

        IERC20(p.tokenIn).safeTransferFrom(msg.sender, address(this), p.amountPerRun * p.runs);

        planId = nextPlanId++;
        Plan storage plan = plans[planId];
        plan.owner = msg.sender;
        plan.tokenIn = p.tokenIn;
        plan.tokenOut = p.tokenOut;
        plan.decimalsIn = IERC20Metadata(p.tokenIn).decimals();
        plan.decimalsOut = IERC20Metadata(p.tokenOut).decimals();
        plan.active = true;
        plan.maxSlippageBps = p.maxSlippageBps;
        plan.maxConfBps = p.maxConfBps;
        plan.maxPriceAge = p.maxPriceAge;
        plan.intervalSeconds = p.intervalSeconds;
        plan.runsRemaining = p.runs;
        plan.amountPerRun = p.amountPerRun;
        plan.fundsRemaining = p.amountPerRun * p.runs;
        plan.priceIdIn = p.priceIdIn;
        plan.priceIdOut = p.priceIdOut;
        plan.path = p.path;
        planIdsByOwner[msg.sender].push(planId);

        emit PlanCreated(planId, msg.sender, p.tokenIn, p.tokenOut, p.amountPerRun, p.runs, p.intervalSeconds);
        _scheduleNext(planId, plan, block.timestamp + p.intervalSeconds);
    }

    /// @notice Run one purchase. HSS calls this at the scheduled time, and anyone may call it once
    ///         the plan is due (a keeper-free fallback if HSS ever fails to schedule).
    /// @dev Cancelled, completed and paused plans return silently so stale schedules are harmless.
    function execute(uint256 planId) external nonReentrant {
        Plan storage plan = plans[planId];
        if (!plan.active || plan.paused) return;
        if (block.timestamp + DUE_TOLERANCE < plan.nextRunAt) revert NotDue(planId, plan.nextRunAt);

        (SkipReason reason, uint256 expected, uint256 minimum) = _evaluate(plan);
        if (reason == SkipReason.None) {
            (bool swapped, uint256 received) = _trySwap(plan, minimum);
            if (swapped) {
                _recordRun(planId, plan, received, expected);
                return;
            }
            reason = SkipReason.SwapFailed;
        }
        _recordSkip(planId, plan, reason);
    }

    function pausePlan(uint256 planId) external onlyPlanOwner(planId) {
        Plan storage plan = plans[planId];
        if (!plan.active || plan.paused) revert InvalidState(planId);
        plan.paused = true;
        plan.scheduled = false;
        emit PlanPaused(planId, false);
    }

    function resumePlan(uint256 planId) external onlyPlanOwner(planId) nonReentrant {
        Plan storage plan = plans[planId];
        if (!plan.active || !plan.paused) revert InvalidState(planId);
        plan.paused = false;
        plan.skipsInARow = 0;
        emit PlanResumed(planId);
        _scheduleNext(planId, plan, block.timestamp + plan.intervalSeconds);
    }

    /// @notice Stop a plan and return the tokenIn that has not been sold. Bought tokenOut stays
    ///         claimable through `claim`, so cancelling never depends on a tokenOut association.
    function cancelPlan(uint256 planId) external onlyPlanOwner(planId) nonReentrant {
        Plan storage plan = plans[planId];
        if (!plan.active) revert InvalidState(planId);
        uint256 refund = plan.fundsRemaining;
        plan.active = false;
        plan.paused = false;
        plan.scheduled = false;
        plan.runsRemaining = 0;
        plan.fundsRemaining = 0;
        if (refund > 0) IERC20(plan.tokenIn).safeTransfer(msg.sender, refund);
        emit PlanCancelled(planId, refund);
    }

    /// @notice Withdraw bought tokenOut. The caller must be associated with tokenOut.
    function claim(uint256 planId) external onlyPlanOwner(planId) nonReentrant {
        Plan storage plan = plans[planId];
        uint256 amount = plan.accruedOut;
        if (amount == 0) revert NothingToClaim(planId);
        plan.accruedOut = 0;
        IERC20(plan.tokenOut).safeTransfer(msg.sender, amount);
        emit Claimed(planId, amount);
    }

    // ---------------------------------------------------------------------
    // Oracle
    // ---------------------------------------------------------------------

    /// @notice Push a signed Pyth update on-chain. Anyone can call this and pays the fee themselves.
    /// @dev `msg.value` and the fee are both in the EVM's native unit, which on Hedera is tinybar.
    ///      Clients using JSON-RPC send weibar (18 decimals); the relay converts it. Excess is refunded.
    function refreshPrice(bytes[] calldata updateData) external payable nonReentrant {
        uint256 fee = pyth.getUpdateFee(updateData);
        if (msg.value < fee) revert InsufficientUpdateFee(fee, msg.value);
        pyth.updatePriceFeeds{value: fee}(updateData);
        uint256 excess = msg.value - fee;
        if (excess > 0) _sendHbar(msg.sender, excess);
        emit PriceRefreshed(msg.sender, fee);
    }

    /// @notice What `execute` would do right now, without moving funds. Powers the guard badge in the UI.
    function previewRun(uint256 planId)
        external
        view
        returns (SkipReason reason, uint256 expected, uint256 minimum)
    {
        Plan storage plan = plans[planId];
        if (plan.owner == address(0)) revert InvalidState(planId);
        return _evaluate(plan);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getPlan(uint256 planId) external view returns (Plan memory) {
        return plans[planId];
    }

    function getPlanIds(address account) external view returns (uint256[] memory) {
        return planIdsByOwner[account];
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Recover HBAR kept for scheduled-run gas. Cannot touch user tokens.
    function withdrawHbar(address to, uint256 amount) external onlyOwner nonReentrant {
        _sendHbar(to, amount);
    }

    // ---------------------------------------------------------------------
    // Internals: validation
    // ---------------------------------------------------------------------

    function _validate(CreatePlanParams calldata p) internal view {
        if (p.tokenIn == address(0) || p.tokenOut == address(0) || p.tokenIn == p.tokenOut) revert InvalidTokens();
        if (p.amountPerRun == 0 || p.runs == 0 || p.runs > MAX_RUNS) revert InvalidAmounts();
        if (p.intervalSeconds < minIntervalSeconds) revert IntervalTooShort(p.intervalSeconds, minIntervalSeconds);
        if (p.maxSlippageBps > MAX_SLIPPAGE_BPS || p.maxConfBps > PriceMath.BPS || p.maxPriceAge == 0) {
            revert InvalidPolicy();
        }
        uint256 length = p.path.length;
        if (length < 43 || (length - 20) % 23 != 0) revert InvalidPath();
        if (address(bytes20(p.path[:20])) != p.tokenIn || address(bytes20(p.path[length - 20:])) != p.tokenOut) {
            revert InvalidPath();
        }
    }

    // ---------------------------------------------------------------------
    // Internals: Hedera system contracts
    // ---------------------------------------------------------------------

    function _associate(address token) internal {
        if (associated[token]) return;
        (bool ok, bytes memory ret) =
            HTS.call(abi.encodeCall(IHederaTokenServiceAssociate.associateToken, (address(this), token)));
        int64 rc = (ok && ret.length >= 32) ? abi.decode(ret, (int64)) : RC_SCHEDULE_CALL_FAILED;
        if (rc != RC_SUCCESS && rc != RC_TOKEN_ALREADY_ASSOCIATED) revert AssociationFailed(token, rc);
        associated[token] = true;
    }

    /// @dev Asks HSS to call `execute(planId)` at `runAt`. HIP-1215 recommends probing capacity and
    ///      moving to the next second when a second is busy, which this loop does.
    ///      `scheduleCall` never reverts, so failure is recorded and the plan stays usable manually.
    function _scheduleNext(uint256 planId, Plan storage plan, uint256 runAt) internal {
        bytes memory callData = abi.encodeCall(this.execute, (planId));
        uint256 gasLimit = scheduledCallGasLimit;
        int64 lastCode = RC_NO_SCHEDULE_CAPACITY;

        for (uint256 i = 0; i < MAX_SCHEDULE_SECOND_SEARCH; ++i) {
            uint256 second = runAt + i;
            if (!_hasCapacity(second, gasLimit)) continue;

            (bool called, bytes memory ret) = HSS.call(
                abi.encodeCall(IHederaScheduleService.scheduleCall, (address(this), second, gasLimit, 0, callData))
            );
            if (!called || ret.length < 64) {
                lastCode = RC_SCHEDULE_CALL_FAILED;
                break;
            }
            (int64 code, address scheduleAddress) = abi.decode(ret, (int64, address));
            if (code == RC_SUCCESS) {
                plan.nextRunAt = uint64(second);
                plan.scheduled = true;
                emit RunScheduled(planId, second, scheduleAddress);
                return;
            }
            lastCode = code;
        }

        plan.nextRunAt = uint64(runAt);
        plan.scheduled = false;
        emit ScheduleFailed(planId, lastCode);
    }

    function _hasCapacity(uint256 second, uint256 gasLimit) internal view returns (bool) {
        (bool ok, bytes memory ret) =
            HSS.staticcall(abi.encodeCall(IHederaScheduleService.hasScheduleCapacity, (second, gasLimit)));
        // If the probe itself is unavailable, let scheduleCall make the decision.
        if (!ok || ret.length != 32) return true;
        return abi.decode(ret, (bool));
    }

    // ---------------------------------------------------------------------
    // Internals: running a plan
    // ---------------------------------------------------------------------

    function _evaluate(Plan storage plan) internal view returns (SkipReason, uint256, uint256) {
        (SkipReason reasonIn, uint256 wadIn) = _readWad(plan.priceIdIn, plan.maxPriceAge, plan.maxConfBps);
        if (reasonIn != SkipReason.None) return (reasonIn, 0, 0);
        (SkipReason reasonOut, uint256 wadOut) = _readWad(plan.priceIdOut, plan.maxPriceAge, plan.maxConfBps);
        if (reasonOut != SkipReason.None) return (reasonOut, 0, 0);

        (uint256 expected, uint256 minimum) = _quote(plan, wadIn, wadOut);
        if (expected == 0) return (SkipReason.InvalidPrice, 0, 0);
        return (SkipReason.None, expected, minimum);
    }

    /// @dev Reads one Pyth price and returns it as a USD price with 18 decimals, or the reason it is unusable.
    function _readWad(bytes32 id, uint32 maxAge, uint16 maxConfBps) internal view returns (SkipReason, uint256) {
        (bool ok, PythStructs.Price memory price) = _readPrice(id, maxAge);
        if (!ok) return (SkipReason.StalePrice, 0);
        if (!PriceMath.confidenceOk(price.price, price.conf, maxConfBps)) return (SkipReason.LowConfidence, 0);
        (bool valid, uint256 wad) = PriceMath.toWad(price.price, price.expo);
        if (!valid) return (SkipReason.InvalidPrice, 0);
        return (SkipReason.None, wad);
    }

    /// @dev Oracle-implied output for one run, and the floor after the plan's slippage allowance.
    function _quote(Plan storage plan, uint256 wadIn, uint256 wadOut)
        internal
        view
        returns (uint256 expected, uint256 minimum)
    {
        expected = PriceMath.expectedOut(plan.amountPerRun, wadIn, wadOut, plan.decimalsIn, plan.decimalsOut);
        minimum = PriceMath.applySlippage(expected, plan.maxSlippageBps);
    }

    function _readPrice(bytes32 id, uint32 maxAge) internal view returns (bool ok, PythStructs.Price memory price) {
        try pyth.getPriceNoOlderThan(id, maxAge) returns (PythStructs.Price memory fresh) {
            return (true, fresh);
        } catch {
            return (false, price);
        }
    }

    function _trySwap(Plan storage plan, uint256 minimumOut) internal returns (bool swapped, uint256 received) {
        IERC20 tokenIn = IERC20(plan.tokenIn);
        IERC20 tokenOut = IERC20(plan.tokenOut);
        uint256 balanceBefore = tokenOut.balanceOf(address(this));

        tokenIn.forceApprove(address(router), plan.amountPerRun);
        try router.exactInput(
            ISaucerSwapV2Router.ExactInputParams({
                path: plan.path,
                recipient: address(this),
                deadline: block.timestamp + SWAP_DEADLINE_WINDOW,
                amountIn: plan.amountPerRun,
                amountOutMinimum: minimumOut
            })
        ) returns (uint256) {
            tokenIn.forceApprove(address(router), 0);
            return (true, tokenOut.balanceOf(address(this)) - balanceBefore);
        } catch {
            tokenIn.forceApprove(address(router), 0);
            return (false, 0);
        }
    }

    function _recordRun(uint256 planId, Plan storage plan, uint256 received, uint256 expected) internal {
        plan.fundsRemaining -= plan.amountPerRun;
        plan.runsRemaining -= 1;
        plan.runsDone += 1;
        plan.accruedOut += received;
        plan.skipsInARow = 0;
        emit RunExecuted(planId, plan.amountPerRun, received, expected, plan.runsRemaining);

        if (plan.runsRemaining == 0) {
            plan.active = false;
            plan.scheduled = false;
            emit PlanCompleted(planId);
            return;
        }
        _scheduleNext(planId, plan, _nextRunTime(plan));
    }

    /// @dev Skipped runs consume no funds and no run count. After `MAX_CONSECUTIVE_SKIPS` in a row
    ///      the plan pauses itself so it cannot burn gas forever on a dead market.
    function _recordSkip(uint256 planId, Plan storage plan, SkipReason reason) internal {
        plan.runsSkipped += 1;
        plan.skipsInARow += 1;
        emit RunSkipped(planId, reason);

        if (plan.skipsInARow >= MAX_CONSECUTIVE_SKIPS) {
            plan.paused = true;
            plan.scheduled = false;
            emit PlanPaused(planId, true);
            return;
        }
        _scheduleNext(planId, plan, _nextRunTime(plan));
    }

    /// @dev Never schedules in the past, so a late run does not trigger a burst of catch-up runs.
    function _nextRunTime(Plan storage plan) internal view returns (uint256) {
        uint256 base = plan.nextRunAt > block.timestamp ? plan.nextRunAt : block.timestamp;
        return base + plan.intervalSeconds;
    }

    function _sendHbar(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
