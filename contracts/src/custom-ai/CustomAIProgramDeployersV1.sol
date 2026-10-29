// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import { CustomAIProgramRouterV1 } from "./CustomAIProgramRouterV1.sol";
import { CustomAILiquidityProgramV1 } from "./CustomAILiquidityProgramV1.sol";
import { CustomAIProgramV1 } from "./CustomAIProgramV1.sol";
import { CustomAIFactoryV1 } from "./CustomAIFactoryV1.sol";

library ProgramAddressV1 {
    function predicted(address from, bytes32 salt, bytes32 initHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), from, salt, initHash)))));
    }
}

contract CustomAIProgramRouterDeployerV1 {
    function predict(
        bytes32 salt,
        CustomAIFactoryV1 f,
        address creator,
        bytes32 launchSalt,
        address quote,
        CustomAIProgramRouterV1.Destination[] memory targets,
        address registry
    ) public view returns (address) {
        return ProgramAddressV1.predicted(
            address(this),
            salt,
            keccak256(
                abi.encodePacked(
                    type(CustomAIProgramRouterV1).creationCode,
                    abi.encode(f, creator, launchSalt, quote, targets, registry)
                )
            )
        );
    }

    function deploy(
        bytes32 salt,
        CustomAIFactoryV1 f,
        address creator,
        bytes32 launchSalt,
        address quote,
        CustomAIProgramRouterV1.Destination[] memory targets,
        address registry
    ) external returns (address instance) {
        instance = predict(salt, f, creator, launchSalt, quote, targets, registry);
        if (instance.code.length == 0) {
            instance =
                address(new CustomAIProgramRouterV1{ salt: salt }(f, creator, launchSalt, quote, targets, registry));
        }
    }
}

contract CustomAILiquidityProgramDeployerV1 {
    function predict(bytes32 salt, CustomAILiquidityProgramV1.Configuration memory c) public view returns (address) {
        return ProgramAddressV1.predicted(
            address(this),
            salt,
            keccak256(abi.encodePacked(type(CustomAILiquidityProgramV1).creationCode, abi.encode(c)))
        );
    }

    function deploy(bytes32 salt, CustomAILiquidityProgramV1.Configuration memory c)
        external
        returns (address instance)
    {
        instance = predict(salt, c);
        if (instance.code.length == 0) instance = address(new CustomAILiquidityProgramV1{ salt: salt }(c));
    }
}

contract CustomAIFundedProgramDeployerV1 {
    function predict(bytes32 salt, CustomAIProgramV1.Configuration memory c) public view returns (address) {
        return ProgramAddressV1.predicted(
            address(this), salt, keccak256(abi.encodePacked(type(CustomAIProgramV1).creationCode, abi.encode(c)))
        );
    }

    function deploy(bytes32 salt, CustomAIProgramV1.Configuration memory c) external returns (address instance) {
        instance = predict(salt, c);
        if (instance.code.length == 0) instance = address(new CustomAIProgramV1{ salt: salt }(c));
    }
}
