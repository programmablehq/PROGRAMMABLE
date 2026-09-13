import { getAddress, keccak256, toFunctionSignature, toHex } from 'viem';
import { bytes, canonicalJson, need } from './core.mjs';
import { alignPublishedImmutableIds } from './launch-source-profiles.mjs';
import { isAnyQuotePositionManagerEngine, ANY_QUOTE_POSITION_MANAGER_ENGINE } from './any-quote-position-manager.mjs';
import { SOURCIFY_COMPILER, anyQuoteEthEngineAuxdataProfile, exactSolcVersionAuxdata,
  exactSolcVersionAuxdataDescription, validateSourcifyCompilation, validateSourcifyRuntimeImmutables } from './source-readback.mjs';

export const ETH_CANONICAL_SOURCE_CLASS = 'exact-public-source-and-canonical-create2-v1';
const PROFILES = new Set(['module-engine-any-quote-eth-v1', 'module-engine-any-quote-v1']);
const targets = { token: ['lib/uerc20-factory/src/tokens/UERC20.sol', 'UERC20'],
  engine: ['src/module-engine/any-quote/AnyQuoteLPModuleV1.sol', 'AnyQuoteLPModuleV1'] };
const equal = (a, b, label) => need(canonicalJson(a) === canonicalJson(b), label);
function keys(value, expected, label) {
  need(value && typeof value === 'object' && !Array.isArray(value), label);
  equal(Object.keys(value).sort(), [...expected].sort(), label);
}
const empty = (value, label) => keys(value, [], label);

