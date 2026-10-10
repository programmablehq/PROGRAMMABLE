var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};

// contracts/spec/module-foundation/chain-1.v1.json
var chain_1_v1_default;
var init_chain_1_v1 = __esm({
  "contracts/spec/module-foundation/chain-1.v1.json"() {
    chain_1_v1_default = {
      schemaVersion: "programmable.module-foundation.chain.v1",
      chainId: 1,
      observedBlock: "26125239",
      contracts: {
        poolManager: {
          address: "0x000000000004444c5dc75cB358380D2e3dE08A90",
          runtimeCodeHash: "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293"
        },
        positionManager: {
          address: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
          runtimeCodeHash: "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b"
        },
        universalRouter: {
          address: "0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca",
          runtimeCodeHash: "0x70c9ea2b275087aea3d57ae48e2d30e272a07ff5b6c7974bd47c21478b37face"
        },
        permit2: {
          address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
          runtimeCodeHash: "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131"
        },
        v4Quoter: {
          address: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
          runtimeCodeHash: "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441"
        },
        stateView: {
          address: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
          runtimeCodeHash: "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878"
        },
        wrappedEth: {
          address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          runtimeCodeHash: "0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23"
        },
        multicall3: {
          address: "0xca11bde05977b3631167028862be2a173976ca11",
          runtimeCodeHash: "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891"
        }
      },
      canonicalStamp: {
        router: {
          address: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
          runtimeCodeHash: "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546"
        },
        graphFactory: {
          address: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
          runtimeCodeHash: "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8"
        }
      }
    };
  }
});

// lib/chains.ts
import { defineChain } from "viem";
var ROBINHOOD_CHAIN_ID, ROBINHOOD_MAINNET_RPC_URL, ROBINHOOD_BLOCK_EXPLORER_URL, ROBINHOOD_MULTICALL3_ADDRESS, ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH, robinhoodChain;
var init_chains = __esm({
  "lib/chains.ts"() {
    "use strict";
    ROBINHOOD_CHAIN_ID = 4663;
    ROBINHOOD_MAINNET_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
    ROBINHOOD_BLOCK_EXPLORER_URL = "https://robinhoodchain.blockscout.com";
    ROBINHOOD_MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
    ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH = "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891";
    robinhoodChain = defineChain({
      id: ROBINHOOD_CHAIN_ID,
      name: "Robinhood Chain",
      nativeCurrency: {
        decimals: 18,
        name: "Ether",
        symbol: "ETH"
      },
      rpcUrls: {
        default: {
          http: [ROBINHOOD_MAINNET_RPC_URL]
        }
      },
      blockExplorers: {
        default: {
          name: "Robinhood Chain Explorer",
          url: ROBINHOOD_BLOCK_EXPLORER_URL
        }
      },
      contracts: {
        multicall3: {
          address: ROBINHOOD_MULTICALL3_ADDRESS
        }
      }
    });
  }
});

// contracts/spec/robinhood-custom-launch/chain-4663.v1.json
var chain_4663_v1_default;
var init_chain_4663_v1 = __esm({
  "contracts/spec/robinhood-custom-launch/chain-4663.v1.json"() {
    chain_4663_v1_default = {
      schemaVersion: "programmable.robinhood-custom-launch.chain-profile.v1",
      chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
      deploymentState: "prepared-not-broadcast",
      chainId: "4663",
      chainIdHex: "0x1237",
      caip2: "eip155:4663",
      network: "robinhood-mainnet",
      nativeCurrency: "ETH",
      explorer: "https://robinhoodchain.blockscout.com",
      rpc: {
        public: "https://rpc.mainnet.chain.robinhood.com",
        productionRequirement: "authenticated-distinct-primary-and-secondary-providers",
        publicRpcCountsTowardQuorum: false
      },
      finality: {
        schemaVersion: "programmable.custom-launch-finality-policy-ref.v1",
        policyId: "robinhood-stage-finality-v1",
        policyRevision: 1,
        stages: [
          "sequencer_soft_confirmation",
          "ethereum_posted",
          "ethereum_finalized"
        ],
        terminalStage: "ethereum_finalized",
        promotableStage: "ethereum_finalized",
        arbitraryL2ConfirmationDepthIsFinality: false,
        policyDigest: "sha256:537d531423d1285a3808556a57303ec68f1e6bdeea3c9aaf6320f9e5a0e47153",
        policyDigestState: "byte-locked-provider-integration"
      },
      sources: {
        uniswapRegistry: {
          repository: "https://github.com/Uniswap/contracts",
          commit: "4cfc406c8e34da3ce04e60657a7825075b64fd22",
          path: "deployments/json/4663.json",
          sha256: "0x21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15"
        },
        safeDeployments: {
          repository: "https://github.com/safe-global/safe-deployments",
          commit: "0974182c16c57ca6fe2b9bba8cffb8a7e55fb83c",
          version: "1.4.1"
        },
        multicall3: {
          repository: "https://github.com/mds1/multicall3",
          commit: "b667d67ecfa5361a81e8f110234ce242613b0012",
          path: "src/Multicall3.sol",
          sha256: "0x2054218939d3fa0f52f8ce1a33658d570a550671f63197356ee5744f7e188b1e",
          bindingEvidence: "Robinhood runtime is byte-identical to the canonical same-address Ethereum deployment; upstream deployments.json does not list chain 4663"
        },
        router: {
          repository: "https://github.com/programmablehq/PROGRAMMABLE",
          commit: "0a7134bbb912222639627fb9078df2f8dd3a6c38",
          originalPath: "src/ProgrammableLaunchStampRouterV1.sol",
          currentPath: "contracts/src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol",
          sha256: "0xef87aa9338c364634bffda64423bd3fb096c1630a45cc58ecf854d24959ff163",
          abiSha256: "0xab25262ce1cb907eba1cb820492754c0cd5d7278eb5fd6a024ba24c767323ac0",
          standardJsonInputPath: "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
          standardJsonInputSha256: "0x6abca24d06b013599f4ff63e049976419c3f17455fa9bc343b15ec0d6e6a078a",
          recovery: "byte-identical"
        },
        graphFactory: {
          repository: "https://github.com/programmablehq/PROGRAMMABLE",
          commit: "518fd05066edeb6017db995af520819151173a3b",
          path: "contracts/src/ProgrammableCreate2GraphDeployerV1.sol",
          sha256: "0x06a3acaf9beeb68647af231f5524c5a34dc013d99611a1b2d0a6c80895f595e9",
          abiSha256: "0x2d253b16e76c43bc6736a6dadb28881c7f8d52a1c4b8cf8aa22a20b0c6aaa5f4",
          standardJsonInputPath: "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
          standardJsonInputSha256: "0x8ab811a215d70b1d5aef0c71a47153173953ee78d7632725413833888369ec4d"
        }
      },
      observation: {
        blockNumber: "49220000",
        blockHash: "0xabc4e2a609516012bb7af14128a26a51a67012552f3e68b585a9c1814d120025",
        blockTimestamp: "1788013113",
        observedAt: "2026-08-29T14:18:33Z",
        l1BlockNumberHex: "0x18a9d4e",
        evidenceType: "code-presence-and-runtime-hash-not-source-verification"
      },
      contracts: {
        uniswap: {
          poolManager: {
            address: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
            runtimeCodeHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626"
          },
          positionManager: {
            address: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
            runtimeCodeHash: "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2"
          },
          v4Quoter: {
            address: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
            runtimeCodeHash: "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6"
          },
          stateView: {
            address: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
            runtimeCodeHash: "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6"
          },
          permit2: {
            address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
            runtimeCodeHash: "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca"
          },
          universalRouter: {
            address: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
            runtimeCodeHash: "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
            supersededAddressRejected: "0x8876789976decbfcbbbe364623c63652db8c0904"
          }
        },
        safeInfrastructure: {
          safeSingleton: {
            address: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
            runtimeCodeHash: "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4"
          },
          safeL2Singleton: {
            address: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
            runtimeCodeHash: "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff",
            selectedForPermitAuthority: false
          },
          safeProxyFactory: {
            address: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
            runtimeCodeHash: "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317"
          },
          compatibilityFallbackHandler: {
            address: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
            runtimeCodeHash: "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9"
          },
          multiSend: {
            address: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
            runtimeCodeHash: "0x0e4f7fc66550a322d1e7688e181b75e217e662a4f3f4d6a29b22bc61217c4b77"
          },
          multiSendCallOnly: {
            address: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
            runtimeCodeHash: "0xecd5bd14a08c5d2122379900b2f272bdf107a7e92423c10dd5fe3254386c9939"
          }
        },
        deploymentInfrastructure: {
          multicall3: {
            address: "0xcA11bde05977b3631167028862bE2a173976CA11",
            runtimeCodeHash: "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891",
            runtimeBytes: 3808,
            role: "atomic-zero-value-owner-transaction"
          },
          deterministicDeployer: {
            address: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
            runtimeCodeHash: "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989"
          }
        },
        programmable: {
          permitAuthority: {
            address: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
            runtimeCodeHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
            deploymentState: "prepared-not-broadcast",
            preparedComponentCallIndex: 0
          },
          graphFactory: {
            address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
            runtimeCodeHash: "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
            creationCodeHash: "0x84f7cb8e9e445d3322249dbc2b9efc65bb9c7a8ba26902aafef9b0552f4bc208",
            deploymentState: "prepared-not-broadcast",
            preparedComponentCallIndex: 1
          },
          programmableLaunchStampRouter: {
            address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
            runtimeCodeHash: "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
            baseCreationCodeHash: "0xac3a064602cd7aa5e3665507b69ae125d457942228ad88f15626c46ccac80ef9",
            baseRuntimeCodeHash: "0x79ae905ee338fe82158dab92d84c52bc4cf197b031beb9c1b5e402c7f449dfe1",
            creationCodeHash: "0xf4176bf15de19a93b76cd138d6525a30d68efdad356e831f6d8449659959eb39",
            constructorAppendedCreationCodeHash: "0xf4176bf15de19a93b76cd138d6525a30d68efdad356e831f6d8449659959eb39",
            deploymentState: "prepared-not-broadcast",
            preparedComponentCallIndex: 2,
            launchAndStampV1Selector: "0xe5f6b8cd"
          }
        }
      },
      permitAuthorityConfiguration: {
        safeVersion: "1.4.1",
        singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
        owners: [
          "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
          "0x2Bb333d48DFAF1596D9036671d2E43168994249E"
        ],
        threshold: 1,
        modules: [],
        guard: "0x0000000000000000000000000000000000000000",
        fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
        initialNonce: "0",
        sourceObservation: {
          chainId: "1",
          permitAuthority: "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b",
          blockNumber: "25861371",
          blockHash: "0x6786356f10214c01c4ae5110b44b78d22188f2c0a5f1b9df0387c122574fd067",
          blockTimestamp: "1788012083",
          observedAt: "2026-08-29T14:01:23Z",
          independentRpcAgreement: 2,
          version: "1.4.1",
          masterCopy: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
          runtimeCodeHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
          owners: [
            "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
            "0x2Bb333d48DFAF1596D9036671d2E43168994249E"
          ],
          threshold: 1,
          nonce: "2",
          modules: [],
          guard: "0x0000000000000000000000000000000000000000",
          fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
          ownerCodeState: {
            "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3": "empty-code",
            "0x2Bb333d48DFAF1596D9036671d2E43168994249E": "eip-7702-delegation-designator-0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b"
          }
        },
        safeSaltNonce: "0x64379301d86858c9c72eda110164ebe008411237ae7ec8c4b2391720fdedae45",
        identityNote: "This is a new Safe address initialized directly to the current Ethereum authority governance configuration with fresh nonce zero, not a historical replay at 0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b."
      },
      preparedOwnerTransaction: {
        purpose: "atomically-deploy-safe-graph-factory-and-router",
        to: "0xcA11bde05977b3631167028862bE2a173976CA11",
        function: "aggregate3((address,bool,bytes)[])",
        selector: "0x82ad56cb",
        value: "0",
        dataHash: "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9",
        dataBytes: 33412,
        allowFailure: false,
        subcallOrder: [0, 1, 2],
        ethEstimateGasLiveObservation: {
          value: "7169706",
          blockRange: ["49228085", "49228090"],
          observedAt: "2026-08-29T14:32:09Z"
        },
        preparedEnvelope: "exact-to-value-data; sender selection, nonce, fees and final gas limit remain wallet-time chain envelope fields"
      },
      decodedComponentCalls: [
        {
          index: 0,
          purpose: "deploy-and-initialize-safe-1.4.1-permit-authority",
          to: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
          value: "0",
          dataHash: "0x3a9a3af8bfaab5ef893202e872e1a720874ef7cdbdd8d9c5d2a813b1eff596d2",
          dataBytes: 548
        },
        {
          index: 1,
          purpose: "deploy-current-create2-graph-factory",
          to: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
          value: "0",
          dataHash: "0x46b864077a44a112678b7191405cb13ba431298c114d9d00a4d7be477b4c7d79",
          dataBytes: 7540
        },
        {
          index: 2,
          purpose: "deploy-canonical-launch-stamp-router-v1-with-robinhood-immutables",
          to: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
          value: "0",
          dataHash: "0xedb1a8e23b81c8d71d65967333619d51893e4d0d35c2ae75cde091e47bc14b5e",
          dataBytes: 24714
        }
      ],
      compiler: {
        solc: "0.8.26",
        evmVersion: "cancun",
        optimizer: true,
        optimizerRuns: 1e3,
        bytecodeHash: "none",
        cborMetadata: false,
        binaryLabel: "solc-0.8.26+commit.8a97fa7a.Darwin.appleclang",
        binarySha256: "0x24b06eb31fd9db8edf3a57bdf7468d7360d6fc2fb202a6bb577bda089193ef31"
      },
      operationalCapacity: {
        admissionTargetRange: {
          minimum: 3,
          maximum: 16
        },
        graphFactoryProtocolRange: {
          minimum: 1,
          maximum: 16
        },
        measuredMinimalTargetBenchmarks: {
          threeTargets: {
            deployGraphCalldataBytes: 2084,
            executionGas: "433479"
          },
          sixteenTargets: {
            deployGraphCalldataBytes: 9988,
            executionGas: "2091212"
          }
        },
        qualification: "Target-count benchmark with minimal test contracts; every real graph still requires request-specific fork simulation under the byte caps."
      },
      sourceCommitment: "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
      deploymentEvidence: {
        sender: null,
        transactionHash: null,
        transactionNonce: null,
        transactionGasLimit: null,
        transactionMaxFeePerGas: null,
        transactionMaxPriorityFeePerGas: null,
        blockNumber: null,
        blockHash: null,
        blockTimestamp: null,
        startBlock: null,
        explorerUrl: null,
        sourceVerification: {
          permitAuthority: "official-safe-source-pinned-predeployment",
          graphFactory: "exact-source-prepared-not-submitted",
          programmableLaunchStampRouter: "exact-source-prepared-not-submitted"
        }
      },
      externalBoundary: {
        field: "sender",
        allowedValues: [
          "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
          "0x2Bb333d48DFAF1596D9036671d2E43168994249E"
        ],
        action: "one observed Safe owner must select its sender account, review and separately sign/broadcast the one exact zero-value Multicall3 transaction on chain 4663",
        automaticSigningOrBroadcast: false
      },
      notice: "This is deterministic predeployment preparation. It is not deployment, source verification, finality, indexing or public availability evidence."
    };
  }
});

// lib/module-foundation/creator-fees.ts
var init_creator_fees = __esm({
  "lib/module-foundation/creator-fees.ts"() {
    "use strict";
  }
});

// lib/module-foundation/constants.ts
import { getAddress, keccak256, stringToHex } from "viem";
var FOUNDATION_CHAIN_ID, FOUNDATION_SUPPLY, FOUNDATION_TICK_SPACING, FOUNDATION_LP_FEE, FOUNDATION_PLATFORM_RECIPIENT, FOUNDATION_ABI_ID, FOUNDATION_FACTORY_V2_ID, FOUNDATION_FACTORY_V3_ID, FOUNDATION_LP_CUSTODY_DEAD_ID, FOUNDATION_DEAD_ADDRESS, FOUNDATION_INT128_MAX, FOUNDATION_ZERO_HASH, FOUNDATION_INFRASTRUCTURE;
var init_constants = __esm({
  "lib/module-foundation/constants.ts"() {
    "use strict";
    init_chain_4663_v1();
    init_creator_fees();
    FOUNDATION_CHAIN_ID = 4663;
    FOUNDATION_SUPPLY = 1000000000n * 10n ** 18n;
    FOUNDATION_TICK_SPACING = 60;
    FOUNDATION_LP_FEE = 0;
    FOUNDATION_PLATFORM_RECIPIENT = getAddress("0xD88539d3c4C460136a733A3Fd60cf6BF269079da");
    FOUNDATION_ABI_ID = keccak256(stringToHex("programmable.module-foundation.v1"));
    FOUNDATION_FACTORY_V2_ID = keccak256(stringToHex("programmable.module-foundation.factory.v2"));
    FOUNDATION_FACTORY_V3_ID = keccak256(stringToHex("programmable.module-foundation.factory.v3"));
    FOUNDATION_LP_CUSTODY_DEAD_ID = keccak256(stringToHex("programmable.module-foundation.launch-nfts.dead.v1"));
    FOUNDATION_DEAD_ADDRESS = getAddress("0x000000000000000000000000000000000000dEaD");
    FOUNDATION_INT128_MAX = (1n << 127n) - 1n;
    FOUNDATION_ZERO_HASH = `0x${"0".repeat(64)}`;
    FOUNDATION_INFRASTRUCTURE = Object.fromEntries(
      ["poolManager", "positionManager", "universalRouter", "permit2", "v4Quoter", "stateView"].map((role) => {
        const pin2 = chain_4663_v1_default.contracts.uniswap[role];
        return [role, { address: getAddress(pin2.address), runtimeCodeHash: pin2.runtimeCodeHash }];
      })
    );
  }
});

