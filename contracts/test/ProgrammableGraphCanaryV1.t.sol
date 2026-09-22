// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { PositionPlanner } from "@uniswap/liquidity-launcher/src/libraries/PositionPlanner.sol";
import {
    CurrencyAmounts,
    Plan,
    Position,
    PositionDefinition
} from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { IPositionDescriptor } from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IWETH9 } from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";

import { PlatformFeeHookV1 } from "../src/PlatformFeeHookV1.sol";
import { ProgrammableCanaryLiquidityInitializerV1 } from "../src/ProgrammableCanaryLiquidityInitializerV1.sol";
import { ProgrammableCanaryTokenV1 } from "../src/ProgrammableCanaryTokenV1.sol";

interface IProgrammableCreate2GraphDeployerV1 {
    struct GraphAuthorization {
        bytes32 routeNamespace;
        bytes32 routeNonce;
        bytes32 topologyHash;
        bytes32 graphCommitment;
        address authorizedLauncher;
        uint256 totalValue;
    }

    struct Target {
        bytes32 targetIdHash;
        bytes32 applicantSalt;
        uint256 deploymentValue;
        uint256 initializerValue;
        bytes initCode;
        bytes initializerCalldata;
    }

    function deployGraph(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        payable
        returns (
            address[] memory deployments,
            bytes32[] memory runtimeCodeHashes,
            bytes[] memory runtimeCodes,
            bytes32 graphDeploymentHash
        );

    function computeGraphCommitment(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        view
        returns (bytes32 commitment, uint256 targetValueSum);

    function effectiveTargetSalt(GraphAuthorization calldata authorization, bytes32 targetIdHash, bytes32 applicantSalt)
        external
        view
        returns (bytes32);

    function predictTarget(GraphAuthorization calldata authorization, Target calldata target)
        external
        view
        returns (address);
}

/// @dev Test-only reproduction of the deployed V1 factory's deploy-all-then-initialize caller semantics and hashes.
contract LocalProgrammableCreate2GraphDeployerV1 is IProgrammableCreate2GraphDeployerV1 {
    bytes32 internal constant GRAPH_TARGET_COMMITMENT_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphTargetCommitmentV1(uint256 targetIndex,bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes32 initCodeHash,bytes32 initializerCalldataHash)"
    );
    bytes32 internal constant GRAPH_COMMITMENT_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphCommitmentV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,address authorizedLauncher,uint256 totalValue,bytes32 targetCommitmentsHash)"
    );
    bytes32 internal constant TARGET_SALT_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)"
    );
    bytes32 internal constant GRAPH_AUTHORIZATION_KEY_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphAuthorizationKeyV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,address authorizedLauncher)"
    );
    bytes32 internal constant GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphDeploymentAccumulatorV1(bytes32 previous,uint256 targetIndex,bytes32 targetIdHash,address deployment,bytes32 effectiveSalt,bytes32 initCodeHash,bytes32 initializerCalldataHash,bytes32 runtimeCodeHash,uint256 deploymentValue,uint256 initializerValue)"
    );

    struct GraphExecution {
        address[] deployments;
        bytes32[] salts;
        bytes32[] initCodeHashes;
        bytes32[] initializerCalldataHashes;
        bytes32[] runtimeCodeHashes;
        bytes[] runtimeCodes;
    }

    mapping(bytes32 authorizationKey => bool consumed) public consumedGraphAuthorization;

    error InvalidGraph();
    error InitializerFailed(uint256 index, bytes reason);

    function deployGraph(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        payable
        override
        returns (
            address[] memory deployments,
            bytes32[] memory runtimeCodeHashes,
            bytes[] memory runtimeCodes,
            bytes32 graphDeploymentHash
        )
    {
        if (targets.length == 0 || targets.length > 16 || msg.sender != authorization.authorizedLauncher) {
            revert InvalidGraph();
        }
        if (msg.value != authorization.totalValue) revert InvalidGraph();
        (bytes32 commitment, uint256 targetValueSum) = _computeGraphCommitment(authorization, targets);
        if (commitment != authorization.graphCommitment || targetValueSum != authorization.totalValue) {
            revert InvalidGraph();
        }
        bytes32 authorizationKey = keccak256(
            abi.encode(
                GRAPH_AUTHORIZATION_KEY_TYPEHASH,
                block.chainid,
                address(this),
                authorization.routeNamespace,
                authorization.routeNonce,
                authorization.authorizedLauncher
            )
        );
        if (consumedGraphAuthorization[authorizationKey]) revert InvalidGraph();
        consumedGraphAuthorization[authorizationKey] = true;

        uint256 length = targets.length;
        GraphExecution memory execution = GraphExecution({
            deployments: new address[](length),
            salts: new bytes32[](length),
            initCodeHashes: new bytes32[](length),
            initializerCalldataHashes: new bytes32[](length),
            runtimeCodeHashes: new bytes32[](length),
            runtimeCodes: new bytes[](length)
        });

        _deriveTargets(authorization, targets, execution);
        _deployTargets(targets, execution);
        _initializeTargets(targets, execution.deployments);
        graphDeploymentHash = _observeTargets(authorization, targets, execution);
        deployments = execution.deployments;
        runtimeCodeHashes = execution.runtimeCodeHashes;
        runtimeCodes = execution.runtimeCodes;
    }

    function computeGraphCommitment(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        view
        override
        returns (bytes32 commitment, uint256 targetValueSum)
    {
        return _computeGraphCommitment(authorization, targets);
    }

    function effectiveTargetSalt(GraphAuthorization calldata authorization, bytes32 targetIdHash, bytes32 applicantSalt)
        external
        view
        override
        returns (bytes32)
    {
        return _effectiveTargetSalt(authorization, targetIdHash, applicantSalt);
    }

    function predictTarget(GraphAuthorization calldata authorization, Target calldata target)
        external
        view
        override
        returns (address)
    {
        return _computeAddress(
            _effectiveTargetSalt(authorization, target.targetIdHash, target.applicantSalt), keccak256(target.initCode)
        );
    }

    function _computeGraphCommitment(GraphAuthorization calldata authorization, Target[] calldata targets)
        private
        view
        returns (bytes32 commitment, uint256 targetValueSum)
    {
        bytes32[] memory targetCommitments = new bytes32[](targets.length);
        for (uint256 index; index < targets.length; ++index) {
            Target calldata target = targets[index];
            targetValueSum += target.deploymentValue + target.initializerValue;
            targetCommitments[index] = keccak256(
                abi.encode(
                    GRAPH_TARGET_COMMITMENT_TYPEHASH,
                    index,
                    target.targetIdHash,
                    target.applicantSalt,
                    target.deploymentValue,
                    target.initializerValue,
                    keccak256(target.initCode),
                    keccak256(target.initializerCalldata)
                )
            );
        }
        commitment = keccak256(
            abi.encode(
                GRAPH_COMMITMENT_TYPEHASH,
                block.chainid,
                address(this),
                authorization.routeNamespace,
                authorization.routeNonce,
                authorization.topologyHash,
                authorization.authorizedLauncher,
                authorization.totalValue,
                keccak256(abi.encode(targetCommitments))
            )
        );
    }

    function _deriveTargets(
        GraphAuthorization calldata authorization,
        Target[] calldata targets,
        GraphExecution memory execution
    ) private view {
        for (uint256 index; index < targets.length; ++index) {
            Target calldata target = targets[index];
            if (target.targetIdHash == bytes32(0) || target.initCode.length == 0) revert InvalidGraph();
            execution.salts[index] = _effectiveTargetSalt(authorization, target.targetIdHash, target.applicantSalt);
            execution.initCodeHashes[index] = keccak256(target.initCode);
            execution.initializerCalldataHashes[index] = keccak256(target.initializerCalldata);
            execution.deployments[index] = _computeAddress(execution.salts[index], execution.initCodeHashes[index]);
            if (execution.deployments[index].code.length != 0) revert InvalidGraph();
        }
    }

    function _deployTargets(Target[] calldata targets, GraphExecution memory execution) private {
        for (uint256 index; index < targets.length; ++index) {
            bytes memory creationCode = targets[index].initCode;
            address deployed;
            bytes32 salt = execution.salts[index];
            uint256 value = targets[index].deploymentValue;
            assembly ("memory-safe") {
                deployed := create2(value, add(creationCode, 0x20), mload(creationCode), salt)
            }
            if (deployed != execution.deployments[index]) revert InvalidGraph();
        }
    }

    function _initializeTargets(Target[] calldata targets, address[] memory deployments) private {
        for (uint256 index; index < targets.length; ++index) {
            if (targets[index].initializerCalldata.length == 0) continue;
            (bool success, bytes memory reason) =
                deployments[index].call{ value: targets[index].initializerValue }(targets[index].initializerCalldata);
            if (!success) revert InitializerFailed(index, reason);
        }
    }

    function _observeTargets(
        GraphAuthorization calldata authorization,
        Target[] calldata targets,
        GraphExecution memory execution
    ) private view returns (bytes32 accumulator) {
        accumulator = authorization.graphCommitment;
        for (uint256 index; index < targets.length; ++index) {
            execution.runtimeCodes[index] = execution.deployments[index].code;
            execution.runtimeCodeHashes[index] = keccak256(execution.runtimeCodes[index]);
            accumulator = _accumulateTarget(accumulator, index, targets[index], execution);
        }
    }

    function _accumulateTarget(bytes32 previous, uint256 index, Target calldata target, GraphExecution memory execution)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH,
                previous,
                index,
                target.targetIdHash,
                execution.deployments[index],
                execution.salts[index],
                execution.initCodeHashes[index],
                execution.initializerCalldataHashes[index],
                execution.runtimeCodeHashes[index],
                target.deploymentValue,
                target.initializerValue
            )
        );
    }

    function _effectiveTargetSalt(
        GraphAuthorization calldata authorization,
        bytes32 targetIdHash,
        bytes32 applicantSalt
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                TARGET_SALT_TYPEHASH,
                block.chainid,
                address(this),
                authorization.routeNamespace,
                authorization.routeNonce,
                targetIdHash,
                applicantSalt,
                authorization.authorizedLauncher
            )
        );
    }

    function _computeAddress(bytes32 salt, bytes32 initCodeHash) private view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}