/** Validates present public data only. The operator must separately supply its private canonical target authority. */
export function validateSourcifyCreationGap(target, value, recompilation) {
  const role = target.role, positions = role === 'engine' && target.sourceProfile === 'module-engine-any-quote-v1'
    && isAnyQuotePositionManagerEngine({ sourcePath: target.file, contractName: target.name });
  const selected = positions ? [ANY_QUOTE_POSITION_MANAGER_ENGINE.sourcePath, ANY_QUOTE_POSITION_MANAGER_ENGINE.contractName] : targets[role];
  need(PROFILES.has(target.sourceProfile) && selected && target.file === selected[0] && target.name === selected[1], 'Exact Any Quote source profile required');
  keys(value, ['matchId', 'creationMatch', 'runtimeMatch', 'verifiedAt', 'creationBytecode', 'runtimeBytecode', 'deployment',
    'sources', 'compilation', 'abi', 'metadata', 'storageLayout', 'transientStorageLayout', 'userdoc', 'devdoc', 'sourceIds',
    'additionalInput', 'stdJsonInput', 'stdJsonOutput', 'signatures', 'proxyResolution', 'match', 'chainId', 'address'], 'Unexpected Sourcify evidence fields');
  need(value.chainId === '4663' && getAddress(value.address) === getAddress(target.address), 'Sourcify chain/address differs');
  need(value.match === 'match' && value.runtimeMatch === 'match' && value.creationMatch === null, 'Only the observed runtime match with unavailable creation is eligible');
  need(typeof value.matchId === 'string' && /^[1-9][0-9]*$/.test(value.matchId)
    && typeof value.verifiedAt === 'string' && Number.isFinite(Date.parse(value.verifiedAt)), 'Sourcify match identity missing');
  equal(value.deployment, { transactionHash: null, blockNumber: null, transactionIndex: null, deployer: null }, 'Conflicting Sourcify deployment evidence');
  need(value.additionalInput === null && value.transientStorageLayout === null, 'Unexpected additional compiler evidence');
  equal(value.proxyResolution, { isProxy: false, proxyType: null, implementations: [] }, 'Only direct Any Quote deployments are eligible');
  keys(value.compilation, ['language', 'compiler', 'compilerVersion', 'compilerSettings', 'name', 'fullyQualifiedName'], 'Unexpected compiler identity fields');
  keys(value.stdJsonInput, ['language', 'sources', 'settings'], 'Unexpected standard compiler input fields');
  for (const settings of [value.compilation.compilerSettings, value.stdJsonInput.settings]) {
    keys(settings, ['viaIR', 'metadata', 'libraries', 'optimizer', 'evmVersion', 'remappings'], 'Unexpected compiler settings fields');
    keys(settings.metadata, role === 'engine' ? ['bytecodeHash'] : ['appendCBOR', 'bytecodeHash', 'useLiteralContent'], 'Unexpected compiler metadata settings');
  }
  const metadata = JSON.parse(target.artifact.metadata), rawArtifact = target.artifact;
  const artifact = { ...rawArtifact.evm, abi: rawArtifact.abi, metadata,
    compilationTarget: { [target.file]: target.name }, bytecode: { ...rawArtifact.evm.bytecode, object: `0x${rawArtifact.evm.bytecode.object}` },
    deployedBytecode: { ...rawArtifact.evm.deployedBytecode, object: `0x${rawArtifact.evm.deployedBytecode.object}` } };
  need(metadata.compiler?.version === SOURCIFY_COMPILER, 'Pinned compiler metadata required');
  validateSourcifyCompilation({ artifact, input: target.input, metadata, file: target.file, name: target.name, role, recompilation }, value);
  if (role === 'engine') anyQuoteEthEngineAuxdataProfile(artifact, target.input, metadata, target.sourceProfile);
  else need(target.input.settings.metadata?.appendCBOR === false && target.input.settings.metadata.bytecodeHash === 'none'
    && target.input.settings.evmVersion === 'cancun' && target.input.settings.optimizer?.enabled === true
    && target.input.settings.optimizer.runs === 1000 && target.input.settings.viaIR !== true, 'Exact Any Quote token compiler profile required');
  const c = value.creationBytecode, r = value.runtimeBytecode;
  const bytecodeKeys = ['onchainBytecode', 'recompiledBytecode', 'sourceMap', 'linkReferences', 'cborAuxdata', 'transformations', 'transformationValues'];
  keys(c, bytecodeKeys, 'Unexpected creation bytecode evidence'); keys(r, [...bytecodeKeys, 'immutableReferences'], 'Unexpected runtime bytecode evidence');
  need(c.onchainBytecode === null && c.transformations === null && c.transformationValues === null, 'Conflicting Sourcify creation evidence');
  need(bytes(c.recompiledBytecode) === artifact.bytecode.object && bytes(r.recompiledBytecode) === artifact.deployedBytecode.object
    && bytes(r.onchainBytecode) === bytes(target.runtime), 'Complete public compiled/runtime bytes differ');
  for (const [label, code, compiled] of [['creation', c, artifact.bytecode], ['runtime', r, artifact.deployedBytecode]]) {
    empty(code.linkReferences, 'Library links are not eligible'); empty(compiled.linkReferences, 'Compiled library links are not eligible');
    equal(code.sourceMap, compiled.sourceMap, `${label}: source map differs from the bound compiler output`);
    if (role === 'engine') {
      if (label === 'creation') exactSolcVersionAuxdataDescription(code.cborAuxdata, compiled.object, role, label);
      else exactSolcVersionAuxdata(code, compiled.object, role, label);
    } else empty(code.cborAuxdata, 'Unexpected token compiler auxdata');
  }
  // Original compiler IDs are checked before the existing bijective transformation-ID alignment.
  equal(r.immutableReferences, artifact.deployedBytecode.immutableReferences, 'Public immutable references differ from the bound compiler context');
  const aligned = alignPublishedImmutableIds(value);
  validateSourcifyRuntimeImmutables(artifact, target.runtime, aligned.value.runtimeBytecode, role);
  const sourceIds = Object.fromEntries(Object.keys(target.input.sources).map(file => {
    const id = target.compilation.sources[file]?.id;
    need(Number.isSafeInteger(id) && id >= 0, 'Bound compiler source ID missing'); return [file, { id }];
  }));
  equal(value.sourceIds, sourceIds, 'Public source IDs differ from the bound compiler context');
  need(rawArtifact.storageLayout && rawArtifact.transientStorageLayout === undefined, 'Pinned compiler auxiliary output required');
  equal(value.storageLayout, rawArtifact.storageLayout, 'Public storage layout differs');
  equal(value.userdoc, metadata.output.userdoc, 'Public user documentation differs');
  equal(value.devdoc, metadata.output.devdoc, 'Public developer documentation differs');
  const compilerBytecode = code => ({ object: code.object, sourceMap: code.sourceMap, linkReferences: code.linkReferences });
  const expectedOutput = { sources: sourceIds, contracts: { [target.file]: { [target.name]: {
    abi: rawArtifact.abi, metadata: rawArtifact.metadata, userdoc: metadata.output.userdoc, devdoc: metadata.output.devdoc,
    storageLayout: rawArtifact.storageLayout, transientStorageLayout: null, evm: {
      bytecode: compilerBytecode(rawArtifact.evm.bytecode), deployedBytecode: { ...compilerBytecode(rawArtifact.evm.deployedBytecode),
        immutableReferences: rawArtifact.evm.deployedBytecode.immutableReferences },
    },
  } } } };
  equal(value.stdJsonOutput, expectedOutput, 'Complete public standard compiler output differs');
  keys(value.signatures, ['function', 'event', 'error'], 'Unexpected signature categories');
  for (const type of ['function', 'event', 'error']) {
    const expected = rawArtifact.abi.filter(item => item.type === type).map(item => {
      const signature = toFunctionSignature({ type: 'function', name: item.name, inputs: item.inputs, outputs: [], stateMutability: 'pure' });
      const signatureHash32 = keccak256(toHex(signature)); return { signature, signatureHash4: signatureHash32.slice(0, 10), signatureHash32 };
    });
    need(Array.isArray(value.signatures[type]), 'Public signatures missing');
    equal(value.signatures[type].map(canonicalJson).sort(), expected.map(canonicalJson).sort(), 'Public ABI signatures differ');
  }
  return { status: 'canonical-creation-binding-required', provider: 'sourcify-v2', providerMatch: value.match, creationMatch: value.creationMatch, runtimeMatch: value.runtimeMatch,
    matchId: value.matchId, verifiedAt: value.verifiedAt, providerClassification: 'RUNTIME_MATCH_CREATION_ACQUISITION_UNAVAILABLE',
    providerImmutableIdRelabelling: aligned.bindings, validatedPresentFields: Object.keys(value).sort() };
}
