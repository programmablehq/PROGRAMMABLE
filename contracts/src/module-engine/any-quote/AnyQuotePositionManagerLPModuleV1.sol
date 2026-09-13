// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Pool } from "@uniswap/v4-core/src/libraries/Pool.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IImmutableState } from "@uniswap/v4-periphery/src/interfaces/IImmutableState.sol";
import { Permit2Forwarder } from "@uniswap/v4-periphery/src/base/Permit2Forwarder.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { IUniversalRouter } from "@uniswap/universal-router/contracts/interfaces/IUniversalRouter.sol";
import { Commands } from "@uniswap/universal-router/contracts/libraries/Commands.sol";
import { IV4Router } from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import { ModuleEngineBaseV1 } from "../ModuleEngineBaseV1.sol";
import { ModuleEngineTypesV1 as T } from "../ModuleEngineTypesV1.sol";
import { AnyQuoteTypesV1 as A } from "./AnyQuoteTypesV1.sol";
import { IAnyQuoteSharedHookV1 } from "./IAnyQuoteSharedHookV1.sol";

/// @notice Immutable custodian of one canonical Uniswap V4 PositionManager NFT on Chain 4663.
/// @dev All initial primary inventory is permanently held in that position or as protected rounding dust.
/// There is no NFT approval, transfer, withdrawal, signature validation, upgrade or generic call entrypoint.
/// The shared hook and ledger retain the existing quote-denominated fee policy for every ordinary V4 swap.
contract AnyQuotePositionManagerLPModuleV1 is ModuleEngineBaseV1, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 public constant BUY = keccak256("spot.buy.exact-input.v1");
    bytes32 public constant SELL = keccak256("spot.sell.exact-input.v1");
    bytes32 public constant HOST_PROFILE = A.PROFILE_ID;
    bytes32 public constant LP_CUSTODY_SCHEMA_ID = keccak256("programmable.any-quote.position-manager-custody.v1");
    uint256 public constant CHAIN_ID = A.CHAIN_ID;
    uint256 public constant TOKEN_SUPPLY = A.TOKEN_SUPPLY;
    int24 public constant TICK_SPACING = A.TICK_SPACING;

    // Fixed singleton identities from contracts/spec/robinhood-custom-launch/chain-4663.v1.json.
    address public constant CANONICAL_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    bytes32 public constant CANONICAL_POOL_MANAGER_CODE_HASH =
        0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;
    IPositionManager public constant positionManager = IPositionManager(0x58daec3116aae6D93017bAAea7749052E8a04fA7);
    bytes32 public constant POSITION_MANAGER_CODE_HASH =
        0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2;
    IUniversalRouter public constant universalRouter = IUniversalRouter(0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99);
    bytes32 public constant UNIVERSAL_ROUTER_CODE_HASH =
        0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5;
    IAllowanceTransfer public constant permit2 = IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    bytes32 public constant PERMIT2_CODE_HASH = 0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca;

    IPoolManager public immutable poolManager;
    address public immutable sharedHook;
    bytes32 public immutable poolManagerCodeHash;
    int24 public immutable initialTick;
    // Only direct constructor words are compiler immutables, preserving the existing host admission ABI.
    bytes32 public configurationHash;
    bytes32 public hostCodeHash;
    bytes32 public sharedHookCodeHash;
    bytes32 public primaryCodeHash;
    bytes32 public quoteCodeHash;
    bytes32 public poolId;
    uint8 public quoteDecimals;
    int24 public tickLower;
    int24 public tickUpper;
    uint128 public lockedLiquidity;
    uint256 public lockedTokenDust;
    uint256 public positionTokenId;

    error InvalidConfiguration();
    error WrongChain();
    error InvalidOperation();
    error UnsupportedPriceLimit();
    error InvalidPool();
    error InvalidSettlement();
    error DeadlineExpired();

    constructor(T.Context memory context_, bytes memory configuration) ModuleEngineBaseV1(context_) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (configuration.length != 256) revert InvalidConfiguration();
        A.Configuration memory config = abi.decode(configuration, (A.Configuration));
        if (config.validUntil == 0 || block.timestamp > config.validUntil) revert DeadlineExpired();
        if (
            config.schemaId != A.SCHEMA_ID || config.priceEvidenceHash == bytes32(0)
                || config.quoteAsset != context_.quoteAsset || config.poolManager != CANONICAL_POOL_MANAGER
                || config.poolManagerCodeHash != CANONICAL_POOL_MANAGER_CODE_HASH || context_.token.code.length == 0
                || context_.quoteAsset.code.length == 0 || context_.host.code.length == 0
                || config.sharedHook.code.length == 0 || config.sharedHook == context_.host
                || _isPeriphery(config.sharedHook) || _isPeriphery(context_.host) || _isPeriphery(context_.token)
                || _isPeriphery(context_.quoteAsset) || context_.token == config.sharedHook
                || context_.quoteAsset == config.sharedHook || config.initialTick % TICK_SPACING != 0
                || config.initialTick <= TickMath.minUsableTick(TICK_SPACING)
                || config.initialTick >= TickMath.maxUsableTick(TICK_SPACING)
        ) revert InvalidConfiguration();
        _checkPeriphery();
        IAnyQuoteSharedHookV1 hook = IAnyQuoteSharedHookV1(config.sharedHook);
        address ledger = hook.ledger();
        if (
            hook.host() != context_.host
                || address(IImmutableState(config.sharedHook).poolManager()) != config.poolManager
                || ledger.code.length == 0 || context_.feeCollector != ledger
        ) revert InvalidConfiguration();
        uint8 decimals_ = IERC20Metadata(context_.quoteAsset).decimals();
        if (
            decimals_ > 36 || IERC20Metadata(context_.token).decimals() != 18
                || IERC20(context_.quoteAsset).totalSupply() == 0
                || IERC20(context_.token).totalSupply() != TOKEN_SUPPLY
        ) revert InvalidConfiguration();

        poolManager = IPoolManager(config.poolManager);
        sharedHook = config.sharedHook;
        configurationHash = keccak256(configuration);
        poolManagerCodeHash = config.poolManagerCodeHash;
        hostCodeHash = context_.host.codehash;
        sharedHookCodeHash = config.sharedHook.codehash;
        primaryCodeHash = context_.token.codehash;
        quoteCodeHash = context_.quoteAsset.codehash;
        quoteDecimals = decimals_;
        initialTick = config.initialTick;
        bool quote0 = context_.quoteAsset < context_.token;
        int24 lower = quote0 ? TickMath.minUsableTick(TICK_SPACING) : config.initialTick;
        int24 upper = quote0 ? config.initialTick : TickMath.maxUsableTick(TICK_SPACING);
        tickLower = lower;
        tickUpper = upper;
        uint160 lowerPrice = TickMath.getSqrtPriceAtTick(lower);
        uint160 upperPrice = TickMath.getSqrtPriceAtTick(upper);
        uint128 liquidity = quote0
            ? LiquidityAmounts.getLiquidityForAmount1(lowerPrice, upperPrice, TOKEN_SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount0(lowerPrice, upperPrice, TOKEN_SUPPLY);
        if (liquidity == 0 || liquidity > Pool.tickSpacingToMaxLiquidityPerTick(TICK_SPACING)) {
            revert InvalidConfiguration();
        }
        lockedLiquidity = liquidity;
        poolId = PoolId.unwrap(poolKey().toId());
    }

    function poolKey() public view returns (PoolKey memory) {
        bool quote0 = _context.quoteAsset < _context.token;
        return PoolKey({
            currency0: Currency.wrap(quote0 ? _context.quoteAsset : _context.token),
            currency1: Currency.wrap(quote0 ? _context.token : _context.quoteAsset),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(sharedHook)
        });
    }

    function _initialize(bytes calldata launchData) internal override nonReentrant returns (bytes32) {
        _checkDependencies();
        if (
            launchData.length != 0 || IERC20(_context.token).balanceOf(address(this)) != TOKEN_SUPPLY
                || IERC20(_context.token).totalSupply() != TOKEN_SUPPLY
        ) revert InvalidConfiguration();
        A.PoolRegistration memory registered = IAnyQuoteSharedHookV1(sharedHook).poolConfig(poolId);
        if (
            registered.initializer != address(this) || registered.launchId != _context.launchId
                || registered.token != _context.token || registered.quoteAsset != _context.quoteAsset
                || registered.initialTick != initialTick || registered.configurationHash != configurationHash
                || PoolId.unwrap(IAnyQuoteSharedHookV1(sharedHook).poolKey(poolId).toId()) != poolId
        ) revert InvalidPool();

        // The existing hook authorizes this engine as initializer. PositionManager.initializePool would
        // present the PositionManager as sender, so initialization remains this direct canonical core call.
        if (poolManager.initialize(poolKey(), TickMath.getSqrtPriceAtTick(initialTick)) != initialTick) {
            revert InvalidPool();
        }
        _mintLockedPosition();
        return keccak256(
            abi.encode(
                LP_CUSTODY_SCHEMA_ID,
                positionManager,
                positionTokenId,
                poolId,
                tickLower,
                tickUpper,
                lockedLiquidity,
                lockedTokenDust,
                quoteDecimals
            )
        );
    }

    function _mintLockedPosition() private {
        uint160 lowerPrice = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 upperPrice = TickMath.getSqrtPriceAtTick(tickUpper);
        bool quote0 = _context.quoteAsset < _context.token;
        uint256 debt = quote0
            ? SqrtPriceMath.getAmount1Delta(lowerPrice, upperPrice, lockedLiquidity, true)
            : SqrtPriceMath.getAmount0Delta(lowerPrice, upperPrice, lockedLiquidity, true);
        if (debt == 0 || debt > TOKEN_SUPPLY) revert InvalidSettlement();
        IERC20 primary = IERC20(_context.token);
        uint256 managerBefore = primary.balanceOf(address(poolManager));
        uint256 quoteBefore = IERC20(_context.quoteAsset).balanceOf(address(this));
        bool granted = _authorize(_context.token, address(positionManager), debt);

        // Official PositionManager uses _mint, not safeMint: no ERC721 receiver callback is expected.
        // The NFT ID is captured for this one mint; unsolicited NFTs cannot replace the tracked resource.
        uint256 tokenId = positionManager.nextTokenId();
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            poolKey(),
            tickLower,
            tickUpper,
            uint256(lockedLiquidity),
            uint128(quote0 ? 0 : debt),
            uint128(quote0 ? debt : 0),
            address(this),
            bytes("")
        );
        params[1] = abi.encode(poolKey().currency0, poolKey().currency1);
        positionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR)), params),
            block.timestamp
        );
        _revoke(_context.token, address(positionManager), granted);
        if (
            primary.balanceOf(address(this)) != TOKEN_SUPPLY - debt
                || primary.balanceOf(address(poolManager)) != managerBefore + debt
                || IERC20(_context.quoteAsset).balanceOf(address(this)) != quoteBefore
                || positionManager.nextTokenId() != tokenId + 1
                || IERC721(address(positionManager)).ownerOf(tokenId) != address(this)
                || IERC721(address(positionManager)).getApproved(tokenId) != address(0)
                || positionManager.getPositionLiquidity(tokenId) != lockedLiquidity
        ) revert InvalidSettlement();
        (PoolKey memory key, PositionInfo info) = positionManager.getPoolAndPositionInfo(tokenId);
        if (
            PoolId.unwrap(key.toId()) != poolId || info.tickLower() != tickLower || info.tickUpper() != tickUpper
                || info.hasSubscriber()
        ) revert InvalidPool();
        positionTokenId = tokenId;
        lockedTokenDust = TOKEN_SUPPLY - debt;
    }

    /// @dev Optional host-prefunded adapter. Every swap and settlement executes in canonical UR 2.1.1.
    /// The host binds actor, nonce and input funding. Shared-hook deltas already include both quote fees.
    function _execute(T.Operation calldata op) internal override nonReentrant returns (bytes memory) {
        if (op.operationId != BUY && op.operationId != SELL) revert InvalidOperation();
        bool buy = op.operationId == BUY;
        if (op.deadline == 0 || op.deadline < block.timestamp) revert DeadlineExpired();
        if (
            op.inputAmount == 0 || op.inputAmount > uint256(uint128(type(int128).max)) || op.minimumOutput == 0
                || op.minimumOutput > type(uint128).max || msg.value != 0 || op.actor == address(0)
                || op.recipient == address(0) || op.recipient == address(this) || _isPeriphery(op.recipient)
                || op.recipient == _context.host || op.recipient == sharedHook || op.recipient == _context.feeCollector
                || op.inputAsset != (buy ? _context.quoteAsset : _context.token)
                || op.outputAsset != (buy ? _context.token : _context.quoteAsset) || op.data.length != 32
        ) revert InvalidOperation();
        // UR does not expose core sqrtPriceLimitX96. Never silently reinterpret it as minHopPriceX36.
        if (abi.decode(op.data, (uint160)) != 0) revert UnsupportedPriceLimit();
        _checkDependencies();
        uint256 quoteBefore = IERC20(_context.quoteAsset).balanceOf(address(this));
        uint256 tokenBefore = IERC20(_context.token).balanceOf(address(this));
        if (
            tokenBefore < lockedTokenDust
                || (buy ? quoteBefore < op.inputAmount : tokenBefore - lockedTokenDust < op.inputAmount)
        ) revert InvalidSettlement();
        uint256 managerOutputBefore = IERC20(op.outputAsset).balanceOf(address(poolManager));
        bool granted = _authorize(op.inputAsset, address(universalRouter), op.inputAmount);
        _swap(op, buy);
        _revoke(op.inputAsset, address(universalRouter), granted);
        uint256 outputBefore = buy ? tokenBefore : quoteBefore;
        uint256 outputAfter = IERC20(op.outputAsset).balanceOf(address(this));
        if (outputAfter < outputBefore || outputAfter - outputBefore < op.minimumOutput) revert InvalidSettlement();
        uint256 output = outputAfter - outputBefore;
        // Core deltas do not attest to an ERC20 recipient's actual credit. Preserve exact settlement on
        // core -> engine as well as engine -> recipient, including tokens that tax only the first leg.
        if (
            output > managerOutputBefore
                || IERC20(op.outputAsset).balanceOf(address(poolManager)) != managerOutputBefore - output
        ) revert InvalidSettlement();
        _transferOutputExactly(op.outputAsset, op.recipient, output);
        if (
            IERC20(_context.quoteAsset).balanceOf(address(this)) != quoteBefore - (buy ? op.inputAmount : 0)
                || IERC20(_context.token).balanceOf(address(this)) != tokenBefore - (buy ? 0 : op.inputAmount)
        ) revert InvalidSettlement();
        return abi.encode(output);
    }

    function _swap(T.Operation calldata op, bool buy) private {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: poolKey(),
                zeroForOne: buy == (_context.quoteAsset < _context.token),
                amountIn: uint128(op.inputAmount),
                amountOutMinimum: uint128(op.minimumOutput),
                minHopPriceX36: 0,
                hookData: ""
            })
        );
        params[1] = abi.encode(op.inputAsset, op.inputAmount);
        // TAKE_ALL pays the router's authenticated msgSender, this engine. No singleton balance is swept.
        params[2] = abi.encode(op.outputAsset, op.minimumOutput);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)),
            params
        );
        universalRouter.execute(abi.encodePacked(uint8(Commands.V4_SWAP)), inputs, op.deadline);
    }

    function _authorize(address asset, address spender, uint256 amount) private returns (bool granted) {
        // Canonical UERC20/Solady fixes token -> Permit2 allowance at infinity and rejects approve(0).
        // Preserve that token-level default. The spendable Permit2 -> singleton amount is always exact.
        IERC20 token = IERC20(asset);
        if (token.allowance(address(this), address(permit2)) != type(uint256).max) {
            token.forceApprove(address(permit2), amount);
            granted = true;
        }
        (uint160 beforeAmount,,) = permit2.allowance(address(this), asset, spender);
        if (beforeAmount != 0) revert InvalidSettlement();
        // Permit2 expiration=0 means this block's timestamp, not an unlimited expiration.
        permit2.approve(asset, spender, uint160(amount), 0);
    }

    function _revoke(address asset, address spender, bool granted) private {
        permit2.approve(asset, spender, 0, 0);
        if (granted) IERC20(asset).forceApprove(address(permit2), 0);
    }

    function _transferOutputExactly(address asset, address recipient, uint256 amount) private {
        IERC20 token = IERC20(asset);
        uint256 beforeBalance = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        if (token.balanceOf(recipient) != beforeBalance + amount) revert InvalidSettlement();
    }

    function _checkDependencies() private view {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        _checkPeriphery();
        if (
            _context.host.codehash != hostCodeHash || sharedHook.codehash != sharedHookCodeHash
                || _context.token.codehash != primaryCodeHash || _context.quoteAsset.codehash != quoteCodeHash
                || IERC20Metadata(_context.quoteAsset).decimals() != quoteDecimals
        ) revert InvalidConfiguration();
    }

    function _checkPeriphery() private view {
        if (
            CANONICAL_POOL_MANAGER.codehash != CANONICAL_POOL_MANAGER_CODE_HASH
                || address(positionManager).codehash != POSITION_MANAGER_CODE_HASH
                || address(universalRouter).codehash != UNIVERSAL_ROUTER_CODE_HASH
                || address(permit2).codehash != PERMIT2_CODE_HASH
                || address(positionManager.poolManager()) != CANONICAL_POOL_MANAGER
                || address(Permit2Forwarder(address(positionManager)).permit2()) != address(permit2)
                || address(IImmutableState(address(universalRouter)).poolManager()) != CANONICAL_POOL_MANAGER
        ) revert InvalidConfiguration();
    }

    function _isPeriphery(address target) private pure returns (bool) {
        return target == CANONICAL_POOL_MANAGER || target == address(positionManager)
            || target == address(universalRouter) || target == address(permit2);
    }
}