contract ProgrammableCanaryReferenceToken is ERC20 {
    constructor(address recipient) ERC20("Programmable Canary Reference", "PCR") {
        _mint(recipient, 1_000_000 ether);
    }
}

contract ProgrammableCanaryReentrantLaunchWallet {
    uint256 public receivedAmount;
    address public lastSender;
    bool public reentrySucceeded;
    bytes4 public reentryRevertSelector;

    receive() external payable {
        receivedAmount += msg.value;
        lastSender = msg.sender;
        (bool success, bytes memory reason) = msg.sender
            .call(
                abi.encodeCall(
                    ProgrammableCanaryLiquidityInitializerV1.initialize,
                    (ProgrammableCanaryTokenV1(address(0)), PlatformFeeHookV1(address(0)), 0)
                )
            );
        reentrySucceeded = success;
        if (reason.length >= 4) {
            bytes4 selector;
            assembly ("memory-safe") {
                selector := mload(add(reason, 0x20))
            }
            reentryRevertSelector = selector;
        }
    }
}

contract ProgrammableCanaryRejectingLaunchWallet {
    bytes4 private constant LAUNCH_WALLET_SELECTOR = bytes4(keccak256("launchWallet()"));

    error NativeRefundRejected();

    receive() external payable {
        (bool success, bytes memory result) = msg.sender.staticcall(abi.encodeWithSelector(LAUNCH_WALLET_SELECTOR));
        if (success && result.length >= 32 && abi.decode(result, (address)) == address(this)) {
            revert NativeRefundRejected();
        }
    }
}

