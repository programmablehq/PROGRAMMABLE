// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Pool } from "@uniswap/v4-core/src/libraries/Pool.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IV4Router } from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { FoundationTypesV1 as T } from "./FoundationTypesV1.sol";
import { FoundationTokenV1 } from "./FoundationTokenV1.sol";
import { FoundationHookV2 } from "./FoundationHookV2.sol";
import { FoundationHookDeployerV2 } from "./FoundationHookDeployerV2.sol";
import { FoundationLaunchTypesV2 as L } from "./FoundationLaunchTypesV2.sol";
import { FoundationLaunchTypesV3 as P } from "./FoundationLaunchTypesV3.sol";
import { IFoundationUniversalRouterV2, IFoundationPositionPermit2V2 } from "./FoundationFactoryV2.sol";

/// @notice Atomic launch with independently fixed buy/sell creator fees using official Core, PositionManager and UR
/// 2.1.1.
/// @dev Both launch-created position NFTs and token rounding inventory are minted/transferred directly to DEAD.
/// The separate V1 hook fee ledger remains payable. No NFT management or LP fee-collection right is retained.
contract FoundationFactoryV3 is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    bytes32 public constant VERSION_ID = keccak256("programmable.module-foundation.factory.v3");
    bytes32 public constant MODULE_ABI_ID = T.ABI_ID;
    bytes32 public constant LP_CUSTODY_ID = keccak256("programmable.module-foundation.launch-nfts.dead.v1");
    address public constant LP_RECIPIENT = 0x000000000000000000000000000000000000dEaD;
    address public constant ROUNDING_INVENTORY_RECIPIENT = LP_RECIPIENT;
    uint24 public constant LP_FEE = T.LP_FEE;
    uint256 public immutable chainId;
    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IFoundationUniversalRouterV2 public immutable universalRouter;
    IAllowanceTransfer public immutable permit2;
    FoundationHookDeployerV2 public immutable hookDeployer;
    bytes32 public immutable poolManagerCodeHash;
    bytes32 public immutable positionManagerCodeHash;
    bytes32 public immutable universalRouterCodeHash;
    bytes32 public immutable permit2CodeHash;
    bytes32 public immutable hookDeployerCodeHash;
    mapping(address => L.LaunchResultV2) private _launches;

    struct PositionPlan {
        int24 lower;
        int24 upper;
        uint128 liquidity;
        uint128 debt;
        bool asset0;
    }

    error InvalidInfrastructure();
    error InvalidConfiguration();
    error InvalidSettlement();
    error DeadlineExpired();

    event FoundationLaunchedV3(
        address indexed token,
        address indexed creator,
        bytes32 indexed poolId,
        address hook,
        address ledger,
        address quote,
        bytes32 metadataHash,
        bytes32 compositionHash,
        bytes32 custodyId,
        uint256 initialBuyQuoteAmount,
        L.LaunchResultV2 result
    );

    constructor(
        IPoolManager manager,
        IPositionManager positions,
        IFoundationUniversalRouterV2 router,
        IAllowanceTransfer permits,
        FoundationHookDeployerV2 deployer,
        bytes32[5] memory expectedCodeHashes
    ) {
        chainId = block.chainid;
        poolManager = manager;
        positionManager = positions;
        universalRouter = router;
        permit2 = permits;
        hookDeployer = deployer;
        poolManagerCodeHash = expectedCodeHashes[0];
        positionManagerCodeHash = expectedCodeHashes[1];
        universalRouterCodeHash = expectedCodeHashes[2];
        permit2CodeHash = expectedCodeHashes[3];
        hookDeployerCodeHash = expectedCodeHashes[4];
        if (
            address(manager).code.length == 0 || address(positions).code.length == 0 || address(router).code.length == 0
                || address(permits).code.length == 0 || address(deployer).code.length == 0
        ) revert InvalidInfrastructure();
        _verifyInfrastructure();
        if (
            address(positions.poolManager()) != address(manager) || address(router.poolManager()) != address(manager)
                || address(IFoundationPositionPermit2V2(address(positions)).permit2()) != address(permits)
        ) {
            revert InvalidInfrastructure();
        }
    }

    function launch(P.LaunchParamsV3 calldata p) external nonReentrant returns (L.LaunchResultV2 memory result) {
        return _launch(p, bytes(""));
    }

    function _launch(P.LaunchParamsV3 calldata p, bytes memory fundingData)
        internal
        returns (L.LaunchResultV2 memory result)
    {
        _verifyInfrastructure();
        if (p.deadline < block.timestamp) revert DeadlineExpired();
        if (
            p.quote.code.length == 0 || p.quoteDecimals > 36 || IERC20Metadata(p.quote).decimals() != p.quoteDecimals
                || p.initialBuyQuoteAmount > uint128(type(int128).max)
                || p.additionalQuoteAmount > uint128(type(int128).max)
                || (p.initialBuyQuoteAmount == 0 && p.initialBuyMinimumTokenAmount != 0)
        ) revert InvalidConfiguration();
        IERC20 quoteAsset = IERC20(p.quote);
        uint256 quoteBefore = quoteAsset.balanceOf(address(this));
        uint256 funding = uint256(p.initialBuyQuoteAmount) + p.additionalQuoteAmount;
        if (funding != 0) {
            _collectFunding(p, funding, fundingData);
            if (quoteAsset.balanceOf(address(this)) != quoteBefore + funding) revert InvalidSettlement();
        }
        FoundationTokenV1 primary =
            new FoundationTokenV1{ salt: _tokenSalt(msg.sender, p.tokenSalt) }(p.metadata, address(this));
        result.token = address(primary);
        FoundationHookV2 hook = hookDeployer.deploy(
            poolManager,
            result.token,
            p.quote,
            msg.sender,
            p.initialTick,
            p.creatorBuyFeeBps,
            p.creatorSellFeeBps,
            p.modules,
            p.hookSalt
        );
        result.hook = address(hook);
        result.ledger = address(hook.ledger());
        result.poolId = hook.poolId();
        PoolKey memory key = hook.poolKey();
        PositionPlan memory base = _positionPlan(result.token < p.quote, p.initialTick, T.TOKEN_SUPPLY);
        PositionPlan memory additional;
        if (p.additionalQuoteAmount != 0) {
            additional = _positionPlan(p.quote < result.token, p.initialTick, p.additionalQuoteAmount);
        }
        // The opposing bands share their starting tick, whose gross liquidity counts BOTH positions.
        if (uint256(base.liquidity) + additional.liquidity > Pool.tickSpacingToMaxLiquidityPerTick(T.TICK_SPACING)) {
            revert InvalidConfiguration();
        }
        if (poolManager.initialize(key, TickMath.getSqrtPriceAtTick(p.initialTick)) != p.initialTick) {
            revert InvalidSettlement();
        }
        result.basePositionOwner = LP_RECIPIENT;
        result.roundingInventoryRecipient = ROUNDING_INVENTORY_RECIPIENT;
        result.baseTokenPrincipal = base.debt;
        result.basePositionId = positionManager.nextTokenId();
        _mintPosition(key, base, result.basePositionId, p.deadline);
        uint256 dust = IERC20(result.token).balanceOf(address(this));
        if (dust != T.TOKEN_SUPPLY - base.debt) revert InvalidSettlement();
        // The fixed supply fits uint128. Transfer to DEAD leaves totalSupply unchanged.
        result.baseTokenRounding = uint128(dust);
        if (dust != 0) _transferExact(IERC20(result.token), ROUNDING_INVENTORY_RECIPIENT, dust);
        if (p.additionalQuoteAmount != 0) {
            result.creatorPositionOwner = LP_RECIPIENT;
            result.creatorQuotePrincipal = additional.debt;
            result.creatorPositionId = positionManager.nextTokenId();
            _mintPosition(key, additional, result.creatorPositionId, p.deadline);
        }
        if (p.initialBuyQuoteAmount != 0) result.initialBuyTokenAmount = _initialBuy(key, p);
        uint256 remaining = quoteAsset.balanceOf(address(this));
        if (remaining < quoteBefore) revert InvalidSettlement();
        result.actualQuoteRefund = remaining - quoteBefore;
        if (result.actualQuoteRefund != 0) _transferExact(quoteAsset, msg.sender, result.actualQuoteRefund);
        if (IERC20(result.token).balanceOf(address(this)) != 0 || quoteAsset.balanceOf(address(this)) != quoteBefore) {
            revert InvalidSettlement();
        }
        _launches[result.token] = result;
        emit FoundationLaunchedV3(
            result.token,
            msg.sender,
            result.poolId,
            result.hook,
            result.ledger,
            p.quote,
            primary.metadataHash(),
            hook.compositionHash(),
            LP_CUSTODY_ID,
            p.initialBuyQuoteAmount,
            result
        );
    }

    /// @dev Native extensions must supply the exact quote amount without pulling the creator's ERC20s.
    function _collectFunding(P.LaunchParamsV3 calldata p, uint256 funding, bytes memory fundingData) internal virtual {
        if (fundingData.length != 0) revert InvalidConfiguration();
        IERC20(p.quote).safeTransferFrom(msg.sender, address(this), funding);
    }

    function launchOf(address token) external view returns (L.LaunchResultV2 memory) {
        return _launches[token];
    }

    function predictTokenAddress(address creator, bytes32 tokenSalt, T.Metadata calldata metadata_)
        public
        view
        returns (address)
    {
        bytes32 hash =
            keccak256(abi.encodePacked(type(FoundationTokenV1).creationCode, abi.encode(metadata_, address(this))));
        return _create2Address(address(this), _tokenSalt(creator, tokenSalt), hash);
    }

    function hookInitCodeHash(address creator, address predictedToken, P.LaunchParamsV3 calldata p)
        public
        view
        returns (bytes32)
    {
        return hookDeployer.initCodeHash(
            poolManager,
            address(this),
            predictedToken,
            p.quote,
            creator,
            p.initialTick,
            p.creatorBuyFeeBps,
            p.creatorSellFeeBps,
            p.modules
        );
    }

    function predictHookAddress(address creator, address predictedToken, P.LaunchParamsV3 calldata p)
        external
        view
        returns (address)
    {
        return _create2Address(address(hookDeployer), p.hookSalt, hookInitCodeHash(creator, predictedToken, p));
    }

    /// @notice Each asset lies entirely on its side of the starting price. No virtual quote reserve exists.
    function _positionPlan(bool asset0, int24 tick, uint256 amount) private pure returns (PositionPlan memory p) {
        p.asset0 = asset0;
        p.lower = asset0 ? tick : TickMath.minUsableTick(T.TICK_SPACING);
        p.upper = asset0 ? TickMath.maxUsableTick(T.TICK_SPACING) : tick;
        uint160 lower = TickMath.getSqrtPriceAtTick(p.lower);
        uint160 upper = TickMath.getSqrtPriceAtTick(p.upper);
        p.liquidity = asset0
            ? LiquidityAmounts.getLiquidityForAmount0(lower, upper, amount)
            : LiquidityAmounts.getLiquidityForAmount1(lower, upper, amount);
        uint256 debt = asset0
            ? SqrtPriceMath.getAmount0Delta(lower, upper, p.liquidity, true)
            : SqrtPriceMath.getAmount1Delta(lower, upper, p.liquidity, true);
        if (p.liquidity == 0 || debt == 0 || debt > amount || debt > uint256(uint128(type(int128).max))) {
            revert InvalidConfiguration();
        }
        p.debt = uint128(debt);
    }

    function _mintPosition(PoolKey memory key, PositionPlan memory p, uint256 id, uint256 deadline) private {
        address asset = Currency.unwrap(p.asset0 ? key.currency0 : key.currency1);
        IERC20 currency = IERC20(asset);
        uint256 beforeFactory = currency.balanceOf(address(this));
        uint256 beforeManager = currency.balanceOf(address(poolManager));
        bool granted = _approve(asset, address(positionManager), p.debt);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key,
            p.lower,
            p.upper,
            uint256(p.liquidity),
            uint128(p.asset0 ? p.debt : 0),
            uint128(p.asset0 ? 0 : p.debt),
            LP_RECIPIENT,
            bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        positionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR)), params), deadline
        );
        _revoke(asset, address(positionManager), granted);
        (PoolKey memory observed, PositionInfo info) = positionManager.getPoolAndPositionInfo(id);
        if (
            currency.balanceOf(address(this)) != beforeFactory - p.debt
                || currency.balanceOf(address(poolManager)) != beforeManager + p.debt
                || positionManager.nextTokenId() != id + 1
                || IERC721(address(positionManager)).ownerOf(id) != LP_RECIPIENT
                || IERC721(address(positionManager)).getApproved(id) != address(0)
                || positionManager.getPositionLiquidity(id) != p.liquidity
                || PoolId.unwrap(observed.toId()) != PoolId.unwrap(key.toId()) || info.tickLower() != p.lower
                || info.tickUpper() != p.upper
        ) revert InvalidSettlement();
    }

    function _initialBuy(PoolKey memory key, P.LaunchParamsV3 calldata p) private returns (uint256 output) {
        address token = Currency.unwrap(Currency.unwrap(key.currency0) == p.quote ? key.currency1 : key.currency0);
        uint256 beforeQuote = IERC20(p.quote).balanceOf(address(this));
        uint256 beforeToken = IERC20(token).balanceOf(address(this));
        bool granted = _approve(p.quote, address(universalRouter), p.initialBuyQuoteAmount);
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams(
                key, p.quote < token, p.initialBuyQuoteAmount, p.initialBuyMinimumTokenAmount, 0, bytes("")
            )
        );
        params[1] = abi.encode(Currency.wrap(p.quote), uint256(p.initialBuyQuoteAmount));
        params[2] = abi.encode(Currency.wrap(token), uint256(p.initialBuyMinimumTokenAmount));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)),
            params
        );
        universalRouter.execute(hex"10", inputs, p.deadline);
        _revoke(p.quote, address(universalRouter), granted);
        if (IERC20(p.quote).balanceOf(address(this)) != beforeQuote - p.initialBuyQuoteAmount) {
            revert InvalidSettlement();
        }
        output = IERC20(token).balanceOf(address(this)) - beforeToken;
        if (output == 0 || output < p.initialBuyMinimumTokenAmount) revert InvalidSettlement();
        _transferExact(IERC20(token), msg.sender, output);
    }

    function _approve(address token, address spender, uint256 amount) internal returns (bool granted) {
        // Some ERC20s grant Permit2 permanently and reject explicit approval changes.
        granted = IERC20(token).allowance(address(this), address(permit2)) != type(uint256).max;
        if (granted) IERC20(token).forceApprove(address(permit2), amount);
        permit2.approve(token, spender, uint160(amount), uint48(block.timestamp));
    }

    function _revoke(address token, address spender, bool granted) internal {
        permit2.approve(token, spender, 0, 0);
        if (granted) IERC20(token).forceApprove(address(permit2), 0);
    }

    function _transferExact(IERC20 asset, address recipient, uint256 amount) private {
        uint256 beforeRecipient = asset.balanceOf(recipient);
        uint256 beforeSelf = asset.balanceOf(address(this));
        asset.safeTransfer(recipient, amount);
        if (
            asset.balanceOf(recipient) != beforeRecipient + amount
                || asset.balanceOf(address(this)) != beforeSelf - amount
        ) {
            revert InvalidSettlement();
        }
    }

    function _verifyInfrastructure() private view {
        // Construction rejects empty runtimes. Their immutable code hashes also reject later removal.
        if (
            block.chainid != chainId || address(poolManager).codehash != poolManagerCodeHash
                || address(positionManager).codehash != positionManagerCodeHash
                || address(universalRouter).codehash != universalRouterCodeHash
                || address(permit2).codehash != permit2CodeHash
                || address(hookDeployer).codehash != hookDeployerCodeHash
        ) revert InvalidInfrastructure();
    }

    function _tokenSalt(address creator, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(creator, salt));
    }

    function _create2Address(address deployer, bytes32 salt, bytes32 hash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, hash)))));
    }
}
