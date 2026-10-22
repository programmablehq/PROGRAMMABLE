// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { CustomAIPriceV1 as P } from "./CustomAIPriceV1.sol";
import { CustomAITransfersV1 as X } from "./CustomAITransfersV1.sol";
import { CustomAITokenV1 } from "./CustomAITokenV1.sol";
import { CustomAIHookV1 } from "./CustomAIHookV1.sol";
import { CustomAIHookDeployerV1 } from "./CustomAIHookDeployerV1.sol";
import { CustomAISwapRouterV1 } from "./CustomAISwapRouterV1.sol";
import { CustomAILiquidityVaultV1 } from "./CustomAILiquidityVaultV1.sol";
import { CustomAILiquidityDeployerV1 } from "./CustomAILiquidityDeployerV1.sol";
import { CustomAILiquidityV1 as L } from "./CustomAILiquidityV1.sol";

/// @notice A signed preview becomes one atomic, idempotent launch. No owner, review queue or administrative setters.
/// @dev The immutable price signer authenticates short-lived quote/USD and ETH/USD prices, not price truth.
contract CustomAIFactoryV1 is EIP712, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    bytes32 public constant CORE_VERSION = T.VERSION_ID;
    bytes32 public constant PRICE_TYPEHASH = keccak256(
        "LaunchPrice(bytes32 planHash,uint256 quoteUsdE18,uint256 ethUsdE18,uint64 observedAt,uint64 validUntil)"
    );
    uint256 public constant MIN_INITIAL_BUY_ETH = T.MIN_INITIAL_BUY_ETH;
    IPoolManager public immutable poolManager;
    CustomAIHookDeployerV1 public immutable hookDeployer;
    CustomAISwapRouterV1 public immutable router;
    CustomAILiquidityDeployerV1 public immutable liquidityDeployer;
    address public immutable priceSigner;
    bytes32 public immutable managerCodeHash;
    bytes32 public immutable deployerCodeHash;
    bytes32 public immutable routerCodeHash;
    bytes32 public immutable liquidityDeployerCodeHash;
    mapping(address => mapping(bytes32 => T.LaunchResult)) private _launches;

    error InvalidConfiguration();
    error InvalidSignature();
    error DeadlineExpired();
    error SaltAlreadyUsed();
    error InvalidSettlement();
    error InitialBuyTooSmall(uint256 minimumQuote);

    event Launched(
        address indexed creator,
        bytes32 indexed launchSalt,
        bytes32 indexed planHash,
        T.LaunchResult result,
        uint256 initialFdvLowerUsdE18,
        uint256 initialFdvUpperUsdE18
    );

    constructor(
        IPoolManager manager,
        CustomAIHookDeployerV1 deployer,
        CustomAILiquidityDeployerV1 liquidityDeployer_,
        CustomAISwapRouterV1 router_,
        address signer
    ) EIP712("Programmable Custom AI Launch", "1") {
        if (
            address(manager).code.length == 0 || address(deployer).code.length == 0 || address(router_).code.length == 0
                || address(liquidityDeployer_).code.length == 0 || address(router_.poolManager()) != address(manager)
                || signer == address(0)
        ) revert InvalidConfiguration();
        poolManager = manager;
        hookDeployer = deployer;
        router = router_;
        liquidityDeployer = liquidityDeployer_;
        priceSigner = signer;
        managerCodeHash = address(manager).codehash;
        deployerCodeHash = address(deployer).codehash;
        routerCodeHash = address(router_).codehash;
        liquidityDeployerCodeHash = address(liquidityDeployer_).codehash;
    }

    function hashPlan(address creator, T.LaunchParams calldata p) public view returns (bytes32) {
        return keccak256(abi.encode(CORE_VERSION, block.chainid, address(this), creator, p));
    }

    function priceDigest(bytes32 planHash, T.Price calldata price) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PRICE_TYPEHASH, planHash, price.quoteUsdE18, price.ethUsdE18, price.observedAt, price.validUntil
                )
            )
        );
    }

    function launchOf(address creator, bytes32 salt) external view returns (T.LaunchResult memory) {
        return _launches[creator][salt];
    }

    function predictTokenAddress(address creator, T.LaunchParams calldata p) public view returns (address) {
        bytes32 initHash =
            keccak256(abi.encodePacked(type(CustomAITokenV1).creationCode, abi.encode(p.metadata, p.quote)));
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), address(this), keccak256(abi.encode(creator, p.launchSalt)), initHash
                        )
                    )
                )
            )
        );
    }

    function launch(T.LaunchParams calldata p, T.Price calldata price, bytes calldata signature)
        external
        nonReentrant
        returns (T.LaunchResult memory r)
    {
        bytes32 planHash = hashPlan(msg.sender, p);
        r = _launches[msg.sender][p.launchSalt];
        if (r.token != address(0)) {
            if (r.planHash != planHash) revert SaltAlreadyUsed();
            return r; // Readback-only retry, even after the attestation expires. No repeated buy or transfers.
        }
        if (block.timestamp > p.deadline) revert DeadlineExpired();
        if (
            address(poolManager).codehash != managerCodeHash || address(hookDeployer).codehash != deployerCodeHash
                || address(router).codehash != routerCodeHash
                || address(liquidityDeployer).codehash != liquidityDeployerCodeHash || p.quote.code.length == 0
                || p.quoteDecimals > 36 || IERC20Metadata(p.quote).decimals() != p.quoteDecimals
                || p.initialBuyQuote > T.MAX_AMOUNT || p.minimumBuyTokens == 0 || p.maximumFeeBps < T.PLATFORM_BPS
                || p.maximumFeeBps > T.MAX_TOTAL_BPS
        ) revert InvalidConfiguration();
        if (ECDSA.recover(priceDigest(planHash, price), signature) != priceSigner) revert InvalidSignature();
        (uint256 lower, uint256 upper) =
            P.validate(predictTokenAddress(msg.sender, p) < p.quote, p.initialTick, p.quoteDecimals, price);
        uint256 minimumQuote = P.minimumInitialBuy(p.quoteDecimals, price);
        if (p.initialBuyQuote < minimumQuote) revert InitialBuyTooSmall(minimumQuote);
        CustomAITokenV1 token =
            new CustomAITokenV1{ salt: keccak256(abi.encode(msg.sender, p.launchSalt)) }(p.metadata, p.quote);
        CustomAIHookV1 hook = hookDeployer.deploy(
            poolManager, address(token), p.quote, p.initialTick, p.feeModule, p.rewards, p.hookSalt
        );
        r.planHash = planHash;
        r.token = address(token);
        r.hook = address(hook);
        r.ledger = address(hook.ledger());
        r.rewardVault = address(hook.rewardVault());
        r.poolId = token.bindPool(address(hook));
        if (r.poolId != hook.poolId()) revert InvalidSettlement();
        PoolKey memory key = hook.poolKey();
        if (poolManager.initialize(key, TickMath.getSqrtPriceAtTick(p.initialTick)) != p.initialTick) {
            revert InvalidSettlement();
        }
        CustomAILiquidityVaultV1 vault = liquidityDeployer.deploy(poolManager, address(token));
        r.liquidityVault = address(vault);
        X.push(IERC20(address(token)), address(vault), T.TOKEN_SUPPLY);
        L.Position memory position = vault.initialize(key, p.initialTick);
        r.liquidity = position.liquidity;
        r.tokenPrincipal = position.tokenPrincipal;
        r.tokenRounding = position.tokenRounding;
        r.initialBuyTokens = _buy(p, key);
        if (token.balanceOf(address(this)) != 0) revert InvalidSettlement();
        _launches[msg.sender][p.launchSalt] = r;
        emit Launched(msg.sender, p.launchSalt, planHash, r, lower, upper);
    }

    function _buy(T.LaunchParams calldata p, PoolKey memory key) private returns (uint256 bought) {
        IERC20 quote = IERC20(p.quote);
        uint256 beforeBalance = quote.balanceOf(address(this));
        X.pull(quote, msg.sender, address(this), p.initialBuyQuote);
        quote.forceApprove(address(router), p.initialBuyQuote);
        bool zeroForOne = p.quote < predictTokenAddress(msg.sender, p);
        (uint256 paid, uint256 received) = router.swap(
            key,
            SwapParams(
                zeroForOne,
                -int256(uint256(p.initialBuyQuote)),
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            p.minimumBuyTokens,
            p.maximumFeeBps,
            msg.sender,
            p.deadline
        );
        quote.forceApprove(address(router), 0);
        if (paid != p.initialBuyQuote || quote.balanceOf(address(this)) != beforeBalance) revert InvalidSettlement();
        return received;
    }
}