abstract contract ProgrammableGraphCanaryFixtureV1 is Deployers {
    using SafeCast for uint256;
    using StateLibrary for IPoolManager;

    uint256 internal constant FEE_DENOMINATOR = 1_000_000;
    uint256 internal constant MAX_HOOK_SALT_ATTEMPTS = 500_000;
    uint256 internal constant CANARY_TOKEN_LIQUIDITY_BUDGET = 1_000_000 ether;
    uint256 internal constant CANARY_NATIVE_LIQUIDITY_BUDGET = 0.001 ether;
    uint160 internal constant CANARY_ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 internal constant CANARY_REQUIRED_HOOK_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);
    address internal constant CANARY_PLATFORM_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    IPositionManager internal positionManager;
    IProgrammableCreate2GraphDeployerV1 internal graphFactory;
    ProgrammableCanaryLiquidityInitializerV1 internal initializer;
    ProgrammableCanaryTokenV1 internal token;
    PlatformFeeHookV1 internal hook;
    PoolKey internal hookKey;

    address internal launchWallet;
    address internal lpRecipient;
    address internal initializerPrefunder;
    uint256 internal graphDeployGasUsed;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function _launchCanary() internal {
        _launchCanaryWithConfiguration(
            makeAddr("programmableCanaryLaunchWallet"), makeAddr("programmableCanaryLpRecipient"), 0
        );
    }

    function _launchCanaryWithInitializerPrefund(uint256 initializerPrefund) internal {
        _launchCanaryWithConfiguration(
            makeAddr("programmableCanaryLaunchWallet"), makeAddr("programmableCanaryLpRecipient"), initializerPrefund
        );
    }

    function _launchCanaryWithConfiguration(address launchWallet_, address lpRecipient_, uint256 initializerPrefund)
        internal
    {
        launchWallet = launchWallet_;
        lpRecipient = lpRecipient_;
        vm.deal(address(this), 100 ether);

        IProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization =
            IProgrammableCreate2GraphDeployerV1.GraphAuthorization({
                routeNamespace: keccak256("programmable.mainnet-canary.v1"),
                routeNonce: keccak256(abi.encode(address(this), block.number, "canary-1")),
                topologyHash: keccak256("initializer,token,hook;initializer(token,hook)"),
                graphCommitment: bytes32(0),
                authorizedLauncher: address(this),
                totalValue: CANARY_NATIVE_LIQUIDITY_BUDGET
            });
        IProgrammableCreate2GraphDeployerV1.Target[] memory targets =
            new IProgrammableCreate2GraphDeployerV1.Target[](3);

        targets[0] = IProgrammableCreate2GraphDeployerV1.Target({
            targetIdHash: keccak256("programmable-canary-initializer-v1"),
            applicantSalt: keccak256("programmable-canary-initializer-salt-v1"),
            deploymentValue: 0,
            initializerValue: CANARY_NATIVE_LIQUIDITY_BUDGET,
            initCode: abi.encodePacked(
                type(ProgrammableCanaryLiquidityInitializerV1).creationCode,
                abi.encode(manager, positionManager, address(graphFactory), launchWallet, lpRecipient)
            ),
            initializerCalldata: bytes("")
        });
        address predictedInitializer = graphFactory.predictTarget(authorization, targets[0]);
        if (initializerPrefund != 0) {
            initializerPrefunder = makeAddr("programmableCanaryInitializerPrefunder");
            vm.deal(initializerPrefunder, initializerPrefund);
            vm.prank(initializerPrefunder);
            (bool success,) = payable(predictedInitializer).call{ value: initializerPrefund }("");
            assertTrue(success);
            assertEq(predictedInitializer.balance, initializerPrefund);
        }

        targets[1] = IProgrammableCreate2GraphDeployerV1.Target({
            targetIdHash: keccak256("programmable-canary-token-v1"),
            applicantSalt: keccak256("programmable-canary-token-salt-v1"),
            deploymentValue: 0,
            initializerValue: 0,
            initCode: abi.encodePacked(
                type(ProgrammableCanaryTokenV1).creationCode,
                abi.encode("Programmable Mainnet Canary", "PCAN", launchWallet, predictedInitializer)
            ),
            initializerCalldata: bytes("")
        });
        address predictedToken = graphFactory.predictTarget(authorization, targets[1]);

        targets[2] = IProgrammableCreate2GraphDeployerV1.Target({
            targetIdHash: keccak256("programmable-canary-hook-v1"),
            applicantSalt: bytes32(0),
            deploymentValue: 0,
            initializerValue: 0,
            initCode: abi.encodePacked(
                type(PlatformFeeHookV1).creationCode,
                abi.encode(
                    manager,
                    predictedInitializer,
                    CANARY_PLATFORM_FEE_RECIPIENT,
                    Currency.wrap(address(0)),
                    Currency.wrap(predictedToken)
                )
            ),
            initializerCalldata: bytes("")
        });
        address predictedHook = _mineHookTarget(authorization, targets[2]);

        uint256 deadline = block.timestamp + 1 days;
        targets[0].initializerCalldata = abi.encodeCall(
            ProgrammableCanaryLiquidityInitializerV1.initialize,
            (ProgrammableCanaryTokenV1(predictedToken), PlatformFeeHookV1(predictedHook), deadline)
        );
        uint256 valueSum;
        (authorization.graphCommitment, valueSum) = graphFactory.computeGraphCommitment(authorization, targets);
        assertEq(valueSum, authorization.totalValue);

        uint256 graphDeployGasBefore = gasleft();
        (
            address[] memory deployments,
            bytes32[] memory runtimeCodeHashes,
            bytes[] memory runtimeCodes,
            bytes32 graphDeploymentHash
        ) = graphFactory.deployGraph{ value: authorization.totalValue }(authorization, targets);
        graphDeployGasUsed = graphDeployGasBefore - gasleft();

        assertEq(deployments.length, 3);
        assertEq(deployments[0], predictedInitializer);
        assertEq(deployments[1], predictedToken);
        assertEq(deployments[2], predictedHook);
        assertTrue(graphDeploymentHash != bytes32(0));
        for (uint256 index; index < deployments.length; ++index) {
            assertGt(runtimeCodes[index].length, 0);
            assertEq(runtimeCodeHashes[index], deployments[index].codehash);
            assertEq(runtimeCodeHashes[index], keccak256(runtimeCodes[index]));
        }

        initializer = ProgrammableCanaryLiquidityInitializerV1(payable(predictedInitializer));
        token = ProgrammableCanaryTokenV1(predictedToken);
        hook = PlatformFeeHookV1(predictedHook);
        hookKey = hook.poolKey();
    }

    function _mineHookTarget(
        IProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
        IProgrammableCreate2GraphDeployerV1.Target memory target
    ) private returns (address predictedHook) {
        // Salt mining is an offchain manifest-construction step, not part of the Mainnet transaction.
        vm.pauseGasMetering();
        uint160 requiredFlags = CANARY_REQUIRED_HOOK_FLAGS;
        uint160 mask = CANARY_ALL_HOOK_MASK;
        for (uint256 attempt; attempt < MAX_HOOK_SALT_ATTEMPTS; ++attempt) {
            target.applicantSalt = bytes32(attempt);
            predictedHook = graphFactory.predictTarget(authorization, target);
            if ((uint160(predictedHook) & mask) == requiredFlags) {
                vm.resumeGasMetering();
                return predictedHook;
            }
        }
        vm.resumeGasMetering();
        revert("hook salt not found");
    }
}

