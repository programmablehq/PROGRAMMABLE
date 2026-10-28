// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { CustomAIProgramTypesV1 as P } from "./CustomAIProgramTypesV1.sol";
import { CustomAIProgramRouterV1 } from "./CustomAIProgramRouterV1.sol";
import { CustomAILiquidityProgramV1 } from "./CustomAILiquidityProgramV1.sol";
import { CustomAIProgramV1 } from "./CustomAIProgramV1.sol";
import { CustomAIFactoryV1 } from "./CustomAIFactoryV1.sol";
import { CustomAIExecutionPriceFeedV1 } from "./CustomAIExecutionPriceFeedV1.sol";
import {
    CustomAIProgramRouterDeployerV1,
    CustomAILiquidityProgramDeployerV1,
    CustomAIFundedProgramDeployerV1
} from "./CustomAIProgramDeployersV1.sol";

/// @notice Deploys one immutable program set for a creator/launch salt. No owner, setters or arbitrary calls.
contract CustomAIProgramFactoryV1 is ReentrancyGuardTransient {
    CustomAIFactoryV1 public immutable core;
    CustomAIProgramRouterDeployerV1 public immutable routers;
    CustomAILiquidityProgramDeployerV1 public immutable liquidityPrograms;
    CustomAIFundedProgramDeployerV1 public immutable fundedPrograms;
    CustomAIExecutionPriceFeedV1 public immutable prices;
    bytes32 public immutable routerCodeHash;
    bytes32 public immutable liquidityCodeHash;
    bytes32 public immutable fundedCodeHash;
    mapping(bytes32 => bytes32) public configurationOf;
    mapping(address => mapping(bytes32 => address)) public recipientOf;
    error InvalidProgram();
    event ProgramsDeployed(bytes32 indexed key, address indexed router, bytes32 configurationHash);

    constructor(
        CustomAIFactoryV1 f,
        CustomAIProgramRouterDeployerV1 r,
        CustomAILiquidityProgramDeployerV1 l,
        CustomAIFundedProgramDeployerV1 b,
        CustomAIExecutionPriceFeedV1 p
    ) {
        if (
            address(f).code.length == 0 || address(r).code.length == 0 || address(l).code.length == 0
                || address(b).code.length == 0 || address(p).code.length == 0
        ) revert InvalidProgram();
        core = f;
        routers = r;
        liquidityPrograms = l;
        fundedPrograms = b;
        prices = p;
        routerCodeHash = address(r).codehash;
        liquidityCodeHash = address(l).codehash;
        fundedCodeHash = address(b).codehash;
    }

    function _validate(P.Launch memory c)
        private
        view
        returns (bytes32 key, bytes32 hash, CustomAIProgramRouterV1.Destination[] memory targets)
    {
        if (
            c.factory != core || c.creator == address(0) || c.quote.code.length == 0 || c.quoteDecimals > 36
                || c.ruleSpecHash == 0 || c.actions.length == 0 || c.actions.length > 4
                || address(routers).codehash != routerCodeHash
                || address(liquidityPrograms).codehash != liquidityCodeHash
                || address(fundedPrograms).codehash != fundedCodeHash
        ) revert InvalidProgram();
        uint256 sum;
        targets = new CustomAIProgramRouterV1.Destination[](c.actions.length);
        for (uint256 i; i < c.actions.length; i++) {
            P.Action memory a = c.actions[i];
            if (a.id == 0 || a.kind > 3 || a.shareBps == 0 || a.interval < 60) revert InvalidProgram();
            for (uint256 j; j < i; j++) {
                if (c.actions[j].id == a.id) revert InvalidProgram();
            }
            if ((a.kind == 0 || a.kind == 2) && a.recipient != address(0)) revert InvalidProgram();
            if ((a.kind == 1 || a.kind == 3) && a.recipient == address(0)) revert InvalidProgram();
            sum += a.shareBps;
            targets[i] = CustomAIProgramRouterV1.Destination(a.id, address(0), a.shareBps);
        }
        if (sum > 10_000) revert InvalidProgram();
        key = keccak256(abi.encode(c.factory, c.creator, c.launchSalt));
        hash = keccak256(abi.encode(c));
    }

    function _liquidity(P.Launch memory c, P.Action memory a, address router)
        private
        view
        returns (CustomAILiquidityProgramV1.Configuration memory)
    {
        return CustomAILiquidityProgramV1.Configuration(
            c.factory,
            c.creator,
            c.launchSalt,
            CustomAIProgramRouterV1(router),
            a.id,
            c.quote,
            a.maximumBatch,
            a.deviation,
            a.interval,
            a.maxPriceAge,
            a.minimumObservations,
            a.minimumHistory,
            prices
        );
    }

    function _funded(P.Launch memory c, P.Action memory a)
        private
        pure
        returns (CustomAIProgramV1.Configuration memory)
    {
        return CustomAIProgramV1.Configuration(
            c.factory,
            c.creator,
            c.launchSalt,
            c.quote,
            c.quoteDecimals,
            CustomAIProgramV1.Mode(a.kind - 1),
            a.recipient,
            a.interval,
            a.kind == 3 ? a.maximumBatch : 0,
            a.kind == 3 ? a.minimumTokensPerQuote : 0
        );
    }

    function predictPrograms(P.Launch memory c)
        public
        view
        returns (address router, address[] memory programs, bytes32 hash)
    {
        (bytes32 key, bytes32 configuration, CustomAIProgramRouterV1.Destination[] memory targets) = _validate(c);
        hash = configuration;
        router = routers.predict(key, c.factory, c.creator, c.launchSalt, c.quote, targets, address(this));
        programs = new address[](c.actions.length);
        for (uint256 i; i < c.actions.length; i++) {
            bytes32 salt = keccak256(abi.encode(key, c.actions[i].id));
            programs[i] = c.actions[i].kind == 0
                ? liquidityPrograms.predict(salt, _liquidity(c, c.actions[i], router))
                : fundedPrograms.predict(salt, _funded(c, c.actions[i]));
        }
    }

    function deployPrograms(P.Launch memory c)
        external
        nonReentrant
        returns (address router, address[] memory programs)
    {
        if (msg.sender != c.creator) revert InvalidProgram();
        (bytes32 key, bytes32 hash, CustomAIProgramRouterV1.Destination[] memory targets) = _validate(c);
        if (configurationOf[key] != 0 && configurationOf[key] != hash) revert InvalidProgram();
        (router, programs,) = predictPrograms(c);
        if (configurationOf[key] != 0) return (router, programs);
        configurationOf[key] = hash;
        if (routers.deploy(key, c.factory, c.creator, c.launchSalt, c.quote, targets, address(this)) != router) {
            revert InvalidProgram();
        }
        for (uint256 i; i < c.actions.length; i++) {
            P.Action memory a = c.actions[i];
            bytes32 salt = keccak256(abi.encode(key, a.id));
            address instance = a.kind == 0
                ? liquidityPrograms.deploy(salt, _liquidity(c, a, router))
                : fundedPrograms.deploy(salt, _funded(c, a));
            if (instance != programs[i] || instance.code.length == 0) revert InvalidProgram();
            recipientOf[router][a.id] = instance;
        }
        emit ProgramsDeployed(key, router, hash);
    }
}