// lib/module-foundation/chains.ts
import { getAddress as getAddress2 } from "viem";
import { mainnet } from "viem/chains";
function pin(value) {
  return Object.freeze({ address: getAddress2(value.address), runtimeCodeHash: value.runtimeCodeHash });
}
function foundationChainProfile(chainId = FOUNDATION_CHAIN_ID) {
  if (chainId !== 1 && chainId !== FOUNDATION_CHAIN_ID) throw new Error("This network does not support Module Mode.");
  return profiles[chainId];
}
var ethereumInfrastructure, profiles;
var init_chains2 = __esm({
  "lib/module-foundation/chains.ts"() {
    "use strict";
    init_chains();
    init_chain_1_v1();
    init_constants();
    ethereumInfrastructure = Object.freeze(Object.fromEntries(Object.keys(FOUNDATION_INFRASTRUCTURE).map((role) => [role, pin(chain_1_v1_default.contracts[role])])));
    profiles = Object.freeze({
      4663: Object.freeze({
        chainId: 4663,
        chain: robinhoodChain,
        name: "Robinhood Chain",
        explorer: "https://robinhoodchain.blockscout.com",
        infrastructure: Object.freeze(Object.fromEntries(Object.entries(FOUNDATION_INFRASTRUCTURE).map(([role, value]) => [role, Object.freeze(value)]))),
        wrappedEth: pin({ address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", runtimeCodeHash: "0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353" }),
        multicall3: pin({ address: ROBINHOOD_MULTICALL3_ADDRESS, runtimeCodeHash: ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH }),
        preparationLag: 16n,
        launchConfirmations: 0,
        publicRpcUrls: Object.freeze(["https://rpc-robinhood.blockmachine.io", "https://rpc.mainnet.chain.robinhood.com"])
      }),
      1: Object.freeze({
        chainId: 1,
        chain: mainnet,
        name: "Ethereum",
        explorer: "https://etherscan.io",
        infrastructure: ethereumInfrastructure,
        wrappedEth: pin(chain_1_v1_default.contracts.wrappedEth),
        multicall3: pin(chain_1_v1_default.contracts.multicall3),
        preparationLag: 2n,
        launchConfirmations: 64,
        // The public Tenderly gateway rejects some full launch simulations at its request limit.
        publicRpcUrls: Object.freeze(["https://ethereum-rpc.publicnode.com", "https://mainnet.gateway.tenderly.co"])
      })
    });
  }
});

// lib/module-foundation/funding-path.ts
import { encodeAbiParameters, getAddress as getAddress3, parseAbiParameters, zeroAddress } from "viem";
function encodeFoundationFundingPath(path, chainId = 4663) {
  foundationChainProfile(chainId);
  return encodeAbiParameters(foundationFundingPathParameters, [path]);
}
function assertFoundationFundingPath(quote, path, chainId = 4663) {
  const FOUNDATION_WETH = foundationChainProfile(chainId).wrappedEth.address;
  if (getAddress3(quote) === FOUNDATION_WETH) {
    if (path.length !== 0) throw new Error("WETH funding requires an empty path.");
    return;
  }
  if (path.length < 1 || path.length > 4 || getAddress3(path[0].intermediateCurrency) !== zeroAddress) throw new Error("The funding path must start with native ETH.");
  const currencies = [...path.map((hop) => getAddress3(hop.intermediateCurrency)), getAddress3(quote)];
  if (new Set(currencies).size !== currencies.length) throw new Error("The funding path must not repeat a currency.");
  for (const hop of path) {
    getAddress3(hop.hooks);
    if (!Number.isInteger(hop.fee) || hop.fee < 0 || hop.fee > 1e6 && hop.fee !== 8388608 || !Number.isInteger(hop.tickSpacing) || hop.tickSpacing < 1 || hop.tickSpacing > 32767 || !/^0x(?:[0-9a-f]{2}){0,2048}$/i.test(hop.hookData)) throw new Error("Invalid Uniswap funding path.");
  }
}
var foundationFundingPathParameters;
var init_funding_path = __esm({
  "lib/module-foundation/funding-path.ts"() {
    "use strict";
    init_chains2();
    foundationFundingPathParameters = parseAbiParameters("(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[]");
  }
});

// lib/module-foundation/abi.ts
import { encodeAbiParameters as encodeAbiParameters2, encodeFunctionData, parseAbi, parseAbiParameters as parseAbiParameters2 } from "viem";
var foundationMetadataParameters, foundationLaunchParameters, foundationLaunchParametersV3, foundationFactoryAbi, foundationFactoryV2Abi, foundationFactoryV3Abi, foundationFactoryNativeAbi, foundationFactoryV3NativeAbi, foundationHookAbi, foundationHookV2Abi, foundationQuoterAbi, foundationPermit2Abi, foundationTokenAbi, foundationLedgerAbi;
var init_abi = __esm({
  "lib/module-foundation/abi.ts"() {
    "use strict";
    init_creator_fees();
    foundationMetadataParameters = parseAbiParameters2("(string name,string symbol,string description,string imageURI,string website,bytes socialData)");
    foundationLaunchParameters = parseAbiParameters2("((string name,string symbol,string description,string imageURI,string website,bytes socialData) metadata,address quote,uint8 quoteDecimals,int24 initialTick,uint16 creatorFeeBps,uint128 additionalQuoteAmount,uint128 initialBuyQuoteAmount,uint128 initialBuyMinimumTokenAmount,uint64 deadline,bytes32 tokenSalt,bytes32 hookSalt,(address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 descriptorHash,bytes configuration,uint16 creatorShareBps)[] modules)");
    foundationLaunchParametersV3 = parseAbiParameters2("((string name,string symbol,string description,string imageURI,string website,bytes socialData) metadata,address quote,uint8 quoteDecimals,int24 initialTick,uint16 creatorBuyFeeBps,uint16 creatorSellFeeBps,uint128 additionalQuoteAmount,uint128 initialBuyQuoteAmount,uint128 initialBuyMinimumTokenAmount,uint64 deadline,bytes32 tokenSalt,bytes32 hookSalt,(address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 descriptorHash,bytes configuration,uint16 creatorShareBps)[] modules)");
    foundationFactoryAbi = parseAbi([
      "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
      "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
      "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
      "struct LaunchResult { address token; address hook; address ledger; bytes32 poolId; address baseVault; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; }",
      "function launch(LaunchParams p) returns (LaunchResult result)",
      "function launchOf(address token) view returns (LaunchResult result)",
      "function predictTokenAddress(address creator,bytes32 tokenSalt,Metadata metadata) view returns (address)",
      "function hookInitCodeHash(address creator,address predictedToken,LaunchParams p) view returns (bytes32)",
      "function predictHookAddress(address creator,address predictedToken,LaunchParams p) view returns (address)",
      "function hookDeployer() view returns (address)",
      "function VERSION_ID() view returns (bytes32)",
      "function poolManager() view returns (address)",
      "function positionManager() view returns (address)",
      "function universalRouter() view returns (address)",
      "function permit2() view returns (address)"
    ]);
    foundationFactoryV2Abi = parseAbi([
      "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
      "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
      "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
      "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }",
      "function launch(LaunchParams p) returns (LaunchResultV2 result)",
      "function launchOf(address token) view returns (LaunchResultV2 result)",
      "function predictTokenAddress(address creator,bytes32 tokenSalt,Metadata metadata) view returns (address)",
      "function hookInitCodeHash(address creator,address predictedToken,LaunchParams p) view returns (bytes32)",
      "function predictHookAddress(address creator,address predictedToken,LaunchParams p) view returns (address)",
      "function hookDeployer() view returns (address)",
      "function VERSION_ID() view returns (bytes32)",
      "function MODULE_ABI_ID() view returns (bytes32)",
      "function LP_CUSTODY_ID() view returns (bytes32)",
      "function LP_RECIPIENT() view returns (address)",
      "function ROUNDING_INVENTORY_RECIPIENT() view returns (address)",
      "function LP_FEE() view returns (uint24)",
      "function poolManager() view returns (address)",
      "function positionManager() view returns (address)",
      "function universalRouter() view returns (address)",
      "function permit2() view returns (address)",
      "event FoundationLaunchedV2(address indexed token,address indexed creator,bytes32 indexed poolId,address hook,address ledger,address quote,bytes32 metadataHash,bytes32 compositionHash,bytes32 custodyId,uint256 initialBuyQuoteAmount,LaunchResultV2 result)"
    ]);
    foundationFactoryV3Abi = parseAbi([
      "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
      "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
      "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorBuyFeeBps; uint16 creatorSellFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
      "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }",
      "function launch(LaunchParams p) returns (LaunchResultV2 result)",
      "function launchOf(address token) view returns (LaunchResultV2 result)",
      "function predictTokenAddress(address creator,bytes32 tokenSalt,Metadata metadata) view returns (address)",
      "function hookInitCodeHash(address creator,address predictedToken,LaunchParams p) view returns (bytes32)",
      "function predictHookAddress(address creator,address predictedToken,LaunchParams p) view returns (address)",
      "function hookDeployer() view returns (address)",
      "function VERSION_ID() view returns (bytes32)",
      "function MODULE_ABI_ID() view returns (bytes32)",
      "function LP_CUSTODY_ID() view returns (bytes32)",
      "function LP_RECIPIENT() view returns (address)",
      "function ROUNDING_INVENTORY_RECIPIENT() view returns (address)",
      "function LP_FEE() view returns (uint24)",
      "function poolManager() view returns (address)",
      "function positionManager() view returns (address)",
      "function universalRouter() view returns (address)",
      "function permit2() view returns (address)",
      "event FoundationLaunchedV3(address indexed token,address indexed creator,bytes32 indexed poolId,address hook,address ledger,address quote,bytes32 metadataHash,bytes32 compositionHash,bytes32 custodyId,uint256 initialBuyQuoteAmount,LaunchResultV2 result)"
    ]);
    foundationFactoryNativeAbi = [...foundationFactoryV2Abi, ...parseAbi([
      "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
      "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
      "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
      "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }",
      "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
      "function launchWithEth(LaunchParams p,PoolKey fundingPool) payable returns (LaunchResultV2 result)",
      "function launchWithEthRoute(LaunchParams p,bytes fundingPath) payable returns (LaunchResultV2 result)",
      "function NATIVE_FUNDING_ID() view returns (bytes32)",
      "function wrappedEth() view returns (address)",
      "function wrappedEthCodeHash() view returns (bytes32)"
    ])];
    foundationFactoryV3NativeAbi = [...foundationFactoryV3Abi, ...parseAbi([
      "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
      "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
      "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorBuyFeeBps; uint16 creatorSellFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
      "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }",
      "function launchWithEthRoute(LaunchParams p,bytes fundingPath) payable returns (LaunchResultV2 result)",
      "function NATIVE_FUNDING_ID() view returns (bytes32)",
      "function wrappedEth() view returns (address)",
      "function wrappedEthCodeHash() view returns (bytes32)"
    ])];
    foundationHookAbi = parseAbi([
      "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
      "function initializer() view returns (address)",
      "function token() view returns (address)",
      "function quote() view returns (address)",
      "function creator() view returns (address)",
      "function creatorFeeBps() view returns (uint16)",
      "function ledger() view returns (address)",
      "function poolId() view returns (bytes32)",
      "function poolKey() view returns (PoolKey)",
      "function initialTick() view returns (int24)",
      "function feeCarry(bool buy) view returns (uint16 platform,uint16 creator)",
      "function moduleCount() view returns (uint256)"
    ]);
    foundationHookV2Abi = parseAbi([
      "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
      "function initializer() view returns (address)",
      "function token() view returns (address)",
      "function quote() view returns (address)",
      "function creator() view returns (address)",
      "function creatorBuyFeeBps() view returns (uint16)",
      "function creatorSellFeeBps() view returns (uint16)",
      "function ledger() view returns (address)",
      "function poolId() view returns (bytes32)",
      "function poolKey() view returns (PoolKey)",
      "function initialTick() view returns (int24)",
      "function feeCarry(bool buy) view returns (uint16 platform,uint16 creator)",
      "function moduleCount() view returns (uint256)"
    ]);
    foundationQuoterAbi = parseAbi([
      "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
      "struct QuoteParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
      "function quoteExactInputSingle(QuoteParams params) returns (uint256 amountOut,uint256 gasEstimate)",
      "struct PathKey { address intermediateCurrency; uint24 fee; int24 tickSpacing; address hooks; bytes hookData; }",
      "struct QuoteExactParams { address exactCurrency; PathKey[] path; uint128 exactAmount; }",
      "function quoteExactInput(QuoteExactParams params) returns (uint256 amountOut,uint256 gasEstimate)"
    ]);
    foundationPermit2Abi = parseAbi([
      "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
      "function approve(address token,address spender,uint160 amount,uint48 expiration)"
    ]);
    foundationTokenAbi = parseAbi([
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
      "function totalSupply() view returns (uint256)",
      "function metadata() view returns (string description,string website,string image,bytes extraData)",
      "function metadataHash() view returns (bytes32)"
    ]);
    foundationLedgerAbi = parseAbi([
      "function poolManager() view returns (address)",
      "function hook() view returns (address)",
      "function quote() view returns (address)",
      "function creator() view returns (address)",
      "function platformReceived() view returns (uint256)",
      "function platformClaimed() view returns (uint256)",
      "function creatorCredited() view returns (uint256)",
      "function creatorClaimed() view returns (uint256)",
      "function claimPlatform() returns (uint256 amount)",
      "function claimCreator() returns (uint256 amount)",
      "event QuoteClaimed(address indexed beneficiary,uint8 indexed budget,uint256 amount)"
    ]);
  }
});

// lib/module-foundation/pool-key.ts
import { encodeAbiParameters as encodeAbiParameters3, getAddress as getAddress4, keccak256 as keccak2562, parseAbiParameters as parseAbiParameters3 } from "viem";
function foundationPoolKey(pool) {
  const token = getAddress4(pool.token), quote = getAddress4(pool.quote), hook = getAddress4(pool.hook);
  if (BigInt(token) === 0n || BigInt(quote) === 0n || BigInt(hook) === 0n || token === quote || token === hook || quote === hook) throw new Error("Invalid launch pool identity.");
  return {
    currency0: BigInt(token) < BigInt(quote) ? token : quote,
    currency1: BigInt(token) < BigInt(quote) ? quote : token,
    fee: FOUNDATION_LP_FEE,
    tickSpacing: FOUNDATION_TICK_SPACING,
    hooks: hook
  };
}
var init_pool_key = __esm({
  "lib/module-foundation/pool-key.ts"() {
    "use strict";
    init_constants();
  }
});

// lib/module-foundation/ethereum-graph.ts
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters as encodeAbiParameters4,
  encodeFunctionData as encodeFunctionData2,
  getAddress as getAddress5,
  keccak256 as keccak2563,
  parseAbi as parseAbi2,
  parseAbiParameters as parseAbiParameters4
} from "viem";
var launch, foundationEthereumGraphAbi, foundationEthereumStampAbi, foundationEthereumRouteParameters, fundingParameters;
var init_ethereum_graph = __esm({
  "lib/module-foundation/ethereum-graph.ts"() {
    "use strict";
    init_abi();
    init_funding_path();
    init_pool_key();
    launch = foundationFactoryV3Abi.find((item) => item.type === "function" && item.name === "launch");
    foundationEthereumGraphAbi = [{
      ...launch,
      name: "initializeGraph",
      stateMutability: "payable",
      inputs: [...launch.inputs, { name: "token", type: "address" }, { name: "hook", type: "address" }, { name: "fundingPath", type: "bytes" }]
    }, ...parseAbi2([
      "function implementation() view returns (address)",
      "function implementationCodeHash() view returns (bytes32)",
      "function GRAPH_FACTORY() view returns (address)",
      "function LAUNCH_WALLET() view returns (address)",
      "function parametersHash() view returns (bytes32)",
      "function initialized() view returns (bool)"
    ])];
    foundationEthereumStampAbi = parseAbi2([
      "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
      "struct Component { uint8 resultIndex; address account; bytes32 runtimeCodeHash; uint8 kind; uint8 scope; }",
      "struct Stamp { bytes32 launchId; address token; bytes32 tokenRuntimeCodeHash; PoolKey poolKey; bytes32 hookRuntimeCodeHash; Component[] components; }",
      "struct Permit { uint256 chainId; address router; address launchWallet; uint8 kind; bytes32 routePayloadHash; bytes32 expectedResultHash; bytes32 stampRequestHash; bytes32 nonce; uint64 validAfter; uint64 deadline; uint256 value; }",
      "function launchAndStampV1(Permit permit,Stamp stampRequest,bytes routePayload,bytes signature) payable returns (bytes32)"
    ]);
    foundationEthereumRouteParameters = parseAbiParameters4(
      "(bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,bytes32 graphCommitment,(bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes initCode,bytes initializerCalldata)[] targets,(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)[] expectedOutputs,bytes32 expectedGraphDeploymentHash)"
    );
    fundingParameters = parseAbiParameters4("(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[]");
  }
});

// lib/module-foundation/ethereum-graph-plan.ts
import {
  concatHex,
  encodeAbiParameters as encodeAbiParameters5,
  encodeFunctionData as encodeFunctionData3,
  getAddress as getAddress6,
  getContractAddress,
  keccak256 as keccak2564,
  parseAbiParameters as parseAbiParameters5,
  stringToHex as stringToHex2
} from "viem";
function foundationEthereumTargetSalt(identity, target2) {
  if (![identity.routeNamespace, identity.routeNonce, identity.topologyHash, target2.targetIdHash].every(nonzero)) fail();
  return keccak2564(encodeAbiParameters5(
    parseAbiParameters5("bytes32,uint256,address,bytes32,bytes32,bytes32,bytes32,address"),
    [types.salt, 1n, factory, identity.routeNamespace, identity.routeNonce, target2.targetIdHash, target2.applicantSalt, router]
  ));
}
function predictFoundationEthereumTarget(identity, target2) {
  return getContractAddress({
    opcode: "CREATE2",
    from: factory,
    salt: foundationEthereumTargetSalt(identity, target2),
    bytecodeHash: keccak2564(target2.initCode)
  });
}
function foundationEthereumGraphCommitment(identity, targets) {
  if (targets.length !== 3 || ![identity.routeNamespace, identity.routeNonce, identity.topologyHash].every(nonzero)) fail();
  let totalValue = 0n, totalBytes = 0;
  const addresses = /* @__PURE__ */ new Set();
  const commitments = targets.map((target2, index) => {
    if (!same(target2.targetIdHash, hash(["engine", "token", "hook"][index])) || target2.deploymentValue !== 0n || target2.initializerValue < 0n || index > 0 && (target2.initializerValue !== 0n || target2.initializerCalldata !== "0x") || index === 0 && target2.initializerCalldata === "0x" || !/^0x(?:[0-9a-f]{2})+$/i.test(target2.initCode) || target2.initCode.length > 49152 * 2 + 2 || !/^0x(?:[0-9a-f]{2})*$/i.test(target2.initializerCalldata) || target2.initializerCalldata.length > 131072 * 2 + 2) fail();
    const address = predictFoundationEthereumTarget(identity, target2);
    if (addresses.has(address)) fail();
    addresses.add(address);
    totalValue += target2.initializerValue;
    totalBytes += (target2.initCode.length + target2.initializerCalldata.length - 4) / 2;
    return keccak2564(encodeAbiParameters5(
      parseAbiParameters5("bytes32,uint256,bytes32,bytes32,uint256,uint256,bytes32,bytes32"),
      [
        types.target,
        BigInt(index),
        target2.targetIdHash,
        target2.applicantSalt,
        target2.deploymentValue,
        target2.initializerValue,
        keccak2564(target2.initCode),
        keccak2564(target2.initializerCalldata)
      ]
    ));
  });
  if (totalBytes > 524288 || totalValue > (1n << 127n) - 1n) fail();
  const graphCommitment = keccak2564(encodeAbiParameters5(
    parseAbiParameters5("bytes32,uint256,address,bytes32,bytes32,bytes32,address,uint256,bytes32"),
    [
      types.graph,
      1n,
      factory,
      identity.routeNamespace,
      identity.routeNonce,
      identity.topologyHash,
      router,
      totalValue,
      keccak2564(encodeAbiParameters5(parseAbiParameters5("bytes32[]"), [commitments]))
    ]
  ));
  return { graphCommitment, totalValue };
}
function prepareFoundationEthereumStamp(input) {
  const { identity, targets, outputs } = input;
  const { graphCommitment, totalValue } = foundationEthereumGraphCommitment(identity, targets);
  if (!nonzero(input.launchId) || BigInt(getAddress6(input.account)) === 0n || outputs.length !== 3 || input.validAfter < 0n || input.deadline <= input.validAfter || input.deadline - input.validAfter > 3600n || input.deadline > (1n << 64n) - 1n) fail();
  let graphDeploymentHash = graphCommitment;
  const outputHashes = outputs.map((output, index) => {
    const target2 = targets[index];
    if (output.targetIndex !== index || !same(output.targetIdHash, target2.targetIdHash) || !nonzero(output.runtimeCodeHash) || !same(output.account, predictFoundationEthereumTarget(identity, target2))) fail();
    graphDeploymentHash = keccak2564(encodeAbiParameters5(
      parseAbiParameters5("bytes32,bytes32,uint256,bytes32,address,bytes32,bytes32,bytes32,bytes32,uint256,uint256"),
      [
        types.accumulator,
        graphDeploymentHash,
        BigInt(index),
        target2.targetIdHash,
        output.account,
        foundationEthereumTargetSalt(identity, target2),
        keccak2564(target2.initCode),
        keccak2564(target2.initializerCalldata),
        output.runtimeCodeHash,
        target2.deploymentValue,
        target2.initializerValue
      ]
    ));
    return keccak2564(encodeAbiParameters5(
      parseAbiParameters5("bytes32,uint8,bytes32,address,bytes32"),
      [types.output, index, output.targetIdHash, output.account, output.runtimeCodeHash]
    ));
  });
  const { poolKey } = input;
  if (!same(poolKey.hooks, outputs[2].account) || poolKey.fee !== 0 || poolKey.tickSpacing !== 60 || BigInt(poolKey.currency0) >= BigInt(poolKey.currency1) || ![poolKey.currency0, poolKey.currency1].some((currency) => same(currency, outputs[1].account))) fail();
  const components = outputs.map((output, index) => ({
    resultIndex: index,
    account: output.account,
    runtimeCodeHash: output.runtimeCodeHash,
    kind: index === 1 ? 1 : index === 2 ? 2 : 0,
    scope: 1
  })).sort((a, b) => BigInt(a.account) < BigInt(b.account) ? -1 : 1);
  const componentSetHash = keccak2564(concatHex(components.map((component) => keccak2564(encodeAbiParameters5(
    parseAbiParameters5("bytes32,uint8,address,bytes32,uint8,uint8"),
    [types.component, component.resultIndex, component.account, component.runtimeCodeHash, component.kind, component.scope]
  )))));
  const poolKeyHash = keccak2564(encodeAbiParameters5(
    parseAbiParameters5("bytes32,address,address,uint24,int24,address"),
    [types.pool, poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  ));
  const stamp = {
    launchId: input.launchId,
    token: outputs[1].account,
    tokenRuntimeCodeHash: outputs[1].runtimeCodeHash,
    poolKey,
    hookRuntimeCodeHash: outputs[2].runtimeCodeHash,
    components
  };
  const stampRequestHash = keccak2564(encodeAbiParameters5(
    parseAbiParameters5("bytes32,bytes32,address,bytes32,bytes32,bytes32,bytes32"),
    [types.stamp, stamp.launchId, stamp.token, stamp.tokenRuntimeCodeHash, poolKeyHash, stamp.hookRuntimeCodeHash, componentSetHash]
  ));
  const route = { ...identity, graphCommitment, targets, expectedOutputs: outputs, expectedGraphDeploymentHash: graphDeploymentHash };
  const routePayload = encodeAbiParameters5(foundationEthereumRouteParameters, [route]);
  const expectedResultHash = keccak2564(encodeAbiParameters5(
    parseAbiParameters5("bytes32,bytes32,bytes32"),
    [types.result, keccak2564(concatHex(outputHashes)), graphDeploymentHash]
  ));
  const permit = {
    chainId: 1n,
    router,
    launchWallet: getAddress6(input.account),
    kind: 1,
    routePayloadHash: keccak2564(routePayload),
    expectedResultHash,
    stampRequestHash,
    nonce: identity.routeNonce,
    validAfter: input.validAfter,
    deadline: input.deadline,
    value: totalValue
  };
  return { route, routePayload, stamp, permit };
}
function encodeFoundationEthereumStamp(plan, signature) {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(signature)) throw new Error("The launch authority has not signed this plan.");
  return { to: router, value: plan.permit.value, data: encodeFunctionData3({
    abi: foundationEthereumStampAbi,
    functionName: "launchAndStampV1",
    args: [plan.permit, plan.stamp, plan.routePayload, signature]
  }) };
}
var hash, factory, router, same, nonzero, fail, types;
var init_ethereum_graph_plan = __esm({
  "lib/module-foundation/ethereum-graph-plan.ts"() {
    "use strict";
    init_chain_1_v1();
    init_ethereum_graph();
    hash = (text) => keccak2564(stringToHex2(text));
    factory = getAddress6(chain_1_v1_default.canonicalStamp.graphFactory.address);
    router = getAddress6(chain_1_v1_default.canonicalStamp.router.address);
    same = (a, b) => a.toLowerCase() === b.toLowerCase();
    nonzero = (value) => /^0x[0-9a-f]{64}$/i.test(value) && BigInt(value) !== 0n;
    fail = () => {
      throw new Error("The Ethereum module graph does not match its exact launch plan.");
    };
    types = {
      salt: hash("ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)"),
      target: hash("ProgrammableCreate2GraphTargetCommitmentV1(uint256 targetIndex,bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes32 initCodeHash,bytes32 initializerCalldataHash)"),
      graph: hash("ProgrammableCreate2GraphCommitmentV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,address authorizedLauncher,uint256 totalValue,bytes32 targetCommitmentsHash)"),
      accumulator: hash("ProgrammableCreate2GraphDeploymentAccumulatorV1(bytes32 previous,uint256 targetIndex,bytes32 targetIdHash,address deployment,bytes32 effectiveSalt,bytes32 initCodeHash,bytes32 initializerCalldataHash,bytes32 runtimeCodeHash,uint256 deploymentValue,uint256 initializerValue)"),
      output: hash("ProgrammableExpectedGraphOutputV1(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)"),
      result: hash("ProgrammableExpectedGraphResultV1(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)"),
      component: hash("ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)"),
      pool: hash("ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"),
      stamp: hash("ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)")
    };
  }
});

// lib/module-foundation/ethereum-graph-builder.ts
import {
  concatHex as concatHex2,
  encodeAbiParameters as encodeAbiParameters6,
  encodeFunctionData as encodeFunctionData4,
  getAddress as getAddress7,
  getContractAddress as getContractAddress2,
  keccak256 as keccak2565,
  parseAbiParameters as parseAbiParameters6,
  stringToHex as stringToHex3,
  toHex
} from "viem";

// contracts/spec/module-foundation/ethereum-graph-bytecode.v1.json
var ethereum_graph_bytecode_v1_default = {
  schemaVersion: "programmable.ethereum-module-bytecode.v1",
  sourceCommit: "92ff1f513c47fe94ddc1022babffdf95ad47d76b",
  compilerVersion: "0.8.26+commit.8a97fa7a",
  evmVersion: "cancun",
  viaIR: true,
  optimizerRuns: 200,
  contracts: {
    FoundationEthereumGraphProxyV1: {
      constructorInputs: [
        {
          name: "target",
          type: "address",
          internalType: "address"
        },
        {
          name: "expectedCodeHash",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "launchWallet",
          type: "address",
          internalType: "address"
        }
      ],
      creationBytecode: "0x60c0806040523461019d576060816102dd803803809161001f82856101bf565b83398101031261019d57610032816101e2565b906100446040602083015192016101e2565b91803b1580156101b4575b801561012b575b61011c575f9283928260805260a052604051602081019163160e6c7760e11b835260018060a01b03166024820152602481526100936044826101bf565b51915af43d15610114573d906001600160401b03821161010057604051916100c5601f8201601f1916602001846101bf565b82523d5f602084013e5b156100f85760405160e690816101f782396080518181816079015260b5015260a0518160420152f35b602081519101fd5b634e487b7160e01b5f52604160045260245ffd5b6060906100cf565b63340aafcd60e11b5f5260045ffd5b50604051630e64f2e760e11b81526020816004816001600160a01b0386165afa9081156101a9575f9161016b575b506001600160a01b0316331415610056565b90506020813d6020116101a1575b81610186602093836101bf565b8101031261019d57610197906101e2565b5f610159565b5f80fd5b3d9150610179565b6040513d5f823e3d90fd5b5081813f141561004f565b601f909101601f19168101906001600160401b0382119082101761010057604052565b51906001600160a01b038216820361019d5756fe608060405260043610156015575b3660ab5760ab565b5f3560e01c80635c60da1b1460695763bc0a398103600d57346065575f36600319011260655760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b5f80fd5b346065575f3660031901126065577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03166080908152602090f35b365f80375f8036817f00000000000000000000000000000000000000000000000000000000000000005af43d5f803e1560e2573d5ff35b3d5ffd",
      creationCodeHash: "0xe2ba5ed961f1fe0ab04df8f6c50e10cb54b2e8366cc918648df815dc779dd4f8",
      runtimeTemplate: "0x608060405260043610156015575b3660ab5760ab565b5f3560e01c80635c60da1b1460695763bc0a398103600d57346065575f36600319011260655760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b5f80fd5b346065575f3660031901126065577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03166080908152602090f35b365f80375f8036817f00000000000000000000000000000000000000000000000000000000000000005af43d5f803e1560e2573d5ff35b3d5ffd",
      immutableReferences: [
        {
          start: 121,
          length: 32
        },
        {
          start: 181,
          length: 32
        },
        {
          start: 66,
          length: 32
        }
      ],
      sources: {
        "lib/openzeppelin-contracts/contracts/interfaces/IERC1363.sol": "0x9b6b3e7803bc5f2f8cd7ad57db8ac1def61a9930a5a3107df4882e028a9605d7",
        "lib/openzeppelin-contracts/contracts/interfaces/IERC165.sol": "0xde7e9fd9aee8d4f40772f96bb3b58836cbc6dfc0227014a061947f8821ea9724",
        "lib/openzeppelin-contracts/contracts/interfaces/IERC20.sol": "0xce41876e78d1badc0512229b4d14e4daf83bc1003d7f83978d18e0e56f965b9c",
        "lib/openzeppelin-contracts/contracts/interfaces/draft-IERC6093.sol": "0x880da465c203cec76b10d72dbd87c80f387df4102274f23eea1f9c9b0918792b",
        "lib/openzeppelin-contracts/contracts/proxy/Proxy.sol": "0xc3f2ec76a3de8ed7a7007c46166f5550c72c7709e3fc7e8bb3111a7191cdedbd",
        "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol": "0x41f6b3b9e030561e7896dbef372b499cc8d418a80c3884a4d65a68f2fdc7493a",
        "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol": "0xe06a3f08a987af6ad2e1c1e774405d4fe08f1694b67517438b467cecf0da0ef7",
        "lib/openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol": "0x70f2f713b13b7ce4610bcd0ac9fec0f3cc43693b043abcb8dc40a42a726eb330",
        "lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol": "0x982c5cb790ab941d1e04f807120a71709d4c313ba0bfc16006447ffbd27fbbd5",
        "lib/openzeppelin-contracts/contracts/token/ERC721/IERC721.sol": "0x5dc63d1c6a12fe1b17793e1745877b2fcbe1964c3edfd0a482fac21ca8f18261",
        "lib/openzeppelin-contracts/contracts/utils/Context.sol": "0x493033a8d1b176a037b2cc6a04dad01a5c157722049bbecf632ca876224dd4b2",
        "lib/openzeppelin-contracts/contracts/utils/ReentrancyGuardTransient.sol": "0xe56ff5015046505f81f9d62671a784e933dd099db4c3a8fa8de598f20af2c5a3",
        "lib/openzeppelin-contracts/contracts/utils/TransientSlot.sol": "0xac673fa1e374d9e6107504af363333e3e5f6344d2e83faf57d9bfd41d77cc946",
        "lib/openzeppelin-contracts/contracts/utils/introspection/IERC165.sol": "0x79796192ec90263f21b464d5bc90b777a525971d3de8232be80d9c4f9fb353b8",
        "lib/openzeppelin-uniswap-hooks/src/base/BaseHook.sol": "0x4a3534932ad54cdacf8bcd60489bf9df253ad5daa8dd5599753312844e4af45c",
        "lib/permit2/src/interfaces/IAllowanceTransfer.sol": "0x37f0ac203b6ef605c9533e1a739477e8e9dcea90710b40e645a367f8a21ace29",
        "lib/permit2/src/interfaces/IEIP712.sol": "0xfdccf2b9639070803cd0e4198427fb0df3cc452ca59bd3b8a0d957a9a4254138",
        "lib/v4-core/src/interfaces/IExtsload.sol": "0x80b53ca4907d6f0088c3b931f2b72cad1dc4615a95094d96bd0fb8dff8d5ba43",
        "lib/v4-core/src/interfaces/IExttload.sol": "0xc6b68283ebd8d1c789df536756726eed51c589134bb20821b236a0d22a135937",
        "lib/v4-core/src/interfaces/IHooks.sol": "0xc131ffa2d04c10a012fe715fe2c115811526b7ea34285cf0a04ce7ce8320da8d",
        "lib/v4-core/src/interfaces/IPoolManager.sol": "0xbdab3544da3d32dfdf7457baa94e17d5a3012952428559e013ffac45d067038e",
        "lib/v4-core/src/interfaces/IProtocolFees.sol": "0x32a666e588a2f66334430357bb1e2424fe7eebeb98a3364b1dd16eb6ccca9848",
        "lib/v4-core/src/interfaces/callback/IUnlockCallback.sol": "0x58c82f2bd9d7c097ed09bd0991fedc403b0ec270eb3d0158bfb095c06a03d719",
        "lib/v4-core/src/interfaces/external/IERC20Minimal.sol": "0xeccadf1bf69ba2eb51f2fe4fa511bc7bb05bbd6b9f9a3cb8e5d83d9582613e0f",
        "lib/v4-core/src/interfaces/external/IERC6909Claims.sol": "0xa586f345739e52b0488a0fe40b6e375cce67fdd25758408b0efcb5133ad96a48",
        "lib/v4-core/src/libraries/BitMath.sol": "0x51b9be4f5c4fd3e80cbc9631a65244a2eb2be250b6b7f128a2035080e18aee8d",
        "lib/v4-core/src/libraries/CustomRevert.sol": "0x111ed3031b6990c80a93ae35dde6b6ac0b7e6af471388fdd7461e91edda9b7de",
        "lib/v4-core/src/libraries/FixedPoint128.sol": "0xad236e10853f4b4b20a35a9bb52b857c4fc79874846b7e444e06ead7f2630542",
        "lib/v4-core/src/libraries/FixedPoint96.sol": "0xef5c3fd41aee26bb12aa1c32873cfee88e67eddfe7c2b32283786265ac669741",
        "lib/v4-core/src/libraries/FullMath.sol": "0x4fc73a00817193fd3cac1cc03d8167d21af97d75f1815a070ee31a90c702b4c2",
        "lib/v4-core/src/libraries/Hooks.sol": "0xd679b4b2d429689bc44f136050ebc958fb2d7d0d3a3c7b3e48c08ab4fba09aaa",
        "lib/v4-core/src/libraries/LPFeeLibrary.sol": "0xbf6914e01014e7c1044111feb7df7a3d96bb503b3da827ad8464b1955580d13b",
        "lib/v4-core/src/libraries/LiquidityMath.sol": "0x000ef2eadcc1eb7b2c18a77655f94e76e0e860f605783484657ef65fd6eda353",
        "lib/v4-core/src/libraries/ParseBytes.sol": "0x7533b13f53ee2c2c55500100b22ffd6e37e7523c27874edc98663d53a8672b15",
        "lib/v4-core/src/libraries/Pool.sol": "0xb8191707c5913f5e2f589cec5167e3fac4a5b86bd84f61fdba0fbe6a8ce8a3a0",
        "lib/v4-core/src/libraries/Position.sol": "0xddab2a831f1befb6abf5567e77c4582169ca8156cf69eb4f22d8e87f7226a3f9",
        "lib/v4-core/src/libraries/ProtocolFeeLibrary.sol": "0xf483001899229ab10f5a626fe1c5866134d9e965b48ce6cf55ce0d7f74f7d8ec",
        "lib/v4-core/src/libraries/SafeCast.sol": "0x42c4a24f996a14d358be397b71f7ec9d7daf666aaec78002c63315a6ee67aa86",
        "lib/v4-core/src/libraries/SqrtPriceMath.sol": "0xf8079fe6e3460db495451d06b1705e18f1c4075c1af96a31ad313545f7082982",
        "lib/v4-core/src/libraries/SwapMath.sol": "0x6baa782ae523269c079cc763639a9b91a25fcfa1743c049c76e43741ef494bd9",
        "lib/v4-core/src/libraries/TickBitmap.sol": "0x6779f89e28a0b4af6e09d518caf014b7e8fc627400f5561f86fed11635b1458a",
        "lib/v4-core/src/libraries/TickMath.sol": "0x4e1a11e154eb06106cb1c4598f06cca5f5ca16eaa33494ba2f0e74981123eca8",
        "lib/v4-core/src/libraries/UnsafeMath.sol": "0xa6e55e0a43a15df2df471d9972cd48f613d07c663ecb8bbeaf7623f6f99bcce4",
        "lib/v4-core/src/types/BalanceDelta.sol": "0xa719c8fe51e0a9524280178f19f6851bcc3b3b60e73618f3d60905d35ae5569f",
        "lib/v4-core/src/types/BeforeSwapDelta.sol": "0x2a774312d91285313d569da1a718c909655da5432310417692097a1d4dc83a78",
        "lib/v4-core/src/types/Currency.sol": "0x4a0b84b282577ff6f8acf13ec9f4d32dbb9348748b49611d00e68bee96609c93",
        "lib/v4-core/src/types/PoolId.sol": "0x308311916ea0f5c2fd878b6a2751eb223d170a69e33f601fae56dfe3c5d392af",
        "lib/v4-core/src/types/PoolKey.sol": "0xf89856e0580d7a4856d3187a76858377ccee9d59702d230c338d84388221b786",
        "lib/v4-core/src/types/PoolOperation.sol": "0x7a1a107fc1f2208abb2c9364c8c54e56e98dca27673e9441bed2b949b6382162",
        "lib/v4-core/src/types/Slot0.sol": "0x8b4912fac7e25ea680056748121113f902d56f8b2640f421d5c38d438db11c1b",
        "lib/v4-periphery-v211/src/interfaces/IImmutableState.sol": "0x36ab3100e87457ecf04887f4f540e34fd7f21d8e3b83880cb679239e60b7b06b",
        "lib/v4-periphery-v211/src/interfaces/IV4Router.sol": "0xff381f7dd24ae4c7a5511b0ffa6b0f11c1314b633c1a818502d0fb43fef83cf7",
        "lib/v4-periphery-v211/src/libraries/Actions.sol": "0x3d7eb71bb13b47131f523947beccb613dddc5b619d9cdb93209db969c89e94b5",
        "lib/v4-periphery-v211/src/libraries/PathKey.sol": "0xbbd79ffefe045f025263e389539021266fb4d371463aefba405e1ff1d3fcf9bc",
        "lib/v4-periphery/src/interfaces/IEIP712_v4.sol": "0xd7f7115476e307a0bfc32a0f0a0f5434e9e5ca62a6c5af1e18b75e48161bb408",
        "lib/v4-periphery/src/interfaces/IERC721Permit_v4.sol": "0x103adbba724ef536abc536fe8a4d7dc12880724c562109b69f2adce4a91fa017",
        "lib/v4-periphery/src/interfaces/IImmutableState.sol": "0x36ab3100e87457ecf04887f4f540e34fd7f21d8e3b83880cb679239e60b7b06b",
        "lib/v4-periphery/src/interfaces/IMulticall_v4.sol": "0x336bec303f7ff86497d2679464c5adad5040f412b3d0769ce5e1d2a42f7e2c08",
        "lib/v4-periphery/src/interfaces/INotifier.sol": "0xfdc5187a98240a1691aae98b7dd2444d4c2bfb4746f3c34de9f3d18399c17c5e",
        "lib/v4-periphery/src/interfaces/IPermit2Forwarder.sol": "0xfad472937280e861125ff12aa6f9c2cf7440fbb20a2cc29485c24662ad4279c5",
        "lib/v4-periphery/src/interfaces/IPoolInitializer_v4.sol": "0x2e4feda94650a2642039e0309ffdec480ee050bc40864bf5e1dba42bb4dc9e98",
        "lib/v4-periphery/src/interfaces/IPositionManager.sol": "0x62dfa0cbee8314ee7e6787db8bc1d364245c340f940875ac7ff11e89d074fc7e",
        "lib/v4-periphery/src/interfaces/ISubscriber.sol": "0x34ceadec4a63019680e543fe73197f198a55c825d86e18f327840354760b57e7",
        "lib/v4-periphery/src/interfaces/IUnorderedNonce.sol": "0xd7f32fee74dc7d1a3b078ca1263961baccaa6bf434c79e8fe0e092e30c3e0ec3",
        "lib/v4-periphery/src/libraries/Actions.sol": "0x8efd4b8b289177ee27e557d9d0a5a9f973d66fe1eb1ef8959d316b11987ca830",
        "lib/v4-periphery/src/libraries/LiquidityAmounts.sol": "0x8ea74b89831877ffe657f8461164a01a6f3c7e46f415410854fca8d28a8cab53",
        "lib/v4-periphery/src/libraries/PositionInfoLibrary.sol": "0xc5ddf96bd088bc87ea50a20f907fc932fb28397a42682a301b268a11b7f34078",
        "src/module-foundation/FoundationEthereumGraphLaunchV1.sol": "0x41d0ea8ced681f1f4cf83d1020768c3341ca7eba973f6cbccb784983c9eb1e7f",
        "src/module-foundation/FoundationEthereumGraphProxyV1.sol": "0x77f6da3ec65c8076751544b5957305e8780a04185fe5cdbe34f07f0e5a44fd6e",
        "src/module-foundation/FoundationFactoryV2.sol": "0xf5e59c6a003c0df59a1adb9f3672f10416aa0765fabf4a657b3d4590e18c1f83",
        "src/module-foundation/FoundationFactoryV2Native.sol": "0xd70d6609a355cd9a84b2b1712b67c88d359ed517ed0f75d70e04387f5fbe2cf1",
        "src/module-foundation/FoundationFactoryV3.sol": "0x70d4c73aa261328a2434071827eafa597713c63f104b4ffe1291899a38b542e7",
        "src/module-foundation/FoundationFactoryV3EthereumNative.sol": "0x8d3e7d81f636d5dce2b50897f5193ed8750e26e5b9eca893a3914188523d0144",
        "src/module-foundation/FoundationFactoryV3NativeBase.sol": "0x28122f55e9dd018dcef440249f19f4276c3b8ad8072227067e4b18c75a042314",
        "src/module-foundation/FoundationFeeMathV1.sol": "0x27a21ffdd2d6b61f4a292c8fc1907fad1ac10ab1adc2b1deade67950011f67cd",
        "src/module-foundation/FoundationHookDeployerV1.sol": "0xf3c497b9b5b5fe65dfe867c0d2e839e740c14c9c08b88fd7b318729458bbd6f1",
        "src/module-foundation/FoundationHookDeployerV2.sol": "0xd9885270995cd17faf953fde523172076558e2f7a3d9420af50765dd7978a2e5",
        "src/module-foundation/FoundationHookV1.sol": "0x2ba605b3a0e84ea2580b3d2cb4880a253e26a607d7bf05b5609c46ab7ca14621",
        "src/module-foundation/FoundationHookV2.sol": "0x8c8cfa62ecf96e632943246eb55ff3b42489ade7043873583d66b6e55f04635e",
        "src/module-foundation/FoundationLaunchTypesV2.sol": "0x9a99ffb9f615518b19413386c5344f7b3cc0e25d4d46bef38da1ed2bcf6f3d94",
        "src/module-foundation/FoundationLaunchTypesV3.sol": "0x500b17a5251adf6d452bffc5003922a9168df45ade510e0341f1436f5f6f837d",
        "src/module-foundation/FoundationLedgerV1.sol": "0x47895ccfb4ac77fd72bf2004d11740f71b5e2b492d760736cb365949c21747c2",
        "src/module-foundation/FoundationTokenV1.sol": "0x28ad9a130f32c14d931da364f529c63a207b9476bfc19c67751d9df0d568397d",
        "src/module-foundation/FoundationTypesV1.sol": "0x1c1782146f0a707c7171068ba5a061dd2e2562d5cfa96d627107fcca0b5f12e8",
        "src/module-foundation/IFoundationModuleV1.sol": "0xd1b2e59ed62f5b4dbe1171a8686175b3270c9f31d7c25345e66e88be0ceef1fe"
      }
    },
    FoundationTokenV1: {
      constructorInputs: [
        {
          name: "m",
          type: "tuple",
          internalType: "struct FoundationTypesV1.Metadata",
          components: [
            {
              name: "name",
              type: "string",
              internalType: "string"
            },
            {
              name: "symbol",
              type: "string",
              internalType: "string"
            },
            {
              name: "description",
              type: "string",
              internalType: "string"
            },
            {
              name: "imageURI",
              type: "string",
              internalType: "string"
            },
            {
              name: "website",
              type: "string",
              internalType: "string"
            },
            {
              name: "socialData",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        },
        {
          name: "recipient",
          type: "address",
          internalType: "address"
        }
      ],
      creationBytecode: "0x60a080604052346109eb5761152b803803809161001c82856109ef565b83398101906040818303126109eb5780516001600160401b0381116109eb57810160c0818403126109eb576040519160c083016001600160401b038111848210176106075760405281516001600160401b0381116109eb5784610080918401610a57565b835260208201516001600160401b0381116109eb57846100a1918401610a57565b6020840190815260408301519091906001600160401b0381116109eb57856100ca918501610a57565b6040850190815260608401519093906001600160401b0381116109eb57866100f3918301610a57565b6060860190815260808201519096906001600160401b0381116109eb578161011c918401610a57565b6080870190815260a083015190926001600160401b0382116109eb570181601f820112156109eb57602091818361015593519101610a12565b60a087019081529201516001600160a01b03811696908790036109eb5785518451815190916001600160401b03821161060757610193600354610a74565b601f811161099d575b50602090601f8311600114610938576101cc92915f918361053e575b50508160011b915f199060031b1c19161790565b6003555b8051906001600160401b038211610607576101ec600454610a74565b601f81116108ea575b50602090601f83116001146108855761022492915f918361053e5750508160011b915f199060031b1c19161790565b6004555b855151801590811561087a575b508015610870575b8015610864575b8015610857575b801561084d575b8015610840575b8015610833575b8015610826575b6108175784518051906001600160401b03821161060757610289600554610a74565b601f81116107e6575b50602090601f8311600114610781576102c192915f918361053e5750508160011b915f199060031b1c19161790565b6005555b80518051906001600160401b038211610607576102e3600654610a74565b601f8111610733575b50602090601f83116001146106ce5761031b92915f918361053e5750508160011b915f199060031b1c19161790565b6006555b81518051906001600160401b0382116106075761033d600754610a74565b601f8111610680575b50602090601f831160011461061b5761037592915f918361053e5750508160011b915f199060031b1c19161790565b6007555b82518051906001600160401b03821161060757610397600854610a74565b601f81116105ae575b50602090601f8311600114610549576103cf92915f918361053e5750508160011b915f199060031b1c19161790565b6008555b604051948594602086019760208952516040870160c0905261010087016103f991610ac2565b9051868203603f190160608801526104119190610ac2565b9051858203603f190160808701526104299190610ac2565b9051848203603f190160a08601526104419190610ac2565b9051838203603f190160c08501526104599190610ac2565b9051828203603f190160e08401526104719190610ac2565b03601f198101825261048390826109ef565b519020608052801561052b576002546b033b2e3c9fd0803ce8000000810180911161051757600255805f525f60205260405f206b033b2e3c9fd0803ce800000081540190555f7fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef60206040516b033b2e3c9fd0803ce80000008152a3604051610a449081610ae78239608051816101670152f35b634e487b7160e01b5f52601160045260245ffd5b63ec442f0560e01b5f525f60045260245ffd5b015190505f806101b8565b90601f1983169160085f52815f20925f5b818110610596575090846001959493921061057e575b505050811b016008556103d3565b01515f1960f88460031b161c191690555f8080610570565b9293602060018192878601518155019501930161055a565b60085f526105f7907ff3f7a9fe364faab93b216da50a3214154f22a0a2b415b23a84c8169e8b636ee3601f850160051c810191602086106105fd575b601f0160051c0190610aac565b5f6103a0565b90915081906105ea565b634e487b7160e01b5f52604160045260245ffd5b90601f1983169160075f52815f20925f5b8181106106685750908460019594939210610650575b505050811b01600755610379565b01515f1960f88460031b161c191690555f8080610642565b9293602060018192878601518155019501930161062c565b60075f526106c8907fa66cc928b5edb82af9bd49922954155ab7b0942694bea4ce44661d9a8736c688601f850160051c810191602086106105fd57601f0160051c0190610aac565b5f610346565b90601f1983169160065f52815f20925f5b81811061071b5750908460019594939210610703575b505050811b0160065561031f565b01515f1960f88460031b161c191690555f80806106f5565b929360206001819287860151815501950193016106df565b60065f5261077b907ff652222313e28459528d920b65115c16c04f3efc82aaedc97be59f3f377c0d3f601f850160051c810191602086106105fd57601f0160051c0190610aac565b5f6102ec565b90601f1983169160055f52815f20925f5b8181106107ce57509084600195949392106107b6575b505050811b016005556102c5565b01515f1960f88460031b161c191690555f80806107a8565b92936020600181928786015181550195019301610792565b6108119060055f5260205f20601f850160051c810191602086106105fd57601f0160051c0190610aac565b5f610292565b635e765b2560e11b5f5260045ffd5b506104b083515111610267565b5061080082515111610260565b5061080081515111610259565b5080515115610252565b506101188551511161024b565b50600c84515111610244565b508351511561023d565b60309150115f610235565b90601f1983169160045f52815f20925f5b8181106108d257509084600195949392106108ba575b505050811b01600455610228565b01515f1960f88460031b161c191690555f80806108ac565b92936020600181928786015181550195019301610896565b60045f52610932907f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b601f850160051c810191602086106105fd57601f0160051c0190610aac565b5f6101f5565b90601f1983169160035f52815f20925f5b818110610985575090846001959493921061096d575b505050811b016003556101d0565b01515f1960f88460031b161c191690555f808061095f565b92936020600181928786015181550195019301610949565b60035f526109e5907fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b601f850160051c810191602086106105fd57601f0160051c0190610aac565b5f61019c565b5f80fd5b601f909101601f19168101906001600160401b0382119082101761060757604052565b9192916001600160401b0382116106075760405191610a3b601f8201601f1916602001846109ef565b8294818452818301116109eb578281602093845f96015e010152565b9080601f830112156109eb578151610a7192602001610a12565b90565b90600182811c92168015610aa2575b6020831014610a8e57565b634e487b7160e01b5f52602260045260245ffd5b91607f1691610a83565b818110610ab7575050565b5f8155600101610aac565b805180835260209291819084018484015e5f828201840152601f01601f191601019056fe60806040526004361015610011575f80fd5b5f3560e01c806306fdde03146105c1578063095ea7b31461053f57806318160ddd1461052257806323b872dd14610443578063313ce56714610428578063392f37e9146103ad57806342966c681461030d578063609d3334146102f257806370a08231146102bb5780637284e416146102a057806395d89b41146101d6578063a9059cbb146101a5578063beb0a4161461018a578063c5a1d7f014610150578063dd62ed3e146101005763f3ccaac0146100c9575f80fd5b346100fc575f3660031901126100fc576100f86100e4610905565b604051918291602083526020830190610666565b0390f35b5f80fd5b346100fc5760403660031901126100fc5761011961068a565b6101216106a0565b6001600160a01b039182165f908152600160209081526040808320949093168252928352819020549051908152f35b346100fc575f3660031901126100fc5760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b346100fc575f3660031901126100fc576100f86100e4610870565b346100fc5760403660031901126100fc576101cb6101c161068a565b602435903361099a565b602060405160018152f35b346100fc575f3660031901126100fc576040515f6004546101f6816106b6565b808452906001811690811561027c575060011461021e575b6100f8836100e4818503826106ee565b60045f9081527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b939250905b808210610262575090915081016020016100e461020e565b91926001816020925483858801015201910190929161024a565b60ff191660208086019190915291151560051b840190910191506100e4905061020e565b346100fc575f3660031901126100fc576100f86100e46107db565b346100fc5760203660031901126100fc576001600160a01b036102dc61068a565b165f525f602052602060405f2054604051908152f35b346100fc575f3660031901126100fc576100f86100e4610724565b346100fc5760203660031901126100fc57600435331561039a57335f525f60205260405f20548181106103815790805f923384528360205203604083205580600254036002556040519081527fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef60203392a3005b63391434e360e21b5f523360045260245260445260645ffd5b634b637e8f60e11b5f525f60045260245ffd5b346100fc575f3660031901126100fc576103fe6103c86107db565b6100f86103d3610870565b61041a6103de610905565b61040c6103e9610724565b93604051978897608089526080890190610666565b908782036020890152610666565b908582036040870152610666565b908382036060850152610666565b346100fc575f3660031901126100fc57602060405160128152f35b346100fc5760603660031901126100fc5761045c61068a565b6104646106a0565b6001600160a01b0382165f818152600160209081526040808320338452909152902054909260443592915f1981106104a2575b506101cb935061099a565b8381106105075784156104f45733156104e1576101cb945f52600160205260405f2060018060a01b0333165f526020528360405f209103905584610497565b634a1406b160e11b5f525f60045260245ffd5b63e602df0560e01b5f525f60045260245ffd5b8390637dc7a0d960e11b5f523360045260245260445260645ffd5b346100fc575f3660031901126100fc576020600254604051908152f35b346100fc5760403660031901126100fc5761055861068a565b6024359033156104f4576001600160a01b03169081156104e157335f52600160205260405f20825f526020528060405f20556040519081527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92560203392a3602060405160018152f35b346100fc575f3660031901126100fc576040515f6003546105e1816106b6565b808452906001811690811561027c5750600114610608576100f8836100e4818503826106ee565b60035f9081527fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b939250905b80821061064c575090915081016020016100e461020e565b919260018160209254838588010152019101909291610634565b805180835260209291819084018484015e5f828201840152601f01601f1916010190565b600435906001600160a01b03821682036100fc57565b602435906001600160a01b03821682036100fc57565b90600182811c921680156106e4575b60208310146106d057565b634e487b7160e01b5f52602260045260245ffd5b91607f16916106c5565b90601f8019910116810190811067ffffffffffffffff82111761071057604052565b634e487b7160e01b5f52604160045260245ffd5b604051905f8260085491610737836106b6565b80835292600181169081156107bc575060011461075d575b61075b925003836106ee565b565b5060085f90815290917ff3f7a9fe364faab93b216da50a3214154f22a0a2b415b23a84c8169e8b636ee35b8183106107a057505090602061075b9282010161074f565b6020919350806001915483858901015201910190918492610788565b6020925061075b94915060ff191682840152151560051b82010161074f565b604051905f82600554916107ee836106b6565b80835292600181169081156107bc57506001146108115761075b925003836106ee565b5060055f90815290917f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db05b81831061085457505090602061075b9282010161074f565b602091935080600191548385890101520191019091849261083c565b604051905f8260075491610883836106b6565b80835292600181169081156107bc57506001146108a65761075b925003836106ee565b5060075f90815290917fa66cc928b5edb82af9bd49922954155ab7b0942694bea4ce44661d9a8736c6885b8183106108e957505090602061075b9282010161074f565b60209193508060019154838589010152019101909184926108d1565b604051905f8260065491610918836106b6565b80835292600181169081156107bc575060011461093b5761075b925003836106ee565b5060065f90815290917ff652222313e28459528d920b65115c16c04f3efc82aaedc97be59f3f377c0d3f5b81831061097e57505090602061075b9282010161074f565b6020919350806001915483858901015201910190918492610966565b6001600160a01b031690811561039a576001600160a01b0316918215610a3157815f525f60205260405f2054818110610a1857817fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef92602092855f525f84520360405f2055845f525f825260405f20818154019055604051908152a3565b8263391434e360e21b5f5260045260245260445260645ffd5b63ec442f0560e01b5f525f60045260245ffd",
      creationCodeHash: "0x770fd980651dba53d6b8b1d045720d8b655c5a27a3829401f18aa1f07f732bc8",
      runtimeTemplate: "0x60806040526004361015610011575f80fd5b5f3560e01c806306fdde03146105c1578063095ea7b31461053f57806318160ddd1461052257806323b872dd14610443578063313ce56714610428578063392f37e9146103ad57806342966c681461030d578063609d3334146102f257806370a08231146102bb5780637284e416146102a057806395d89b41146101d6578063a9059cbb146101a5578063beb0a4161461018a578063c5a1d7f014610150578063dd62ed3e146101005763f3ccaac0146100c9575f80fd5b346100fc575f3660031901126100fc576100f86100e4610905565b604051918291602083526020830190610666565b0390f35b5f80fd5b346100fc5760403660031901126100fc5761011961068a565b6101216106a0565b6001600160a01b039182165f908152600160209081526040808320949093168252928352819020549051908152f35b346100fc575f3660031901126100fc5760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b346100fc575f3660031901126100fc576100f86100e4610870565b346100fc5760403660031901126100fc576101cb6101c161068a565b602435903361099a565b602060405160018152f35b346100fc575f3660031901126100fc576040515f6004546101f6816106b6565b808452906001811690811561027c575060011461021e575b6100f8836100e4818503826106ee565b60045f9081527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b939250905b808210610262575090915081016020016100e461020e565b91926001816020925483858801015201910190929161024a565b60ff191660208086019190915291151560051b840190910191506100e4905061020e565b346100fc575f3660031901126100fc576100f86100e46107db565b346100fc5760203660031901126100fc576001600160a01b036102dc61068a565b165f525f602052602060405f2054604051908152f35b346100fc575f3660031901126100fc576100f86100e4610724565b346100fc5760203660031901126100fc57600435331561039a57335f525f60205260405f20548181106103815790805f923384528360205203604083205580600254036002556040519081527fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef60203392a3005b63391434e360e21b5f523360045260245260445260645ffd5b634b637e8f60e11b5f525f60045260245ffd5b346100fc575f3660031901126100fc576103fe6103c86107db565b6100f86103d3610870565b61041a6103de610905565b61040c6103e9610724565b93604051978897608089526080890190610666565b908782036020890152610666565b908582036040870152610666565b908382036060850152610666565b346100fc575f3660031901126100fc57602060405160128152f35b346100fc5760603660031901126100fc5761045c61068a565b6104646106a0565b6001600160a01b0382165f818152600160209081526040808320338452909152902054909260443592915f1981106104a2575b506101cb935061099a565b8381106105075784156104f45733156104e1576101cb945f52600160205260405f2060018060a01b0333165f526020528360405f209103905584610497565b634a1406b160e11b5f525f60045260245ffd5b63e602df0560e01b5f525f60045260245ffd5b8390637dc7a0d960e11b5f523360045260245260445260645ffd5b346100fc575f3660031901126100fc576020600254604051908152f35b346100fc5760403660031901126100fc5761055861068a565b6024359033156104f4576001600160a01b03169081156104e157335f52600160205260405f20825f526020528060405f20556040519081527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92560203392a3602060405160018152f35b346100fc575f3660031901126100fc576040515f6003546105e1816106b6565b808452906001811690811561027c5750600114610608576100f8836100e4818503826106ee565b60035f9081527fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b939250905b80821061064c575090915081016020016100e461020e565b919260018160209254838588010152019101909291610634565b805180835260209291819084018484015e5f828201840152601f01601f1916010190565b600435906001600160a01b03821682036100fc57565b602435906001600160a01b03821682036100fc57565b90600182811c921680156106e4575b60208310146106d057565b634e487b7160e01b5f52602260045260245ffd5b91607f16916106c5565b90601f8019910116810190811067ffffffffffffffff82111761071057604052565b634e487b7160e01b5f52604160045260245ffd5b604051905f8260085491610737836106b6565b80835292600181169081156107bc575060011461075d575b61075b925003836106ee565b565b5060085f90815290917ff3f7a9fe364faab93b216da50a3214154f22a0a2b415b23a84c8169e8b636ee35b8183106107a057505090602061075b9282010161074f565b6020919350806001915483858901015201910190918492610788565b6020925061075b94915060ff191682840152151560051b82010161074f565b604051905f82600554916107ee836106b6565b80835292600181169081156107bc57506001146108115761075b925003836106ee565b5060055f90815290917f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db05b81831061085457505090602061075b9282010161074f565b602091935080600191548385890101520191019091849261083c565b604051905f8260075491610883836106b6565b80835292600181169081156107bc57506001146108a65761075b925003836106ee565b5060075f90815290917fa66cc928b5edb82af9bd49922954155ab7b0942694bea4ce44661d9a8736c6885b8183106108e957505090602061075b9282010161074f565b60209193508060019154838589010152019101909184926108d1565b604051905f8260065491610918836106b6565b80835292600181169081156107bc575060011461093b5761075b925003836106ee565b5060065f90815290917ff652222313e28459528d920b65115c16c04f3efc82aaedc97be59f3f377c0d3f5b81831061097e57505090602061075b9282010161074f565b6020919350806001915483858901015201910190918492610966565b6001600160a01b031690811561039a576001600160a01b0316918215610a3157815f525f60205260405f2054818110610a1857817fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef92602092855f525f84520360405f2055845f525f825260405f20818154019055604051908152a3565b8263391434e360e21b5f5260045260245260445260645ffd5b63ec442f0560e01b5f525f60045260245ffd",
      immutableReferences: [
        {
          start: 359,
          length: 32
        }
      ],
      sources: {
        "lib/openzeppelin-contracts/contracts/interfaces/draft-IERC6093.sol": "0x880da465c203cec76b10d72dbd87c80f387df4102274f23eea1f9c9b0918792b",
        "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol": "0x41f6b3b9e030561e7896dbef372b499cc8d418a80c3884a4d65a68f2fdc7493a",
        "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol": "0xe06a3f08a987af6ad2e1c1e774405d4fe08f1694b67517438b467cecf0da0ef7",
        "lib/openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol": "0x70f2f713b13b7ce4610bcd0ac9fec0f3cc43693b043abcb8dc40a42a726eb330",
        "lib/openzeppelin-contracts/contracts/utils/Context.sol": "0x493033a8d1b176a037b2cc6a04dad01a5c157722049bbecf632ca876224dd4b2",
        "src/module-foundation/FoundationTokenV1.sol": "0x28ad9a130f32c14d931da364f529c63a207b9476bfc19c67751d9df0d568397d",
        "src/module-foundation/FoundationTypesV1.sol": "0x1c1782146f0a707c7171068ba5a061dd2e2562d5cfa96d627107fcca0b5f12e8"
      }
    },
    FoundationHookV2: {
      constructorInputs: [
        {
          name: "manager",
          type: "address",
          internalType: "contract IPoolManager"
        },
        {
          name: "initializer_",
          type: "address",
          internalType: "address"
        },
        {
          name: "token_",
          type: "address",
          internalType: "address"
        },
        {
          name: "quote_",
          type: "address",
          internalType: "address"
        },
        {
          name: "creator_",
          type: "address",
          internalType: "address"
        },
        {
          name: "initialTick_",
          type: "int24",
          internalType: "int24"
        },
        {
          name: "creatorBuyFeeBps_",
          type: "uint16",
          internalType: "uint16"
        },
        {
          name: "creatorSellFeeBps_",
          type: "uint16",
          internalType: "uint16"
        },
        {
          name: "selections",
          type: "tuple[]",
          internalType: "struct FoundationTypesV1.ModuleSelection[]",
          components: [
            {
              name: "factory",
              type: "address",
              internalType: "address"
            },
            {
              name: "factoryCodeHash",
              type: "bytes32",
              internalType: "bytes32"
            },
            {
              name: "moduleCodeHash",
              type: "bytes32",
              internalType: "bytes32"
            },
            {
              name: "descriptorHash",
              type: "bytes32",
              internalType: "bytes32"
            },
            {
              name: "configuration",
              type: "bytes",
              internalType: "bytes"
            },
            {
              name: "creatorShareBps",
              type: "uint16",
              internalType: "uint16"
            }
          ]
        }
      ],
      creationBytecode: "0x6101e08060405234610cc057615385803803809161001d8285611445565b8339810161012082820312610cc0578151916001600160a01b038316808403610cc05761004c60208301611468565b9161005960408201611468565b9061006660608201611468565b9361007360808301611468565b9260a0830151908160020b92838303610cc05761009260c0860161147c565b9361009f60e0870161147c565b61010087015190966001600160401b038211610cc057019a8a601f8d011215610cc0578b519a6100ce8c61148b565b9c6040519d6100dd908f611445565b8d8d815260200191829d60051b820160200191818311610cc05760208101935b8385106113265750505060809290925250506040516101c081016001600160401b0381118282101761095957600191610160916040525f60208201525f60408201525f60608201525f60808201525f60a08201525f6101008201525f6101208201525f6101808201525f6101a08201528281528260c08201528260e082015282610140820152015261200030161515600114801590611319575b801561130c575b80156112ff575b80156112f2575b80156112e5575b80156112d5575b80156112c5575b80156112b9575b80156112ad575b801561129d575b801561128d575b8015611281575b8015611275575b61126257873b15908115611250575b8115611246575b811561123c575b8115611226575b8115611214575b8115611204575b81156111f0575b81156111e0575b81156111cc575b81156111bc575b81156111ad575b811561119f575b50610a025760a05260c0528560e05283610100526101205261014052610160525f60806040516102768161142a565b828152602081018390526040810183905260608101839052015260e05160c05160a0916001600160a01b039182169116818110919082156111985780925b1561119157505b604051916102c88361142a565b5f196001851b0190811683521660208201525f604080830191909152603c60608301523060808301529190206101a052519261172f91828501916001600160401b03831186841017610959576060948694613c56863983526001600160a01b0390811660208401521660408201520301905ff08015610ccc576101805260405160208101918160608101917feec95424459934ec69cc14945be8c29d8a064b8b90ffb60a279c9c9bef35cfc185526040808301528551809352608082019260808160051b84010191935f905b82821061111e575050506103b1925003601f198101835282611445565b5190206101c0526008815111610a025780516103e56103cf8261148b565b916103dd6040519384611445565b80835261148b565b602082019190601f190136833782516104006103cf8261148b565b602082019490601f19013686375f94855b8251871015610ef65761042487846114c6565b5180519097906001600160a01b0316803b15908115610ee6575b508015610ed6575b610a025760c05160e05161010051610180516101a051604051969490936001600160a01b039283169383169290811691166104808861140f565b308852602088015260408701526060860152608085015260a084015260018060a01b038951165f602061053a60808d01938451604051948580948193630565b4a960e31b83526105298d600485019060a08091600180831b038151168452600180831b036020820151166020850152600180831b036040820151166040850152600180831b036060820151166060850152600180831b0360808201511660808501520151910152565b60e060c484015260e48301906114a2565b03925af1908115610ccc575f91610e9d575b50803b158015610e8e575b8015610e77575b8015610e5f575b8015610e48575b610a025760405163303e74df60e01b81526001600160a01b039190911692909161012083600481875afa928315610ccc575f93610d6c575b50516020815191012094604051636824b6b560e11b815260c081600481885afa908115610ccc575f91610cd7575b506040805182516001600160a01b03908116602080840191825285015182168385015292840151811660608084019190915284015181166080808401919091528401511660a0808301919091529092015160c08301529060c0815261063860e082611445565b5190206040805183516001600160a01b03908116602080840191825286015182168385015292850151811660608084019190915285015181166080808401919091528501511660a0808301919091529093015160c0840152909160c081526106a160e082611445565b51902014801590610c66575b8015610bc8575b8015610bb5575b8015610bac575b8015610b9d575b8015610b8c575b8015610b7b575b8015610b65575b8015610b4f575b8015610b39575b8015610b13575b8015610aed575b8015610ac7575b8015610aa4575b8015610a74575b8015610a41575b8015610a11575b610a02575f5b848110610981575063ffffffff60808301511663ffffffff60a0840151160163ffffffff811161096d5763ffffffff16810180911161096d579982610768858b6114c6565b5261ffff60a08201511661077c858a6114c6565b5260408101805191604051966080880188811060018060401b03821117610959576040528588526020880193845260408801938185526060890195865260025468010000000000000000811015610959578060016107dd920160025561150d565b919091610946576109268960608f9497608098600560019f60019d7f5710d2719653f0ed1105b4e716b841ff6dd615957a5ec3c1603e9c93d80465ae9d879f99610100938b61ffff9c60a01b0390511660018060a01b031987541617865551600186015551600285015551805160038501556004840189602083015116815462ff0000604085015160101b169063ff0000008a86015160181b1691608067ffffffff000000009087015160201b166bffffffff000000000000000060a088015160401b16926fffffffff00000000000000000000000060c08901518e1b1694608060ff901b60e08a0151151560801b1696608060ff901b19946fffffffff00000000000000000000000019936bffffffff0000000000000000199267ffffffff00000000199163ffffffff191617161716171617161717179055015191015551960151936114c6565b511691604051938452602084015260408301526060820152a30195610411565b634e487b7160e01b5f525f60045260245ffd5b634e487b7160e01b5f52604160045260245ffd5b634e487b7160e01b5f52601160045260245ffd5b61098a8161150d565b5080546001600160a01b031685149081156109f3575b81156109cb575b506109b457600101610723565b84906337c6a46760e11b5f5260045260245260445ffd5b905061010084015180151591826109e5575b50505f6109a7565b600501541490505f806109dd565b600381015485511491506109a0565b63c52a9bd360e01b5f5260045ffd5b5061ffff60a08c0151161515801561071d57506001606083015116158061071d575060046040830151161561071d565b506004604083015116158015610716575060c082015163ffffffff16151580610716575060ff6060830151161515610716565b50600260408301511615801561070f575060a082015163ffffffff1615158061070f575060e0820151151561070f565b506001604083015116158015610708575063ffffffff6080830151161515610708565b50600460408301511615158015610701575061271063ffffffff60c08401511610610701565b506002604083015116151580156106fa575061271063ffffffff60a084015116106106fa565b506001604083015116151580156106f3575061271063ffffffff608084015116106106f3565b50621e848063ffffffff60c084015116116106ec565b50620493e063ffffffff60a084015116116106e5565b50620493e063ffffffff608084015116116106de565b50600160ff606084015116116106d7565b50600760ff604084015116116106d0565b5060ff604083015116156106c9565b508151156106c2565b50600161ffff60208401511614156106bb565b5060405160208101908351825261ffff602085015116604082015260ff604085015116606082015260ff606085015116608082015263ffffffff60808501511660a082015263ffffffff60a08501511660c082015263ffffffff60c08501511660e082015260e084015115156101008201526101008401516101208201526101208152610c5761014082611445565b51902060608c015114156106b4565b50604051630c1e67fd60e11b8152602081600481875afa8015610ccc5786915f91610c94575b5014156106ad565b9150506020813d8211610cc4575b81610caf60209383611445565b81010312610cc0578590515f610c8c565b5f80fd5b3d9150610ca2565b6040513d5f823e3d90fd5b905060c0813d8211610d64575b81610cf160c09383611445565b81010312610cc05760a060405191610d088361140f565b610d1181611468565b8352610d1f60208201611468565b6020840152610d3060408201611468565b6040840152610d4160608201611468565b6060840152610d5260808201611468565b6080840152015160a08201525f6105d2565b3d9150610ce4565b909250610120813d8211610e40575b81610d896101209383611445565b81010312610cc0576040519061012082016001600160401b038111838210176109595760405280518252610dbf6020820161147c565b6020830152610dd0604082016114ee565b6040830152610de1606082016114ee565b6060830152610df2608082016114fc565b6080830152610e0360a082016114fc565b60a0830152610e1460c082016114fc565b60c083015260e0810151908115158203610cc0576101009160e08401520151610100820152915f6105a4565b3d9150610d7b565b5060a0516001600160a01b0382811691161461056c565b50610180516001600160a01b03828116911614610565565b506080516001600160a01b0382811691161461055e565b50803f60408c01511415610557565b90506020813d8211610ece575b81610eb760209383611445565b81010312610cc057610ec890611468565b5f61054c565b3d9150610eaa565b5061400060808901515111610446565b90503f602089015114155f61043e565b8591925062124f8010610a0257610180516001600160a01b031692833b15610cc05760408051633d8ebb8d60e21b815260048101919091529451604486018190528593926064850192915f5b8181106110fc5750505060209060031985840301602486015251918281520191905f5b8181106110df5750505091815f81819503925af18015610ccc576110cf575b60405161272c908161152a823960805181818161029e0152818161031a0152818161076d01528181610b91015281816111910152818161123a015281816114220152818161157c0152818161160f0152611795015260a05181818161034a015261147a015260c05181818161021a01528181610c4101528181610cb801528181611ae00152612130015260e051818181610c6401528181610cdb015281816111fe015281816114be01528181611b04015261215901526101005181611c090152610120518181816103b10152611705015261014051818181611bd301526123b80152610160518181816116ca0152818161233f01526123dc015261018051818181610e27015281816111d6015261168101526101a05181818161071d01528181610eb70152818161110e015281816113cf0152818161174201526120cd01526101c05181611a780152f35b5f6110d991611445565b5f610f84565b825161ffff16845286945060209384019390920191600101610f65565b82516001600160a01b0316855288965060209485019490920191600101610f42565b91935091602080600192607f19898203018552875190848060a01b0382511681528282015183820152604082015160408201526060820151606082015260a061ffff8161117a608086015160c0608087015260c08601906114a2565b940151169101529601920192018593919492610394565b90506102bb565b81926102b4565b620d89b4915012155f610247565b620d89b3198113159150610240565b603c810760020b15159150610239565b905061ffff60648188160616151590610232565b6103e861ffff881611915061022b565b905061ffff60648187160616151590610224565b6103e861ffff871611915061021d565b6001600160a01b038816159150610216565b6001600160a01b03848116908b1614915061020f565b893b159150610208565b833b159150610201565b6001600160a01b0383161591506101fa565b630732d7b560e51b5f523060045260245ffd5b506001301615156101eb565b506002301615156101e4565b50600430161515600114156101dd565b50600830161515600114156101d6565b506010301615156101cf565b506020301615156101c8565b50604030161515600114156101c1565b50608030161515600114156101ba565b50610100301615156101b3565b50610200301615156101ac565b50610400301615156101a5565b506108003016151561019e565b5061100030161515610197565b84516001600160401b038111610cc05782019060c0828503601f190112610cc057604051906113548261140f565b61136060208401611468565b825260408301516020830152606083015160408301526080830151606083015260a083015160018060401b038111610cc0576020908401019185601f84011215610cc05782516001600160401b03811161095957604051936113cc601f8301601f191660200186611445565b8185528760208383010111610cc05760209586955f87856113ff968260c097018386015e8301015260808501520161147c565b60a08201528152019401936100fd565b60c081019081106001600160401b0382111761095957604052565b60a081019081106001600160401b0382111761095957604052565b601f909101601f19168101906001600160401b0382119082101761095957604052565b51906001600160a01b0382168203610cc057565b519061ffff82168203610cc057565b6001600160401b0381116109595760051b60200190565b805180835260209291819084018484015e5f828201840152601f01601f1916010190565b80518210156114da5760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b519060ff82168203610cc057565b519063ffffffff82168203610cc057565b6002548110156114da5760025f52600660205f20910201905f9056fe6080806040526004361015610012575f80fd5b5f905f3560e01c90816302d05d3f14611bf75750806314ad21d814611bb9578063182148ef14611a9b5780631a65ec9314611a615780631cd6232e146117d657806321d0ee7014611782578063259982e514611782578063334f7ac5146117655780633e0dc34e1461172b57806348d5b114146116ee5780635567a03a146116b057806356397c351461166c578063575e24b4146115b95780636c2bbe7e1461140f5780636fe7e6eb146115415780637b78d458146114ed578063999b93af146114a95780639ce110d7146114655780639f063efc1461140f578063b47b2fb114610b39578063b6a8b0fa14610287578063c4e833ce14610a09578063cd210ef314610968578063d216d2961461079c578063dc4c90d314610757578063dc98354e146102e9578063e1b4af6914610287578063e934422f14610249578063fc0c546a146102045763fdf43bf714610168575f80fd5b34610201576040366003190112610201576101ce6080916040610189611dc4565b91610192611ead565b5061019c836123b1565b921515815280602052209061ffff604051926101b784611dee565b54818116845260101c16602083015260243561256e565b6101ff604051809261ffff602060406060938051865282810151838701520151828151166040860152015116910152565bf35b80fd5b50346102015780600319360112610201576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346102015760203660031901126102015760408091610267611dc4565b1515815280602052205461ffff825191818116835260101c166020820152f35b50346102015760049061029936611d6d565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330392506102dd91505057630a85dc2960e01b8152fd5b63570c108560e11b8152fd5b50346102015760e036600319011261020157610303611c65565b60a036602319011261075357610317611d47565b907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163303610744577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b039081169116148015919061070d575b81156103ad575b5061039e57604051636e4c1aa760e11b8152602090f35b63f92ee8a960e01b8152600490fd5b90507f000000000000000000000000000000000000000000000000000000000000000060020b8060ff1d8181011890620d89e882116106fb57600160801b7001fffcb933bd6fad37aa2d162d1a59400160018416021891849190600281166106df575b600481166106c3575b600881166106a7575b6010811661068b575b6020811661066f575b60408116610653575b60808116610637575b610100811661061b575b61020081166105ff575b61040081166105e3575b61080081166105c7575b61100081166105ab575b612000811661058f575b6140008116610573575b6180008116610557575b62010000811661053b575b620200008116610520575b620400008116610505575b62080000166104ed575b136104e5575b63ffffffff0160201c6001600160a01b03908116911614155f610387565b5f19046104c7565b916b048a170391f7dc42444e8fa20260801c916104c1565b6d2216e584f5fa1ea926041bedfe9890930260801c926104b7565b926e5d6af8dedb81196699c329225ee6040260801c926104ac565b926f09aa508b5b7a84e1c677de54f3e99bc90260801c926104a1565b926f31be135f97d08fd981231505542fcfa60260801c92610496565b926f70d869a156d2a1b890bb3df62baf32f70260801c9261048c565b926fa9f746462d870fdf8a65dc1f90e061e50260801c92610482565b926fd097f3bdfd2022b8845ad8f792aa58250260801c92610478565b926fe7159475a2c29b7443b29c7fa6e889d90260801c9261046e565b926ff3392b0822b70005940c7a398e4b70f30260801c92610464565b926ff987a7253ac413176f2b074cf7815e540260801c9261045a565b926ffcbe86c7900a88aedcffc83b479aa3a40260801c92610450565b926ffe5dee046a99a2a811c461f1969c30530260801c92610446565b926fff2ea16466c96a3843ec78b326b528610260801c9261043d565b926fff973b41fa98c081472e6896dfb254c00260801c92610434565b926fffcb9843d60f6159c9db58835c9266440260801c9261042b565b926fffe5caca7e10e4e61c3624eaa0941cd00260801c92610422565b926ffff2e50f5f656932ef12357cf3c7fdcc0260801c92610419565b926ffff97272373d413259a46990580e213a0260801c92610410565b6345c3193d60e11b8452600452602483fd5b905060a061071a36611fa5565b207f0000000000000000000000000000000000000000000000000000000000000000141590610380565b63570c108560e11b8352600483fd5b5080fd5b50346102015780600319360112610201576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346102015760203660031901126102015760606040516107bc81611e25565b828152826020820152826040820152604051926107d884611e40565b80845280602085015280604085015280838501528060808501528060a08501528060c08501528060e0850152610100840152015261018061081a600435611e7d565b506101006040519161082b83611e25565b80546001600160a01b0316835260018101546020840190815260028201546040808601918252519290919060059061086285611e40565b6003810154855260ff600482015461ffff81166020880152818160101c166040880152818160181c16606088015263ffffffff8160201c16608088015263ffffffff8160401c1660a088015263ffffffff8160601c1660c088015260801c16151560e0860152015484840152606085019283526040519460018060a01b039051168552516020850152516040840152518051606084015261ffff602082015116608084015260ff60408201511660a084015260ff60608201511660c084015263ffffffff60808201511660e084015263ffffffff60a0820151168284015263ffffffff60c08201511661012084015260e081015115156101408401520151610160820152f35b5034610201576040366003190112610201576101ff6109d260a092604061098d611dc4565b91610996611ead565b506109a0836123b1565b921515815280602052209061ffff604051926109bb84611dee565b54818116845260101c16602083015260243561240b565b604092919251928352602083019061ffff602060406060938051865282810151838701520151828151166040860152015116910152565b50346102015780600319360112610201576040516101c081018181106001600160401b03821117610b255791806020926101c09460405283810182815260408201838152606083018481526080840185815260a0850186815260c086019060e08701926101008801948986526101208901968a88526101408a019860016101608c019b61018081019d8e526101a081019e8f5252600186526001875260018a5260018b526040519d8e916001835251151591015251151560408d015251151560608c015251151560808b015251151560a08a015251151560c089015251151560e08801525115156101008701525115156101208601525115156101408501525115156101608401525115156101808301525115156101a0820152f35b634e487b7160e01b83526041600452602483fd5b50346112875761016036600319011261128757610b54611c65565b9060a03660231901126112875760603660c319011261128757610144356001600160401b03811161128757610b8d903690600401611c38565b50507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036114005760ff60015416916001831415806113f5575b80156113c0575b6113b15760405160c081018181106001600160401b0382111761139d576040525f81525f60208201525f60408201525f60608201525f6080820152610c1b611ead565b60a0820152610c2b60e435612627565b60c4358015158103611287576001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081167f00000000000000000000000000000000000000000000000000000000000000009091161090151581148084525f60e435126020850181905214604084015215611391576101243560801d5b6001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081167f000000000000000000000000000000000000000000000000000000000000000090911610156113845761012435600f0b915b610d1582612718565b9060408501511580611372575b6112c95760208501511561131057610d81908551151590815f1461130857905b816060880152610d51816123b1565b905f525f60205260405f209161ffff60405193610d6d85611dee565b54818116855260101c16602084015261256e565b60a08501525b610d9a606085015160a086015190612679565b908160808601526040850151151591826112d8575b50506112c95782515f9190156112a857600f0b129081159161129a575b505b61128b57604060a08201510151815115155f525f60205260405f209061ffff81511663ffff00006020845493015160101b169163ffffffff19161717905560808101518061118f575b5060a081015180516020909101517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031691823b1561118b579060448692836040519586948593631c4b9a2d60e01b8552600485015260248401525af1801561118057908491611167575b5050805115159160208201511515610ea260e435612627565b60608401519160405195610eb587611e09565b7f0000000000000000000000000000000000000000000000000000000000000000875260018060a01b038516602088015260408701526060860152608085015260a08401526101243560801d600f0b60c084015261012435600f0b60e0840152835b60025481101561107057610f2a81611e7d565b50600481019081549060028260101c161561106557610fe491908815611057576311aaa97d60e11b915b63ffffffff604051918460208401528a51602484015260018060a01b0360208c015116604484015260408b01511515606484015260608b01511515608484015260808b015160a484015260a08b015160c484015260c08b0151600f0b60e484015260e08b0151600f0b6101048401526101048352610fd461012484611e5c565b8b1561104d5760201c1691611efc565b15610ff5575b506001905b01610f17565b5460801c60ff161561103657806001917f699c7feb850c0da9a2a1cd65be9b13df0cce79ae7dfbef2bd411bc8e68d8e56c602060405160028152a290610fea565b63ae193d1560e01b85526004526002602452604484fd5b60401c1691611efc565b63fcd93e9760e01b91610f54565b505050600190610fef565b604085848460038a0361115f5760ff60025b1660ff196001541617600155815115159060208301511515606084015160a08501519060208251920151928851958652602086015287850152606084015260808301526101243560801d600f0b60a083015261012435600f0b60c083015260018060a01b0316907f583ec8ec4eab64e7e5cc7f84ae0de43cb727aed3ff51fcf279f7351c6692bdac60e07f000000000000000000000000000000000000000000000000000000000000000092a3808301511561115157505b81519063b47b2fb160e01b8252600f0b6020820152f35b608091500151600f0b61113a565b60ff83611082565b8161117191611e5c565b61117c57825f610e89565b8280fd5b6040513d86823e3d90fd5b8580fd5b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163b1561128757604051630ab714fb60e11b81526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811660048301527f0000000000000000000000000000000000000000000000000000000000000000811660248301526044820192909252905f908290606490829084907f0000000000000000000000000000000000000000000000000000000000000000165af1801561127c5715610e17576112749193505f90611e5c565b5f915f610e17565b6040513d5f823e3d90fd5b5f80fd5b6304564c7160e21b5f5260045ffd5b5f9150600f0b13155f610dcc565b600f0b13908115916112bb575b50610dce565b5f9150600f0b12155f6112b5565b63d39cf37760e01b5f5260045ffd5b855191925090156112fc576112f19060608601516123fe565b905b14155f80610daf565b506060840151906112f3565b508290610d42565b61135d908551151590815f1461136c575082905b61132d816123b1565b905f525f60205260405f209161ffff6040519361134985611dee565b54818116855260101c16602084015261240b565b60a08601526060850152610d87565b90611324565b508061137d85612718565b1415610d22565b6101243560801d91610d0c565b61012435600f0b610cae565b634e487b7160e01b5f52604160045260245ffd5b63e1bcc00560e01b5f5260045ffd5b5060a06113cc36611fa5565b207f00000000000000000000000000000000000000000000000000000000000000001415610bd8565b506003831415610bd1565b63570c108560e11b5f5260045ffd5b346112875761141d36611cde565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330393506114009250505057630a85dc2960e01b5f5260045ffd5b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287576020366003190112611287576020611508611c65565b600154600260ff8216149182611525575b50506040519015158152f35b6001600160a01b0390811660089290921c161490508280611519565b34611287576101003660031901126112875761155b611c65565b5060a036602319011261128757611570611d47565b50611579611d5d565b507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330361140057630a85dc2960e01b5f5260045ffd5b3461128757610140366003190112611287576115d3611c65565b60a03660231901126112875760603660c319011261128757610124356001600160401b0381116112875761160b903690600401611c38565b50507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036114005762ffffff61164c60609261202c565b906040939293519363ffffffff60e01b1684526020840152166040820152f35b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287575f36600319011261128757602060405161ffff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34611287575f3660031901126112875760206040517f000000000000000000000000000000000000000000000000000000000000000060020b8152f35b34611287575f3660031901126112875760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34611287575f366003190112611287576020600254604051908152f35b346112875761179036611c7b565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633039150611400905057630a85dc2960e01b5f5260045ffd5b34611287576040366003190112611287576004356024356001600160401b03811161128757611809903690600401611c38565b6001549060ff82166113b15761181e84611e7d565b5060048101926004845460101c16158015611a56575b611a1c57600260ff198216176001556001845460181c16611a2b575b5060405160208101635c085b4160e11b815233602483015260406044830152836064830152838660848401375f60848584010152601f19601f850116946118a56084848881010301601f198101855284611e5c565b549163ffffffff8360601c169260018060a01b03855416946001863f91015403611a1c57643fffffffc0805a92605a1c16166040600160a61b031684158582046040141715611a0857603f90049061ea608201809211611a0857106119f95783926020925f6040519687948286525193f18092513d826119d3575b50506119c15750156119a957600180546001600160a81b03191690556001600160401b03811161139d5761195a6020604051930183611e5c565b8082526020820192368282011161128757815f92602092863783010152519020906040519182527fca539ca6d71f32350620025ebd69a27e47c82be74d18a0f8c587d5faa2b477f660203393a3005b8363ae193d1560e01b5f52600452600460245260445ffd5b631bea0edf60e11b5f5260045260245ffd5b602014801592506119e7575b508780611920565b635c085b4160e11b14159050876119df565b631115766760e01b5f5260045ffd5b634e487b7160e01b5f52601160045260245ffd5b63c52a9bd360e01b5f5260045ffd5b81546001600160a81b031990911660089190911b610100600160a81b03161760021760015585611850565b506140008311611834565b34611287575f3660031901126112875760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34611287575f366003190112611287575f6080604051611aba81611dd3565b828152602081018390526040810183905260608101839052015260a06001600160a01b037f00000000000000000000000000000000000000000000000000000000000000008181167f000000000000000000000000000000000000000000000000000000000000000092831610918215611bb357805b5f196001861b01169215611bac57505b604051611b4c81611dd3565b8281526020810191600180861b0316825262ffffff604082015f815260806060840193603c85520193308552604051958652600180881b039051166020860152511660408401525160020b6060830152600180841b039051166080820152f35b9050611b40565b81611b30565b34611287575f36600319011261128757602060405161ffff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34611287575f366003190112611287577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b9181601f84011215611287578235916001600160401b038311611287576020838186019501011161128757565b600435906001600160a01b038216820361128757565b90610160600319830112611287576004356001600160a01b0381168103611287579160a060231982011261128757602491608060c3198301126112875760c49161014435906001600160401b03821161128757611cda91600401611c38565b9091565b906101a0600319830112611287576004356001600160a01b0381168103611287579160a060231982011261128757602491608060c3198301126112875760c4916101443591610164359161018435906001600160401b03821161128757611cda91600401611c38565b60c435906001600160a01b038216820361128757565b60e435908160020b820361128757565b610120600319820112611287576004356001600160a01b0381168103611287579160a06023198301126112875760249160c4359160e4359161010435906001600160401b03821161128757611cda91600401611c38565b60043590811515820361128757565b60a081019081106001600160401b0382111761139d57604052565b604081019081106001600160401b0382111761139d57604052565b61010081019081106001600160401b0382111761139d57604052565b608081019081106001600160401b0382111761139d57604052565b61012081019081106001600160401b0382111761139d57604052565b90601f801991011681019081106001600160401b0382111761139d57604052565b600254811015611e995760025f52600660205f20910201905f90565b634e487b7160e01b5f52603260045260245ffd5b60405190606082018281106001600160401b0382111761139d57604052815f81525f60208201526040805191611ee283611dee565b5f83525f60208401520152565b91908201809211611a0857565b9160018060a01b03835416926001843f91015403611a1c575a63ffffffff8216643fffffffc08360061b169080820460401490151715611a0857603f90049061ea608201809211611a0857106119f9576020906040519283915f83525f86858451940192f1928391513d83611f77575b5050506119c1575090565b60201480159350909190611f90575b50505f8080611f6c565b6001600160e01b031916141590505f80611f86565b60a09060231901126112875760405190611fbe82611dd3565b816024356001600160a01b03811681036112875781526044356001600160a01b038116810361128757602082015260643562ffffff811681036112875760408201526084358060020b810361128757606082015260a435906001600160a01b03821682036112875760800152565b6001549060ff821691821515806123a6575b6113b15760a03660231901126112875760405161205a81611dd3565b6024356001600160a01b03811681036112875781526044356001600160a01b038116810361128757602082015260643562ffffff811681036112875760408201526084358060020b810361128757606082015260a435906001600160a01b03821682036112875760a091608082015220927f00000000000000000000000000000000000000000000000000000000000000008094036119f95760020361239d5760ff60035b169060ff19161760015560e4359261211684612627565b9260c435801515808203611287575f915060018060a01b037f00000000000000000000000000000000000000000000000000000000000000001660018060a01b037f00000000000000000000000000000000000000000000000000000000000000001610149512936040519161218b83611e09565b8252602082019360018060a01b03168452604082019580875260608301938685526080840183815260a08501915f835260c08601935f855260e08701955f87525f5b6002548110156122ae57808b6121e38f93611e7d565b508b8d60048301549560018760101c16156122a0579563ffffffff9161227a96976311aaa97d60e11b966040519588602088015251602487015260018060a01b039051166044860152511515606485015251151560848401528a5160a48401528b5160c48401528c51600f0b60e48401528d51600f0b610104840152610104835261227061012484611e5c565b60201c1691611efc565b15612289576001905b016121cd565b63ae193d1560e01b5f52600452600160245260445ffd5b505050505060019150612283565b50985098965098505050505050820361238c5761231a91816122ce611ead565b50811561232c5750806122e3612314926123b1565b905f525f60205260405f209061ffff604051926122ff84611dee565b54818116845260101c1660208301528361256e565b90612679565b60801b906315d7892d60e21b91905f90565b5f808052602052604051612314935091507f00000000000000000000000000000000000000000000000000000000000000009061ffff7fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb561134985611dee565b506315d7892d60e21b915f91508190565b60ff60016120ff565b50600283141561203e565b156123da577f000000000000000000000000000000000000000000000000000000000000000090565b7f000000000000000000000000000000000000000000000000000000000000000090565b91908203918211611a0857565b919290612416611ead565b5061242184826126c1565b8215801561255e575b6125505761ffff8116806126f203906126f28211611a0857846127100261271081048603611a08576124656124749161ffff89511690611eef565b61ffff60208901511690611eef565b906126f21461253c570493846003811115612535576002198101818111611a0857905b85821061252d575b60016001607f1b031061251e575b858111156124c45763686c07bf60e11b5f5260045ffd5b6124cf82848361256e565b6124df8151602083015190611eef565b86838210918261250a575b505061250157505f198114611a08576001016124ad565b90955093505050565b612516919250846123fe565b14865f6124ea565b60016001607f1b0395506124ad565b85915061249f565b5f90612497565b634e487b7160e01b5f52601260045260245ffd5b62a4671960e71b5f5260045ffd5b5060016001607f1b03831161242a565b9291612578611ead565b9361258382846126c1565b8015808015612607575b61255057601e8202828104601e14821715611a08576125b361ffff918286511690611eef565b9416808302928304141715611a08576125d96127109161ffff6020819501511690611eef565b818404865281810460208701528282604051956125f587611dee565b06168452061660208201526040830152565b5060016001607f1b03821161258d565b600160ff1b8114611a08575f0390565b80158015612669575b801561264f575b6119f9575f81121561264c5761264c90612617565b90565b506f7ffffffffffffffffffffffffffffffe198112612637565b5060016001607f1b038113612630565b919061268c906020815191015190611eef565b9180159081156126b0575b81156126a5575b506119f957565b90508210155f61269e565b60016001607f1b0381119150612697565b61ffff6103e8911611908115612705575b81156126ef575b506126e057565b634db7e85160e01b5f5260045ffd5b6127109150602061ffff9101511610155f6126d9565b905061271061ffff8251161015906126d2565b600f0b5f81121561264c5761264c90612617566101003461013e57601f61172f38819003918201601f19168301916001600160401b038311848410176101425780849260609460405283398101031261013e5780516001600160a01b038116919082810361013e5761006c604061006560208501610156565b9301610156565b923b158015610135575b8015610124575b610115576080523360a05260c05260e0526040516115c4908161016b8239608051818181610480015281816105e701528181610e52015281816113290152611529015260a0518181816101e5015281816109bd01528181610a5b0152610ccb015260c0518181816105610152818161066801528181610e2a0152818161130101526114f0015260e051818181610c3e01526111040152f35b63c52a9bd360e01b5f5260045ffd5b506001600160a01b0383161561007d565b50813b15610076565b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b038216820361013e5756fe6080806040526004361015610012575f80fd5b5f905f3560e01c90816302d05d3f146110f2575080630351ddd4146110825780630c48d7871461104a578063103bc62f1461102e5780631150e87414610dde5780631c4b9a2d14610cb1578063232adc6514610bfb5780632ec0e5c014610bd9578063331a9bbb14610bbc5780633e02e96514610b9f57806357b9990314610a245780637e183759146109ec5780637f5a7c7b146109a857806391dd734614610590578063999b93af1461054b578063b1a25c9414610529578063bfd1eaa81461050b578063c4f08c74146104cd578063cea5725a146104af578063dc4c90d31461046a578063f02ef6481461044c5763f63aee3414610110575f80fd5b346104495760403660031901126104495760043567ffffffffffffffff8111610445573660238201121561044557806004013561014c816111a9565b9161015a6040519384611173565b8183526024602084019260051b8201019036821161044157602401915b818310610421575050506024359067ffffffffffffffff821161041d573660238301121561041d5781600401356101ad816111a9565b926101bb6040519485611173565b8184526024602085019260051b8201019036821161041957602401915b8183106103fa57505050337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316148015906103ee575b80156103e3575b80156103d7575b6103c957600b805460ff191660011790558291825b825184101561037b576001600160a01b03610254858561126c565b51161561036c57845b848110610328575061027e9061ffff610276868561126c565b51169061120e565b9261ffff61028c828461126c565b51166001600160a01b036102a0838661126c565b51168652600760205260408620805461ffff191690911790556001600160a01b036102cb828561126c565b5116600a546801000000000000000081101561031457906102f482600180959401600a556111e2565b819291549060031b91821b91858060a01b03901b19161790550192610239565b634e487b7160e01b87526041600452602487fd5b6001600160a01b0361033a868661126c565b51166001600160a01b0361034e838761126c565b51161461035d5760010161025d565b63c52a9bd360e01b8652600486fd5b63c52a9bd360e01b8552600485fd5b849061271081116103ba576127100361271081116103a65761ffff1661ffff19600654161760065580f35b634e487b7160e01b82526011600452602482fd5b63c52a9bd360e01b8252600482fd5b6282b42960e81b8352600483fd5b50805182511415610224565b50600881511161021d565b5060ff600b5416610216565b823561ffff81168103610415578152602092830192016101d8565b8680fd5b8580fd5b8280fd5b82356001600160a01b038116810361041957815260209283019201610177565b8480fd5b5080fd5b80fd5b50346104495780600319360112610449576020600254604051908152f35b50346104495780600319360112610449576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346104495780600319360112610449576020600454604051908152f35b50346104495760203660031901126104495760209061ffff906040906001600160a01b036104f9611133565b16815260078452205416604051908152f35b50346104495780600319360112610449576020600554604051908152f35b5034610449578060031936011261044957602061ffff60065416604051908152f35b50346104495780600319360112610449576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346108425760203660031901126108425760043567ffffffffffffffff811161084257366023820112156108425780600401359067ffffffffffffffff82116108425760248101828201366024820111610842577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169333851480159190610991575b8115610986575b811561094e575b50610940575f600c556040908390031261084257356001600160a01b0381169190829003610842576040516370a0823160e01b8152600481018390527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316916044013590602081602481865afa9081156108cf575f9161090e575b506040516370a0823160e01b81526004810186905293602085602481875afa9485156108cf575f956108da575b50853b1561084257604051637a94c56560e11b81523060048201528460248201528360448201525f81606481838b5af180156108cf576108ba575b50853b156104155786604051630b0d9c0960e01b81528560048201528260248201528460448201528181606481838c5af180156108af5761089a575b5050604051906370a0823160e01b82526004820152602081602481875afa90811561088f5783908892610859575b5061078a919261120e565b14938415946107cf575b505050506107c0576040516107bc916107ae602083611173565b815260405191829182611149565b0390f35b632f35253160e01b8152600490fd5b602091929394506024604051809581936370a0823160e01b835260048301525afa91821561084e578492610814575b5061080991926111c1565b14155f808080610794565b91506020823d602011610846575b8161082f60209383611173565b81010312610842576108099151916107fe565b5f80fd5b3d9150610822565b6040513d86823e3d90fd5b9150506020813d602011610887575b8161087560209383611173565b8101031261084257518261078a61077f565b3d9150610868565b6040513d89823e3d90fd5b816108a491611173565b61041557865f610751565b6040513d84823e3d90fd5b6108c79197505f90611173565b5f955f610715565b6040513d5f823e3d90fd5b9094506020813d602011610906575b816108f660209383611173565b810103126108425751935f6106da565b3d91506108e9565b90506020813d602011610938575b8161092960209383611173565b8101031261084257515f6106ad565b3d915061091c565b6282b42960e81b5f5260045ffd5b905061095981611250565b6109666040519182611173565b8181525f6020808301938087863783010152519020600c5414155f61062a565b600c54159150610623565b5f805160206115a48339815191525c15915061061c565b34610842575f366003190112610842576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610842576020366003190112610842576001600160a01b03610a0d611133565b165f526009602052602060405f2054604051908152f35b3461084257602036600319011261084257600435610a40611280565b604051630f6f1a8b60e31b81523360048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa9081156108cf575f91610b64575b50158015610b39575b8015610b31575b8015610b21575b61094057600290335f52600960205260405f20610ac882825461120e565b9055610ad68160055461120e565b600555610ae381336112e5565b6040519081527f7d41ef2ca0417b1f34e24f6baa6bb801e64d7c82436e45963c2f78a168ba825160203392a35f5f805160206115a48339815191525d005b5060016001607f1b038111610aaa565b508015610aa3565b50335f526008602052610b5d60405f2054335f52600960205260405f2054906111c1565b8111610a9c565b90506020813d602011610b97575b81610b7f60209383611173565b81010312610842575180151581036108425782610a93565b3d9150610b72565b34610842575f366003190112610842576020600354604051908152f35b34610842575f366003190112610842576020600154604051908152f35b34610842575f366003190112610842576020610bf361121b565b604051908152f35b34610842575f36600319011261084257610c13611280565b6020600354610c37610c30610c2b60045480946111c1565b6112b5565b809261120e565b60045560017f0000000000000000000000000000000000000000000000000000000000000000610c6783826112e5565b7f7d41ef2ca0417b1f34e24f6baa6bb801e64d7c82436e45963c2f78a168ba82518460405192858452848060a01b031692a35f5f805160206115a48339815191525d604051908152f35b3461084257604036600319011261084257602435600435337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614801590610dd1575b61094057610d0b815f5461120e565b5f55610d2d610d1c8360025461120e565b8060025561ffff6006541690611473565b6003555f5b600a54811015610d865780610d486001926111e2565b838060a01b0391549060031b1c16610d73600254825f52600760205261ffff60405f20541690611473565b905f52600860205260405f205501610d32565b7f3aae519a7db03e1a8d2ce277caffd12b248ff9e84f194a95e0911ca074bf9cf360808385610db36114dc565b5f5460025491604051938452602084015260408301526060820152a1005b5060ff600b541615610cfc565b34610842575f36600319011261084257610df6611280565b5f54610e0b610c30610c2b60015480946111c1565b600155604051627eeac760e11b81523060048201526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811660248301527f00000000000000000000000000000000000000000000000000000000000000001690602081604481855afa9081156108cf575f91610ffc575b50610e9c83610e9761121b565b61120e565b11610fed575f610efd81926040516020810173d88539d3c4c460136a733a3fd60cf6bf269079da815286604083015260408252610eda606083611173565b81519020600c556040519485809481936348c8949160e01b835260048301611149565b03925af180156108cf57610f76575b50600c5461094057602090610f1f6114dc565b5f73d88539d3c4c460136a733a3fd60cf6bf269079da7f7d41ef2ca0417b1f34e24f6baa6bb801e64d7c82436e45963c2f78a168ba825184604051858152a35f5f805160206115a48339815191525d604051908152f35b3d805f833e610f858183611173565b8101906020818303126108425780519067ffffffffffffffff8211610842570181601f8201121561084257805190610fbc82611250565b92610fca6040519485611173565b8284526020838301011161084257815f9260208093018386015e83010152610f0c565b6340db7f8760e01b5f5260045ffd5b90506020813d602011611026575b8161101760209383611173565b81010312610842575183610e8a565b3d915061100a565b34610842575f3660031901126108425760205f54604051908152f35b34610842576020366003190112610842576001600160a01b0361106b611133565b165f526008602052602060405f2054604051908152f35b34610842575f366003190112610842576110a1600254600354906111c1565b5f90600a545b8083106110b957602082604051908152f35b906110e96001916110c9856111e2565b848060a01b0391549060031b1c165f52600860205260405f2054906111c1565b920191906110a7565b34610842575f366003190112610842577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b600435906001600160a01b038216820361084257565b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b90601f8019910116810190811067ffffffffffffffff82111761119557604052565b634e487b7160e01b5f52604160045260245ffd5b67ffffffffffffffff81116111955760051b60200190565b919082039182116111ce57565b634e487b7160e01b5f52601160045260245ffd5b600a548110156111fa57600a5f5260205f2001905f90565b634e487b7160e01b5f52603260045260245ffd5b919082018092116111ce57565b61124d61124461123b6112325f546002549061120e565b600154906111c1565b600454906111c1565b600554906111c1565b90565b67ffffffffffffffff811161119557601f01601f191660200190565b80518210156111fa5760209160051b010190565b5f805160206115a48339815191525c6112a65760015f805160206115a48339815191525d565b633ee5aeb560e01b5f5260045ffd5b80156112d65760016001607f1b0381111561124d575060016001607f1b0390565b639b0e91e160e01b5f5260045ffd5b604051627eeac760e11b81523060048201526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811660248301527f000000000000000000000000000000000000000000000000000000000000000016929190602081604481875afa9081156108cf575f91611441575b5061137083610e9761121b565b11610fed57604080516001600160a01b0392909216602083019081528282019390935281525f9283926113a99290610eda606083611173565b03925af180156108cf576113ca575b50600c54610940576113c86114dc565b565b3d805f833e6113d98183611173565b8101906020818303126108425780519067ffffffffffffffff8211610842570181601f820112156108425780519061141082611250565b9261141e6040519485611173565b8284526020838301011161084257815f9260208093018386015e830101526113b8565b90506020813d60201161146b575b8161145c60209383611173565b8101031261084257515f611363565b3d915061144f565b808202905f1983820990828083109203918083039283612710111561084257146114d1577fbc01a36e2eb1c432ca57a786c226809d495182a9930be0ded288ce703afb7e9193612710910990828211900360fc1b910360041c170290565b505061271091500490565b604051627eeac760e11b81523060048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03166024820152602081806044810103817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa9081156108cf575f91611571575b5061156a61121b565b11610fed57565b90506020813d60201161159b575b8161158c60209383611173565b8101031261084257515f611561565b3d915061157f56fe9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00",
      creationCodeHash: "0x7cab9b9d60e532cb8e8fc4444b832bb5cb842c5bdb4a1db2ee4873111f4ad754",
      runtimeTemplate: "0x6080806040526004361015610012575f80fd5b5f905f3560e01c90816302d05d3f14611bf75750806314ad21d814611bb9578063182148ef14611a9b5780631a65ec9314611a615780631cd6232e146117d657806321d0ee7014611782578063259982e514611782578063334f7ac5146117655780633e0dc34e1461172b57806348d5b114146116ee5780635567a03a146116b057806356397c351461166c578063575e24b4146115b95780636c2bbe7e1461140f5780636fe7e6eb146115415780637b78d458146114ed578063999b93af146114a95780639ce110d7146114655780639f063efc1461140f578063b47b2fb114610b39578063b6a8b0fa14610287578063c4e833ce14610a09578063cd210ef314610968578063d216d2961461079c578063dc4c90d314610757578063dc98354e146102e9578063e1b4af6914610287578063e934422f14610249578063fc0c546a146102045763fdf43bf714610168575f80fd5b34610201576040366003190112610201576101ce6080916040610189611dc4565b91610192611ead565b5061019c836123b1565b921515815280602052209061ffff604051926101b784611dee565b54818116845260101c16602083015260243561256e565b6101ff604051809261ffff602060406060938051865282810151838701520151828151166040860152015116910152565bf35b80fd5b50346102015780600319360112610201576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346102015760203660031901126102015760408091610267611dc4565b1515815280602052205461ffff825191818116835260101c166020820152f35b50346102015760049061029936611d6d565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330392506102dd91505057630a85dc2960e01b8152fd5b63570c108560e11b8152fd5b50346102015760e036600319011261020157610303611c65565b60a036602319011261075357610317611d47565b907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163303610744577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b039081169116148015919061070d575b81156103ad575b5061039e57604051636e4c1aa760e11b8152602090f35b63f92ee8a960e01b8152600490fd5b90507f000000000000000000000000000000000000000000000000000000000000000060020b8060ff1d8181011890620d89e882116106fb57600160801b7001fffcb933bd6fad37aa2d162d1a59400160018416021891849190600281166106df575b600481166106c3575b600881166106a7575b6010811661068b575b6020811661066f575b60408116610653575b60808116610637575b610100811661061b575b61020081166105ff575b61040081166105e3575b61080081166105c7575b61100081166105ab575b612000811661058f575b6140008116610573575b6180008116610557575b62010000811661053b575b620200008116610520575b620400008116610505575b62080000166104ed575b136104e5575b63ffffffff0160201c6001600160a01b03908116911614155f610387565b5f19046104c7565b916b048a170391f7dc42444e8fa20260801c916104c1565b6d2216e584f5fa1ea926041bedfe9890930260801c926104b7565b926e5d6af8dedb81196699c329225ee6040260801c926104ac565b926f09aa508b5b7a84e1c677de54f3e99bc90260801c926104a1565b926f31be135f97d08fd981231505542fcfa60260801c92610496565b926f70d869a156d2a1b890bb3df62baf32f70260801c9261048c565b926fa9f746462d870fdf8a65dc1f90e061e50260801c92610482565b926fd097f3bdfd2022b8845ad8f792aa58250260801c92610478565b926fe7159475a2c29b7443b29c7fa6e889d90260801c9261046e565b926ff3392b0822b70005940c7a398e4b70f30260801c92610464565b926ff987a7253ac413176f2b074cf7815e540260801c9261045a565b926ffcbe86c7900a88aedcffc83b479aa3a40260801c92610450565b926ffe5dee046a99a2a811c461f1969c30530260801c92610446565b926fff2ea16466c96a3843ec78b326b528610260801c9261043d565b926fff973b41fa98c081472e6896dfb254c00260801c92610434565b926fffcb9843d60f6159c9db58835c9266440260801c9261042b565b926fffe5caca7e10e4e61c3624eaa0941cd00260801c92610422565b926ffff2e50f5f656932ef12357cf3c7fdcc0260801c92610419565b926ffff97272373d413259a46990580e213a0260801c92610410565b6345c3193d60e11b8452600452602483fd5b905060a061071a36611fa5565b207f0000000000000000000000000000000000000000000000000000000000000000141590610380565b63570c108560e11b8352600483fd5b5080fd5b50346102015780600319360112610201576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346102015760203660031901126102015760606040516107bc81611e25565b828152826020820152826040820152604051926107d884611e40565b80845280602085015280604085015280838501528060808501528060a08501528060c08501528060e0850152610100840152015261018061081a600435611e7d565b506101006040519161082b83611e25565b80546001600160a01b0316835260018101546020840190815260028201546040808601918252519290919060059061086285611e40565b6003810154855260ff600482015461ffff81166020880152818160101c166040880152818160181c16606088015263ffffffff8160201c16608088015263ffffffff8160401c1660a088015263ffffffff8160601c1660c088015260801c16151560e0860152015484840152606085019283526040519460018060a01b039051168552516020850152516040840152518051606084015261ffff602082015116608084015260ff60408201511660a084015260ff60608201511660c084015263ffffffff60808201511660e084015263ffffffff60a0820151168284015263ffffffff60c08201511661012084015260e081015115156101408401520151610160820152f35b5034610201576040366003190112610201576101ff6109d260a092604061098d611dc4565b91610996611ead565b506109a0836123b1565b921515815280602052209061ffff604051926109bb84611dee565b54818116845260101c16602083015260243561240b565b604092919251928352602083019061ffff602060406060938051865282810151838701520151828151166040860152015116910152565b50346102015780600319360112610201576040516101c081018181106001600160401b03821117610b255791806020926101c09460405283810182815260408201838152606083018481526080840185815260a0850186815260c086019060e08701926101008801948986526101208901968a88526101408a019860016101608c019b61018081019d8e526101a081019e8f5252600186526001875260018a5260018b526040519d8e916001835251151591015251151560408d015251151560608c015251151560808b015251151560a08a015251151560c089015251151560e08801525115156101008701525115156101208601525115156101408501525115156101608401525115156101808301525115156101a0820152f35b634e487b7160e01b83526041600452602483fd5b50346112875761016036600319011261128757610b54611c65565b9060a03660231901126112875760603660c319011261128757610144356001600160401b03811161128757610b8d903690600401611c38565b50507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036114005760ff60015416916001831415806113f5575b80156113c0575b6113b15760405160c081018181106001600160401b0382111761139d576040525f81525f60208201525f60408201525f60608201525f6080820152610c1b611ead565b60a0820152610c2b60e435612627565b60c4358015158103611287576001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081167f00000000000000000000000000000000000000000000000000000000000000009091161090151581148084525f60e435126020850181905214604084015215611391576101243560801d5b6001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081167f000000000000000000000000000000000000000000000000000000000000000090911610156113845761012435600f0b915b610d1582612718565b9060408501511580611372575b6112c95760208501511561131057610d81908551151590815f1461130857905b816060880152610d51816123b1565b905f525f60205260405f209161ffff60405193610d6d85611dee565b54818116855260101c16602084015261256e565b60a08501525b610d9a606085015160a086015190612679565b908160808601526040850151151591826112d8575b50506112c95782515f9190156112a857600f0b129081159161129a575b505b61128b57604060a08201510151815115155f525f60205260405f209061ffff81511663ffff00006020845493015160101b169163ffffffff19161717905560808101518061118f575b5060a081015180516020909101517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031691823b1561118b579060448692836040519586948593631c4b9a2d60e01b8552600485015260248401525af1801561118057908491611167575b5050805115159160208201511515610ea260e435612627565b60608401519160405195610eb587611e09565b7f0000000000000000000000000000000000000000000000000000000000000000875260018060a01b038516602088015260408701526060860152608085015260a08401526101243560801d600f0b60c084015261012435600f0b60e0840152835b60025481101561107057610f2a81611e7d565b50600481019081549060028260101c161561106557610fe491908815611057576311aaa97d60e11b915b63ffffffff604051918460208401528a51602484015260018060a01b0360208c015116604484015260408b01511515606484015260608b01511515608484015260808b015160a484015260a08b015160c484015260c08b0151600f0b60e484015260e08b0151600f0b6101048401526101048352610fd461012484611e5c565b8b1561104d5760201c1691611efc565b15610ff5575b506001905b01610f17565b5460801c60ff161561103657806001917f699c7feb850c0da9a2a1cd65be9b13df0cce79ae7dfbef2bd411bc8e68d8e56c602060405160028152a290610fea565b63ae193d1560e01b85526004526002602452604484fd5b60401c1691611efc565b63fcd93e9760e01b91610f54565b505050600190610fef565b604085848460038a0361115f5760ff60025b1660ff196001541617600155815115159060208301511515606084015160a08501519060208251920151928851958652602086015287850152606084015260808301526101243560801d600f0b60a083015261012435600f0b60c083015260018060a01b0316907f583ec8ec4eab64e7e5cc7f84ae0de43cb727aed3ff51fcf279f7351c6692bdac60e07f000000000000000000000000000000000000000000000000000000000000000092a3808301511561115157505b81519063b47b2fb160e01b8252600f0b6020820152f35b608091500151600f0b61113a565b60ff83611082565b8161117191611e5c565b61117c57825f610e89565b8280fd5b6040513d86823e3d90fd5b8580fd5b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163b1561128757604051630ab714fb60e11b81526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811660048301527f0000000000000000000000000000000000000000000000000000000000000000811660248301526044820192909252905f908290606490829084907f0000000000000000000000000000000000000000000000000000000000000000165af1801561127c5715610e17576112749193505f90611e5c565b5f915f610e17565b6040513d5f823e3d90fd5b5f80fd5b6304564c7160e21b5f5260045ffd5b5f9150600f0b13155f610dcc565b600f0b13908115916112bb575b50610dce565b5f9150600f0b12155f6112b5565b63d39cf37760e01b5f5260045ffd5b855191925090156112fc576112f19060608601516123fe565b905b14155f80610daf565b506060840151906112f3565b508290610d42565b61135d908551151590815f1461136c575082905b61132d816123b1565b905f525f60205260405f209161ffff6040519361134985611dee565b54818116855260101c16602084015261240b565b60a08601526060850152610d87565b90611324565b508061137d85612718565b1415610d22565b6101243560801d91610d0c565b61012435600f0b610cae565b634e487b7160e01b5f52604160045260245ffd5b63e1bcc00560e01b5f5260045ffd5b5060a06113cc36611fa5565b207f00000000000000000000000000000000000000000000000000000000000000001415610bd8565b506003831415610bd1565b63570c108560e11b5f5260045ffd5b346112875761141d36611cde565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330393506114009250505057630a85dc2960e01b5f5260045ffd5b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287576020366003190112611287576020611508611c65565b600154600260ff8216149182611525575b50506040519015158152f35b6001600160a01b0390811660089290921c161490508280611519565b34611287576101003660031901126112875761155b611c65565b5060a036602319011261128757611570611d47565b50611579611d5d565b507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330361140057630a85dc2960e01b5f5260045ffd5b3461128757610140366003190112611287576115d3611c65565b60a03660231901126112875760603660c319011261128757610124356001600160401b0381116112875761160b903690600401611c38565b50507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036114005762ffffff61164c60609261202c565b906040939293519363ffffffff60e01b1684526020840152166040820152f35b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287575f36600319011261128757602060405161ffff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34611287575f3660031901126112875760206040517f000000000000000000000000000000000000000000000000000000000000000060020b8152f35b34611287575f3660031901126112875760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34611287575f366003190112611287576020600254604051908152f35b346112875761179036611c7b565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633039150611400905057630a85dc2960e01b5f5260045ffd5b34611287576040366003190112611287576004356024356001600160401b03811161128757611809903690600401611c38565b6001549060ff82166113b15761181e84611e7d565b5060048101926004845460101c16158015611a56575b611a1c57600260ff198216176001556001845460181c16611a2b575b5060405160208101635c085b4160e11b815233602483015260406044830152836064830152838660848401375f60848584010152601f19601f850116946118a56084848881010301601f198101855284611e5c565b549163ffffffff8360601c169260018060a01b03855416946001863f91015403611a1c57643fffffffc0805a92605a1c16166040600160a61b031684158582046040141715611a0857603f90049061ea608201809211611a0857106119f95783926020925f6040519687948286525193f18092513d826119d3575b50506119c15750156119a957600180546001600160a81b03191690556001600160401b03811161139d5761195a6020604051930183611e5c565b8082526020820192368282011161128757815f92602092863783010152519020906040519182527fca539ca6d71f32350620025ebd69a27e47c82be74d18a0f8c587d5faa2b477f660203393a3005b8363ae193d1560e01b5f52600452600460245260445ffd5b631bea0edf60e11b5f5260045260245ffd5b602014801592506119e7575b508780611920565b635c085b4160e11b14159050876119df565b631115766760e01b5f5260045ffd5b634e487b7160e01b5f52601160045260245ffd5b63c52a9bd360e01b5f5260045ffd5b81546001600160a81b031990911660089190911b610100600160a81b03161760021760015585611850565b506140008311611834565b34611287575f3660031901126112875760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34611287575f366003190112611287575f6080604051611aba81611dd3565b828152602081018390526040810183905260608101839052015260a06001600160a01b037f00000000000000000000000000000000000000000000000000000000000000008181167f000000000000000000000000000000000000000000000000000000000000000092831610918215611bb357805b5f196001861b01169215611bac57505b604051611b4c81611dd3565b8281526020810191600180861b0316825262ffffff604082015f815260806060840193603c85520193308552604051958652600180881b039051166020860152511660408401525160020b6060830152600180841b039051166080820152f35b9050611b40565b81611b30565b34611287575f36600319011261128757602060405161ffff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34611287575f366003190112611287577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b9181601f84011215611287578235916001600160401b038311611287576020838186019501011161128757565b600435906001600160a01b038216820361128757565b90610160600319830112611287576004356001600160a01b0381168103611287579160a060231982011261128757602491608060c3198301126112875760c49161014435906001600160401b03821161128757611cda91600401611c38565b9091565b906101a0600319830112611287576004356001600160a01b0381168103611287579160a060231982011261128757602491608060c3198301126112875760c4916101443591610164359161018435906001600160401b03821161128757611cda91600401611c38565b60c435906001600160a01b038216820361128757565b60e435908160020b820361128757565b610120600319820112611287576004356001600160a01b0381168103611287579160a06023198301126112875760249160c4359160e4359161010435906001600160401b03821161128757611cda91600401611c38565b60043590811515820361128757565b60a081019081106001600160401b0382111761139d57604052565b604081019081106001600160401b0382111761139d57604052565b61010081019081106001600160401b0382111761139d57604052565b608081019081106001600160401b0382111761139d57604052565b61012081019081106001600160401b0382111761139d57604052565b90601f801991011681019081106001600160401b0382111761139d57604052565b600254811015611e995760025f52600660205f20910201905f90565b634e487b7160e01b5f52603260045260245ffd5b60405190606082018281106001600160401b0382111761139d57604052815f81525f60208201526040805191611ee283611dee565b5f83525f60208401520152565b91908201809211611a0857565b9160018060a01b03835416926001843f91015403611a1c575a63ffffffff8216643fffffffc08360061b169080820460401490151715611a0857603f90049061ea608201809211611a0857106119f9576020906040519283915f83525f86858451940192f1928391513d83611f77575b5050506119c1575090565b60201480159350909190611f90575b50505f8080611f6c565b6001600160e01b031916141590505f80611f86565b60a09060231901126112875760405190611fbe82611dd3565b816024356001600160a01b03811681036112875781526044356001600160a01b038116810361128757602082015260643562ffffff811681036112875760408201526084358060020b810361128757606082015260a435906001600160a01b03821682036112875760800152565b6001549060ff821691821515806123a6575b6113b15760a03660231901126112875760405161205a81611dd3565b6024356001600160a01b03811681036112875781526044356001600160a01b038116810361128757602082015260643562ffffff811681036112875760408201526084358060020b810361128757606082015260a435906001600160a01b03821682036112875760a091608082015220927f00000000000000000000000000000000000000000000000000000000000000008094036119f95760020361239d5760ff60035b169060ff19161760015560e4359261211684612627565b9260c435801515808203611287575f915060018060a01b037f00000000000000000000000000000000000000000000000000000000000000001660018060a01b037f00000000000000000000000000000000000000000000000000000000000000001610149512936040519161218b83611e09565b8252602082019360018060a01b03168452604082019580875260608301938685526080840183815260a08501915f835260c08601935f855260e08701955f87525f5b6002548110156122ae57808b6121e38f93611e7d565b508b8d60048301549560018760101c16156122a0579563ffffffff9161227a96976311aaa97d60e11b966040519588602088015251602487015260018060a01b039051166044860152511515606485015251151560848401528a5160a48401528b5160c48401528c51600f0b60e48401528d51600f0b610104840152610104835261227061012484611e5c565b60201c1691611efc565b15612289576001905b016121cd565b63ae193d1560e01b5f52600452600160245260445ffd5b505050505060019150612283565b50985098965098505050505050820361238c5761231a91816122ce611ead565b50811561232c5750806122e3612314926123b1565b905f525f60205260405f209061ffff604051926122ff84611dee565b54818116845260101c1660208301528361256e565b90612679565b60801b906315d7892d60e21b91905f90565b5f808052602052604051612314935091507f00000000000000000000000000000000000000000000000000000000000000009061ffff7fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb561134985611dee565b506315d7892d60e21b915f91508190565b60ff60016120ff565b50600283141561203e565b156123da577f000000000000000000000000000000000000000000000000000000000000000090565b7f000000000000000000000000000000000000000000000000000000000000000090565b91908203918211611a0857565b919290612416611ead565b5061242184826126c1565b8215801561255e575b6125505761ffff8116806126f203906126f28211611a0857846127100261271081048603611a08576124656124749161ffff89511690611eef565b61ffff60208901511690611eef565b906126f21461253c570493846003811115612535576002198101818111611a0857905b85821061252d575b60016001607f1b031061251e575b858111156124c45763686c07bf60e11b5f5260045ffd5b6124cf82848361256e565b6124df8151602083015190611eef565b86838210918261250a575b505061250157505f198114611a08576001016124ad565b90955093505050565b612516919250846123fe565b14865f6124ea565b60016001607f1b0395506124ad565b85915061249f565b5f90612497565b634e487b7160e01b5f52601260045260245ffd5b62a4671960e71b5f5260045ffd5b5060016001607f1b03831161242a565b9291612578611ead565b9361258382846126c1565b8015808015612607575b61255057601e8202828104601e14821715611a08576125b361ffff918286511690611eef565b9416808302928304141715611a08576125d96127109161ffff6020819501511690611eef565b818404865281810460208701528282604051956125f587611dee565b06168452061660208201526040830152565b5060016001607f1b03821161258d565b600160ff1b8114611a08575f0390565b80158015612669575b801561264f575b6119f9575f81121561264c5761264c90612617565b90565b506f7ffffffffffffffffffffffffffffffe198112612637565b5060016001607f1b038113612630565b919061268c906020815191015190611eef565b9180159081156126b0575b81156126a5575b506119f957565b90508210155f61269e565b60016001607f1b0381119150612697565b61ffff6103e8911611908115612705575b81156126ef575b506126e057565b634db7e85160e01b5f5260045ffd5b6127109150602061ffff9101511610155f6126d9565b905061271061ffff8251161015906126d2565b600f0b5f81121561264c5761264c9061261756",
      immutableReferences: [
        {
          start: 670,
          length: 32
        },
        {
          start: 794,
          length: 32
        },
        {
          start: 1901,
          length: 32
        },
        {
          start: 2961,
          length: 32
        },
        {
          start: 4497,
          length: 32
        },
        {
          start: 4666,
          length: 32
        },
        {
          start: 5154,
          length: 32
        },
        {
          start: 5500,
          length: 32
        },
        {
          start: 5647,
          length: 32
        },
        {
          start: 6037,
          length: 32
        },
        {
          start: 842,
          length: 32
        },
        {
          start: 5242,
          length: 32
        },
        {
          start: 538,
          length: 32
        },
        {
          start: 3137,
          length: 32
        },
        {
          start: 3256,
          length: 32
        },
        {
          start: 6880,
          length: 32
        },
        {
          start: 8496,
          length: 32
        },
        {
          start: 3172,
          length: 32
        },
        {
          start: 3291,
          length: 32
        },
        {
          start: 4606,
          length: 32
        },
        {
          start: 5310,
          length: 32
        },
        {
          start: 6916,
          length: 32
        },
        {
          start: 8537,
          length: 32
        },
        {
          start: 7177,
          length: 32
        },
        {
          start: 945,
          length: 32
        },
        {
          start: 5893,
          length: 32
        },
        {
          start: 7123,
          length: 32
        },
        {
          start: 9144,
          length: 32
        },
        {
          start: 5834,
          length: 32
        },
        {
          start: 9023,
          length: 32
        },
        {
          start: 9180,
          length: 32
        },
        {
          start: 3623,
          length: 32
        },
        {
          start: 4566,
          length: 32
        },
        {
          start: 5761,
          length: 32
        },
        {
          start: 1821,
          length: 32
        },
        {
          start: 3767,
          length: 32
        },
        {
          start: 4366,
          length: 32
        },
        {
          start: 5071,
          length: 32
        },
        {
          start: 5954,
          length: 32
        },
        {
          start: 8397,
          length: 32
        },
        {
          start: 6776,
          length: 32
        }
      ],
      sources: {
        "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol": "0xe06a3f08a987af6ad2e1c1e774405d4fe08f1694b67517438b467cecf0da0ef7",
        "lib/openzeppelin-contracts/contracts/utils/ReentrancyGuardTransient.sol": "0xe56ff5015046505f81f9d62671a784e933dd099db4c3a8fa8de598f20af2c5a3",
        "lib/openzeppelin-contracts/contracts/utils/TransientSlot.sol": "0xac673fa1e374d9e6107504af363333e3e5f6344d2e83faf57d9bfd41d77cc946",
        "lib/openzeppelin-uniswap-hooks/src/base/BaseHook.sol": "0x4a3534932ad54cdacf8bcd60489bf9df253ad5daa8dd5599753312844e4af45c",
        "lib/v4-core/src/interfaces/IExtsload.sol": "0x80b53ca4907d6f0088c3b931f2b72cad1dc4615a95094d96bd0fb8dff8d5ba43",
        "lib/v4-core/src/interfaces/IExttload.sol": "0xc6b68283ebd8d1c789df536756726eed51c589134bb20821b236a0d22a135937",
        "lib/v4-core/src/interfaces/IHooks.sol": "0xc131ffa2d04c10a012fe715fe2c115811526b7ea34285cf0a04ce7ce8320da8d",
        "lib/v4-core/src/interfaces/IPoolManager.sol": "0xbdab3544da3d32dfdf7457baa94e17d5a3012952428559e013ffac45d067038e",
        "lib/v4-core/src/interfaces/IProtocolFees.sol": "0x32a666e588a2f66334430357bb1e2424fe7eebeb98a3364b1dd16eb6ccca9848",
        "lib/v4-core/src/interfaces/callback/IUnlockCallback.sol": "0x58c82f2bd9d7c097ed09bd0991fedc403b0ec270eb3d0158bfb095c06a03d719",
        "lib/v4-core/src/interfaces/external/IERC20Minimal.sol": "0xeccadf1bf69ba2eb51f2fe4fa511bc7bb05bbd6b9f9a3cb8e5d83d9582613e0f",
        "lib/v4-core/src/interfaces/external/IERC6909Claims.sol": "0xa586f345739e52b0488a0fe40b6e375cce67fdd25758408b0efcb5133ad96a48",
        "lib/v4-core/src/libraries/BitMath.sol": "0x51b9be4f5c4fd3e80cbc9631a65244a2eb2be250b6b7f128a2035080e18aee8d",
        "lib/v4-core/src/libraries/CustomRevert.sol": "0x111ed3031b6990c80a93ae35dde6b6ac0b7e6af471388fdd7461e91edda9b7de",
        "lib/v4-core/src/libraries/FullMath.sol": "0x4fc73a00817193fd3cac1cc03d8167d21af97d75f1815a070ee31a90c702b4c2",
        "lib/v4-core/src/libraries/Hooks.sol": "0xd679b4b2d429689bc44f136050ebc958fb2d7d0d3a3c7b3e48c08ab4fba09aaa",
        "lib/v4-core/src/libraries/LPFeeLibrary.sol": "0xbf6914e01014e7c1044111feb7df7a3d96bb503b3da827ad8464b1955580d13b",
        "lib/v4-core/src/libraries/ParseBytes.sol": "0x7533b13f53ee2c2c55500100b22ffd6e37e7523c27874edc98663d53a8672b15",
        "lib/v4-core/src/libraries/SafeCast.sol": "0x42c4a24f996a14d358be397b71f7ec9d7daf666aaec78002c63315a6ee67aa86",
        "lib/v4-core/src/libraries/TickMath.sol": "0x4e1a11e154eb06106cb1c4598f06cca5f5ca16eaa33494ba2f0e74981123eca8",
        "lib/v4-core/src/types/BalanceDelta.sol": "0xa719c8fe51e0a9524280178f19f6851bcc3b3b60e73618f3d60905d35ae5569f",
        "lib/v4-core/src/types/BeforeSwapDelta.sol": "0x2a774312d91285313d569da1a718c909655da5432310417692097a1d4dc83a78",
        "lib/v4-core/src/types/Currency.sol": "0x4a0b84b282577ff6f8acf13ec9f4d32dbb9348748b49611d00e68bee96609c93",
        "lib/v4-core/src/types/PoolId.sol": "0x308311916ea0f5c2fd878b6a2751eb223d170a69e33f601fae56dfe3c5d392af",
        "lib/v4-core/src/types/PoolKey.sol": "0xf89856e0580d7a4856d3187a76858377ccee9d59702d230c338d84388221b786",
        "lib/v4-core/src/types/PoolOperation.sol": "0x7a1a107fc1f2208abb2c9364c8c54e56e98dca27673e9441bed2b949b6382162",
        "src/module-foundation/FoundationFeeMathV1.sol": "0x27a21ffdd2d6b61f4a292c8fc1907fad1ac10ab1adc2b1deade67950011f67cd",
        "src/module-foundation/FoundationHookV2.sol": "0x8c8cfa62ecf96e632943246eb55ff3b42489ade7043873583d66b6e55f04635e",
        "src/module-foundation/FoundationLedgerV1.sol": "0x47895ccfb4ac77fd72bf2004d11740f71b5e2b492d760736cb365949c21747c2",
        "src/module-foundation/FoundationTypesV1.sol": "0x1c1782146f0a707c7171068ba5a061dd2e2562d5cfa96d627107fcca0b5f12e8",
        "src/module-foundation/IFoundationModuleV1.sol": "0xd1b2e59ed62f5b4dbe1171a8686175b3270c9f31d7c25345e66e88be0ceef1fe"
      }
    }
  }
};

// contracts/spec/module-foundation/ethereum-graph-bytecode.v2.json
var ethereum_graph_bytecode_v2_default = {
  schemaVersion: "programmable.ethereum-module-bytecode.v2",
  sourceCommit: "ca4e0f38bd977cdd84e2cf988c456deecdc62b5e",
  compilerVersion: "0.8.26+commit.8a97fa7a",
  evmVersion: "cancun",
  viaIR: true,
  optimizerRuns: 200,
  contracts: {
    FoundationEthereumGraphProxyV2: {
      constructorInputs: [
        {
          name: "target",
          type: "address",
          internalType: "address"
        },
        {
          name: "expectedCodeHash",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "launchWallet",
          type: "address",
          internalType: "address"
        },
        {
          name: "routeNonce",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      creationBytecode: "0x60c080604052346101a8576080816102e8803803809161001f82856101ca565b8339810103126101a857610032816101ed565b6020820151906060610046604085016101ed565b93015192813b1580156101bf575b8015610136575b610127575f9384938360805260a0526040519060208201926321cb087960e01b845260018060a01b0316602483015260448201526044815261009e6064826101ca565b51915af43d1561011f573d906001600160401b03821161010b57604051916100d0601f8201601f1916602001846101ca565b82523d5f602084013e5b156101035760405160e6908161020282396080518181816079015260b5015260a0518160420152f35b602081519101fd5b634e487b7160e01b5f52604160045260245ffd5b6060906100da565b63340aafcd60e11b5f5260045ffd5b50604051630e64f2e760e11b81526020816004816001600160a01b0387165afa9081156101b4575f91610176575b506001600160a01b031633141561005b565b90506020813d6020116101ac575b81610191602093836101ca565b810103126101a8576101a2906101ed565b5f610164565b5f80fd5b3d9150610184565b6040513d5f823e3d90fd5b5082823f1415610054565b601f909101601f19168101906001600160401b0382119082101761010b57604052565b51906001600160a01b03821682036101a85756fe608060405260043610156015575b3660ab5760ab565b5f3560e01c80635c60da1b1460695763bc0a398103600d57346065575f36600319011260655760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b5f80fd5b346065575f3660031901126065577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03166080908152602090f35b365f80375f8036817f00000000000000000000000000000000000000000000000000000000000000005af43d5f803e1560e2573d5ff35b3d5ffd",
      creationCodeHash: "0xbb1258a7a222a2e627771d7f58c6ce23c5a1cbdac0418994cb0aad9954958264",
      runtimeTemplate: "0x608060405260043610156015575b3660ab5760ab565b5f3560e01c80635c60da1b1460695763bc0a398103600d57346065575f36600319011260655760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b5f80fd5b346065575f3660031901126065577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03166080908152602090f35b365f80375f8036817f00000000000000000000000000000000000000000000000000000000000000005af43d5f803e1560e2573d5ff35b3d5ffd",
      immutableReferences: [
        {
          start: 121,
          length: 32
        },
        {
          start: 181,
          length: 32
        },
        {
          start: 66,
          length: 32
        }
      ],
      sources: {
        "lib/openzeppelin-contracts/contracts/proxy/Proxy.sol": "0xc3f2ec76a3de8ed7a7007c46166f5550c72c7709e3fc7e8bb3111a7191cdedbd",
        "src/module-foundation/FoundationEthereumGraphProxyV2.sol": "0xf5b31f2f750aca5e886c3e2a732cdaa9ad19a1a47e2e52eceddf86610ec0bf45"
      }
    },
    FoundationTokenV1: {
      constructorInputs: [
        {
          name: "m",
          type: "tuple",
          internalType: "struct FoundationTypesV1.Metadata",
          components: [
            {
              name: "name",
              type: "string",
              internalType: "string"
            },
            {
              name: "symbol",
              type: "string",
              internalType: "string"
            },
            {
              name: "description",
              type: "string",
              internalType: "string"
            },
            {
              name: "imageURI",
              type: "string",
              internalType: "string"
            },
            {
              name: "website",
              type: "string",
              internalType: "string"
            },
            {
              name: "socialData",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        },
        {
          name: "recipient",
          type: "address",
          internalType: "address"
        }
      ],
      creationBytecode: "0x60a080604052346109eb5761152b803803809161001c82856109ef565b83398101906040818303126109eb5780516001600160401b0381116109eb57810160c0818403126109eb576040519160c083016001600160401b038111848210176106075760405281516001600160401b0381116109eb5784610080918401610a57565b835260208201516001600160401b0381116109eb57846100a1918401610a57565b6020840190815260408301519091906001600160401b0381116109eb57856100ca918501610a57565b6040850190815260608401519093906001600160401b0381116109eb57866100f3918301610a57565b6060860190815260808201519096906001600160401b0381116109eb578161011c918401610a57565b6080870190815260a083015190926001600160401b0382116109eb570181601f820112156109eb57602091818361015593519101610a12565b60a087019081529201516001600160a01b03811696908790036109eb5785518451815190916001600160401b03821161060757610193600354610a74565b601f811161099d575b50602090601f8311600114610938576101cc92915f918361053e575b50508160011b915f199060031b1c19161790565b6003555b8051906001600160401b038211610607576101ec600454610a74565b601f81116108ea575b50602090601f83116001146108855761022492915f918361053e5750508160011b915f199060031b1c19161790565b6004555b855151801590811561087a575b508015610870575b8015610864575b8015610857575b801561084d575b8015610840575b8015610833575b8015610826575b6108175784518051906001600160401b03821161060757610289600554610a74565b601f81116107e6575b50602090601f8311600114610781576102c192915f918361053e5750508160011b915f199060031b1c19161790565b6005555b80518051906001600160401b038211610607576102e3600654610a74565b601f8111610733575b50602090601f83116001146106ce5761031b92915f918361053e5750508160011b915f199060031b1c19161790565b6006555b81518051906001600160401b0382116106075761033d600754610a74565b601f8111610680575b50602090601f831160011461061b5761037592915f918361053e5750508160011b915f199060031b1c19161790565b6007555b82518051906001600160401b03821161060757610397600854610a74565b601f81116105ae575b50602090601f8311600114610549576103cf92915f918361053e5750508160011b915f199060031b1c19161790565b6008555b604051948594602086019760208952516040870160c0905261010087016103f991610ac2565b9051868203603f190160608801526104119190610ac2565b9051858203603f190160808701526104299190610ac2565b9051848203603f190160a08601526104419190610ac2565b9051838203603f190160c08501526104599190610ac2565b9051828203603f190160e08401526104719190610ac2565b03601f198101825261048390826109ef565b519020608052801561052b576002546b033b2e3c9fd0803ce8000000810180911161051757600255805f525f60205260405f206b033b2e3c9fd0803ce800000081540190555f7fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef60206040516b033b2e3c9fd0803ce80000008152a3604051610a449081610ae78239608051816101670152f35b634e487b7160e01b5f52601160045260245ffd5b63ec442f0560e01b5f525f60045260245ffd5b015190505f806101b8565b90601f1983169160085f52815f20925f5b818110610596575090846001959493921061057e575b505050811b016008556103d3565b01515f1960f88460031b161c191690555f8080610570565b9293602060018192878601518155019501930161055a565b60085f526105f7907ff3f7a9fe364faab93b216da50a3214154f22a0a2b415b23a84c8169e8b636ee3601f850160051c810191602086106105fd575b601f0160051c0190610aac565b5f6103a0565b90915081906105ea565b634e487b7160e01b5f52604160045260245ffd5b90601f1983169160075f52815f20925f5b8181106106685750908460019594939210610650575b505050811b01600755610379565b01515f1960f88460031b161c191690555f8080610642565b9293602060018192878601518155019501930161062c565b60075f526106c8907fa66cc928b5edb82af9bd49922954155ab7b0942694bea4ce44661d9a8736c688601f850160051c810191602086106105fd57601f0160051c0190610aac565b5f610346565b90601f1983169160065f52815f20925f5b81811061071b5750908460019594939210610703575b505050811b0160065561031f565b01515f1960f88460031b161c191690555f80806106f5565b929360206001819287860151815501950193016106df565b60065f5261077b907ff652222313e28459528d920b65115c16c04f3efc82aaedc97be59f3f377c0d3f601f850160051c810191602086106105fd57601f0160051c0190610aac565b5f6102ec565b90601f1983169160055f52815f20925f5b8181106107ce57509084600195949392106107b6575b505050811b016005556102c5565b01515f1960f88460031b161c191690555f80806107a8565b92936020600181928786015181550195019301610792565b6108119060055f5260205f20601f850160051c810191602086106105fd57601f0160051c0190610aac565b5f610292565b635e765b2560e11b5f5260045ffd5b506104b083515111610267565b5061080082515111610260565b5061080081515111610259565b5080515115610252565b506101188551511161024b565b50600c84515111610244565b508351511561023d565b60309150115f610235565b90601f1983169160045f52815f20925f5b8181106108d257509084600195949392106108ba575b505050811b01600455610228565b01515f1960f88460031b161c191690555f80806108ac565b92936020600181928786015181550195019301610896565b60045f52610932907f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b601f850160051c810191602086106105fd57601f0160051c0190610aac565b5f6101f5565b90601f1983169160035f52815f20925f5b818110610985575090846001959493921061096d575b505050811b016003556101d0565b01515f1960f88460031b161c191690555f808061095f565b92936020600181928786015181550195019301610949565b60035f526109e5907fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b601f850160051c810191602086106105fd57601f0160051c0190610aac565b5f61019c565b5f80fd5b601f909101601f19168101906001600160401b0382119082101761060757604052565b9192916001600160401b0382116106075760405191610a3b601f8201601f1916602001846109ef565b8294818452818301116109eb578281602093845f96015e010152565b9080601f830112156109eb578151610a7192602001610a12565b90565b90600182811c92168015610aa2575b6020831014610a8e57565b634e487b7160e01b5f52602260045260245ffd5b91607f1691610a83565b818110610ab7575050565b5f8155600101610aac565b805180835260209291819084018484015e5f828201840152601f01601f191601019056fe60806040526004361015610011575f80fd5b5f3560e01c806306fdde03146105c1578063095ea7b31461053f57806318160ddd1461052257806323b872dd14610443578063313ce56714610428578063392f37e9146103ad57806342966c681461030d578063609d3334146102f257806370a08231146102bb5780637284e416146102a057806395d89b41146101d6578063a9059cbb146101a5578063beb0a4161461018a578063c5a1d7f014610150578063dd62ed3e146101005763f3ccaac0146100c9575f80fd5b346100fc575f3660031901126100fc576100f86100e4610905565b604051918291602083526020830190610666565b0390f35b5f80fd5b346100fc5760403660031901126100fc5761011961068a565b6101216106a0565b6001600160a01b039182165f908152600160209081526040808320949093168252928352819020549051908152f35b346100fc575f3660031901126100fc5760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b346100fc575f3660031901126100fc576100f86100e4610870565b346100fc5760403660031901126100fc576101cb6101c161068a565b602435903361099a565b602060405160018152f35b346100fc575f3660031901126100fc576040515f6004546101f6816106b6565b808452906001811690811561027c575060011461021e575b6100f8836100e4818503826106ee565b60045f9081527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b939250905b808210610262575090915081016020016100e461020e565b91926001816020925483858801015201910190929161024a565b60ff191660208086019190915291151560051b840190910191506100e4905061020e565b346100fc575f3660031901126100fc576100f86100e46107db565b346100fc5760203660031901126100fc576001600160a01b036102dc61068a565b165f525f602052602060405f2054604051908152f35b346100fc575f3660031901126100fc576100f86100e4610724565b346100fc5760203660031901126100fc57600435331561039a57335f525f60205260405f20548181106103815790805f923384528360205203604083205580600254036002556040519081527fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef60203392a3005b63391434e360e21b5f523360045260245260445260645ffd5b634b637e8f60e11b5f525f60045260245ffd5b346100fc575f3660031901126100fc576103fe6103c86107db565b6100f86103d3610870565b61041a6103de610905565b61040c6103e9610724565b93604051978897608089526080890190610666565b908782036020890152610666565b908582036040870152610666565b908382036060850152610666565b346100fc575f3660031901126100fc57602060405160128152f35b346100fc5760603660031901126100fc5761045c61068a565b6104646106a0565b6001600160a01b0382165f818152600160209081526040808320338452909152902054909260443592915f1981106104a2575b506101cb935061099a565b8381106105075784156104f45733156104e1576101cb945f52600160205260405f2060018060a01b0333165f526020528360405f209103905584610497565b634a1406b160e11b5f525f60045260245ffd5b63e602df0560e01b5f525f60045260245ffd5b8390637dc7a0d960e11b5f523360045260245260445260645ffd5b346100fc575f3660031901126100fc576020600254604051908152f35b346100fc5760403660031901126100fc5761055861068a565b6024359033156104f4576001600160a01b03169081156104e157335f52600160205260405f20825f526020528060405f20556040519081527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92560203392a3602060405160018152f35b346100fc575f3660031901126100fc576040515f6003546105e1816106b6565b808452906001811690811561027c5750600114610608576100f8836100e4818503826106ee565b60035f9081527fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b939250905b80821061064c575090915081016020016100e461020e565b919260018160209254838588010152019101909291610634565b805180835260209291819084018484015e5f828201840152601f01601f1916010190565b600435906001600160a01b03821682036100fc57565b602435906001600160a01b03821682036100fc57565b90600182811c921680156106e4575b60208310146106d057565b634e487b7160e01b5f52602260045260245ffd5b91607f16916106c5565b90601f8019910116810190811067ffffffffffffffff82111761071057604052565b634e487b7160e01b5f52604160045260245ffd5b604051905f8260085491610737836106b6565b80835292600181169081156107bc575060011461075d575b61075b925003836106ee565b565b5060085f90815290917ff3f7a9fe364faab93b216da50a3214154f22a0a2b415b23a84c8169e8b636ee35b8183106107a057505090602061075b9282010161074f565b6020919350806001915483858901015201910190918492610788565b6020925061075b94915060ff191682840152151560051b82010161074f565b604051905f82600554916107ee836106b6565b80835292600181169081156107bc57506001146108115761075b925003836106ee565b5060055f90815290917f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db05b81831061085457505090602061075b9282010161074f565b602091935080600191548385890101520191019091849261083c565b604051905f8260075491610883836106b6565b80835292600181169081156107bc57506001146108a65761075b925003836106ee565b5060075f90815290917fa66cc928b5edb82af9bd49922954155ab7b0942694bea4ce44661d9a8736c6885b8183106108e957505090602061075b9282010161074f565b60209193508060019154838589010152019101909184926108d1565b604051905f8260065491610918836106b6565b80835292600181169081156107bc575060011461093b5761075b925003836106ee565b5060065f90815290917ff652222313e28459528d920b65115c16c04f3efc82aaedc97be59f3f377c0d3f5b81831061097e57505090602061075b9282010161074f565b6020919350806001915483858901015201910190918492610966565b6001600160a01b031690811561039a576001600160a01b0316918215610a3157815f525f60205260405f2054818110610a1857817fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef92602092855f525f84520360405f2055845f525f825260405f20818154019055604051908152a3565b8263391434e360e21b5f5260045260245260445260645ffd5b63ec442f0560e01b5f525f60045260245ffd",
      creationCodeHash: "0x770fd980651dba53d6b8b1d045720d8b655c5a27a3829401f18aa1f07f732bc8",
      runtimeTemplate: "0x60806040526004361015610011575f80fd5b5f3560e01c806306fdde03146105c1578063095ea7b31461053f57806318160ddd1461052257806323b872dd14610443578063313ce56714610428578063392f37e9146103ad57806342966c681461030d578063609d3334146102f257806370a08231146102bb5780637284e416146102a057806395d89b41146101d6578063a9059cbb146101a5578063beb0a4161461018a578063c5a1d7f014610150578063dd62ed3e146101005763f3ccaac0146100c9575f80fd5b346100fc575f3660031901126100fc576100f86100e4610905565b604051918291602083526020830190610666565b0390f35b5f80fd5b346100fc5760403660031901126100fc5761011961068a565b6101216106a0565b6001600160a01b039182165f908152600160209081526040808320949093168252928352819020549051908152f35b346100fc575f3660031901126100fc5760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b346100fc575f3660031901126100fc576100f86100e4610870565b346100fc5760403660031901126100fc576101cb6101c161068a565b602435903361099a565b602060405160018152f35b346100fc575f3660031901126100fc576040515f6004546101f6816106b6565b808452906001811690811561027c575060011461021e575b6100f8836100e4818503826106ee565b60045f9081527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b939250905b808210610262575090915081016020016100e461020e565b91926001816020925483858801015201910190929161024a565b60ff191660208086019190915291151560051b840190910191506100e4905061020e565b346100fc575f3660031901126100fc576100f86100e46107db565b346100fc5760203660031901126100fc576001600160a01b036102dc61068a565b165f525f602052602060405f2054604051908152f35b346100fc575f3660031901126100fc576100f86100e4610724565b346100fc5760203660031901126100fc57600435331561039a57335f525f60205260405f20548181106103815790805f923384528360205203604083205580600254036002556040519081527fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef60203392a3005b63391434e360e21b5f523360045260245260445260645ffd5b634b637e8f60e11b5f525f60045260245ffd5b346100fc575f3660031901126100fc576103fe6103c86107db565b6100f86103d3610870565b61041a6103de610905565b61040c6103e9610724565b93604051978897608089526080890190610666565b908782036020890152610666565b908582036040870152610666565b908382036060850152610666565b346100fc575f3660031901126100fc57602060405160128152f35b346100fc5760603660031901126100fc5761045c61068a565b6104646106a0565b6001600160a01b0382165f818152600160209081526040808320338452909152902054909260443592915f1981106104a2575b506101cb935061099a565b8381106105075784156104f45733156104e1576101cb945f52600160205260405f2060018060a01b0333165f526020528360405f209103905584610497565b634a1406b160e11b5f525f60045260245ffd5b63e602df0560e01b5f525f60045260245ffd5b8390637dc7a0d960e11b5f523360045260245260445260645ffd5b346100fc575f3660031901126100fc576020600254604051908152f35b346100fc5760403660031901126100fc5761055861068a565b6024359033156104f4576001600160a01b03169081156104e157335f52600160205260405f20825f526020528060405f20556040519081527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92560203392a3602060405160018152f35b346100fc575f3660031901126100fc576040515f6003546105e1816106b6565b808452906001811690811561027c5750600114610608576100f8836100e4818503826106ee565b60035f9081527fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b939250905b80821061064c575090915081016020016100e461020e565b919260018160209254838588010152019101909291610634565b805180835260209291819084018484015e5f828201840152601f01601f1916010190565b600435906001600160a01b03821682036100fc57565b602435906001600160a01b03821682036100fc57565b90600182811c921680156106e4575b60208310146106d057565b634e487b7160e01b5f52602260045260245ffd5b91607f16916106c5565b90601f8019910116810190811067ffffffffffffffff82111761071057604052565b634e487b7160e01b5f52604160045260245ffd5b604051905f8260085491610737836106b6565b80835292600181169081156107bc575060011461075d575b61075b925003836106ee565b565b5060085f90815290917ff3f7a9fe364faab93b216da50a3214154f22a0a2b415b23a84c8169e8b636ee35b8183106107a057505090602061075b9282010161074f565b6020919350806001915483858901015201910190918492610788565b6020925061075b94915060ff191682840152151560051b82010161074f565b604051905f82600554916107ee836106b6565b80835292600181169081156107bc57506001146108115761075b925003836106ee565b5060055f90815290917f036b6384b5eca791c62761152d0c79bb0604c104a5fb6f4eb0703f3154bb3db05b81831061085457505090602061075b9282010161074f565b602091935080600191548385890101520191019091849261083c565b604051905f8260075491610883836106b6565b80835292600181169081156107bc57506001146108a65761075b925003836106ee565b5060075f90815290917fa66cc928b5edb82af9bd49922954155ab7b0942694bea4ce44661d9a8736c6885b8183106108e957505090602061075b9282010161074f565b60209193508060019154838589010152019101909184926108d1565b604051905f8260065491610918836106b6565b80835292600181169081156107bc575060011461093b5761075b925003836106ee565b5060065f90815290917ff652222313e28459528d920b65115c16c04f3efc82aaedc97be59f3f377c0d3f5b81831061097e57505090602061075b9282010161074f565b6020919350806001915483858901015201910190918492610966565b6001600160a01b031690811561039a576001600160a01b0316918215610a3157815f525f60205260405f2054818110610a1857817fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef92602092855f525f84520360405f2055845f525f825260405f20818154019055604051908152a3565b8263391434e360e21b5f5260045260245260445260645ffd5b63ec442f0560e01b5f525f60045260245ffd",
      immutableReferences: [
        {
          start: 359,
          length: 32
        }
      ],
      sources: {
        "lib/openzeppelin-contracts/contracts/interfaces/draft-IERC6093.sol": "0x880da465c203cec76b10d72dbd87c80f387df4102274f23eea1f9c9b0918792b",
        "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol": "0x41f6b3b9e030561e7896dbef372b499cc8d418a80c3884a4d65a68f2fdc7493a",
        "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol": "0xe06a3f08a987af6ad2e1c1e774405d4fe08f1694b67517438b467cecf0da0ef7",
        "lib/openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol": "0x70f2f713b13b7ce4610bcd0ac9fec0f3cc43693b043abcb8dc40a42a726eb330",
        "lib/openzeppelin-contracts/contracts/utils/Context.sol": "0x493033a8d1b176a037b2cc6a04dad01a5c157722049bbecf632ca876224dd4b2",
        "src/module-foundation/FoundationTokenV1.sol": "0x28ad9a130f32c14d931da364f529c63a207b9476bfc19c67751d9df0d568397d",
        "src/module-foundation/FoundationTypesV1.sol": "0x1c1782146f0a707c7171068ba5a061dd2e2562d5cfa96d627107fcca0b5f12e8"
      }
    },
    FoundationHookV2: {
      constructorInputs: [
        {
          name: "manager",
          type: "address",
          internalType: "contract IPoolManager"
        },
        {
          name: "initializer_",
          type: "address",
          internalType: "address"
        },
        {
          name: "token_",
          type: "address",
          internalType: "address"
        },
        {
          name: "quote_",
          type: "address",
          internalType: "address"
        },
        {
          name: "creator_",
          type: "address",
          internalType: "address"
        },
        {
          name: "initialTick_",
          type: "int24",
          internalType: "int24"
        },
        {
          name: "creatorBuyFeeBps_",
          type: "uint16",
          internalType: "uint16"
        },
        {
          name: "creatorSellFeeBps_",
          type: "uint16",
          internalType: "uint16"
        },
        {
          name: "selections",
          type: "tuple[]",
          internalType: "struct FoundationTypesV1.ModuleSelection[]",
          components: [
            {
              name: "factory",
              type: "address",
              internalType: "address"
            },
            {
              name: "factoryCodeHash",
              type: "bytes32",
              internalType: "bytes32"
            },
            {
              name: "moduleCodeHash",
              type: "bytes32",
              internalType: "bytes32"
            },
            {
              name: "descriptorHash",
              type: "bytes32",
              internalType: "bytes32"
            },
            {
              name: "configuration",
              type: "bytes",
              internalType: "bytes"
            },
            {
              name: "creatorShareBps",
              type: "uint16",
              internalType: "uint16"
            }
          ]
        }
      ],
      creationBytecode: "0x6101e08060405234610cc057615385803803809161001d8285611445565b8339810161012082820312610cc0578151916001600160a01b038316808403610cc05761004c60208301611468565b9161005960408201611468565b9061006660608201611468565b9361007360808301611468565b9260a0830151908160020b92838303610cc05761009260c0860161147c565b9361009f60e0870161147c565b61010087015190966001600160401b038211610cc057019a8a601f8d011215610cc0578b519a6100ce8c61148b565b9c6040519d6100dd908f611445565b8d8d815260200191829d60051b820160200191818311610cc05760208101935b8385106113265750505060809290925250506040516101c081016001600160401b0381118282101761095957600191610160916040525f60208201525f60408201525f60608201525f60808201525f60a08201525f6101008201525f6101208201525f6101808201525f6101a08201528281528260c08201528260e082015282610140820152015261200030161515600114801590611319575b801561130c575b80156112ff575b80156112f2575b80156112e5575b80156112d5575b80156112c5575b80156112b9575b80156112ad575b801561129d575b801561128d575b8015611281575b8015611275575b61126257873b15908115611250575b8115611246575b811561123c575b8115611226575b8115611214575b8115611204575b81156111f0575b81156111e0575b81156111cc575b81156111bc575b81156111ad575b811561119f575b50610a025760a05260c0528560e05283610100526101205261014052610160525f60806040516102768161142a565b828152602081018390526040810183905260608101839052015260e05160c05160a0916001600160a01b039182169116818110919082156111985780925b1561119157505b604051916102c88361142a565b5f196001851b0190811683521660208201525f604080830191909152603c60608301523060808301529190206101a052519261172f91828501916001600160401b03831186841017610959576060948694613c56863983526001600160a01b0390811660208401521660408201520301905ff08015610ccc576101805260405160208101918160608101917feec95424459934ec69cc14945be8c29d8a064b8b90ffb60a279c9c9bef35cfc185526040808301528551809352608082019260808160051b84010191935f905b82821061111e575050506103b1925003601f198101835282611445565b5190206101c0526008815111610a025780516103e56103cf8261148b565b916103dd6040519384611445565b80835261148b565b602082019190601f190136833782516104006103cf8261148b565b602082019490601f19013686375f94855b8251871015610ef65761042487846114c6565b5180519097906001600160a01b0316803b15908115610ee6575b508015610ed6575b610a025760c05160e05161010051610180516101a051604051969490936001600160a01b039283169383169290811691166104808861140f565b308852602088015260408701526060860152608085015260a084015260018060a01b038951165f602061053a60808d01938451604051948580948193630565b4a960e31b83526105298d600485019060a08091600180831b038151168452600180831b036020820151166020850152600180831b036040820151166040850152600180831b036060820151166060850152600180831b0360808201511660808501520151910152565b60e060c484015260e48301906114a2565b03925af1908115610ccc575f91610e9d575b50803b158015610e8e575b8015610e77575b8015610e5f575b8015610e48575b610a025760405163303e74df60e01b81526001600160a01b039190911692909161012083600481875afa928315610ccc575f93610d6c575b50516020815191012094604051636824b6b560e11b815260c081600481885afa908115610ccc575f91610cd7575b506040805182516001600160a01b03908116602080840191825285015182168385015292840151811660608084019190915284015181166080808401919091528401511660a0808301919091529092015160c08301529060c0815261063860e082611445565b5190206040805183516001600160a01b03908116602080840191825286015182168385015292850151811660608084019190915285015181166080808401919091528501511660a0808301919091529093015160c0840152909160c081526106a160e082611445565b51902014801590610c66575b8015610bc8575b8015610bb5575b8015610bac575b8015610b9d575b8015610b8c575b8015610b7b575b8015610b65575b8015610b4f575b8015610b39575b8015610b13575b8015610aed575b8015610ac7575b8015610aa4575b8015610a74575b8015610a41575b8015610a11575b610a02575f5b848110610981575063ffffffff60808301511663ffffffff60a0840151160163ffffffff811161096d5763ffffffff16810180911161096d579982610768858b6114c6565b5261ffff60a08201511661077c858a6114c6565b5260408101805191604051966080880188811060018060401b03821117610959576040528588526020880193845260408801938185526060890195865260025468010000000000000000811015610959578060016107dd920160025561150d565b919091610946576109268960608f9497608098600560019f60019d7f5710d2719653f0ed1105b4e716b841ff6dd615957a5ec3c1603e9c93d80465ae9d879f99610100938b61ffff9c60a01b0390511660018060a01b031987541617865551600186015551600285015551805160038501556004840189602083015116815462ff0000604085015160101b169063ff0000008a86015160181b1691608067ffffffff000000009087015160201b166bffffffff000000000000000060a088015160401b16926fffffffff00000000000000000000000060c08901518e1b1694608060ff901b60e08a0151151560801b1696608060ff901b19946fffffffff00000000000000000000000019936bffffffff0000000000000000199267ffffffff00000000199163ffffffff191617161716171617161717179055015191015551960151936114c6565b511691604051938452602084015260408301526060820152a30195610411565b634e487b7160e01b5f525f60045260245ffd5b634e487b7160e01b5f52604160045260245ffd5b634e487b7160e01b5f52601160045260245ffd5b61098a8161150d565b5080546001600160a01b031685149081156109f3575b81156109cb575b506109b457600101610723565b84906337c6a46760e11b5f5260045260245260445ffd5b905061010084015180151591826109e5575b50505f6109a7565b600501541490505f806109dd565b600381015485511491506109a0565b63c52a9bd360e01b5f5260045ffd5b5061ffff60a08c0151161515801561071d57506001606083015116158061071d575060046040830151161561071d565b506004604083015116158015610716575060c082015163ffffffff16151580610716575060ff6060830151161515610716565b50600260408301511615801561070f575060a082015163ffffffff1615158061070f575060e0820151151561070f565b506001604083015116158015610708575063ffffffff6080830151161515610708565b50600460408301511615158015610701575061271063ffffffff60c08401511610610701565b506002604083015116151580156106fa575061271063ffffffff60a084015116106106fa565b506001604083015116151580156106f3575061271063ffffffff608084015116106106f3565b50621e848063ffffffff60c084015116116106ec565b50620493e063ffffffff60a084015116116106e5565b50620493e063ffffffff608084015116116106de565b50600160ff606084015116116106d7565b50600760ff604084015116116106d0565b5060ff604083015116156106c9565b508151156106c2565b50600161ffff60208401511614156106bb565b5060405160208101908351825261ffff602085015116604082015260ff604085015116606082015260ff606085015116608082015263ffffffff60808501511660a082015263ffffffff60a08501511660c082015263ffffffff60c08501511660e082015260e084015115156101008201526101008401516101208201526101208152610c5761014082611445565b51902060608c015114156106b4565b50604051630c1e67fd60e11b8152602081600481875afa8015610ccc5786915f91610c94575b5014156106ad565b9150506020813d8211610cc4575b81610caf60209383611445565b81010312610cc0578590515f610c8c565b5f80fd5b3d9150610ca2565b6040513d5f823e3d90fd5b905060c0813d8211610d64575b81610cf160c09383611445565b81010312610cc05760a060405191610d088361140f565b610d1181611468565b8352610d1f60208201611468565b6020840152610d3060408201611468565b6040840152610d4160608201611468565b6060840152610d5260808201611468565b6080840152015160a08201525f6105d2565b3d9150610ce4565b909250610120813d8211610e40575b81610d896101209383611445565b81010312610cc0576040519061012082016001600160401b038111838210176109595760405280518252610dbf6020820161147c565b6020830152610dd0604082016114ee565b6040830152610de1606082016114ee565b6060830152610df2608082016114fc565b6080830152610e0360a082016114fc565b60a0830152610e1460c082016114fc565b60c083015260e0810151908115158203610cc0576101009160e08401520151610100820152915f6105a4565b3d9150610d7b565b5060a0516001600160a01b0382811691161461056c565b50610180516001600160a01b03828116911614610565565b506080516001600160a01b0382811691161461055e565b50803f60408c01511415610557565b90506020813d8211610ece575b81610eb760209383611445565b81010312610cc057610ec890611468565b5f61054c565b3d9150610eaa565b5061400060808901515111610446565b90503f602089015114155f61043e565b8591925062124f8010610a0257610180516001600160a01b031692833b15610cc05760408051633d8ebb8d60e21b815260048101919091529451604486018190528593926064850192915f5b8181106110fc5750505060209060031985840301602486015251918281520191905f5b8181106110df5750505091815f81819503925af18015610ccc576110cf575b60405161272c908161152a823960805181818161029e0152818161031a0152818161076d01528181610b91015281816111910152818161123a015281816114220152818161157c0152818161160f0152611795015260a05181818161034a015261147a015260c05181818161021a01528181610c4101528181610cb801528181611ae00152612130015260e051818181610c6401528181610cdb015281816111fe015281816114be01528181611b04015261215901526101005181611c090152610120518181816103b10152611705015261014051818181611bd301526123b80152610160518181816116ca0152818161233f01526123dc015261018051818181610e27015281816111d6015261168101526101a05181818161071d01528181610eb70152818161110e015281816113cf0152818161174201526120cd01526101c05181611a780152f35b5f6110d991611445565b5f610f84565b825161ffff16845286945060209384019390920191600101610f65565b82516001600160a01b0316855288965060209485019490920191600101610f42565b91935091602080600192607f19898203018552875190848060a01b0382511681528282015183820152604082015160408201526060820151606082015260a061ffff8161117a608086015160c0608087015260c08601906114a2565b940151169101529601920192018593919492610394565b90506102bb565b81926102b4565b620d89b4915012155f610247565b620d89b3198113159150610240565b603c810760020b15159150610239565b905061ffff60648188160616151590610232565b6103e861ffff881611915061022b565b905061ffff60648187160616151590610224565b6103e861ffff871611915061021d565b6001600160a01b038816159150610216565b6001600160a01b03848116908b1614915061020f565b893b159150610208565b833b159150610201565b6001600160a01b0383161591506101fa565b630732d7b560e51b5f523060045260245ffd5b506001301615156101eb565b506002301615156101e4565b50600430161515600114156101dd565b50600830161515600114156101d6565b506010301615156101cf565b506020301615156101c8565b50604030161515600114156101c1565b50608030161515600114156101ba565b50610100301615156101b3565b50610200301615156101ac565b50610400301615156101a5565b506108003016151561019e565b5061100030161515610197565b84516001600160401b038111610cc05782019060c0828503601f190112610cc057604051906113548261140f565b61136060208401611468565b825260408301516020830152606083015160408301526080830151606083015260a083015160018060401b038111610cc0576020908401019185601f84011215610cc05782516001600160401b03811161095957604051936113cc601f8301601f191660200186611445565b8185528760208383010111610cc05760209586955f87856113ff968260c097018386015e8301015260808501520161147c565b60a08201528152019401936100fd565b60c081019081106001600160401b0382111761095957604052565b60a081019081106001600160401b0382111761095957604052565b601f909101601f19168101906001600160401b0382119082101761095957604052565b51906001600160a01b0382168203610cc057565b519061ffff82168203610cc057565b6001600160401b0381116109595760051b60200190565b805180835260209291819084018484015e5f828201840152601f01601f1916010190565b80518210156114da5760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b519060ff82168203610cc057565b519063ffffffff82168203610cc057565b6002548110156114da5760025f52600660205f20910201905f9056fe6080806040526004361015610012575f80fd5b5f905f3560e01c90816302d05d3f14611bf75750806314ad21d814611bb9578063182148ef14611a9b5780631a65ec9314611a615780631cd6232e146117d657806321d0ee7014611782578063259982e514611782578063334f7ac5146117655780633e0dc34e1461172b57806348d5b114146116ee5780635567a03a146116b057806356397c351461166c578063575e24b4146115b95780636c2bbe7e1461140f5780636fe7e6eb146115415780637b78d458146114ed578063999b93af146114a95780639ce110d7146114655780639f063efc1461140f578063b47b2fb114610b39578063b6a8b0fa14610287578063c4e833ce14610a09578063cd210ef314610968578063d216d2961461079c578063dc4c90d314610757578063dc98354e146102e9578063e1b4af6914610287578063e934422f14610249578063fc0c546a146102045763fdf43bf714610168575f80fd5b34610201576040366003190112610201576101ce6080916040610189611dc4565b91610192611ead565b5061019c836123b1565b921515815280602052209061ffff604051926101b784611dee565b54818116845260101c16602083015260243561256e565b6101ff604051809261ffff602060406060938051865282810151838701520151828151166040860152015116910152565bf35b80fd5b50346102015780600319360112610201576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346102015760203660031901126102015760408091610267611dc4565b1515815280602052205461ffff825191818116835260101c166020820152f35b50346102015760049061029936611d6d565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330392506102dd91505057630a85dc2960e01b8152fd5b63570c108560e11b8152fd5b50346102015760e036600319011261020157610303611c65565b60a036602319011261075357610317611d47565b907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163303610744577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b039081169116148015919061070d575b81156103ad575b5061039e57604051636e4c1aa760e11b8152602090f35b63f92ee8a960e01b8152600490fd5b90507f000000000000000000000000000000000000000000000000000000000000000060020b8060ff1d8181011890620d89e882116106fb57600160801b7001fffcb933bd6fad37aa2d162d1a59400160018416021891849190600281166106df575b600481166106c3575b600881166106a7575b6010811661068b575b6020811661066f575b60408116610653575b60808116610637575b610100811661061b575b61020081166105ff575b61040081166105e3575b61080081166105c7575b61100081166105ab575b612000811661058f575b6140008116610573575b6180008116610557575b62010000811661053b575b620200008116610520575b620400008116610505575b62080000166104ed575b136104e5575b63ffffffff0160201c6001600160a01b03908116911614155f610387565b5f19046104c7565b916b048a170391f7dc42444e8fa20260801c916104c1565b6d2216e584f5fa1ea926041bedfe9890930260801c926104b7565b926e5d6af8dedb81196699c329225ee6040260801c926104ac565b926f09aa508b5b7a84e1c677de54f3e99bc90260801c926104a1565b926f31be135f97d08fd981231505542fcfa60260801c92610496565b926f70d869a156d2a1b890bb3df62baf32f70260801c9261048c565b926fa9f746462d870fdf8a65dc1f90e061e50260801c92610482565b926fd097f3bdfd2022b8845ad8f792aa58250260801c92610478565b926fe7159475a2c29b7443b29c7fa6e889d90260801c9261046e565b926ff3392b0822b70005940c7a398e4b70f30260801c92610464565b926ff987a7253ac413176f2b074cf7815e540260801c9261045a565b926ffcbe86c7900a88aedcffc83b479aa3a40260801c92610450565b926ffe5dee046a99a2a811c461f1969c30530260801c92610446565b926fff2ea16466c96a3843ec78b326b528610260801c9261043d565b926fff973b41fa98c081472e6896dfb254c00260801c92610434565b926fffcb9843d60f6159c9db58835c9266440260801c9261042b565b926fffe5caca7e10e4e61c3624eaa0941cd00260801c92610422565b926ffff2e50f5f656932ef12357cf3c7fdcc0260801c92610419565b926ffff97272373d413259a46990580e213a0260801c92610410565b6345c3193d60e11b8452600452602483fd5b905060a061071a36611fa5565b207f0000000000000000000000000000000000000000000000000000000000000000141590610380565b63570c108560e11b8352600483fd5b5080fd5b50346102015780600319360112610201576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346102015760203660031901126102015760606040516107bc81611e25565b828152826020820152826040820152604051926107d884611e40565b80845280602085015280604085015280838501528060808501528060a08501528060c08501528060e0850152610100840152015261018061081a600435611e7d565b506101006040519161082b83611e25565b80546001600160a01b0316835260018101546020840190815260028201546040808601918252519290919060059061086285611e40565b6003810154855260ff600482015461ffff81166020880152818160101c166040880152818160181c16606088015263ffffffff8160201c16608088015263ffffffff8160401c1660a088015263ffffffff8160601c1660c088015260801c16151560e0860152015484840152606085019283526040519460018060a01b039051168552516020850152516040840152518051606084015261ffff602082015116608084015260ff60408201511660a084015260ff60608201511660c084015263ffffffff60808201511660e084015263ffffffff60a0820151168284015263ffffffff60c08201511661012084015260e081015115156101408401520151610160820152f35b5034610201576040366003190112610201576101ff6109d260a092604061098d611dc4565b91610996611ead565b506109a0836123b1565b921515815280602052209061ffff604051926109bb84611dee565b54818116845260101c16602083015260243561240b565b604092919251928352602083019061ffff602060406060938051865282810151838701520151828151166040860152015116910152565b50346102015780600319360112610201576040516101c081018181106001600160401b03821117610b255791806020926101c09460405283810182815260408201838152606083018481526080840185815260a0850186815260c086019060e08701926101008801948986526101208901968a88526101408a019860016101608c019b61018081019d8e526101a081019e8f5252600186526001875260018a5260018b526040519d8e916001835251151591015251151560408d015251151560608c015251151560808b015251151560a08a015251151560c089015251151560e08801525115156101008701525115156101208601525115156101408501525115156101608401525115156101808301525115156101a0820152f35b634e487b7160e01b83526041600452602483fd5b50346112875761016036600319011261128757610b54611c65565b9060a03660231901126112875760603660c319011261128757610144356001600160401b03811161128757610b8d903690600401611c38565b50507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036114005760ff60015416916001831415806113f5575b80156113c0575b6113b15760405160c081018181106001600160401b0382111761139d576040525f81525f60208201525f60408201525f60608201525f6080820152610c1b611ead565b60a0820152610c2b60e435612627565b60c4358015158103611287576001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081167f00000000000000000000000000000000000000000000000000000000000000009091161090151581148084525f60e435126020850181905214604084015215611391576101243560801d5b6001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081167f000000000000000000000000000000000000000000000000000000000000000090911610156113845761012435600f0b915b610d1582612718565b9060408501511580611372575b6112c95760208501511561131057610d81908551151590815f1461130857905b816060880152610d51816123b1565b905f525f60205260405f209161ffff60405193610d6d85611dee565b54818116855260101c16602084015261256e565b60a08501525b610d9a606085015160a086015190612679565b908160808601526040850151151591826112d8575b50506112c95782515f9190156112a857600f0b129081159161129a575b505b61128b57604060a08201510151815115155f525f60205260405f209061ffff81511663ffff00006020845493015160101b169163ffffffff19161717905560808101518061118f575b5060a081015180516020909101517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031691823b1561118b579060448692836040519586948593631c4b9a2d60e01b8552600485015260248401525af1801561118057908491611167575b5050805115159160208201511515610ea260e435612627565b60608401519160405195610eb587611e09565b7f0000000000000000000000000000000000000000000000000000000000000000875260018060a01b038516602088015260408701526060860152608085015260a08401526101243560801d600f0b60c084015261012435600f0b60e0840152835b60025481101561107057610f2a81611e7d565b50600481019081549060028260101c161561106557610fe491908815611057576311aaa97d60e11b915b63ffffffff604051918460208401528a51602484015260018060a01b0360208c015116604484015260408b01511515606484015260608b01511515608484015260808b015160a484015260a08b015160c484015260c08b0151600f0b60e484015260e08b0151600f0b6101048401526101048352610fd461012484611e5c565b8b1561104d5760201c1691611efc565b15610ff5575b506001905b01610f17565b5460801c60ff161561103657806001917f699c7feb850c0da9a2a1cd65be9b13df0cce79ae7dfbef2bd411bc8e68d8e56c602060405160028152a290610fea565b63ae193d1560e01b85526004526002602452604484fd5b60401c1691611efc565b63fcd93e9760e01b91610f54565b505050600190610fef565b604085848460038a0361115f5760ff60025b1660ff196001541617600155815115159060208301511515606084015160a08501519060208251920151928851958652602086015287850152606084015260808301526101243560801d600f0b60a083015261012435600f0b60c083015260018060a01b0316907f583ec8ec4eab64e7e5cc7f84ae0de43cb727aed3ff51fcf279f7351c6692bdac60e07f000000000000000000000000000000000000000000000000000000000000000092a3808301511561115157505b81519063b47b2fb160e01b8252600f0b6020820152f35b608091500151600f0b61113a565b60ff83611082565b8161117191611e5c565b61117c57825f610e89565b8280fd5b6040513d86823e3d90fd5b8580fd5b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163b1561128757604051630ab714fb60e11b81526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811660048301527f0000000000000000000000000000000000000000000000000000000000000000811660248301526044820192909252905f908290606490829084907f0000000000000000000000000000000000000000000000000000000000000000165af1801561127c5715610e17576112749193505f90611e5c565b5f915f610e17565b6040513d5f823e3d90fd5b5f80fd5b6304564c7160e21b5f5260045ffd5b5f9150600f0b13155f610dcc565b600f0b13908115916112bb575b50610dce565b5f9150600f0b12155f6112b5565b63d39cf37760e01b5f5260045ffd5b855191925090156112fc576112f19060608601516123fe565b905b14155f80610daf565b506060840151906112f3565b508290610d42565b61135d908551151590815f1461136c575082905b61132d816123b1565b905f525f60205260405f209161ffff6040519361134985611dee565b54818116855260101c16602084015261240b565b60a08601526060850152610d87565b90611324565b508061137d85612718565b1415610d22565b6101243560801d91610d0c565b61012435600f0b610cae565b634e487b7160e01b5f52604160045260245ffd5b63e1bcc00560e01b5f5260045ffd5b5060a06113cc36611fa5565b207f00000000000000000000000000000000000000000000000000000000000000001415610bd8565b506003831415610bd1565b63570c108560e11b5f5260045ffd5b346112875761141d36611cde565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330393506114009250505057630a85dc2960e01b5f5260045ffd5b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287576020366003190112611287576020611508611c65565b600154600260ff8216149182611525575b50506040519015158152f35b6001600160a01b0390811660089290921c161490508280611519565b34611287576101003660031901126112875761155b611c65565b5060a036602319011261128757611570611d47565b50611579611d5d565b507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330361140057630a85dc2960e01b5f5260045ffd5b3461128757610140366003190112611287576115d3611c65565b60a03660231901126112875760603660c319011261128757610124356001600160401b0381116112875761160b903690600401611c38565b50507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036114005762ffffff61164c60609261202c565b906040939293519363ffffffff60e01b1684526020840152166040820152f35b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287575f36600319011261128757602060405161ffff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34611287575f3660031901126112875760206040517f000000000000000000000000000000000000000000000000000000000000000060020b8152f35b34611287575f3660031901126112875760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34611287575f366003190112611287576020600254604051908152f35b346112875761179036611c7b565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633039150611400905057630a85dc2960e01b5f5260045ffd5b34611287576040366003190112611287576004356024356001600160401b03811161128757611809903690600401611c38565b6001549060ff82166113b15761181e84611e7d565b5060048101926004845460101c16158015611a56575b611a1c57600260ff198216176001556001845460181c16611a2b575b5060405160208101635c085b4160e11b815233602483015260406044830152836064830152838660848401375f60848584010152601f19601f850116946118a56084848881010301601f198101855284611e5c565b549163ffffffff8360601c169260018060a01b03855416946001863f91015403611a1c57643fffffffc0805a92605a1c16166040600160a61b031684158582046040141715611a0857603f90049061ea608201809211611a0857106119f95783926020925f6040519687948286525193f18092513d826119d3575b50506119c15750156119a957600180546001600160a81b03191690556001600160401b03811161139d5761195a6020604051930183611e5c565b8082526020820192368282011161128757815f92602092863783010152519020906040519182527fca539ca6d71f32350620025ebd69a27e47c82be74d18a0f8c587d5faa2b477f660203393a3005b8363ae193d1560e01b5f52600452600460245260445ffd5b631bea0edf60e11b5f5260045260245ffd5b602014801592506119e7575b508780611920565b635c085b4160e11b14159050876119df565b631115766760e01b5f5260045ffd5b634e487b7160e01b5f52601160045260245ffd5b63c52a9bd360e01b5f5260045ffd5b81546001600160a81b031990911660089190911b610100600160a81b03161760021760015585611850565b506140008311611834565b34611287575f3660031901126112875760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34611287575f366003190112611287575f6080604051611aba81611dd3565b828152602081018390526040810183905260608101839052015260a06001600160a01b037f00000000000000000000000000000000000000000000000000000000000000008181167f000000000000000000000000000000000000000000000000000000000000000092831610918215611bb357805b5f196001861b01169215611bac57505b604051611b4c81611dd3565b8281526020810191600180861b0316825262ffffff604082015f815260806060840193603c85520193308552604051958652600180881b039051166020860152511660408401525160020b6060830152600180841b039051166080820152f35b9050611b40565b81611b30565b34611287575f36600319011261128757602060405161ffff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34611287575f366003190112611287577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b9181601f84011215611287578235916001600160401b038311611287576020838186019501011161128757565b600435906001600160a01b038216820361128757565b90610160600319830112611287576004356001600160a01b0381168103611287579160a060231982011261128757602491608060c3198301126112875760c49161014435906001600160401b03821161128757611cda91600401611c38565b9091565b906101a0600319830112611287576004356001600160a01b0381168103611287579160a060231982011261128757602491608060c3198301126112875760c4916101443591610164359161018435906001600160401b03821161128757611cda91600401611c38565b60c435906001600160a01b038216820361128757565b60e435908160020b820361128757565b610120600319820112611287576004356001600160a01b0381168103611287579160a06023198301126112875760249160c4359160e4359161010435906001600160401b03821161128757611cda91600401611c38565b60043590811515820361128757565b60a081019081106001600160401b0382111761139d57604052565b604081019081106001600160401b0382111761139d57604052565b61010081019081106001600160401b0382111761139d57604052565b608081019081106001600160401b0382111761139d57604052565b61012081019081106001600160401b0382111761139d57604052565b90601f801991011681019081106001600160401b0382111761139d57604052565b600254811015611e995760025f52600660205f20910201905f90565b634e487b7160e01b5f52603260045260245ffd5b60405190606082018281106001600160401b0382111761139d57604052815f81525f60208201526040805191611ee283611dee565b5f83525f60208401520152565b91908201809211611a0857565b9160018060a01b03835416926001843f91015403611a1c575a63ffffffff8216643fffffffc08360061b169080820460401490151715611a0857603f90049061ea608201809211611a0857106119f9576020906040519283915f83525f86858451940192f1928391513d83611f77575b5050506119c1575090565b60201480159350909190611f90575b50505f8080611f6c565b6001600160e01b031916141590505f80611f86565b60a09060231901126112875760405190611fbe82611dd3565b816024356001600160a01b03811681036112875781526044356001600160a01b038116810361128757602082015260643562ffffff811681036112875760408201526084358060020b810361128757606082015260a435906001600160a01b03821682036112875760800152565b6001549060ff821691821515806123a6575b6113b15760a03660231901126112875760405161205a81611dd3565b6024356001600160a01b03811681036112875781526044356001600160a01b038116810361128757602082015260643562ffffff811681036112875760408201526084358060020b810361128757606082015260a435906001600160a01b03821682036112875760a091608082015220927f00000000000000000000000000000000000000000000000000000000000000008094036119f95760020361239d5760ff60035b169060ff19161760015560e4359261211684612627565b9260c435801515808203611287575f915060018060a01b037f00000000000000000000000000000000000000000000000000000000000000001660018060a01b037f00000000000000000000000000000000000000000000000000000000000000001610149512936040519161218b83611e09565b8252602082019360018060a01b03168452604082019580875260608301938685526080840183815260a08501915f835260c08601935f855260e08701955f87525f5b6002548110156122ae57808b6121e38f93611e7d565b508b8d60048301549560018760101c16156122a0579563ffffffff9161227a96976311aaa97d60e11b966040519588602088015251602487015260018060a01b039051166044860152511515606485015251151560848401528a5160a48401528b5160c48401528c51600f0b60e48401528d51600f0b610104840152610104835261227061012484611e5c565b60201c1691611efc565b15612289576001905b016121cd565b63ae193d1560e01b5f52600452600160245260445ffd5b505050505060019150612283565b50985098965098505050505050820361238c5761231a91816122ce611ead565b50811561232c5750806122e3612314926123b1565b905f525f60205260405f209061ffff604051926122ff84611dee565b54818116845260101c1660208301528361256e565b90612679565b60801b906315d7892d60e21b91905f90565b5f808052602052604051612314935091507f00000000000000000000000000000000000000000000000000000000000000009061ffff7fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb561134985611dee565b506315d7892d60e21b915f91508190565b60ff60016120ff565b50600283141561203e565b156123da577f000000000000000000000000000000000000000000000000000000000000000090565b7f000000000000000000000000000000000000000000000000000000000000000090565b91908203918211611a0857565b919290612416611ead565b5061242184826126c1565b8215801561255e575b6125505761ffff8116806126f203906126f28211611a0857846127100261271081048603611a08576124656124749161ffff89511690611eef565b61ffff60208901511690611eef565b906126f21461253c570493846003811115612535576002198101818111611a0857905b85821061252d575b60016001607f1b031061251e575b858111156124c45763686c07bf60e11b5f5260045ffd5b6124cf82848361256e565b6124df8151602083015190611eef565b86838210918261250a575b505061250157505f198114611a08576001016124ad565b90955093505050565b612516919250846123fe565b14865f6124ea565b60016001607f1b0395506124ad565b85915061249f565b5f90612497565b634e487b7160e01b5f52601260045260245ffd5b62a4671960e71b5f5260045ffd5b5060016001607f1b03831161242a565b9291612578611ead565b9361258382846126c1565b8015808015612607575b61255057601e8202828104601e14821715611a08576125b361ffff918286511690611eef565b9416808302928304141715611a08576125d96127109161ffff6020819501511690611eef565b818404865281810460208701528282604051956125f587611dee565b06168452061660208201526040830152565b5060016001607f1b03821161258d565b600160ff1b8114611a08575f0390565b80158015612669575b801561264f575b6119f9575f81121561264c5761264c90612617565b90565b506f7ffffffffffffffffffffffffffffffe198112612637565b5060016001607f1b038113612630565b919061268c906020815191015190611eef565b9180159081156126b0575b81156126a5575b506119f957565b90508210155f61269e565b60016001607f1b0381119150612697565b61ffff6103e8911611908115612705575b81156126ef575b506126e057565b634db7e85160e01b5f5260045ffd5b6127109150602061ffff9101511610155f6126d9565b905061271061ffff8251161015906126d2565b600f0b5f81121561264c5761264c90612617566101003461013e57601f61172f38819003918201601f19168301916001600160401b038311848410176101425780849260609460405283398101031261013e5780516001600160a01b038116919082810361013e5761006c604061006560208501610156565b9301610156565b923b158015610135575b8015610124575b610115576080523360a05260c05260e0526040516115c4908161016b8239608051818181610480015281816105e701528181610e52015281816113290152611529015260a0518181816101e5015281816109bd01528181610a5b0152610ccb015260c0518181816105610152818161066801528181610e2a0152818161130101526114f0015260e051818181610c3e01526111040152f35b63c52a9bd360e01b5f5260045ffd5b506001600160a01b0383161561007d565b50813b15610076565b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b038216820361013e5756fe6080806040526004361015610012575f80fd5b5f905f3560e01c90816302d05d3f146110f2575080630351ddd4146110825780630c48d7871461104a578063103bc62f1461102e5780631150e87414610dde5780631c4b9a2d14610cb1578063232adc6514610bfb5780632ec0e5c014610bd9578063331a9bbb14610bbc5780633e02e96514610b9f57806357b9990314610a245780637e183759146109ec5780637f5a7c7b146109a857806391dd734614610590578063999b93af1461054b578063b1a25c9414610529578063bfd1eaa81461050b578063c4f08c74146104cd578063cea5725a146104af578063dc4c90d31461046a578063f02ef6481461044c5763f63aee3414610110575f80fd5b346104495760403660031901126104495760043567ffffffffffffffff8111610445573660238201121561044557806004013561014c816111a9565b9161015a6040519384611173565b8183526024602084019260051b8201019036821161044157602401915b818310610421575050506024359067ffffffffffffffff821161041d573660238301121561041d5781600401356101ad816111a9565b926101bb6040519485611173565b8184526024602085019260051b8201019036821161041957602401915b8183106103fa57505050337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316148015906103ee575b80156103e3575b80156103d7575b6103c957600b805460ff191660011790558291825b825184101561037b576001600160a01b03610254858561126c565b51161561036c57845b848110610328575061027e9061ffff610276868561126c565b51169061120e565b9261ffff61028c828461126c565b51166001600160a01b036102a0838661126c565b51168652600760205260408620805461ffff191690911790556001600160a01b036102cb828561126c565b5116600a546801000000000000000081101561031457906102f482600180959401600a556111e2565b819291549060031b91821b91858060a01b03901b19161790550192610239565b634e487b7160e01b87526041600452602487fd5b6001600160a01b0361033a868661126c565b51166001600160a01b0361034e838761126c565b51161461035d5760010161025d565b63c52a9bd360e01b8652600486fd5b63c52a9bd360e01b8552600485fd5b849061271081116103ba576127100361271081116103a65761ffff1661ffff19600654161760065580f35b634e487b7160e01b82526011600452602482fd5b63c52a9bd360e01b8252600482fd5b6282b42960e81b8352600483fd5b50805182511415610224565b50600881511161021d565b5060ff600b5416610216565b823561ffff81168103610415578152602092830192016101d8565b8680fd5b8580fd5b8280fd5b82356001600160a01b038116810361041957815260209283019201610177565b8480fd5b5080fd5b80fd5b50346104495780600319360112610449576020600254604051908152f35b50346104495780600319360112610449576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346104495780600319360112610449576020600454604051908152f35b50346104495760203660031901126104495760209061ffff906040906001600160a01b036104f9611133565b16815260078452205416604051908152f35b50346104495780600319360112610449576020600554604051908152f35b5034610449578060031936011261044957602061ffff60065416604051908152f35b50346104495780600319360112610449576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346108425760203660031901126108425760043567ffffffffffffffff811161084257366023820112156108425780600401359067ffffffffffffffff82116108425760248101828201366024820111610842577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03169333851480159190610991575b8115610986575b811561094e575b50610940575f600c556040908390031261084257356001600160a01b0381169190829003610842576040516370a0823160e01b8152600481018390527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316916044013590602081602481865afa9081156108cf575f9161090e575b506040516370a0823160e01b81526004810186905293602085602481875afa9485156108cf575f956108da575b50853b1561084257604051637a94c56560e11b81523060048201528460248201528360448201525f81606481838b5af180156108cf576108ba575b50853b156104155786604051630b0d9c0960e01b81528560048201528260248201528460448201528181606481838c5af180156108af5761089a575b5050604051906370a0823160e01b82526004820152602081602481875afa90811561088f5783908892610859575b5061078a919261120e565b14938415946107cf575b505050506107c0576040516107bc916107ae602083611173565b815260405191829182611149565b0390f35b632f35253160e01b8152600490fd5b602091929394506024604051809581936370a0823160e01b835260048301525afa91821561084e578492610814575b5061080991926111c1565b14155f808080610794565b91506020823d602011610846575b8161082f60209383611173565b81010312610842576108099151916107fe565b5f80fd5b3d9150610822565b6040513d86823e3d90fd5b9150506020813d602011610887575b8161087560209383611173565b8101031261084257518261078a61077f565b3d9150610868565b6040513d89823e3d90fd5b816108a491611173565b61041557865f610751565b6040513d84823e3d90fd5b6108c79197505f90611173565b5f955f610715565b6040513d5f823e3d90fd5b9094506020813d602011610906575b816108f660209383611173565b810103126108425751935f6106da565b3d91506108e9565b90506020813d602011610938575b8161092960209383611173565b8101031261084257515f6106ad565b3d915061091c565b6282b42960e81b5f5260045ffd5b905061095981611250565b6109666040519182611173565b8181525f6020808301938087863783010152519020600c5414155f61062a565b600c54159150610623565b5f805160206115a48339815191525c15915061061c565b34610842575f366003190112610842576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610842576020366003190112610842576001600160a01b03610a0d611133565b165f526009602052602060405f2054604051908152f35b3461084257602036600319011261084257600435610a40611280565b604051630f6f1a8b60e31b81523360048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa9081156108cf575f91610b64575b50158015610b39575b8015610b31575b8015610b21575b61094057600290335f52600960205260405f20610ac882825461120e565b9055610ad68160055461120e565b600555610ae381336112e5565b6040519081527f7d41ef2ca0417b1f34e24f6baa6bb801e64d7c82436e45963c2f78a168ba825160203392a35f5f805160206115a48339815191525d005b5060016001607f1b038111610aaa565b508015610aa3565b50335f526008602052610b5d60405f2054335f52600960205260405f2054906111c1565b8111610a9c565b90506020813d602011610b97575b81610b7f60209383611173565b81010312610842575180151581036108425782610a93565b3d9150610b72565b34610842575f366003190112610842576020600354604051908152f35b34610842575f366003190112610842576020600154604051908152f35b34610842575f366003190112610842576020610bf361121b565b604051908152f35b34610842575f36600319011261084257610c13611280565b6020600354610c37610c30610c2b60045480946111c1565b6112b5565b809261120e565b60045560017f0000000000000000000000000000000000000000000000000000000000000000610c6783826112e5565b7f7d41ef2ca0417b1f34e24f6baa6bb801e64d7c82436e45963c2f78a168ba82518460405192858452848060a01b031692a35f5f805160206115a48339815191525d604051908152f35b3461084257604036600319011261084257602435600435337f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031614801590610dd1575b61094057610d0b815f5461120e565b5f55610d2d610d1c8360025461120e565b8060025561ffff6006541690611473565b6003555f5b600a54811015610d865780610d486001926111e2565b838060a01b0391549060031b1c16610d73600254825f52600760205261ffff60405f20541690611473565b905f52600860205260405f205501610d32565b7f3aae519a7db03e1a8d2ce277caffd12b248ff9e84f194a95e0911ca074bf9cf360808385610db36114dc565b5f5460025491604051938452602084015260408301526060820152a1005b5060ff600b541615610cfc565b34610842575f36600319011261084257610df6611280565b5f54610e0b610c30610c2b60015480946111c1565b600155604051627eeac760e11b81523060048201526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811660248301527f00000000000000000000000000000000000000000000000000000000000000001690602081604481855afa9081156108cf575f91610ffc575b50610e9c83610e9761121b565b61120e565b11610fed575f610efd81926040516020810173d88539d3c4c460136a733a3fd60cf6bf269079da815286604083015260408252610eda606083611173565b81519020600c556040519485809481936348c8949160e01b835260048301611149565b03925af180156108cf57610f76575b50600c5461094057602090610f1f6114dc565b5f73d88539d3c4c460136a733a3fd60cf6bf269079da7f7d41ef2ca0417b1f34e24f6baa6bb801e64d7c82436e45963c2f78a168ba825184604051858152a35f5f805160206115a48339815191525d604051908152f35b3d805f833e610f858183611173565b8101906020818303126108425780519067ffffffffffffffff8211610842570181601f8201121561084257805190610fbc82611250565b92610fca6040519485611173565b8284526020838301011161084257815f9260208093018386015e83010152610f0c565b6340db7f8760e01b5f5260045ffd5b90506020813d602011611026575b8161101760209383611173565b81010312610842575183610e8a565b3d915061100a565b34610842575f3660031901126108425760205f54604051908152f35b34610842576020366003190112610842576001600160a01b0361106b611133565b165f526008602052602060405f2054604051908152f35b34610842575f366003190112610842576110a1600254600354906111c1565b5f90600a545b8083106110b957602082604051908152f35b906110e96001916110c9856111e2565b848060a01b0391549060031b1c165f52600860205260405f2054906111c1565b920191906110a7565b34610842575f366003190112610842577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b600435906001600160a01b038216820361084257565b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b90601f8019910116810190811067ffffffffffffffff82111761119557604052565b634e487b7160e01b5f52604160045260245ffd5b67ffffffffffffffff81116111955760051b60200190565b919082039182116111ce57565b634e487b7160e01b5f52601160045260245ffd5b600a548110156111fa57600a5f5260205f2001905f90565b634e487b7160e01b5f52603260045260245ffd5b919082018092116111ce57565b61124d61124461123b6112325f546002549061120e565b600154906111c1565b600454906111c1565b600554906111c1565b90565b67ffffffffffffffff811161119557601f01601f191660200190565b80518210156111fa5760209160051b010190565b5f805160206115a48339815191525c6112a65760015f805160206115a48339815191525d565b633ee5aeb560e01b5f5260045ffd5b80156112d65760016001607f1b0381111561124d575060016001607f1b0390565b639b0e91e160e01b5f5260045ffd5b604051627eeac760e11b81523060048201526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811660248301527f000000000000000000000000000000000000000000000000000000000000000016929190602081604481875afa9081156108cf575f91611441575b5061137083610e9761121b565b11610fed57604080516001600160a01b0392909216602083019081528282019390935281525f9283926113a99290610eda606083611173565b03925af180156108cf576113ca575b50600c54610940576113c86114dc565b565b3d805f833e6113d98183611173565b8101906020818303126108425780519067ffffffffffffffff8211610842570181601f820112156108425780519061141082611250565b9261141e6040519485611173565b8284526020838301011161084257815f9260208093018386015e830101526113b8565b90506020813d60201161146b575b8161145c60209383611173565b8101031261084257515f611363565b3d915061144f565b808202905f1983820990828083109203918083039283612710111561084257146114d1577fbc01a36e2eb1c432ca57a786c226809d495182a9930be0ded288ce703afb7e9193612710910990828211900360fc1b910360041c170290565b505061271091500490565b604051627eeac760e11b81523060048201527f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03166024820152602081806044810103817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa9081156108cf575f91611571575b5061156a61121b565b11610fed57565b90506020813d60201161159b575b8161158c60209383611173565b8101031261084257515f611561565b3d915061157f56fe9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00",
      creationCodeHash: "0x7cab9b9d60e532cb8e8fc4444b832bb5cb842c5bdb4a1db2ee4873111f4ad754",
      runtimeTemplate: "0x6080806040526004361015610012575f80fd5b5f905f3560e01c90816302d05d3f14611bf75750806314ad21d814611bb9578063182148ef14611a9b5780631a65ec9314611a615780631cd6232e146117d657806321d0ee7014611782578063259982e514611782578063334f7ac5146117655780633e0dc34e1461172b57806348d5b114146116ee5780635567a03a146116b057806356397c351461166c578063575e24b4146115b95780636c2bbe7e1461140f5780636fe7e6eb146115415780637b78d458146114ed578063999b93af146114a95780639ce110d7146114655780639f063efc1461140f578063b47b2fb114610b39578063b6a8b0fa14610287578063c4e833ce14610a09578063cd210ef314610968578063d216d2961461079c578063dc4c90d314610757578063dc98354e146102e9578063e1b4af6914610287578063e934422f14610249578063fc0c546a146102045763fdf43bf714610168575f80fd5b34610201576040366003190112610201576101ce6080916040610189611dc4565b91610192611ead565b5061019c836123b1565b921515815280602052209061ffff604051926101b784611dee565b54818116845260101c16602083015260243561256e565b6101ff604051809261ffff602060406060938051865282810151838701520151828151166040860152015116910152565bf35b80fd5b50346102015780600319360112610201576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346102015760203660031901126102015760408091610267611dc4565b1515815280602052205461ffff825191818116835260101c166020820152f35b50346102015760049061029936611d6d565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330392506102dd91505057630a85dc2960e01b8152fd5b63570c108560e11b8152fd5b50346102015760e036600319011261020157610303611c65565b60a036602319011261075357610317611d47565b907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163303610744577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b039081169116148015919061070d575b81156103ad575b5061039e57604051636e4c1aa760e11b8152602090f35b63f92ee8a960e01b8152600490fd5b90507f000000000000000000000000000000000000000000000000000000000000000060020b8060ff1d8181011890620d89e882116106fb57600160801b7001fffcb933bd6fad37aa2d162d1a59400160018416021891849190600281166106df575b600481166106c3575b600881166106a7575b6010811661068b575b6020811661066f575b60408116610653575b60808116610637575b610100811661061b575b61020081166105ff575b61040081166105e3575b61080081166105c7575b61100081166105ab575b612000811661058f575b6140008116610573575b6180008116610557575b62010000811661053b575b620200008116610520575b620400008116610505575b62080000166104ed575b136104e5575b63ffffffff0160201c6001600160a01b03908116911614155f610387565b5f19046104c7565b916b048a170391f7dc42444e8fa20260801c916104c1565b6d2216e584f5fa1ea926041bedfe9890930260801c926104b7565b926e5d6af8dedb81196699c329225ee6040260801c926104ac565b926f09aa508b5b7a84e1c677de54f3e99bc90260801c926104a1565b926f31be135f97d08fd981231505542fcfa60260801c92610496565b926f70d869a156d2a1b890bb3df62baf32f70260801c9261048c565b926fa9f746462d870fdf8a65dc1f90e061e50260801c92610482565b926fd097f3bdfd2022b8845ad8f792aa58250260801c92610478565b926fe7159475a2c29b7443b29c7fa6e889d90260801c9261046e565b926ff3392b0822b70005940c7a398e4b70f30260801c92610464565b926ff987a7253ac413176f2b074cf7815e540260801c9261045a565b926ffcbe86c7900a88aedcffc83b479aa3a40260801c92610450565b926ffe5dee046a99a2a811c461f1969c30530260801c92610446565b926fff2ea16466c96a3843ec78b326b528610260801c9261043d565b926fff973b41fa98c081472e6896dfb254c00260801c92610434565b926fffcb9843d60f6159c9db58835c9266440260801c9261042b565b926fffe5caca7e10e4e61c3624eaa0941cd00260801c92610422565b926ffff2e50f5f656932ef12357cf3c7fdcc0260801c92610419565b926ffff97272373d413259a46990580e213a0260801c92610410565b6345c3193d60e11b8452600452602483fd5b905060a061071a36611fa5565b207f0000000000000000000000000000000000000000000000000000000000000000141590610380565b63570c108560e11b8352600483fd5b5080fd5b50346102015780600319360112610201576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346102015760203660031901126102015760606040516107bc81611e25565b828152826020820152826040820152604051926107d884611e40565b80845280602085015280604085015280838501528060808501528060a08501528060c08501528060e0850152610100840152015261018061081a600435611e7d565b506101006040519161082b83611e25565b80546001600160a01b0316835260018101546020840190815260028201546040808601918252519290919060059061086285611e40565b6003810154855260ff600482015461ffff81166020880152818160101c166040880152818160181c16606088015263ffffffff8160201c16608088015263ffffffff8160401c1660a088015263ffffffff8160601c1660c088015260801c16151560e0860152015484840152606085019283526040519460018060a01b039051168552516020850152516040840152518051606084015261ffff602082015116608084015260ff60408201511660a084015260ff60608201511660c084015263ffffffff60808201511660e084015263ffffffff60a0820151168284015263ffffffff60c08201511661012084015260e081015115156101408401520151610160820152f35b5034610201576040366003190112610201576101ff6109d260a092604061098d611dc4565b91610996611ead565b506109a0836123b1565b921515815280602052209061ffff604051926109bb84611dee565b54818116845260101c16602083015260243561240b565b604092919251928352602083019061ffff602060406060938051865282810151838701520151828151166040860152015116910152565b50346102015780600319360112610201576040516101c081018181106001600160401b03821117610b255791806020926101c09460405283810182815260408201838152606083018481526080840185815260a0850186815260c086019060e08701926101008801948986526101208901968a88526101408a019860016101608c019b61018081019d8e526101a081019e8f5252600186526001875260018a5260018b526040519d8e916001835251151591015251151560408d015251151560608c015251151560808b015251151560a08a015251151560c089015251151560e08801525115156101008701525115156101208601525115156101408501525115156101608401525115156101808301525115156101a0820152f35b634e487b7160e01b83526041600452602483fd5b50346112875761016036600319011261128757610b54611c65565b9060a03660231901126112875760603660c319011261128757610144356001600160401b03811161128757610b8d903690600401611c38565b50507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036114005760ff60015416916001831415806113f5575b80156113c0575b6113b15760405160c081018181106001600160401b0382111761139d576040525f81525f60208201525f60408201525f60608201525f6080820152610c1b611ead565b60a0820152610c2b60e435612627565b60c4358015158103611287576001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081167f00000000000000000000000000000000000000000000000000000000000000009091161090151581148084525f60e435126020850181905214604084015215611391576101243560801d5b6001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081167f000000000000000000000000000000000000000000000000000000000000000090911610156113845761012435600f0b915b610d1582612718565b9060408501511580611372575b6112c95760208501511561131057610d81908551151590815f1461130857905b816060880152610d51816123b1565b905f525f60205260405f209161ffff60405193610d6d85611dee565b54818116855260101c16602084015261256e565b60a08501525b610d9a606085015160a086015190612679565b908160808601526040850151151591826112d8575b50506112c95782515f9190156112a857600f0b129081159161129a575b505b61128b57604060a08201510151815115155f525f60205260405f209061ffff81511663ffff00006020845493015160101b169163ffffffff19161717905560808101518061118f575b5060a081015180516020909101517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031691823b1561118b579060448692836040519586948593631c4b9a2d60e01b8552600485015260248401525af1801561118057908491611167575b5050805115159160208201511515610ea260e435612627565b60608401519160405195610eb587611e09565b7f0000000000000000000000000000000000000000000000000000000000000000875260018060a01b038516602088015260408701526060860152608085015260a08401526101243560801d600f0b60c084015261012435600f0b60e0840152835b60025481101561107057610f2a81611e7d565b50600481019081549060028260101c161561106557610fe491908815611057576311aaa97d60e11b915b63ffffffff604051918460208401528a51602484015260018060a01b0360208c015116604484015260408b01511515606484015260608b01511515608484015260808b015160a484015260a08b015160c484015260c08b0151600f0b60e484015260e08b0151600f0b6101048401526101048352610fd461012484611e5c565b8b1561104d5760201c1691611efc565b15610ff5575b506001905b01610f17565b5460801c60ff161561103657806001917f699c7feb850c0da9a2a1cd65be9b13df0cce79ae7dfbef2bd411bc8e68d8e56c602060405160028152a290610fea565b63ae193d1560e01b85526004526002602452604484fd5b60401c1691611efc565b63fcd93e9760e01b91610f54565b505050600190610fef565b604085848460038a0361115f5760ff60025b1660ff196001541617600155815115159060208301511515606084015160a08501519060208251920151928851958652602086015287850152606084015260808301526101243560801d600f0b60a083015261012435600f0b60c083015260018060a01b0316907f583ec8ec4eab64e7e5cc7f84ae0de43cb727aed3ff51fcf279f7351c6692bdac60e07f000000000000000000000000000000000000000000000000000000000000000092a3808301511561115157505b81519063b47b2fb160e01b8252600f0b6020820152f35b608091500151600f0b61113a565b60ff83611082565b8161117191611e5c565b61117c57825f610e89565b8280fd5b6040513d86823e3d90fd5b8580fd5b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03163b1561128757604051630ab714fb60e11b81526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811660048301527f0000000000000000000000000000000000000000000000000000000000000000811660248301526044820192909252905f908290606490829084907f0000000000000000000000000000000000000000000000000000000000000000165af1801561127c5715610e17576112749193505f90611e5c565b5f915f610e17565b6040513d5f823e3d90fd5b5f80fd5b6304564c7160e21b5f5260045ffd5b5f9150600f0b13155f610dcc565b600f0b13908115916112bb575b50610dce565b5f9150600f0b12155f6112b5565b63d39cf37760e01b5f5260045ffd5b855191925090156112fc576112f19060608601516123fe565b905b14155f80610daf565b506060840151906112f3565b508290610d42565b61135d908551151590815f1461136c575082905b61132d816123b1565b905f525f60205260405f209161ffff6040519361134985611dee565b54818116855260101c16602084015261240b565b60a08601526060850152610d87565b90611324565b508061137d85612718565b1415610d22565b6101243560801d91610d0c565b61012435600f0b610cae565b634e487b7160e01b5f52604160045260245ffd5b63e1bcc00560e01b5f5260045ffd5b5060a06113cc36611fa5565b207f00000000000000000000000000000000000000000000000000000000000000001415610bd8565b506003831415610bd1565b63570c108560e11b5f5260045ffd5b346112875761141d36611cde565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330393506114009250505057630a85dc2960e01b5f5260045ffd5b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287576020366003190112611287576020611508611c65565b600154600260ff8216149182611525575b50506040519015158152f35b6001600160a01b0390811660089290921c161490508280611519565b34611287576101003660031901126112875761155b611c65565b5060a036602319011261128757611570611d47565b50611579611d5d565b507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316330361140057630a85dc2960e01b5f5260045ffd5b3461128757610140366003190112611287576115d3611c65565b60a03660231901126112875760603660c319011261128757610124356001600160401b0381116112875761160b903690600401611c38565b50507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036114005762ffffff61164c60609261202c565b906040939293519363ffffffff60e01b1684526020840152166040820152f35b34611287575f366003190112611287576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34611287575f36600319011261128757602060405161ffff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34611287575f3660031901126112875760206040517f000000000000000000000000000000000000000000000000000000000000000060020b8152f35b34611287575f3660031901126112875760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34611287575f366003190112611287576020600254604051908152f35b346112875761179036611c7b565b5050507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633039150611400905057630a85dc2960e01b5f5260045ffd5b34611287576040366003190112611287576004356024356001600160401b03811161128757611809903690600401611c38565b6001549060ff82166113b15761181e84611e7d565b5060048101926004845460101c16158015611a56575b611a1c57600260ff198216176001556001845460181c16611a2b575b5060405160208101635c085b4160e11b815233602483015260406044830152836064830152838660848401375f60848584010152601f19601f850116946118a56084848881010301601f198101855284611e5c565b549163ffffffff8360601c169260018060a01b03855416946001863f91015403611a1c57643fffffffc0805a92605a1c16166040600160a61b031684158582046040141715611a0857603f90049061ea608201809211611a0857106119f95783926020925f6040519687948286525193f18092513d826119d3575b50506119c15750156119a957600180546001600160a81b03191690556001600160401b03811161139d5761195a6020604051930183611e5c565b8082526020820192368282011161128757815f92602092863783010152519020906040519182527fca539ca6d71f32350620025ebd69a27e47c82be74d18a0f8c587d5faa2b477f660203393a3005b8363ae193d1560e01b5f52600452600460245260445ffd5b631bea0edf60e11b5f5260045260245ffd5b602014801592506119e7575b508780611920565b635c085b4160e11b14159050876119df565b631115766760e01b5f5260045ffd5b634e487b7160e01b5f52601160045260245ffd5b63c52a9bd360e01b5f5260045ffd5b81546001600160a81b031990911660089190911b610100600160a81b03161760021760015585611850565b506140008311611834565b34611287575f3660031901126112875760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34611287575f366003190112611287575f6080604051611aba81611dd3565b828152602081018390526040810183905260608101839052015260a06001600160a01b037f00000000000000000000000000000000000000000000000000000000000000008181167f000000000000000000000000000000000000000000000000000000000000000092831610918215611bb357805b5f196001861b01169215611bac57505b604051611b4c81611dd3565b8281526020810191600180861b0316825262ffffff604082015f815260806060840193603c85520193308552604051958652600180881b039051166020860152511660408401525160020b6060830152600180841b039051166080820152f35b9050611b40565b81611b30565b34611287575f36600319011261128757602060405161ffff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34611287575f366003190112611287577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b9181601f84011215611287578235916001600160401b038311611287576020838186019501011161128757565b600435906001600160a01b038216820361128757565b90610160600319830112611287576004356001600160a01b0381168103611287579160a060231982011261128757602491608060c3198301126112875760c49161014435906001600160401b03821161128757611cda91600401611c38565b9091565b906101a0600319830112611287576004356001600160a01b0381168103611287579160a060231982011261128757602491608060c3198301126112875760c4916101443591610164359161018435906001600160401b03821161128757611cda91600401611c38565b60c435906001600160a01b038216820361128757565b60e435908160020b820361128757565b610120600319820112611287576004356001600160a01b0381168103611287579160a06023198301126112875760249160c4359160e4359161010435906001600160401b03821161128757611cda91600401611c38565b60043590811515820361128757565b60a081019081106001600160401b0382111761139d57604052565b604081019081106001600160401b0382111761139d57604052565b61010081019081106001600160401b0382111761139d57604052565b608081019081106001600160401b0382111761139d57604052565b61012081019081106001600160401b0382111761139d57604052565b90601f801991011681019081106001600160401b0382111761139d57604052565b600254811015611e995760025f52600660205f20910201905f90565b634e487b7160e01b5f52603260045260245ffd5b60405190606082018281106001600160401b0382111761139d57604052815f81525f60208201526040805191611ee283611dee565b5f83525f60208401520152565b91908201809211611a0857565b9160018060a01b03835416926001843f91015403611a1c575a63ffffffff8216643fffffffc08360061b169080820460401490151715611a0857603f90049061ea608201809211611a0857106119f9576020906040519283915f83525f86858451940192f1928391513d83611f77575b5050506119c1575090565b60201480159350909190611f90575b50505f8080611f6c565b6001600160e01b031916141590505f80611f86565b60a09060231901126112875760405190611fbe82611dd3565b816024356001600160a01b03811681036112875781526044356001600160a01b038116810361128757602082015260643562ffffff811681036112875760408201526084358060020b810361128757606082015260a435906001600160a01b03821682036112875760800152565b6001549060ff821691821515806123a6575b6113b15760a03660231901126112875760405161205a81611dd3565b6024356001600160a01b03811681036112875781526044356001600160a01b038116810361128757602082015260643562ffffff811681036112875760408201526084358060020b810361128757606082015260a435906001600160a01b03821682036112875760a091608082015220927f00000000000000000000000000000000000000000000000000000000000000008094036119f95760020361239d5760ff60035b169060ff19161760015560e4359261211684612627565b9260c435801515808203611287575f915060018060a01b037f00000000000000000000000000000000000000000000000000000000000000001660018060a01b037f00000000000000000000000000000000000000000000000000000000000000001610149512936040519161218b83611e09565b8252602082019360018060a01b03168452604082019580875260608301938685526080840183815260a08501915f835260c08601935f855260e08701955f87525f5b6002548110156122ae57808b6121e38f93611e7d565b508b8d60048301549560018760101c16156122a0579563ffffffff9161227a96976311aaa97d60e11b966040519588602088015251602487015260018060a01b039051166044860152511515606485015251151560848401528a5160a48401528b5160c48401528c51600f0b60e48401528d51600f0b610104840152610104835261227061012484611e5c565b60201c1691611efc565b15612289576001905b016121cd565b63ae193d1560e01b5f52600452600160245260445ffd5b505050505060019150612283565b50985098965098505050505050820361238c5761231a91816122ce611ead565b50811561232c5750806122e3612314926123b1565b905f525f60205260405f209061ffff604051926122ff84611dee565b54818116845260101c1660208301528361256e565b90612679565b60801b906315d7892d60e21b91905f90565b5f808052602052604051612314935091507f00000000000000000000000000000000000000000000000000000000000000009061ffff7fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb561134985611dee565b506315d7892d60e21b915f91508190565b60ff60016120ff565b50600283141561203e565b156123da577f000000000000000000000000000000000000000000000000000000000000000090565b7f000000000000000000000000000000000000000000000000000000000000000090565b91908203918211611a0857565b919290612416611ead565b5061242184826126c1565b8215801561255e575b6125505761ffff8116806126f203906126f28211611a0857846127100261271081048603611a08576124656124749161ffff89511690611eef565b61ffff60208901511690611eef565b906126f21461253c570493846003811115612535576002198101818111611a0857905b85821061252d575b60016001607f1b031061251e575b858111156124c45763686c07bf60e11b5f5260045ffd5b6124cf82848361256e565b6124df8151602083015190611eef565b86838210918261250a575b505061250157505f198114611a08576001016124ad565b90955093505050565b612516919250846123fe565b14865f6124ea565b60016001607f1b0395506124ad565b85915061249f565b5f90612497565b634e487b7160e01b5f52601260045260245ffd5b62a4671960e71b5f5260045ffd5b5060016001607f1b03831161242a565b9291612578611ead565b9361258382846126c1565b8015808015612607575b61255057601e8202828104601e14821715611a08576125b361ffff918286511690611eef565b9416808302928304141715611a08576125d96127109161ffff6020819501511690611eef565b818404865281810460208701528282604051956125f587611dee565b06168452061660208201526040830152565b5060016001607f1b03821161258d565b600160ff1b8114611a08575f0390565b80158015612669575b801561264f575b6119f9575f81121561264c5761264c90612617565b90565b506f7ffffffffffffffffffffffffffffffe198112612637565b5060016001607f1b038113612630565b919061268c906020815191015190611eef565b9180159081156126b0575b81156126a5575b506119f957565b90508210155f61269e565b60016001607f1b0381119150612697565b61ffff6103e8911611908115612705575b81156126ef575b506126e057565b634db7e85160e01b5f5260045ffd5b6127109150602061ffff9101511610155f6126d9565b905061271061ffff8251161015906126d2565b600f0b5f81121561264c5761264c9061261756",
      immutableReferences: [
        {
          start: 670,
          length: 32
        },
        {
          start: 794,
          length: 32
        },
        {
          start: 1901,
          length: 32
        },
        {
          start: 2961,
          length: 32
        },
        {
          start: 4497,
          length: 32
        },
        {
          start: 4666,
          length: 32
        },
        {
          start: 5154,
          length: 32
        },
        {
          start: 5500,
          length: 32
        },
        {
          start: 5647,
          length: 32
        },
        {
          start: 6037,
          length: 32
        },
        {
          start: 842,
          length: 32
        },
        {
          start: 5242,
          length: 32
        },
        {
          start: 538,
          length: 32
        },
        {
          start: 3137,
          length: 32
        },
        {
          start: 3256,
          length: 32
        },
        {
          start: 6880,
          length: 32
        },
        {
          start: 8496,
          length: 32
        },
        {
          start: 3172,
          length: 32
        },
        {
          start: 3291,
          length: 32
        },
        {
          start: 4606,
          length: 32
        },
        {
          start: 5310,
          length: 32
        },
        {
          start: 6916,
          length: 32
        },
        {
          start: 8537,
          length: 32
        },
        {
          start: 7177,
          length: 32
        },
        {
          start: 945,
          length: 32
        },
        {
          start: 5893,
          length: 32
        },
        {
          start: 7123,
          length: 32
        },
        {
          start: 9144,
          length: 32
        },
        {
          start: 5834,
          length: 32
        },
        {
          start: 9023,
          length: 32
        },
        {
          start: 9180,
          length: 32
        },
        {
          start: 3623,
          length: 32
        },
        {
          start: 4566,
          length: 32
        },
        {
          start: 5761,
          length: 32
        },
        {
          start: 1821,
          length: 32
        },
        {
          start: 3767,
          length: 32
        },
        {
          start: 4366,
          length: 32
        },
        {
          start: 5071,
          length: 32
        },
        {
          start: 5954,
          length: 32
        },
        {
          start: 8397,
          length: 32
        },
        {
          start: 6776,
          length: 32
        }
      ],
      sources: {
        "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol": "0xe06a3f08a987af6ad2e1c1e774405d4fe08f1694b67517438b467cecf0da0ef7",
        "lib/openzeppelin-contracts/contracts/utils/ReentrancyGuardTransient.sol": "0xe56ff5015046505f81f9d62671a784e933dd099db4c3a8fa8de598f20af2c5a3",
        "lib/openzeppelin-contracts/contracts/utils/TransientSlot.sol": "0xac673fa1e374d9e6107504af363333e3e5f6344d2e83faf57d9bfd41d77cc946",
        "lib/openzeppelin-uniswap-hooks/src/base/BaseHook.sol": "0x4a3534932ad54cdacf8bcd60489bf9df253ad5daa8dd5599753312844e4af45c",
        "lib/v4-core/src/interfaces/IExtsload.sol": "0x80b53ca4907d6f0088c3b931f2b72cad1dc4615a95094d96bd0fb8dff8d5ba43",
        "lib/v4-core/src/interfaces/IExttload.sol": "0xc6b68283ebd8d1c789df536756726eed51c589134bb20821b236a0d22a135937",
        "lib/v4-core/src/interfaces/IHooks.sol": "0xc131ffa2d04c10a012fe715fe2c115811526b7ea34285cf0a04ce7ce8320da8d",
        "lib/v4-core/src/interfaces/IPoolManager.sol": "0xbdab3544da3d32dfdf7457baa94e17d5a3012952428559e013ffac45d067038e",
        "lib/v4-core/src/interfaces/IProtocolFees.sol": "0x32a666e588a2f66334430357bb1e2424fe7eebeb98a3364b1dd16eb6ccca9848",
        "lib/v4-core/src/interfaces/callback/IUnlockCallback.sol": "0x58c82f2bd9d7c097ed09bd0991fedc403b0ec270eb3d0158bfb095c06a03d719",
        "lib/v4-core/src/interfaces/external/IERC20Minimal.sol": "0xeccadf1bf69ba2eb51f2fe4fa511bc7bb05bbd6b9f9a3cb8e5d83d9582613e0f",
        "lib/v4-core/src/interfaces/external/IERC6909Claims.sol": "0xa586f345739e52b0488a0fe40b6e375cce67fdd25758408b0efcb5133ad96a48",
        "lib/v4-core/src/libraries/BitMath.sol": "0x51b9be4f5c4fd3e80cbc9631a65244a2eb2be250b6b7f128a2035080e18aee8d",
        "lib/v4-core/src/libraries/CustomRevert.sol": "0x111ed3031b6990c80a93ae35dde6b6ac0b7e6af471388fdd7461e91edda9b7de",
        "lib/v4-core/src/libraries/FullMath.sol": "0x4fc73a00817193fd3cac1cc03d8167d21af97d75f1815a070ee31a90c702b4c2",
        "lib/v4-core/src/libraries/Hooks.sol": "0xd679b4b2d429689bc44f136050ebc958fb2d7d0d3a3c7b3e48c08ab4fba09aaa",
        "lib/v4-core/src/libraries/LPFeeLibrary.sol": "0xbf6914e01014e7c1044111feb7df7a3d96bb503b3da827ad8464b1955580d13b",
        "lib/v4-core/src/libraries/ParseBytes.sol": "0x7533b13f53ee2c2c55500100b22ffd6e37e7523c27874edc98663d53a8672b15",
        "lib/v4-core/src/libraries/SafeCast.sol": "0x42c4a24f996a14d358be397b71f7ec9d7daf666aaec78002c63315a6ee67aa86",
        "lib/v4-core/src/libraries/TickMath.sol": "0x4e1a11e154eb06106cb1c4598f06cca5f5ca16eaa33494ba2f0e74981123eca8",
        "lib/v4-core/src/types/BalanceDelta.sol": "0xa719c8fe51e0a9524280178f19f6851bcc3b3b60e73618f3d60905d35ae5569f",
        "lib/v4-core/src/types/BeforeSwapDelta.sol": "0x2a774312d91285313d569da1a718c909655da5432310417692097a1d4dc83a78",
        "lib/v4-core/src/types/Currency.sol": "0x4a0b84b282577ff6f8acf13ec9f4d32dbb9348748b49611d00e68bee96609c93",
        "lib/v4-core/src/types/PoolId.sol": "0x308311916ea0f5c2fd878b6a2751eb223d170a69e33f601fae56dfe3c5d392af",
        "lib/v4-core/src/types/PoolKey.sol": "0xf89856e0580d7a4856d3187a76858377ccee9d59702d230c338d84388221b786",
        "lib/v4-core/src/types/PoolOperation.sol": "0x7a1a107fc1f2208abb2c9364c8c54e56e98dca27673e9441bed2b949b6382162",
        "src/module-foundation/FoundationFeeMathV1.sol": "0x27a21ffdd2d6b61f4a292c8fc1907fad1ac10ab1adc2b1deade67950011f67cd",
        "src/module-foundation/FoundationHookV2.sol": "0x8c8cfa62ecf96e632943246eb55ff3b42489ade7043873583d66b6e55f04635e",
        "src/module-foundation/FoundationLedgerV1.sol": "0x47895ccfb4ac77fd72bf2004d11740f71b5e2b492d760736cb365949c21747c2",
        "src/module-foundation/FoundationTypesV1.sol": "0x1c1782146f0a707c7171068ba5a061dd2e2562d5cfa96d627107fcca0b5f12e8",
        "src/module-foundation/IFoundationModuleV1.sol": "0xd1b2e59ed62f5b4dbe1171a8686175b3270c9f31d7c25345e66e88be0ceef1fe"
      }
    }
  }
};

// lib/module-foundation/ethereum-graph-builder.ts
init_chain_1_v1();
init_funding_path();
init_ethereum_graph();
init_ethereum_graph_plan();
init_pool_key();
var hash2 = (text) => keccak2565(stringToHex3(text));
var zero = toHex(0n, { size: 32 });
var factory2 = getAddress7(chain_1_v1_default.canonicalStamp.graphFactory.address);
var namespace = hash2("programmable.module-foundation.ethereum-graph.v1");
var topology = hash2("engine-token-hook.v1");
var nonceDomain = hash2("programmable.module-foundation.ethereum-graph-nonce.v1");
var launchDomain = hash2("programmable.module-foundation.ethereum-launch-id.v1");
var contracts = { ...ethereum_graph_bytecode_v1_default.contracts, FoundationEthereumGraphProxyV2: ethereum_graph_bytecode_v2_default.contracts.FoundationEthereumGraphProxyV2 };
var minedHooks = /* @__PURE__ */ new Map();
function foundationEthereumProxyContract(source) {
  if (source.sourceCommit === ethereum_graph_bytecode_v2_default.sourceCommit) return "FoundationEthereumGraphProxyV2";
  if (source.sourceCommit === ethereum_graph_bytecode_v1_default.sourceCommit) return "FoundationEthereumGraphProxyV1";
  throw new Error("The Ethereum module source has no installed compiler artifact.");
}
function creation(name, args) {
  const artifact = contracts[name];
  if (keccak2565(artifact.creationBytecode) !== artifact.creationCodeHash) {
    throw new Error("The Ethereum module compiler artifact has changed.");
  }
  return concatHex2([
    artifact.creationBytecode,
    encodeAbiParameters6(artifact.constructorInputs, args)
  ]);
}
function target(name, initCode) {
  return {
    targetIdHash: hash2(name),
    applicantSalt: zero,
    deploymentValue: 0n,
    initializerValue: 0n,
    initCode,
    initializerCalldata: "0x"
  };
}
function predictFoundationEthereumAccounts(input) {
  const { source, metadata, tokenSalt } = input, account = getAddress7(input.account);
  if (source.chainId !== 1 || BigInt(account) === 0n || !/^0x[\da-f]{64}$/i.test(tokenSalt) || BigInt(tokenSalt) === 0n) {
    throw new Error("The Ethereum launch source, wallet or salt is invalid.");
  }
  const length = (text) => new TextEncoder().encode(text).length;
  if (!metadata.name || length(metadata.name) > 48 || !metadata.symbol || length(metadata.symbol) > 12 || length(metadata.description) > 280 || !metadata.imageURI || length(metadata.imageURI) > 2048 || length(metadata.website) > 2048 || !/^0x(?:[\da-f]{2}){0,1200}$/i.test(metadata.socialData)) {
    throw new Error("The coin details exceed the Ethereum token's metadata limits.");
  }
  const identity = {
    routeNamespace: namespace,
    topologyHash: topology,
    routeNonce: keccak2565(encodeAbiParameters6(
      parseAbiParameters6("bytes32,uint256,address,bytes32,address,bytes32"),
      [nonceDomain, 1n, source.implementation.address, source.releaseDigest, account, tokenSalt]
    ))
  };
  const proxyContract = foundationEthereumProxyContract(source);
  const engineTarget = target("engine", creation(
    proxyContract,
    [
      source.implementation.address,
      source.implementation.runtimeCodeHash,
      account,
      ...proxyContract === "FoundationEthereumGraphProxyV2" ? [identity.routeNonce] : []
    ]
  ));
  const engine = predictFoundationEthereumTarget(identity, engineTarget);
  const tokenTarget = target("token", creation("FoundationTokenV1", [metadata, engine]));
  const token = predictFoundationEthereumTarget(identity, tokenTarget);
  const launchId = keccak2565(encodeAbiParameters6(
    parseAbiParameters6("bytes32,bytes32,address"),
    [launchDomain, identity.routeNonce, token]
  ));
  return { identity, engine, token, engineTarget, tokenTarget, launchId };
}
async function mineFoundationEthereumHook(input) {
  const maximum = input.maximumAttempts ?? 262144;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1048576) throw new Error("Invalid hook mining limit.");
  input.signal?.throwIfAborted();
  const initHash = keccak2565(input.initCode), targetIdHash = hash2("hook");
  const key = `${input.identity.routeNamespace}:${input.identity.topologyHash}:${input.identity.routeNonce}:${initHash}`;
  const cached = minedHooks.get(key);
  if (cached && BigInt(cached.applicantSalt) < BigInt(maximum)) return { ...cached };
  for (let index = 0; index < maximum; index++) {
    if (index % 256 === 0) {
      input.signal?.throwIfAborted();
      if (index) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const applicantSalt = toHex(BigInt(index), { size: 32 });
    const effectiveSalt = foundationEthereumTargetSalt(input.identity, { targetIdHash, applicantSalt });
    const address = getContractAddress2({ opcode: "CREATE2", from: factory2, salt: effectiveSalt, bytecodeHash: initHash });
    if ((BigInt(address) & 0x3fffn) === 0x20ccn) {
      const result = { address, applicantSalt };
      if (minedHooks.size >= 16) minedHooks.delete(minedHooks.keys().next().value);
      minedHooks.set(key, Object.freeze(result));
      return { ...result };
    }
  }
  throw new Error("A hook address was not found within this preparation attempt. Try a new launch salt.");
}
async function buildFoundationEthereumGraph(input) {
  const p = structuredClone(input.parameters), path = structuredClone(input.fundingPath);
  const account = getAddress7(input.account), value = input.value;
  if (p.modules.length > 8 || p.creatorBuyFeeBps < 0 || p.creatorBuyFeeBps > 1e3 || p.creatorSellFeeBps < 0 || p.creatorSellFeeBps > 1e3 || value < 0n || value >= 1n << 127n) {
    throw new Error("The Ethereum module settings exceed the launch limits.");
  }
  const amount = p.initialBuyQuoteAmount + p.additionalQuoteAmount;
  if (amount > 0n) assertFoundationFundingPath(p.quote, path, 1);
  else if (path.length || value !== 0n) throw new Error("An unfunded launch must not include a funding path or ETH.");
  if (amount > 0n && (value === 0n || getAddress7(p.quote) === getAddress7(chain_1_v1_default.contracts.wrappedEth.address) && value < amount)) {
    throw new Error("The ETH budget does not cover the initial funding.");
  }
  const predicted = predictFoundationEthereumAccounts({ source: input.source, account, tokenSalt: p.tokenSalt, metadata: p.metadata });
  const hookTarget = target("hook", creation("FoundationHookV2", [
    chain_1_v1_default.contracts.poolManager.address,
    predicted.engine,
    predicted.token,
    p.quote,
    account,
    p.initialTick,
    p.creatorBuyFeeBps,
    p.creatorSellFeeBps,
    p.modules
  ]));
  const mined = await mineFoundationEthereumHook({ identity: predicted.identity, initCode: hookTarget.initCode, signal: input.signal });
  input.signal?.throwIfAborted();
  hookTarget.applicantSalt = mined.applicantSalt;
  p.hookSalt = mined.applicantSalt;
  const engineTarget = {
    ...predicted.engineTarget,
    initializerValue: value,
    initializerCalldata: encodeFunctionData4({
      abi: foundationEthereumGraphAbi,
      functionName: "initializeGraph",
      args: [p, predicted.token, mined.address, encodeFoundationFundingPath(path, 1)]
    })
  };
  const targets = [engineTarget, predicted.tokenTarget, hookTarget];
  const commitment = foundationEthereumGraphCommitment(predicted.identity, targets);
  return {
    identity: predicted.identity,
    launchId: predicted.launchId,
    account,
    engine: predicted.engine,
    token: predicted.token,
    hook: mined.address,
    targets,
    ...commitment,
    parameters: p,
    poolKey: foundationPoolKey({ token: predicted.token, quote: p.quote, hook: mined.address })
  };
}
function assertFoundationEthereumRuntime(name, runtime) {
  const artifact = contracts[name];
  if (!/^0x(?:[\da-f]{2})+$/i.test(runtime) || runtime.length !== artifact.runtimeTemplate.length) {
    throw new Error(`Unexpected ${name} runtime length.`);
  }
  let masked = runtime.toLowerCase().slice(2), expected = artifact.runtimeTemplate.toLowerCase().slice(2);
  for (const { start, length } of artifact.immutableReferences) {
    const from = start * 2, to = from + length * 2, zeros = "0".repeat(length * 2);
    masked = masked.slice(0, from) + zeros + masked.slice(to);
    expected = expected.slice(0, from) + zeros + expected.slice(to);
  }
  if (masked !== expected) throw new Error(`Unexpected ${name} runtime instructions.`);
}

// lib/module-foundation/ethereum-graph-simulation.ts
init_chain_1_v1();
import { decodeFunctionResult, encodeFunctionData as encodeFunctionData5, getAddress as getAddress8, keccak256 as keccak2566, parseAbi as parseAbi3 } from "viem";
init_ethereum_graph_plan();
var foundationEthereumFactoryGraphAbi = parseAbi3([
  "struct Authorization { bytes32 routeNamespace; bytes32 routeNonce; bytes32 topologyHash; bytes32 graphCommitment; address authorizedLauncher; uint256 totalValue; }",
  "struct Target { bytes32 targetIdHash; bytes32 applicantSalt; uint256 deploymentValue; uint256 initializerValue; bytes initCode; bytes initializerCalldata; }",
  "function deployGraph(Authorization authorization,Target[] targets) payable returns (address[] deployments,bytes32[] runtimeCodeHashes,bytes[] runtimeCodes,bytes32 graphDeploymentHash)"
]);
var same2 = (a, b) => a.toLowerCase() === b.toLowerCase();
async function simulateFoundationEthereumGraph(input) {
  const { clients, source, graph, signal } = input;
  signal?.throwIfAborted();
  const heads = await Promise.all(clients.map(async (client) => {
    const [chainId, block2] = await Promise.all([client.getChainId(), client.getBlock()]);
    if (chainId !== 1 || !block2.hash || block2.number === null) throw new Error("Ethereum simulation requires mainnet providers.");
    return block2;
  }));
  const blockNumber = heads[0].number < heads[1].number ? heads[0].number : heads[1].number;
  const blocks = await Promise.all(clients.map((client) => client.getBlock({ blockNumber })));
  const block = blocks[0];
  if (!block.hash || !same2(block.hash, blocks[1].hash) || block.timestamp !== blocks[1].timestamp || blockNumber < source.startBlock || graph.parameters.deadline <= block.timestamp || graph.parameters.deadline > block.timestamp + 3600n) {
    throw new Error("The providers or launch deadline do not match the same Ethereum block.");
  }
  const router2 = getAddress8(chain_1_v1_default.canonicalStamp.router.address);
  const factory3 = getAddress8(chain_1_v1_default.canonicalStamp.graphFactory.address);
  const authorization = {
    ...graph.identity,
    graphCommitment: graph.graphCommitment,
    authorizedLauncher: router2,
    totalValue: graph.totalValue
  };
  const data = encodeFunctionData5({
    abi: foundationEthereumFactoryGraphAbi,
    functionName: "deployGraph",
    args: [authorization, graph.targets]
  });
  const pins = [
    chain_1_v1_default.canonicalStamp.router,
    chain_1_v1_default.canonicalStamp.graphFactory,
    ...["poolManager", "positionManager", "universalRouter", "permit2", "wrappedEth"].map((key) => chain_1_v1_default.contracts[key]),
    source.implementation,
    ...graph.parameters.modules.map((module) => ({ address: module.factory, runtimeCodeHash: module.factoryCodeHash }))
  ];
  const uniquePins = [...new Map(pins.map((pin2) => [pin2.address.toLowerCase(), pin2])).values()];
  if (pins.some((pin2) => uniquePins.some((other) => same2(pin2.address, other.address) && !same2(pin2.runtimeCodeHash, other.runtimeCodeHash)))) {
    throw new Error("The Ethereum dependency bindings conflict.");
  }
  const results = await Promise.all(clients.map(async (client) => {
    await Promise.all(uniquePins.map(async (pin2) => {
      const code = await client.getCode({ address: getAddress8(pin2.address), blockNumber });
      if (!code || !same2(keccak2566(code), pin2.runtimeCodeHash)) throw new Error("An Ethereum module dependency has changed.");
    }));
    signal?.throwIfAborted();
    const result = await client.call({
      account: router2,
      to: factory3,
      data,
      value: graph.totalValue,
      blockNumber,
      gas: 16777216n,
      stateOverride: [{ address: router2, balance: graph.totalValue }]
    });
    if (!result.data) throw new Error("The Ethereum graph simulation returned no result.");
    return result.data;
  }));
  signal?.throwIfAborted();
  if (!same2(results[0], results[1])) throw new Error("The providers returned different Ethereum launch results.");
  const [addresses, hashes, runtimes, graphDeploymentHash] = decodeFunctionResult({
    abi: foundationEthereumFactoryGraphAbi,
    functionName: "deployGraph",
    data: results[0]
  });
  if (addresses.length !== 3 || hashes.length !== 3 || runtimes.length !== 3) throw new Error("The Ethereum graph has unexpected outputs.");
  const expected = [graph.engine, graph.token, graph.hook];
  const names = [foundationEthereumProxyContract(source), "FoundationTokenV1", "FoundationHookV2"];
  for (let i = 0; i < 3; i++) {
    if (!same2(addresses[i], expected[i]) || !same2(keccak2566(runtimes[i]), hashes[i])) throw new Error("The simulated Ethereum output changed.");
    assertFoundationEthereumRuntime(names[i], runtimes[i]);
  }
  if (!same2(hashes[0], source.proxyRuntimeCodeHash)) throw new Error("The proxy differs from the selected Ethereum release.");
  const plan = prepareFoundationEthereumStamp({
    identity: graph.identity,
    targets: graph.targets,
    account: graph.account,
    launchId: graph.launchId,
    poolKey: graph.poolKey,
    validAfter: block.timestamp > 30n ? block.timestamp - 30n : 0n,
    deadline: graph.parameters.deadline < block.timestamp + 300n ? graph.parameters.deadline : block.timestamp + 300n,
    outputs: addresses.map((account, targetIndex) => ({
      account,
      targetIndex,
      targetIdHash: graph.targets[targetIndex].targetIdHash,
      runtimeCodeHash: hashes[targetIndex]
    }))
  });
  if (!same2(plan.route.expectedGraphDeploymentHash, graphDeploymentHash)) throw new Error("The Ethereum graph deployment commitment changed.");
  const checks = await Promise.all(clients.map((client) => client.getBlock({ blockNumber })));
  if (checks.some((check) => !check.hash || !same2(check.hash, block.hash))) throw new Error("The Ethereum simulation block was reorganized.");
  signal?.throwIfAborted();
  return {
    plan,
    block: { number: blockNumber, hash: block.hash, timestamp: block.timestamp },
    providerCount: 2,
    authoritySignature: null
  };
}

// packages/module-foundation-ethereum/src/index.ts
init_ethereum_graph_plan();
init_abi();
import { decodeAbiParameters as decodeAbiParameters2, encodeAbiParameters as encodeAbiParameters7 } from "viem";
function decodeEthereumModuleParameters(bytes) {
  if (!/^0x(?:[\da-f]{2})+$/i.test(bytes) || bytes.length > 65538) throw new Error("Invalid module parameter bytes.");
  const [parameters] = decodeAbiParameters2(foundationLaunchParametersV3, bytes);
  if (encodeAbiParameters7(foundationLaunchParametersV3, [parameters]).toLowerCase() !== bytes.toLowerCase()) {
    throw new Error("Module parameters are not canonically encoded.");
  }
  return parameters;
}
export {
  buildFoundationEthereumGraph,
  decodeEthereumModuleParameters,
  encodeFoundationEthereumStamp,
  predictFoundationEthereumAccounts,
  simulateFoundationEthereumGraph
};