contract ProgrammableGraphCanaryV1Test is ProgrammableGraphCanaryFixtureV1 {
    ProgrammableCanaryReferenceToken internal referenceToken;
    PoolKey internal referenceKey;

    function setUp() public {
        deployFreshManagerAndRouters();
        positionManager = IPositionManager(
            address(
                new PositionManager(
                    manager,
                    IAllowanceTransfer(address(0)),
                    uint256(0),
                    IPositionDescriptor(address(0)),
                    IWETH9(address(0))
                )
            )
        );
        graphFactory = new LocalProgrammableCreate2GraphDeployerV1();
        _launchCanary();
    }

    function test_graphLaunchIsTradableAndLeavesNoAmbiguousCustody() public view {
        assertTrue(initializer.initialized());
        assertEq(initializer.graphFactory(), address(graphFactory));
        assertEq(initializer.launchWallet(), launchWallet);
        assertEq(initializer.lpRecipient(), lpRecipient);
        assertEq(initializer.token(), address(token));
        assertEq(initializer.hook(), address(hook));
        assertEq(token.launchWallet(), launchWallet);
        assertEq(token.liquidityInitializer(), address(initializer));
        assertEq(token.totalSupply(), initializer.TOKEN_LIQUIDITY_BUDGET());

        assertEq(token.balanceOf(address(initializer)), 0);
        assertEq(address(initializer).balance, 0);
        assertEq(token.balanceOf(address(positionManager)), 0);
        assertEq(address(positionManager).balance, 0);
        assertEq(token.balanceOf(address(manager)), initializer.tokenLiquidityAmount());
        assertEq(address(manager).balance, initializer.nativeLiquidityAmount());
        assertEq(
            token.balanceOf(launchWallet), initializer.TOKEN_LIQUIDITY_BUDGET() - initializer.tokenLiquidityAmount()
        );
        assertEq(launchWallet.balance, initializer.NATIVE_LIQUIDITY_BUDGET() - initializer.nativeLiquidityAmount());
        assertEq(IERC721(address(positionManager)).ownerOf(initializer.positionTokenId()), lpRecipient);
        assertGt(positionManager.getPositionLiquidity(initializer.positionTokenId()), 0);
        assertGt(initializer.nativeLiquidityAmount(), 0);
        assertGt(initializer.tokenLiquidityAmount(), 0);

        (uint160 sqrtPriceX96, int24 tick,,) = StateLibrary.getSlot0(manager, hookKey.toId());
        assertEq(sqrtPriceX96, TickMath.getSqrtPriceAtTick(initializer.INITIAL_TICK()));
        assertEq(tick, initializer.INITIAL_TICK());
        assertEq(initializer.poolId(), hook.poolId());
    }

    function test_hookPermissionsAndExactOutputBasisAreExplicit() public view {
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.afterSwapReturnDelta);
        assertFalse(permissions.beforeSwap);
        assertFalse(permissions.beforeSwapReturnDelta);
        assertEq(hook.PLATFORM_FEE_PIPS(), 1000);
        assertEq(hook.feeRecipient(), initializer.PLATFORM_FEE_RECIPIENT());
        assertEq(hook.authorized(), address(initializer));
        assertEq(uint160(address(hook)) & initializer.ALL_HOOK_MASK(), initializer.REQUIRED_HOOK_FLAGS());
    }

    function test_exactInputNativeToTokenChargesTenBpsOnTokenOutput() public {
        _assertFeeSettlement(true, true);
    }

    function test_exactOutputNativeToTokenChargesTenBpsOnNativeInput() public {
        _assertFeeSettlement(true, false);
    }

    function test_exactInputTokenToNativeChargesTenBpsOnNativeOutput() public {
        _assertFeeSettlement(false, true);
    }

    function test_exactOutputTokenToNativeChargesTenBpsOnTokenInput() public {
        _assertFeeSettlement(false, false);
    }

    function test_rejectsReplayThroughTheSameGraphAuthorization() public {
        uint256 nativeBudget = initializer.NATIVE_LIQUIDITY_BUDGET();
        vm.deal(address(graphFactory), nativeBudget);
        vm.expectRevert(ProgrammableCanaryLiquidityInitializerV1.AlreadyInitialized.selector);
        vm.prank(address(graphFactory));
        initializer.initialize{ value: nativeBudget }(token, hook, block.timestamp + 1 days);
    }

    function test_rejectsCallerOtherThanExplicitGraphFactoryBeforeInspectingTargets() public {
        ProgrammableCanaryLiquidityInitializerV1 freshInitializer = _newUninitializedInitializer();
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCanaryLiquidityInitializerV1.UnauthorizedInitializer.selector,
                address(this),
                address(graphFactory)
            )
        );
        freshInitializer.initialize(ProgrammableCanaryTokenV1(address(0)), PlatformFeeHookV1(address(0)), 0);
    }

    function test_rejectsAnyInitializerValueOtherThanExactReviewedBudget() public {
        ProgrammableCanaryLiquidityInitializerV1 freshInitializer = _newUninitializedInitializer();
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCanaryLiquidityInitializerV1.InvalidValue.selector,
                freshInitializer.NATIVE_LIQUIDITY_BUDGET(),
                0
            )
        );
        vm.prank(address(graphFactory));
        freshInitializer.initialize(ProgrammableCanaryTokenV1(address(0)), PlatformFeeHookV1(address(0)), 0);
    }

    function test_rejectsExpiredCommittedDeadlineBeforeInspectingTargets() public {
        ProgrammableCanaryLiquidityInitializerV1 freshInitializer = _newUninitializedInitializer();
        uint256 nativeBudget = freshInitializer.NATIVE_LIQUIDITY_BUDGET();
        vm.warp(2);
        vm.deal(address(graphFactory), nativeBudget);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableCanaryLiquidityInitializerV1.DeadlineExpired.selector, 2, 1));
        vm.prank(address(graphFactory));
        freshInitializer.initialize{ value: nativeBudget }(
            ProgrammableCanaryTokenV1(address(0)), PlatformFeeHookV1(address(0)), 1
        );
    }

    function test_preexistingForcedNativeCannotChangeLiquidityOrBecomeResidualCustody() public {
        uint256 priorLaunchWalletBalance = launchWallet.balance;
        uint256 forcedNative = 123 wei;
        vm.deal(address(positionManager), forcedNative);
        vm.roll(block.number + 1);

        _launchCanary();

        assertEq(address(positionManager).balance, 0);
        assertEq(
            launchWallet.balance,
            priorLaunchWalletBalance + forcedNative + initializer.NATIVE_LIQUIDITY_BUDGET()
                - initializer.nativeLiquidityAmount()
        );
        assertEq(address(manager).balance, initializer.nativeLiquidityAmount() * 2);
    }

    function test_create2PrefundedInitializerStillLaunchesAndRefundsOnlySignedWallet() public {
        uint256 priorLaunchWalletBalance = launchWallet.balance;
        uint256 poolManagerNativeBefore = address(manager).balance;
        uint256 graphFactoryNativeBefore = address(graphFactory).balance;
        uint256 initializerPrefund = 1 wei;
        vm.roll(block.number + 1);

        _launchCanaryWithInitializerPrefund(initializerPrefund);

        assertEq(initializerPrefunder.balance, 0);
        assertEq(address(initializer).balance, 0);
        assertEq(address(positionManager).balance, 0);
        assertEq(address(graphFactory).balance, graphFactoryNativeBefore);
        assertEq(address(manager).balance - poolManagerNativeBefore, initializer.nativeLiquidityAmount());
        assertEq(
            launchWallet.balance,
            priorLaunchWalletBalance + initializerPrefund + initializer.NATIVE_LIQUIDITY_BUDGET()
                - initializer.nativeLiquidityAmount()
        );
        assertEq(lpRecipient.balance, 0);
    }

    function test_signedLaunchWalletCallbackCannotReenterInitializerRefund() public {
        ProgrammableCanaryReentrantLaunchWallet reentrantWallet = new ProgrammableCanaryReentrantLaunchWallet();
        address reentrantLpRecipient = makeAddr("programmableCanaryReentrantLpRecipient");
        uint256 initializerPrefund = 1 wei;
        vm.roll(block.number + 1);

        _launchCanaryWithConfiguration(address(reentrantWallet), reentrantLpRecipient, initializerPrefund);

        assertEq(address(initializer).balance, 0);
        assertEq(reentrantWallet.lastSender(), address(initializer));
        assertFalse(reentrantWallet.reentrySucceeded());
        assertEq(reentrantWallet.reentryRevertSelector(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(
            reentrantWallet.receivedAmount(),
            initializerPrefund + initializer.NATIVE_LIQUIDITY_BUDGET() - initializer.nativeLiquidityAmount()
        );
        assertEq(IERC721(address(positionManager)).ownerOf(initializer.positionTokenId()), reentrantLpRecipient);
    }

    function test_rejectedInitializerPrefundRefundFailsClosedAndRollsBackGraph() public {
        ProgrammableCanaryRejectingLaunchWallet rejectingWallet = new ProgrammableCanaryRejectingLaunchWallet();
        address rejectingLpRecipient = makeAddr("programmableCanaryRejectingLpRecipient");
        uint256 nextTokenIdBefore = positionManager.nextTokenId();
        uint256 poolManagerNativeBefore = address(manager).balance;
        uint256 graphFactoryNativeBefore = address(graphFactory).balance;
        vm.roll(block.number + 1);

        bool reverted;
        try this.launchCanaryForFailClosedTest(address(rejectingWallet), rejectingLpRecipient, 1 wei) {
            fail();
        } catch (bytes memory reason) {
            reverted = true;
            assertEq(bytes4(reason), LocalProgrammableCreate2GraphDeployerV1.InitializerFailed.selector);
        }

        assertTrue(reverted);
        assertEq(address(rejectingWallet).balance, 0);
        assertEq(positionManager.nextTokenId(), nextTokenIdBefore);
        assertEq(address(manager).balance, poolManagerNativeBefore);
        assertEq(address(graphFactory).balance, graphFactoryNativeBefore);
    }

    function launchCanaryForFailClosedTest(address launchWallet_, address lpRecipient_, uint256 initializerPrefund)
        external
    {
        require(msg.sender == address(this));
        _launchCanaryWithConfiguration(launchWallet_, lpRecipient_, initializerPrefund);
    }

    function _newUninitializedInitializer()
        private
        returns (ProgrammableCanaryLiquidityInitializerV1 freshInitializer)
    {
        freshInitializer = new ProgrammableCanaryLiquidityInitializerV1(
            manager, positionManager, address(graphFactory), launchWallet, lpRecipient
        );
    }

    function _assertFeeSettlement(bool zeroForOne, bool exactInput) private {
        _seedReferencePool();
        address trader = makeAddr("programmableCanaryTrader");
        vm.deal(trader, 10 ether);

        if (!zeroForOne) _primeTraderForSell(trader);

        uint256 amount;
        if (zeroForOne && exactInput) amount = 10 gwei;
        if (zeroForOne && !exactInput) amount = 1 ether;
        if (!zeroForOne && exactInput) amount = 1 ether;
        if (!zeroForOne && !exactInput) amount = 1 gwei;
        int256 signedAmount = SafeCast.toInt256(amount);
        int256 amountSpecified = exactInput ? -signedAmount : signedAmount;
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        bool feeInCurrency1 = exactInput == zeroForOne;
        Currency feeCurrency = feeInCurrency1 ? hookKey.currency1 : hookKey.currency0;
        uint256 claimsBefore = manager.balanceOf(address(hook), feeCurrency.toId());

        BalanceDelta hookDelta = _swapAs(trader, hookKey, params);
        BalanceDelta referenceDelta = _swapReferenceAs(trader, params);
        hookDelta;

        int128 referenceUnspecified = feeInCurrency1 ? referenceDelta.amount1() : referenceDelta.amount0();
        uint256 absoluteUnspecified =
            referenceUnspecified < 0 ? uint256(-int256(referenceUnspecified)) : uint256(int256(referenceUnspecified));
        uint256 expectedFee = FullMath.mulDiv(absoluteUnspecified, hook.PLATFORM_FEE_PIPS(), FEE_DENOMINATOR);
        uint256 actualFee = manager.balanceOf(address(hook), feeCurrency.toId()) - claimsBefore;
        assertEq(actualFee, expectedFee);
        assertGt(actualFee, 0);

        uint256 recipientBefore = feeCurrency.balanceOf(initializer.PLATFORM_FEE_RECIPIENT());
        vm.prank(makeAddr("permissionlessCanaryFeeCollector"));
        hook.handleHookFees(new Currency[](0));
        assertEq(
            feeCurrency.balanceOf(initializer.PLATFORM_FEE_RECIPIENT()), recipientBefore + claimsBefore + actualFee
        );
    }

    function _seedReferencePool() private {
        if (address(referenceToken) != address(0)) return;
        referenceToken = new ProgrammableCanaryReferenceToken(address(this));
        referenceKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(referenceToken)),
            fee: initializer.LP_FEE_PIPS(),
            tickSpacing: initializer.TICK_SPACING(),
            hooks: PlatformFeeHookV1(address(0))
        });
        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(initializer.INITIAL_TICK());
        manager.initialize(referenceKey, initialSqrtPriceX96);

        PositionDefinition[] memory definitions = new PositionDefinition[](0);
        CurrencyAmounts memory available = CurrencyAmounts({
            amount0: initializer.NATIVE_LIQUIDITY_BUDGET(), amount1: initializer.TOKEN_LIQUIDITY_BUDGET()
        });
        (Position[] memory positions,) = PositionPlanner.resolve(
            definitions, initialSqrtPriceX96, initializer.TICK_SPACING(), available, address(this)
        );
        assertEq(positions.length, 1);
        Plan memory plan = PositionPlanner.toPlan(positions, referenceKey, address(this));
        referenceToken.transfer(address(positionManager), initializer.TOKEN_LIQUIDITY_BUDGET());
        positionManager.modifyLiquidities{ value: initializer.NATIVE_LIQUIDITY_BUDGET() }(
            abi.encode(plan.actions, plan.params), block.timestamp + 1 days
        );
    }

    function _primeTraderForSell(address trader) private {
        SwapParams memory buy = SwapParams({
            zeroForOne: true, amountSpecified: -int256(100 gwei), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
        _swapAs(trader, hookKey, buy);
        _swapReferenceAs(trader, buy);
    }

    function _swapAs(address trader, PoolKey memory key, SwapParams memory params)
        private
        returns (BalanceDelta delta)
    {
        vm.startPrank(trader);
        IERC20(Currency.unwrap(key.currency1)).approve(address(swapRouter), type(uint256).max);
        uint256 value = params.zeroForOne ? 1 ether : 0;
        delta = swapRouter.swap{ value: value }(key, params, settings, "");
        vm.stopPrank();
    }

    function _swapReferenceAs(address trader, SwapParams memory params) private returns (BalanceDelta delta) {
        vm.startPrank(trader);
        referenceToken.approve(address(swapRouter), type(uint256).max);
        uint256 value = params.zeroForOne ? 1 ether : 0;
        delta = swapRouter.swap{ value: value }(referenceKey, params, settings, "");
        vm.stopPrank();
    }
}

contract ProgrammableCanaryTokenV1FuzzTest is Test {
    function testFuzz_entireFixedSupplyGoesOnlyToExplicitInitializer(address wallet, address liquidityInitializer)
        public
    {
        vm.assume(wallet != address(0));
        vm.assume(liquidityInitializer != address(0));
        ProgrammableCanaryTokenV1 token =
            new ProgrammableCanaryTokenV1("Programmable Canary", "PCAN", wallet, liquidityInitializer);
        assertEq(token.totalSupply(), token.TOTAL_SUPPLY());
        assertEq(token.balanceOf(liquidityInitializer), token.TOTAL_SUPPLY());
        if (wallet != liquidityInitializer) assertEq(token.balanceOf(wallet), 0);
        assertEq(token.launchWallet(), wallet);
        assertEq(token.liquidityInitializer(), liquidityInitializer);
    }
}

contract ProgrammableGraphCanaryV1MainnetForkTest is ProgrammableGraphCanaryFixtureV1 {
    address internal constant MAINNET_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant MAINNET_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant MAINNET_GRAPH_FACTORY = 0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887;
    bytes32 internal constant POOL_MANAGER_RUNTIME_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 internal constant POSITION_MANAGER_RUNTIME_HASH =
        0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b;
    bytes32 internal constant GRAPH_FACTORY_RUNTIME_HASH =
        0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8;

    function test_mainnetForkDeploysTheExactTradableGraphThroughTheLiveFactory() public {
        string memory rpcUrl = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpcUrl);

        assertEq(MAINNET_POOL_MANAGER.codehash, POOL_MANAGER_RUNTIME_HASH);
        assertEq(MAINNET_POSITION_MANAGER.codehash, POSITION_MANAGER_RUNTIME_HASH);
        assertEq(MAINNET_GRAPH_FACTORY.codehash, GRAPH_FACTORY_RUNTIME_HASH);

        manager = IPoolManager(MAINNET_POOL_MANAGER);
        positionManager = IPositionManager(MAINNET_POSITION_MANAGER);
        graphFactory = IProgrammableCreate2GraphDeployerV1(MAINNET_GRAPH_FACTORY);
        swapRouter = new PoolSwapTest(manager);
        uint256 poolManagerNativeBefore = MAINNET_POOL_MANAGER.balance;
        uint256 graphFactoryNativeBefore = MAINNET_GRAPH_FACTORY.balance;
        uint256 initializerPrefund = 1 wei;
        _launchCanaryWithInitializerPrefund(initializerPrefund);
        emit log_named_uint("Live Graph deploy plus LP call gas", graphDeployGasUsed);

        assertEq(IERC721(MAINNET_POSITION_MANAGER).ownerOf(initializer.positionTokenId()), lpRecipient);
        assertGt(positionManager.getPositionLiquidity(initializer.positionTokenId()), 0);
        assertEq(MAINNET_POOL_MANAGER.balance - poolManagerNativeBefore, initializer.nativeLiquidityAmount());
        assertEq(MAINNET_GRAPH_FACTORY.balance, graphFactoryNativeBefore);
        assertEq(token.balanceOf(MAINNET_POOL_MANAGER), initializer.tokenLiquidityAmount());
        assertEq(
            token.balanceOf(launchWallet), initializer.TOKEN_LIQUIDITY_BUDGET() - initializer.tokenLiquidityAmount()
        );
        assertEq(
            launchWallet.balance,
            initializerPrefund + initializer.NATIVE_LIQUIDITY_BUDGET() - initializer.nativeLiquidityAmount()
        );
        assertEq(initializerPrefunder.balance, 0);
        assertEq(token.balanceOf(address(initializer)), 0);
        assertEq(address(initializer).balance, 0);
        assertEq(hook.feeRecipient(), initializer.PLATFORM_FEE_RECIPIENT());
        assertEq(uint160(address(hook)) & initializer.ALL_HOOK_MASK(), initializer.REQUIRED_HOOK_FLAGS());

        address trader = makeAddr("programmableCanaryMainnetForkTrader");
        vm.deal(trader, 1 ether);
        Currency feeCurrency = hookKey.currency1;
        uint256 feeClaimsBefore = manager.balanceOf(address(hook), feeCurrency.toId());
        uint256 recipientBalanceBefore = token.balanceOf(initializer.PLATFORM_FEE_RECIPIENT());
        SwapParams memory params = SwapParams({
            zeroForOne: true, amountSpecified: -int256(10 gwei), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
        vm.prank(trader);
        BalanceDelta delta = swapRouter.swap{ value: 10 gwei }(hookKey, params, settings, "");
        assertEq(delta.amount0(), -int128(int256(10 gwei)));
        assertGt(delta.amount1(), 0);
        uint256 collectedFee = manager.balanceOf(address(hook), feeCurrency.toId()) - feeClaimsBefore;
        assertGt(collectedFee, 0);

        vm.prank(makeAddr("permissionlessMainnetForkFeeCollector"));
        hook.handleHookFees(new Currency[](0));
        assertEq(token.balanceOf(initializer.PLATFORM_FEE_RECIPIENT()), recipientBalanceBefore + collectedFee);
    }
}
