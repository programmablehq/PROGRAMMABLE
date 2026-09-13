import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, keccak256, parseAbi, parseAbiParameters, toHex as textHex, zeroAddress } from 'viem';
import { parseOptions, patchImmutables, scanRange, validatePublished, boundLaunchBatch, resolveCreationTransactions,
  checkpointVerifiedRelease, ensureTargetResult, sourceRecordsStatus, compile, sourceTarget, engineBuild, run } from './verify-launch-source.mjs';
import { validateSourcifyCreationGap } from './source-creation-gap.mjs';
import { sourcifyNeedsRecompilation } from './source-readback.mjs';
import { recompileSourcifyInput } from './source-recompile.mjs';
import { launchSourceWire } from './launch-source-shared.mjs';
import { checkpointEntry, CHECKPOINT_SCHEMA, engineLaunchIdentity } from './launch-source-profiles.mjs';
import { canonicalJson } from './core.mjs';
import { EXPECTED_COMPILER_PROFILE, resolveRobinhoodReproductionCompiler } from '../robinhood-custom-launch-standard-json-core.mjs';
import { bindEngineReview } from '../module-engine/publication-plan.mjs';

let cachedSourceCompiler;
async function sourceTestSolc() {
  if (process.env.MODULE_MODE_SOLC) return process.env.MODULE_MODE_SOLC;
  // Contracts release CI already warms solc 0.8.26 in Foundry's SVM cache. Reuse
  // the existing byte/version-pinned local resolver; no PATH guess or download.
  cachedSourceCompiler ??= resolveRobinhoodReproductionCompiler({ compiler: EXPECTED_COMPILER_PROFILE }, { allowDownload: false });
  return (await cachedSourceCompiler).path;
}
after(async () => { if (cachedSourceCompiler) await rm((await cachedSourceCompiler).cleanupDirectory, { recursive: true, force: true }); });

const actual = JSON.parse(brotliDecompressSync(readFileSync(new URL('./source-creation-gap.fixture.json.br', import.meta.url))));
let actualTargetPromise;
function actualSourceTargets() {
  return actualTargetPromise ??= (async () => {
    const binary = await sourceTestSolc(), result = {};
    for (const role of ['token', 'engine']) {
      const raw = Buffer.from(role === 'token' ? actual.rawToken : actual.rawEngine), value = JSON.parse(raw);
      const [file, name] = value.compilation.fullyQualifiedName.split(':');
      const standard = role === 'token' ? actual.factory.stdJsonInput : value.stdJsonInput;
      const input = { ...standard, settings: { ...standard.settings,
        outputSelection: { '*': { '*': ['abi', 'metadata', 'storageLayout', 'evm.bytecode', 'evm.deployedBytecode'], '': ['ast'] } } } };
      const output = await compile(input, binary), receipt = actual.launch.receipt;
      const target = { ...sourceTarget({ role, file, name }, input, output), address: value.address.toLowerCase(),
        sourceProfile: actual.launch.release.sourceVersion, sourceCommit: actual.launch.release.sourceCommit,
        runtime: value.runtimeBytecode.onchainBytecode, transactionHash: receipt.transactionHash,
        creation: { transactionHash: receipt.transactionHash, blockNumber: BigInt(receipt.blockNumber).toString(), blockHash: receipt.blockHash,
          transactionIndex: BigInt(receipt.transactionIndex).toString(), transactionSender: receipt.from }, constructorArguments: '0x' };
      target.creationCode = `0x${target.artifact.evm.bytecode.object}`;
      const recompilation = sourcifyNeedsRecompilation(target.input, value)
        ? await recompileSourcifyInput(value, target.input, { PATH: process.env.PATH, MODULE_MODE_SOLC: binary }) : undefined;
      result[role] = { target, value, raw, recompilation };
    }
    return result;
  })();
}

const quoteActual = JSON.parse(brotliDecompressSync(readFileSync(new URL('./quote-source-readback.fixture.json.br', import.meta.url))));
let actualQuoteTargetPromise;
function actualQuoteEngineTarget() {
  return actualQuoteTargetPromise ??= (async () => {
    const { release, acceptedBundle: bundle, publication: readback, launch, runtime } = quoteActual;
    const checked = await bindEngineReview(bundle, release), wire = await launchSourceWire();
    assert.equal(release.sourceVersion, 'module-engine-any-quote-v1');
    assert.equal(release.releaseDigest, '0xac96d652e2043f34b3f736bad999ab673b17aa8750b5d62951e9ec928306273d');
    assert.equal(readback.available, false, 'This source comparison does not manufacture an activated catalog');
    assert.equal(readback.releaseDigest, release.releaseDigest);
    const publication = { template: { status: 'prepared', manifest: bundle.manifest, manifestHash: checked.manifestHash } };
    const log = launch.receipt.logs.find(row => row.address.toLowerCase() === release.contracts.host.address
      && row.topics[0] === encodeEventTopics({ abi: wire.moduleEngineHostAbi, eventName: 'EngineLaunchBound' })[0]);
    assert.ok(log);
    const identity = engineLaunchIdentity({ release, receipt: launch.receipt, log, publication,
      revision: [readback.revision, readback.immutableRuntimeOffsets, readback.immutableConstructorOffsets, readback.eligibleFamilies] }, wire);
    assert.equal(launch.transaction.hash, launch.receipt.transactionHash);
    assert.equal(launch.transaction.blockHash, launch.receipt.blockHash);
    assert.equal(launch.transaction.blockNumber, launch.receipt.blockNumber);
    assert.equal(launch.transaction.to.toLowerCase(), release.contracts.host.address);
    assert.equal(launch.transaction.from.toLowerCase(), identity.launch.creator.toLowerCase());
    assert.equal(launch.transaction.input, encodeFunctionData({ abi: wire.moduleEngineHostAbi, functionName: 'launch', args: [identity.parameters] }));
    assert.equal(launch.receipt.status, '0x1');
    assert.deepEqual(runtime.providers.map(row => row.providerId), ['quicknode', 'alchemy']);
    assert.deepEqual(runtime.providers[0].block, runtime.providers[1].block);
    assert.deepEqual(runtime.providers[0].runtime, runtime.providers[1].runtime);
    assert.deepEqual(runtime.targets, [['token', identity.launch.token.toLowerCase()], ['engine', identity.launch.engine.toLowerCase()]]);
    assert.equal(identity.runtime, runtime.providers[0].runtime.engine);
    const standard = wire.moduleEngineStandardInputV1(bundle.source, checked.artifact.subject, checked.buildPlan);
    const digest = wire.reviewDigest('programmable.modules.compiler-input.v1', standard);
    assert.equal(digest, '0x60be050c239d2ab31d865dd4dcaa09bab172ef7d16e9fda5815a081da8c58855');
    assert.equal(digest, checked.artifact.compiler.completeInputHash);
    assert.equal(digest, bundle.manifest.manifest.source.compiler.completeInputHash);
    const input = { ...standard, settings: { ...standard.settings,
      outputSelection: { '*': { '*': ['abi', 'metadata', 'storageLayout', 'evm.bytecode', 'evm.deployedBytecode'], '': ['ast'] } } } };
    const compiled = await compile(input, await sourceTestSolc()), expected = checked.artifact.engine;
    const target = { ...sourceTarget({ role: 'engine', file: expected.sourcePath, name: expected.contractName,
      sourceProfile: release.sourceVersion, sourceCommit: release.sourceCommit }, input, compiled),
      address: identity.launch.engine.toLowerCase(), runtime: identity.runtime, creationCode: identity.creationCode,
      constructorArguments: identity.constructorArguments, transactionHash: launch.receipt.transactionHash,
      creation: { transactionHash: launch.receipt.transactionHash, blockNumber: BigInt(launch.receipt.blockNumber).toString(),
        blockHash: launch.receipt.blockHash, transactionIndex: BigInt(launch.receipt.transactionIndex).toString(),
        transactionSender: launch.transaction.from }, protectedCompleteInputHash: digest };
    assert.equal(`0x${target.artifact.evm.bytecode.object}`, expected.creationBytecode);
    assert.equal(`0x${target.artifact.evm.deployedBytecode.object}`, expected.runtimeTemplate);
    assert.equal(canonicalJson(target.artifact.abi), canonicalJson(expected.abi));
    assert.equal(canonicalJson(target.artifact.evm.deployedBytecode.immutableReferences),
      canonicalJson(Object.fromEntries(expected.immutableReferences.map(({ id, ranges }) => [id, ranges]))));
    return target;
  })();
}

let actualQuoteTargetsPromise;
function actualQuoteSourceTargets() {
  return actualQuoteTargetsPromise ??= (async () => {
    const engine = await actualQuoteEngineTarget(), binary = await sourceTestSolc();
    const input = { ...quoteActual.factory.stdJsonInput, settings: { ...quoteActual.factory.stdJsonInput.settings,
      outputSelection: { '*': { '*': ['abi', 'metadata', 'storageLayout', 'evm.bytecode', 'evm.deployedBytecode'], '': ['ast'] } } } };
    const result = await compile(input, binary), tokenValue = JSON.parse(quoteActual.rawToken);
    assert.equal(keccak256(quoteActual.factory.runtimeBytecode.onchainBytecode), quoteActual.release.contracts.tokenFactory.runtimeCodeHash);
    const token = { ...sourceTarget({ role: 'token', file: 'lib/uerc20-factory/src/tokens/UERC20.sol', name: 'UERC20',
      sourceProfile: quoteActual.release.sourceVersion, sourceCommit: quoteActual.release.sourceCommit }, input, result),
      address: tokenValue.address.toLowerCase(), runtime: tokenValue.runtimeBytecode.onchainBytecode,
      creation: engine.creation, transactionHash: engine.transactionHash, constructorArguments: '0x' };
    token.creationCode = `0x${token.artifact.evm.bytecode.object}`;
    assert.equal(keccak256(token.creationCode), quoteActual.release.tokenCreationCodeHash);
    assert.equal(token.runtime, quoteActual.runtime.providers[0].runtime.token);
    const fixtures = {};
    for (const [role, target, raw] of [['token', token, quoteActual.rawToken], ['engine', engine, quoteActual.rawEngine]]) {
      const value = JSON.parse(raw), recompilation = sourcifyNeedsRecompilation(target.input, value)
        ? await recompileSourcifyInput(value, target.input, { PATH: process.env.PATH, MODULE_MODE_SOLC: binary }) : undefined;
      fixtures[role] = { target, value, raw: Buffer.from(raw), recompilation };
    }
    return fixtures;
  })();
}

// Only the isolated operator regression activates this temporary catalog. Every review/source field
// is genuine; this test-only status is not a current website activation or an Ethereum-finality proof.
function quoteTestPublication() {
  const bundle = quoteActual.acceptedBundle;
  return { template: { status: 'available', manifest: bundle.manifest,
    manifestHash: bundle.review.command.hostManifestHash, reviewDigest: bundle.review.decisionDigest },
    requestDigest: bundle.artifact.subject.requestDigest, review: bundle.review,
    reviewedBuild: { artifact: bundle.artifact, plan: bundle.buildPlan, subject: bundle.artifact.subject } };
}

test('the quote engine compiler input binds both accepted pins under isolated catalog authority', async () => {
  assert.equal(quoteActual.publication.available, false, 'The retained live prepared catalog is not relabelled');
  const wire = await launchSourceWire(), publication = quoteTestPublication();
  const target = await engineBuild({ release: quoteActual.release }, publication, { wire, binary: await sourceTestSolc(),
    fetchPublic: async url => {
      const kind = /\/(source|manifest|review)\.json$/.exec(String(url))?.[1]; assert.ok(kind);
      return Response.json({ source: quoteActual.acceptedBundle.source, manifest: publication.template.manifest, review: publication.review }[kind]);
    } });
  assert.equal(target.protectedCompleteInputHash, '0x60be050c239d2ab31d865dd4dcaa09bab172ef7d16e9fda5815a081da8c58855');
});

test('the actual quote source records validate every present field while retaining the provider creation gap', async () => {
  for (const fixture of Object.values(await actualQuoteSourceTargets())) {
    const proof = validateSourcifyCreationGap(fixture.target, fixture.value, fixture.recompilation);
    assert.equal(proof.creationMatch, null); assert.equal(proof.runtimeMatch, 'match');
    assert.equal(proof.status, 'canonical-creation-binding-required');
    assert.equal(sourceRecordsStatus([proof]), 'failed');
    assert.deepEqual(proof.validatedPresentFields, Object.keys(fixture.value).sort());
    assert.deepEqual(fixture.value, JSON.parse(fixture.raw));
    assert.throws(() => validatePublished(fixture.target, fixture.value, fixture.recompilation), /Sourcify no-CBOR match is unavailable/);
  }
});

// All receipts, public sources and state reads below are retained real responses. Protected release/catalog installation,
// the scan returning this one launch, and latest/finalized selectors are explicit offline controls.
// They exercise private issuance after future protected activation, not current availability/finality.
async function replayQuoteOperator(fault) {
  const directory = await mkdtemp(path.join(tmpdir(), 'quote-source-operator-'));
  try {
    const release = { ...quoteActual.release, enabled: true, status: 'active',
      // These installation digests are deliberately synthetic authority controls, never live evidence.
      ...Object.fromEntries(['deploymentEvidenceDigest', 'sourceVerificationDigest', 'lifecycleEvidenceDigest']
        .map(key => [key, keccak256(textHex(`quote-offline-test-only-${key}`))])) };
    const wire = await launchSourceWire(), publication = quoteTestPublication();
    const catalog = { schemaVersion: 'programmable.module-engine.catalog.v1', sourceReleaseDigest: release.releaseDigest, entries: [publication] };
    const files = { 'module-mode/robinhood.preview.json': null, 'module-mode/catalog.json': {},
      'module-mode/historical-releases.json': { schemaVersion: 'programmable.module-mode-historical-releases.v1', releases: [] },
      'module-engine/robinhood.json': release, 'module-engine/catalog.json': fault === 'prepared-catalog' ? quoteActual.preparedCatalog : catalog,
      'module-engine/historical-releases.json': { schemaVersion: 'programmable.module-engine.historical-releases.v1', releases: [] } };
    for (const [file, value] of Object.entries(files)) {
      const target = path.join(directory, 'config', file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(value));
    }
    const stateFile = path.join(directory, 'checkpoint.json'), prior = `${JSON.stringify({ schemaVersion: CHECKPOINT_SCHEMA, chainId: 4663, releases: {} })}\n`;
    await writeFile(stateFile, prior);
    const snapshot = quoteActual.canonical, head = snapshot.block, created = { number: textHex(BigInt(snapshot.creation.blockNumber)), hash: snapshot.creation.blockHash };
    const receipt = quoteActual.canonicalCreationRpc.eth_getTransactionReceipt.result;
    const transaction = quoteActual.canonicalCreationRpc.eth_getTransactionByHash.result;
    const host = release.contracts.host.address, engine = snapshot.targets.engine.address.toLowerCase(), token = snapshot.targets.token.address.toLowerCase();
    const log = receipt.logs.find(row => row.address.toLowerCase() === host
      && row.topics[0] === encodeEventTopics({ abi: wire.moduleEngineHostAbi, eventName: 'EngineLaunchBound' })[0]);
    assert.ok(log); assert.equal(quoteActual.publication.available, false);
    const key = call => canonicalJson(call).toLowerCase(), reads = new Map();
    for (const row of quoteActual.canonicalRpc) for (const { call, result } of row.entries) reads.set(key(call), result);
    const publicReads = [], rechecks = [], badHash = `0x${'00'.repeat(32)}`;
    const selector = (name, type) => encodeFunctionData({ abi: parseAbi([`function ${name}() view returns (${type})`]), functionName: name });
    const request = async batch => batch.map(({ method, params }) => {
      if (method === 'eth_chainId') return textHex(4663n);
      if (method === 'eth_getBlockByNumber') {
        if (params[0] === 'latest' || params[0] === 'finalized') return head;
        const block = BigInt(params[0]) === BigInt(created.number) ? created : BigInt(params[0]) === BigInt(head.number) ? head : null;
        assert.ok(block);
        if (publicReads.length) rechecks.push({ block: block.number, afterSource: publicReads.at(-1) });
        if (publicReads.length && (fault === 'creation-reorg' && block === created || fault === 'runtime-reorg' && block === head)) return { ...block, hash: badHash };
        return block;
      }
      if (method === 'eth_getLogs') { assert.equal(params[0].address.toLowerCase(), host); assert.equal(params[0].toBlock, created.number); return [log]; }
      if (method === 'eth_getTransactionReceipt') { assert.equal(params[0], receipt.transactionHash); return fault === 'receipt-sender' ? { ...receipt, from: zeroAddress } : receipt; }
      if (method === 'eth_getTransactionByHash') { assert.equal(params[0], transaction.hash); return transaction; }
      assert.ok(['eth_call', 'eth_getCode'].includes(method));
      assert.deepEqual(params[1], { blockHash: head.hash, requireCanonical: true });
      const value = reads.get(key({ method, params })); assert.ok(value, 'Every quote getter/runtime must exist in the retained canonical snapshot');
      if (method === 'eth_getCode' && fault === 'released-ledger' && params[0].toLowerCase() === release.contracts.ledger.address) return `${value}00`;
      if (method === 'eth_call' && params[0].to.toLowerCase() === engine) {
        if (fault === 'resource' && params[0].data === selector('lockedLiquidity', 'uint128')) return `0x${'0'.repeat(64)}`;
        if (fault === 'context' && params[0].data === selector('contextHash', 'bytes32')) return badHash;
        if (fault === 'shared-hook' && params[0].data === selector('sharedHook', 'address')) return `0x${'0'.repeat(64)}`;
      }
      return value;
    });
    const fetchPublic = async (url, init = {}) => {
      assert.notEqual(init.method, 'POST', 'Readable source is not resubmitted');
      const value = String(url), kind = /\/(source|manifest|review)\.json$/.exec(value)?.[1];
      if (kind) return Response.json({ source: quoteActual.acceptedBundle.source, manifest: publication.template.manifest, review: publication.review }[kind]);
      if (value.endsWith('/api-docs/swagger.json')) return Response.json(quoteActual.preflight.api);
      if (value.endsWith('/chains')) return Response.json(quoteActual.preflight.chains);
      if (value.includes(release.contracts.tokenFactory.address)) return Response.json(quoteActual.factory);
      const role = value.toLowerCase().includes(token) ? 'token' : value.toLowerCase().includes(engine) ? 'engine' : null;
      assert.ok(role); publicReads.push(role);
      const raw = role === 'token' ? quoteActual.rawToken : quoteActual.rawEngine;
      if (fault === 'source-map' && role === 'token') { const changed = JSON.parse(raw); changed.creationBytecode.sourceMap += ';'; return Response.json(changed); }
      return new Response(raw, { headers: { 'content-type': 'application/json' } });
    };
    const report = await run(parseOptions(['--publish', '--state-file', stateFile,
      '--max-blocks', String(BigInt(created.number) - BigInt(release.startBlock) + 1n), '--solc', await sourceTestSolc()]),
    { root: directory, request, fetchPublic });
    return { report, publicReads, rechecks, prior, checkpoint: await readFile(stateFile, 'utf8') };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('the quote operator issues private source evidence only inside an isolated activated catalog replay', async () => {
  const { report, publicReads, rechecks, checkpoint } = await replayQuoteOperator();
  assert.equal(report.status, 'verified', JSON.stringify(report.releases, (_, value) => typeof value === 'bigint' ? value.toString() : value));
  assert.deepEqual(publicReads, ['token', 'engine']);
  assert.equal(report.records.length, 2);
  for (const record of report.records) {
    assert.equal(record.status, 'verified'); assert.equal(record.evidenceClass, 'exact-public-source-and-canonical-create2-v1');
    assert.equal(record.sourceVersion, 'module-engine-any-quote-v1'); assert.equal(record.creationMatch, null); assert.equal(record.runtimeMatch, 'match');
    assert.equal(record.canonicalCreation.method, 'authenticated-AnyQuote-launch-receipt-CREATE2-and-runtime-binding');
    assert.equal(record.canonicalCreation.releaseDigest, quoteActual.release.releaseDigest);
    assert.equal(record.canonicalCreation.resourcesHash, quoteActual.canonical.resources.resourcesHash);
    assert.ok(rechecks.some(row => row.afterSource === record.role && BigInt(row.block) === BigInt(quoteActual.canonical.creation.blockNumber)));
    assert.ok(rechecks.some(row => row.afterSource === record.role && BigInt(row.block) === BigInt(quoteActual.canonical.block.number)));
  }
  assert.equal(report.records[0].sourceTextProvenance, 'public-source-compiles-to-released-initcode');
  assert.equal(report.records[0].protectedCompleteInputHash, null);
  assert.equal(report.records[1].protectedCompleteInputHash, '0x60be050c239d2ab31d865dd4dcaa09bab172ef7d16e9fda5815a081da8c58855');
  const saved = JSON.parse(checkpoint).releases;
  assert.deepEqual(Object.keys(saved), [quoteActual.release.releaseDigest]);
  assert.equal(saved[quoteActual.release.releaseDigest].nextBlock, '60132136');
  assert.equal(saved[quoteActual.release.releaseDigest].blockHash, quoteActual.canonical.creation.blockHash);
});

test('quote prepared authority, source, release, receipt, resource and reorg failures cannot advance a checkpoint', async () => {
  for (const fault of ['prepared-catalog', 'source-map', 'released-ledger', 'receipt-sender', 'resource', 'context', 'shared-hook', 'creation-reorg', 'runtime-reorg']) {
    const { report, publicReads, checkpoint, prior } = await replayQuoteOperator(fault);
    assert.equal(report.status, 'failed', fault); assert.equal(checkpoint, prior, fault);
    if (fault === 'source-map' || fault.endsWith('reorg')) assert.deepEqual(publicReads, ['token', 'engine']);
    else assert.deepEqual(publicReads, [], fault);
  }
});

// This in-memory envelope models a future full provider comparison only. The fixture retains the
// actual404 bodies unchanged; no successful source readback, deployment freshness or authority is claimed.
function quoteFullComparison(target) {
  const metadata = JSON.parse(target.artifact.metadata), { outputSelection, ...settings } = target.input.settings;
  const refs = target.artifact.evm.deployedBytecode.immutableReferences, trailer = '0xa164736f6c634300081a000a';
  const creationCode = `0x${target.artifact.evm.bytecode.object}`, template = `0x${target.artifact.evm.deployedBytecode.object}`;
  const transformations = Object.entries(refs).flatMap(([id, list]) => list.map(ref => ({ id, type: 'replace', offset: ref.start, reason: 'immutable' })));
  const immutables = Object.fromEntries(Object.entries(refs).map(([id, [ref]]) => [id,
    `0x${target.runtime.slice(2 + ref.start * 2, 2 + (ref.start + ref.length) * 2)}`]));
  return { chainId: '4663', address: target.address, match: 'match', creationMatch: 'match', runtimeMatch: 'match',
    matchId: '1', verifiedAt: quoteActual.runtime.observedAt,
    compilation: { language: 'Solidity', compiler: 'solc', compilerVersion: '0.8.26+commit.8a97fa7a',
      name: target.name, fullyQualifiedName: `${target.file}:${target.name}`, compilerSettings: settings },
    stdJsonInput: { ...target.input, settings }, sources: target.input.sources, metadata, abi: target.artifact.abi,
    deployment: { ...target.creation, deployer: target.creation.transactionSender },
    creationBytecode: { recompiledBytecode: creationCode, onchainBytecode: target.creationCode,
      cborAuxdata: { 1: { offset: (creationCode.length - trailer.length) / 2, value: trailer } }, linkReferences: {},
      transformations: [{ type: 'insert', offset: (creationCode.length - 2) / 2, reason: 'constructorArguments' }],
      transformationValues: { constructorArguments: target.constructorArguments } },
    runtimeBytecode: { recompiledBytecode: template, onchainBytecode: target.runtime,
      cborAuxdata: { 1: { offset: (template.length - trailer.length) / 2, value: trailer } }, linkReferences: {},
      immutableReferences: refs, transformations, transformationValues: { immutables } } };
}

test('the retained quote engine accepts its exact compiled trailer in a modeled full source comparison', async () => {
  const target = await actualQuoteEngineTarget(), value = quoteFullComparison(target), proof = validatePublished(target, value);
  assert.deepEqual(value.creationBytecode.cborAuxdata, { 1: { offset: 15265, value: '0xa164736f6c634300081a000a' } });
  assert.deepEqual(value.runtimeBytecode.cborAuxdata, { 1: { offset: 10845, value: '0xa164736f6c634300081a000a' } });
  assert.equal(proof.independentByteComparison, 'exact-complete-creation-and-runtime');
  assert.equal(proof.creationBytecodeHash, '0xea220b3d13a97a539769be7529bce084b28f49b3433e52d86f77469b7d94490e');
  assert.equal(proof.runtimeCodeHash, '0x50ff424fc96646574cf75655351f21c3c40fe52a836d6a2da70733ca1997f1b7');
  assert.equal(proof.evidenceClass, undefined, 'Full-byte comparison does not issue the private canonical witness');
  for (const value of Object.values(quoteActual.unavailableSourceRecords)) {
    assert.equal(value.creationMatch, null); assert.equal(value.runtimeMatch, null); assert.equal(value.match, null);
  }
});

test('the retained quote comparison rejects altered bytes and provider evidence without extending canonical authority', async () => {
  const target = await actualQuoteEngineTarget();
  const mutations = [
    v => { v.creationMatch = null; }, v => { v.runtimeMatch = null; }, v => { v.match = 'partial'; },
    v => { v.address = zeroAddress; }, v => { v.deployment.transactionHash = `0x${'00'.repeat(32)}`; },
    v => { v.creationBytecode.onchainBytecode += '00'; },
    v => { v.creationBytecode.transformationValues.constructorArguments += '00'; },
    v => { v.runtimeBytecode.onchainBytecode = `0x00${v.runtimeBytecode.onchainBytecode.slice(4)}`; },
    v => { v.runtimeBytecode.immutableReferences[Object.keys(v.runtimeBytecode.immutableReferences)[0]][0].start++; },
    v => { v.runtimeBytecode.transformationValues.immutables[Object.keys(v.runtimeBytecode.transformationValues.immutables)[0]] = `0x${'ff'.repeat(32)}`; },
    v => { v.sources[target.file].content += '\n// changed source\n'; },
    v => { v.metadata.compiler.version = '0.8.27'; }, v => { v.abi.pop(); },
    ...['creationBytecode', 'runtimeBytecode'].flatMap(kind => [
      v => { v[kind].recompiledBytecode += '00'; }, v => { v[kind].cborAuxdata = {}; },
      v => { v[kind].cborAuxdata[1].offset++; }, v => { v[kind].cborAuxdata[1].value = '0xa164736f6c634300081b000a'; },
      v => { v[kind].cborAuxdata[2] = structuredClone(v[kind].cborAuxdata[1]); },
      v => { v[kind].transformations.push({ id: '1', type: 'replace', offset: v[kind].cborAuxdata[1].offset, reason: 'cborAuxdata' }); },
      v => { v[kind].linkReferences = { unexpected: {} }; },
    ]),
  ];
  for (const mutate of mutations) {
    const value = structuredClone(quoteFullComparison(target)); mutate(value);
    assert.throws(() => validatePublished(target, value), undefined, mutate.toString());
  }
  for (const sourceProfile of ['module-engine-v1', 'module-native-v1', 'module-native-v2', 'unrecognized'])
    assert.throws(() => validatePublished({ ...target, sourceProfile }, quoteFullComparison(target)), /unexpected creation CBOR/);
  assert.throws(() => validateSourcifyCreationGap(target, quoteActual.unavailableSourceRecords.engine));
  const unavailable = await ensureTargetResult(target, false, { binary: await sourceTestSolc(),
    beforePublish: () => assert.fail('An unavailable quote record cannot request private canonical authority'),
    fetchPublic: async () => Response.json(quoteActual.unavailableSourceRecords.engine, { status: 404 }) });
  assert.equal(sourceRecordsStatus([unavailable]), 'source-publication-required');
  assert.notEqual(unavailable.status, 'verified');
  const directory = await mkdtemp(path.join(tmpdir(), 'quote-source-unavailable-checkpoint-'));
  try {
    const state = { schemaVersion: CHECKPOINT_SCHEMA, chainId: 4663, releases: {} };
    const file = path.join(directory, 'checkpoint.json'), before = `${JSON.stringify(state)}\n`;
    await writeFile(file, before);
    await checkpointVerifiedRelease(file, state, quoteActual.release, BigInt(target.creation.blockNumber) + 1n,
      target.creation.blockHash, quoteActual.runtime.observedAt, [unavailable]);
    assert.equal(await readFile(file, 'utf8'), before);
    assert.deepEqual(state.releases, {});
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the actual engine build binds the public source to both authenticated reviewed input pins', async () => {
  const wire = await launchSourceWire(), publication = actual.launch.publication;
  const binary = await sourceTestSolc(), build = source => engineBuild({ release: actual.launch.release }, publication, { wire,
    binary, fetchPublic: async url => {
      const kind = /\/(source|manifest|review)\.json$/.exec(String(url))?.[1];
      assert.ok(kind, 'Only the existing public module source files are read');
      return Response.json({ source, manifest: publication.template.manifest, review: publication.review }[kind]);
    } });
  const target = await build(actual.sourcePacket);
  assert.equal(target.protectedCompleteInputHash, '0x60be050c239d2ab31d865dd4dcaa09bab172ef7d16e9fda5815a081da8c58855');
  const changed = structuredClone(actual.sourcePacket), file = changed.files.find(item => item.path.endsWith('/AnyQuoteLPModuleV1.sol'));
  assert.ok(file);
  const content = Buffer.concat([Buffer.from(file.bytes, 'base64'), Buffer.from('\n// paired source comment forgery\n')]);
  file.bytes = content.toString('base64'); file.sha256 = createHash('sha256').update(content).digest('hex');
  await assert.rejects(build(changed), /public source bytes differ|source|artifact|build/i);
});

test('actual creation-gap source records validate all present data without becoming full provider matches', async () => {
  for (const [role, fixture] of Object.entries(await actualSourceTargets())) {
    const { target, value, raw, recompilation } = fixture;
    const proof = validateSourcifyCreationGap(target, value, recompilation);
    assert.equal(proof.creationMatch, null); assert.equal(proof.runtimeMatch, 'match');
    assert.equal(proof.providerClassification, 'RUNTIME_MATCH_CREATION_ACQUISITION_UNAVAILABLE');
    assert.deepEqual(proof.validatedPresentFields, Object.keys(value).sort());
    assert.equal(proof.evidenceClass, undefined, 'Present-data validation cannot issue canonical authority');
    assert.equal(proof.status, 'canonical-creation-binding-required');
    assert.equal(sourceRecordsStatus([proof]), 'failed', 'Present-data proof cannot authorize a checkpoint');
    assert.deepEqual(value, JSON.parse(raw), 'Provider data is not synthesized or rewritten');
    assert.throws(() => validatePublished(target, value, recompilation), /Sourcify no-CBOR match is unavailable/);
    assert.equal(Object.keys(target.compilation.sources).length, role === 'token' ? 19 : 47);
  }
});

test('every actual Sourcify field is required and mutations fail without masking auxiliary compiler data', async () => {
  const changes = [
    v => { v.unrecognized = null; }, v => { v.chainId = '1'; }, v => { v.address = zeroAddress; }, v => { v.matchId = '0'; },
    v => { v.verifiedAt = 'invalid'; }, v => { v.match = 'partial'; }, v => { v.runtimeMatch = null; }, v => { v.creationMatch = 'match'; },
    v => { v.deployment.transactionHash = `0x${'00'.repeat(32)}`; }, v => { v.creationBytecode.onchainBytecode = '0x'; },
    v => { v.creationBytecode.transformations = []; }, v => { v.creationBytecode.transformationValues = {}; },
    v => { v.creationBytecode.recompiledBytecode += '00'; }, v => { v.runtimeBytecode.onchainBytecode += '00'; },
    v => { v.runtimeBytecode.recompiledBytecode += '00'; }, v => { v.creationBytecode.sourceMap += ';'; },
    v => { v.runtimeBytecode.sourceMap += ';'; }, v => { v.creationBytecode.cborAuxdata = { 1: { offset: 0, value: '0x00' } }; },
    v => { v.creationBytecode.linkReferences = { Lib: {} }; }, v => { v.runtimeBytecode.immutableReferences = {}; },
    v => { v.runtimeBytecode.transformations.pop(); }, v => { v.runtimeBytecode.transformationValues = {}; },
    v => { v.sources[Object.keys(v.sources)[0]].content += '\n'; }, v => { v.compilation.compilerVersion = '0.8.27'; },
    v => { v.compilation.compilerSettings.optimizer.runs++; }, v => { v.compilation.extra = true; }, v => { v.abi.pop(); },
    v => { v.metadata.output.userdoc.notice = 'forged'; }, v => { v.storageLayout.storage[0].astId++; },
    v => { v.storageLayout.storage[0].slot = '999'; }, v => { v.transientStorageLayout = {}; },
    v => { v.userdoc.notice = 'forged'; }, v => { v.devdoc.details = 'forged'; }, v => { v.sourceIds[Object.keys(v.sourceIds)[0]].id++; },
    v => { v.additionalInput = {}; }, v => { v.stdJsonInput.sources = {}; }, v => { v.stdJsonOutput.sources = {}; },
    v => { v.stdJsonInput.settings.outputSelection = 'invalid'; }, v => { v.stdJsonInput.extra = true; },
    v => { v.compilation.compilerSettings.outputSelection = {}; },
    v => { v.stdJsonOutput.contracts[Object.keys(v.stdJsonOutput.contracts)[0]][v.compilation.name].evm.bytecode.object += '00'; },
    v => { v.signatures.function[0].signatureHash4 = '0x00000000'; }, v => { v.signatures.function.push(v.signatures.function[0]); },
    v => { v.proxyResolution.isProxy = true; }, v => { v.proxyResolution.implementations = [zeroAddress]; },
  ];
  for (const fixture of [...Object.values(await actualSourceTargets()), ...Object.values(await actualQuoteSourceTargets())]) {
    for (const field of Object.keys(fixture.value)) {
      const changed = structuredClone(fixture.value); delete changed[field];
      assert.throws(() => validateSourcifyCreationGap(fixture.target, changed, fixture.recompilation), undefined, `missing ${field}`);
    }
    for (const change of changes) {
      const changed = structuredClone(fixture.value); change(changed);
      assert.throws(() => validateSourcifyCreationGap(fixture.target, changed, fixture.recompilation), undefined, change.toString());
    }
    const wrongContext = structuredClone(fixture.target); wrongContext.compilation.sources[fixture.target.file].id++;
    assert.throws(() => validateSourcifyCreationGap(wrongContext, fixture.value, fixture.recompilation), /source IDs/);
  }
});

test('saved, copied and flag-bearing targets cannot issue canonical evidence and unknown statuses cannot checkpoint', async () => {
  for (const fixture of [...Object.values(await actualSourceTargets()), ...Object.values(await actualQuoteSourceTargets())]) {
    const target = { ...fixture.target, evidenceClass: 'exact-public-source-and-canonical-create2-v1', checkpointEligible: true };
    const result = await ensureTargetResult(target, false, { binary: await sourceTestSolc(),
      beforePublish: () => assert.fail('An unbound target cannot request canonical authority'), fetchPublic: async () => Response.json(fixture.value) });
    assert.equal(result.status, 'failed'); assert.equal(sourceRecordsStatus([result]), 'failed');
  }
  for (const status of ['pending', 'exact-public-source-bytes-canonical-freshness-pending', 'unknown', null])
    assert.equal(sourceRecordsStatus([{ status }]), 'failed');
  const directory = await mkdtemp(path.join(tmpdir(), 'source-present-data-checkpoint-'));
  try {
    const fixture = (await actualSourceTargets()).token;
    const proof = validateSourcifyCreationGap(fixture.target, fixture.value, fixture.recompilation);
    const selected = actual.launch.release, hash = actual.launch.receipt.blockHash, checkedAt = '2026-09-13T00:00:00Z';
    const previous = checkpointEntry(selected, 60419321n, hash, checkedAt);
    const state = { schemaVersion: CHECKPOINT_SCHEMA, chainId: 4663, releases: { [selected.releaseDigest]: previous } };
    const file = path.join(directory, 'checkpoint.json'), before = `${JSON.stringify(state)}\n`;
    await writeFile(file, before);
    await checkpointVerifiedRelease(file, state, selected, 60419322n, hash, checkedAt, [proof]);
    assert.equal(await readFile(file, 'utf8'), before);
    assert.deepEqual(state.releases[selected.releaseDigest], previous);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// These mocks replay retained public values through the real run(), catalogue, compiler, receipt,
// CREATE2 and resource binders. They never replace a production validator or issue private authority.
async function replayActualOperator(fault) {
  const directory = await mkdtemp(path.join(tmpdir(), 'source-canonical-operator-'));
  try {
    const selected = actual.launch.release, wire = await launchSourceWire();
    const identity = engineLaunchIdentity(actual.launch, wire), { receipt, log, revision, state } = actual.launch;
    const head = { number: textHex(BigInt(actual.canonical.checkpoint.number)), hash: actual.canonical.checkpoint.hash };
    const creation = actual.canonical.creation, created = { number: receipt.blockNumber, hash: receipt.blockHash };
    const files = { 'module-mode/robinhood.preview.json': null, 'module-mode/catalog.json': {},
      'module-mode/historical-releases.json': { schemaVersion: 'programmable.module-mode-historical-releases.v1', releases: [] },
      'module-engine/robinhood.json': selected, 'module-engine/catalog.json': actual.catalog,
      'module-engine/historical-releases.json': { schemaVersion: 'programmable.module-engine.historical-releases.v1', releases: [] } };
    for (const [file, value] of Object.entries(files)) {
      const target = path.join(directory, 'config', file); await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(value));
    }
    const stateFile = path.join(directory, 'checkpoint.json');
    const prior = `${JSON.stringify({ schemaVersion: CHECKPOINT_SCHEMA, chainId: 4663, releases: {} })}\n`;
    await writeFile(stateFile, prior);
    const calls = new Map(), publicReads = [], submissions = [], canonicalRechecks = [], unexpected = [];
    const host = selected.contracts.host.address, engine = actual.canonical.launch.engine, token = actual.canonical.launch.token;
    const register = (address, abi, name, args, result) => calls.set(`${address.toLowerCase()}:${encodeFunctionData({ abi, functionName: name, args })}`,
      encodeFunctionResult({ abi, functionName: name, result }));
    const getter = (address, name, type, result) => register(address, parseAbi([`function ${name}() view returns (${type})`]), name, [], result);
    getter(host, 'SOURCE_VERSION', 'bytes32', wire.moduleEngineSourceId(selected));
    register(host, wire.moduleEngineHostAbi, 'getRevision', [actual.canonical.launch.revisionId], revision);
    register(host, wire.moduleEngineHostAbi, 'getLaunch', [actual.canonical.launch.launchId], actual.canonical.launch);
    getter(token, 'name', 'string', identity.parameters.name); getter(token, 'symbol', 'string', identity.parameters.symbol);
    getter(token, 'decimals', 'uint8', 18); getter(token, 'creator', 'address', host); getter(token, 'graffiti', 'bytes32', identity.graffiti);
    getter(engine, 'contextHash', 'bytes32', keccak256(encodeAbiParameters([wire.moduleEngineConstructorParameters[0]], [identity.context])));
    for (const [name, type] of Object.entries({ poolId: 'bytes32', initialTick: 'int24', tickLower: 'int24', tickUpper: 'int24',
      lockedLiquidity: 'uint128', lockedTokenDust: 'uint256', quoteDecimals: 'uint8' })) getter(engine, name, type, state[name]);
    for (const name of ['sharedHook', 'poolManager']) getter(engine, name, 'address', selected.contracts[name].address);
    register(selected.contracts.sharedHook.address, wire.anyQuoteNativeFeeRouteAbi, 'nativeFeeRouteHash', [state.poolId],
      fault === 'resource-mismatch' ? `0x${'00'.repeat(32)}` : state.nativeFeeRouteHash);
    const runtimes = new Map(Object.entries(actual.runtimeCode).map(([role, code]) => [selected.contracts[role].address, code]));
    runtimes.set(token, JSON.parse(actual.rawToken).runtimeBytecode.onchainBytecode);
    runtimes.set(engine, JSON.parse(actual.rawEngine).runtimeBytecode.onchainBytecode);
    const badHash = `0x${'00'.repeat(32)}`;
    const request = async batch => batch.map(({ method, params }) => {
      if (method === 'eth_chainId') return textHex(4663n);
      if (method === 'eth_getBlockByNumber') {
        if (params[0] === 'finalized' || params[0] === 'latest') return head;
        const block = BigInt(params[0]) === BigInt(created.number) ? created : BigInt(params[0]) === BigInt(head.number) ? head : null;
        assert.ok(block, 'Only the retained creation and canonical snapshot blocks are requested');
        if (publicReads.length) canonicalRechecks.push({ number: params[0], afterSource: publicReads.at(-1) });
        if (publicReads.length && (fault === 'creation-reorg' && block === created || fault === 'runtime-reorg' && block === head)) return { ...block, hash: badHash };
        return block;
      }
      if (method === 'eth_getLogs') {
        assert.equal(params[0].address.toLowerCase(), host); assert.equal(params[0].toBlock, created.number);
        return [log];
      }
      if (method === 'eth_getTransactionReceipt') return fault === 'receipt-sender-mismatch' ? { ...receipt, from: zeroAddress } : receipt;
      if (method === 'eth_getTransactionByHash') return { hash: creation.transactionHash, blockHash: creation.blockHash,
        blockNumber: textHex(BigInt(creation.blockNumber)), transactionIndex: textHex(BigInt(creation.transactionIndex)), from: creation.transactionSender };
      if (method === 'eth_getCode' || method === 'eth_call') {
        assert.deepEqual(params[1], { blockHash: head.hash, requireCanonical: true });
        if (method === 'eth_getCode') {
          const code = runtimes.get(params[0].toLowerCase()); assert.ok(code, 'Runtime bytes must exist in retained public evidence');
          return fault === 'released-code-mismatch' && params[0].toLowerCase() === host ? `${code}00` : code;
        }
        const result = calls.get(`${params[0].to.toLowerCase()}:${params[0].data}`);
        assert.ok(result, `Unexpected replay call ${params[0].data.slice(0, 10)}`); return result;
      }
      unexpected.push(method); assert.fail(`Unexpected replay RPC method ${method}`);
    });
    const fetchPublic = async (url, init = {}) => {
      const value = String(url), kind = /\/(source|manifest|review)\.json$/.exec(value)?.[1];
      const role = value.toLowerCase().includes(token) ? 'token' : value.toLowerCase().includes(engine) ? 'engine' : null;
      if (init.method === 'POST') {
        assert.equal(fault, 'source-initially-missing', 'Already-readable public source must not be resubmitted');
        assert.ok(role); assert.equal(value.toLowerCase(), `https://sourcify.dev/server/v2/verify/4663/${role === 'token' ? token : engine}`);
        const body = JSON.parse(init.body), provider = JSON.parse(role === 'token' ? actual.rawToken : actual.rawEngine);
        assert.equal(body.creationTransactionHash, receipt.transactionHash); assert.equal(body.compilerVersion, '0.8.26+commit.8a97fa7a');
        assert.equal(body.contractIdentifier, provider.compilation.fullyQualifiedName); assert.deepEqual(body.stdJsonInput.sources, provider.stdJsonInput.sources);
        submissions.push(role);
        return Response.json({ verificationId: `${role}-synthetic-offline-job` }, { status: 202 });
      }
      if (kind) return Response.json({ source: actual.sourcePacket, manifest: actual.launch.publication.template.manifest, review: actual.launch.publication.review }[kind]);
      if (value.endsWith('/api-docs/swagger.json')) return Response.json(actual.preflight.api);
      if (value.endsWith('/chains')) return Response.json(actual.preflight.chains);
      if (value.includes(selected.contracts.tokenFactory.address)) return Response.json(actual.factory);
      assert.ok(role, 'Only the existing authenticated publication and Sourcify source endpoints are requested'); publicReads.push(role);
      // Controlled absence/job responses test the existing flow, not a historical claim of absence.
      if (fault === 'source-initially-missing' && !submissions.includes(role)) return new Response(null, { status: 404 });
      const raw = role === 'token' ? actual.rawToken : actual.rawEngine;
      if (fault === 'source-mismatch' && role === 'token') { const changed = JSON.parse(raw); changed.storageLayout.storage[0].slot = '999'; return Response.json(changed); }
      return new Response(raw, { headers: { 'content-type': 'application/json' } });
    };
    const options = parseOptions(['--publish', '--state-file', stateFile, '--max-blocks', String(BigInt(created.number) - BigInt(selected.startBlock) + 1n),
      '--solc', await sourceTestSolc()]);
    const report = await run(options, { root: directory, request, fetchPublic });
    assert.deepEqual(unexpected, []);
    return { report, publicReads, submissions, canonicalRechecks, prior, checkpoint: await readFile(stateFile, 'utf8') };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('the complete operator issues the distinct ETH source witness and advances only its exact replay checkpoint', async () => {
  const { report, publicReads, canonicalRechecks, checkpoint } = await replayActualOperator();
  assert.equal(report.status, 'verified', JSON.stringify(report.releases.map(({ status, error, records }) => ({ status, error, records }))));
  assert.deepEqual(publicReads, ['token', 'engine']); assert.equal(report.records.length, 2);
  for (const record of report.records) {
    assert.equal(record.status, 'verified'); assert.equal(record.evidenceClass, 'exact-public-source-and-canonical-create2-v1');
    assert.equal(record.creationMatch, null); assert.equal(record.runtimeMatch, 'match');
    assert.equal(record.canonicalCreation.transactionHash, actual.launch.receipt.transactionHash);
    assert.equal(record.canonicalCreation.resourcesHash, actual.canonical.launch.resourcesHash);
    assert.deepEqual(record.canonicalCreation.runtimeSnapshot, { blockNumber: actual.canonical.checkpoint.number, blockHash: actual.canonical.checkpoint.hash, requireCanonical: true });
    assert.ok(canonicalRechecks.some(call => call.afterSource === record.role && BigInt(call.number) === BigInt(actual.launch.receipt.blockNumber)));
    assert.ok(canonicalRechecks.some(call => call.afterSource === record.role && BigInt(call.number) === BigInt(actual.canonical.checkpoint.number)));
  }
  assert.equal(report.records[0].sourceTextProvenance, 'public-source-compiles-to-released-initcode');
  assert.equal(report.records[0].protectedCompleteInputHash, null);
  assert.equal(report.records[1].protectedCompleteInputHash, '0x60be050c239d2ab31d865dd4dcaa09bab172ef7d16e9fda5815a081da8c58855');
  assert.equal((report.records[1].constructorArguments.length - 2) / 2, 512);
  const saved = JSON.parse(checkpoint).releases[actual.launch.release.releaseDigest];
  assert.equal(saved.nextBlock, '60419322'); assert.equal(saved.blockHash, actual.launch.receipt.blockHash);
});

test('an initially absent source uses the existing submission flow and the same canonical readback authority', async () => {
  const { report, submissions, publicReads, checkpoint } = await replayActualOperator('source-initially-missing');
  assert.equal(report.status, 'verified', JSON.stringify(report.releases.map(({ status, error }) => ({ status, error }))));
  assert.deepEqual(submissions, ['token', 'engine']); assert.deepEqual(publicReads, ['token', 'token', 'engine', 'engine']);
  assert.ok(report.records.every(record => record.status === 'verified' && record.creationMatch === null
    && record.evidenceClass === 'exact-public-source-and-canonical-create2-v1'));
  assert.equal(JSON.parse(checkpoint).releases[actual.launch.release.releaseDigest].nextBlock, '60419322');
});

test('canonical creation and runtime reorgs retain the checkpoint after exact public readback', async () => {
  for (const fault of ['creation-reorg', 'runtime-reorg']) {
    const { report, publicReads, prior, checkpoint } = await replayActualOperator(fault);
    assert.equal(report.status, 'failed'); assert.deepEqual(publicReads, ['token', 'engine']);
    assert.equal(report.records.length, 2); assert.ok(report.records.every(record => record.status === 'failed' && /changed before source publication/.test(record.error)));
    assert.equal(checkpoint, prior);
  }
});

test('source, release, receipt and resource mismatches cannot advance the actual operator checkpoint', async () => {
  for (const fault of ['source-mismatch', 'released-code-mismatch', 'receipt-sender-mismatch', 'resource-mismatch']) {
    const { report, publicReads, prior, checkpoint } = await replayActualOperator(fault);
    assert.equal(report.status, 'failed', fault); assert.equal(checkpoint, prior, fault);
    if (fault === 'source-mismatch') {
      assert.deepEqual(publicReads, ['token', 'engine']); assert.equal(report.records[0].status, 'failed');
      assert.match(report.records[0].error, /storage layout/); assert.equal(report.records[1].status, 'verified');
    } else { assert.deepEqual(publicReads, []); assert.equal(report.records.length, 0); }
  }
});

const address = `0x${'12'.repeat(20)}`;
const release = { chainId: 4663, startBlock: '100', releaseDigest: `0x${'34'.repeat(32)}`, contracts: { launcher: { address } } };

test('publication and checkpoint writes are explicit', () => {
  assert.equal(parseOptions([]).publish, false);
  assert.throws(() => parseOptions(['--state-file', '/tmp/state.json']), /require --publish/);
  assert.throws(() => parseOptions(['--publish', '--state-file', '/tmp/state.json', '--from-block', '100']), /override/);
  assert.throws(() => parseOptions(['--max-blocks', '1000001']), /between/);
  assert.throws(() => parseOptions(['--max-launches', '0']), /between/);
  assert.throws(() => parseOptions(['--from-block', '-1']), /scan block range/);
  assert.throws(() => parseOptions(['--from-block', '101', '--to-block', '100']), /scan block range/);
  assert.throws(() => parseOptions(['--token', 'oops']), /Invalid token/);
  assert.throws(() => parseOptions(['--submit']), /Unknown/);
  assert.equal(parseOptions(['--publish', '--state-file', '/tmp/state.json']).publish, true);
});

test('scan checkpoints bind the active release and never include unfinalized logs', () => {
  const options = parseOptions(['--max-blocks', '20']);
  assert.deepEqual(scanRange(release, options, 150n), { from: 100n, to: 119n, finalized: 150n, caughtUp: false });
  const state = { schemaVersion: 'programmable.module-mode-launch-source-checkpoint.v1', chainId: 4663, releaseDigest: release.releaseDigest, launcher: address, nextBlock: '140', blockHash: `0x${'78'.repeat(32)}` };
  assert.deepEqual(scanRange(release, options, 150n, state), { from: 140n, to: 150n, finalized: 150n, caughtUp: true });
  assert.throws(() => scanRange(release, options, 150n, { ...state, releaseDigest: 'old' }), /different release/);
  assert.throws(() => scanRange(release, options, 150n, { ...state, blockHash: undefined }), /block hash/);
  assert.throws(() => scanRange(release, { ...options, fromBlock: 99n }, 150n), /precede/);
  assert.throws(() => scanRange(release, { ...options, toBlock: 151n }, 150n), /unfinalized/);
});

test('runtime substitution accepts only compiler-declared immutable slots', () => {
  const artifact = { evm: { deployedBytecode: { object: `11${'00'.repeat(32)}22`, immutableReferences: { 7: [{ start: 1, length: 32 }] } } } };
  const compilation = { sources: { 'Token.sol': { ast: { nodes: [{ nodeType: 'VariableDeclaration', mutability: 'immutable', id: 7, name: 'creator' }] } } } };
  assert.equal(patchImmutables(artifact, compilation, { creator: address }), `0x11${address.slice(2).padStart(64, '0')}22`);
  assert.throws(() => patchImmutables(artifact, compilation, { owner: address }), /Unexpected immutable/);
  assert.throws(() => patchImmutables(artifact, compilation, { creator: address, operator: address }), /absent/);
  assert.throws(() => patchImmutables({ evm: { deployedBytecode: { ...artifact.evm.deployedBytecode, immutableReferences: { 7: [{ start: 1, length: 1 }] } } } }, compilation, { creator: address }), /offset/);
});

test('large batches advance through complete blocks without skipping launches', () => {
  const range = { from: 100n, to: 200n, finalized: 200n, caughtUp: true };
  const logs = [100, 101, 101, 102].map(block => ({ blockNumber: toHex(block) }));
  assert.deepEqual(boundLaunchBatch(logs, range, 2), [logs[0]]);
  assert.equal(range.to, 100n);
  assert.equal(range.caughtUp, false);
  assert.throws(() => boundLaunchBatch(logs.slice(1), { ...range, from: 101n }, 1), /single block/);
});

function toHex(value) { return `0x${value.toString(16)}`; }

test('scheduled publication uses production, read-only repository access and a checked compiler', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/verify-module-launch-sources.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron: '17 \* \* \* \*'/);
  assert.match(workflow, /github\.repository == 'programmablehq\/PROGRAMMABLE' && github\.ref == 'refs\/heads\/production'/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow, /(?:issues|actions|contents|id-token): write|secrets\./);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef/);
  assert.match(workflow, /sha256sum --check --status/);
  assert.match(workflow, /--publish/);
  assert.match(workflow, /--max-launches 100/);
  assert.match(workflow, /--state-file \.module-source-state\/checkpoint\.json/);
  for (const match of workflow.matchAll(/uses: ([^\s]+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
});

export function publishedFixture() {
  const transactionHash = `0x${'56'.repeat(32)}`, sourceCommit = 'a'.repeat(40);
  const input = { language: 'Solidity', sources: { 'Token.sol': { content: '// synthetic source, never onchain\ncontract Token {}' } },
    settings: { optimizer: { enabled: true, runs: 1000 }, evmVersion: 'cancun', metadata: { appendCBOR: false, bytecodeHash: 'none' }, libraries: {}, remappings: [] } };
  const metadata = { compiler: { version: '0.8.26+commit.8a97fa7a' }, settings: { compilationTarget: { 'Token.sol': 'Token' } } };
  const creation = { transactionHash, blockNumber: '123', transactionIndex: '2', transactionSender: address };
  const target = { role: 'token', address, file: 'Token.sol', name: 'Token', input, transactionHash, creation, sourceCommit,
    constructorArguments: '0x', creationCode: '0x1122', runtime: '0x3344', artifact: { abi: [], metadata: JSON.stringify(metadata),
      evm: { bytecode: { object: '1122' }, deployedBytecode: { object: '3344', immutableReferences: {} } } } };
  const value = { chainId: '4663', address, match: 'match', creationMatch: 'match', runtimeMatch: 'match', matchId: '12',
    compilation: { language: 'Solidity', compiler: 'solc', compilerVersion: '0.8.26+commit.8a97fa7a', name: 'Token', fullyQualifiedName: 'Token.sol:Token', compilerSettings: input.settings },
    stdJsonInput: structuredClone(input), metadata, abi: [], sources: input.sources, deployment: { ...creation, deployer: address },
    creationBytecode: { onchainBytecode: '0x1122', recompiledBytecode: '0x1122', cborAuxdata: {}, linkReferences: {}, transformations: [], transformationValues: {} },
    runtimeBytecode: { onchainBytecode: '0x3344', recompiledBytecode: '0x3344', cborAuxdata: {}, linkReferences: {}, immutableReferences: {}, transformations: [], transformationValues: {} },
    verifiedAt: '2026-09-07T00:00:00Z' };
  return { target, value };
}
test('a partial token readback retains its job and checkpoint while the bound engine is published', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'module-source-targets-'));
  try {
    const token = publishedFixture(), engine = publishedFixture();
    engine.target = { ...engine.target, role: 'engine', address: `0x${'90'.repeat(20)}` };
    engine.value.address = engine.target.address;
    const tokenJob = '11111111-1111-4111-8111-111111111111', engineJob = '22222222-2222-4222-8222-222222222222';
    const submitted = new Set(), before = [], context = { beforePublish: async target => { before.push(target.address); },
      fetchPublic: async (url, init) => {
        const isToken = String(url).includes(token.target.address), fixture = isToken ? token : engine;
        if (init.method === 'POST') {
          submitted.add(fixture.target.address);
          assert.equal(JSON.parse(init.body).creationTransactionHash, fixture.target.transactionHash);
          return Response.json({ verificationId: isToken ? tokenJob : engineJob }, { status: 202 });
        }
        if (!submitted.has(fixture.target.address)) return new Response(null, { status: 404 });
        return Response.json(isToken ? { ...fixture.value, creationMatch: null,
          deployment: { transactionHash: null, blockNumber: null, transactionIndex: null, deployer: null } } : fixture.value);
      } };
    const records = [];
    for (const target of [token.target, engine.target]) records.push(await ensureTargetResult(target, true, context));
    assert.deepEqual([...submitted], [token.target.address, engine.target.address]);
    assert.deepEqual(before, [token.target.address, engine.target.address]);
    assert.equal(records[0].status, 'failed'); assert.match(records[0].error, /Sourcify no-CBOR match is unavailable/);
    assert.equal(records[0].verificationId, tokenJob);
    assert.equal(records[1].address, engine.target.address); assert.equal(records[1].comparison, 'exact-complete-creation-and-runtime');
    assert.equal(sourceRecordsStatus(records), 'failed');
    const selectedRelease = { ...release, sourceVersion: 'module-native-v1' }, hash = `0x${'ab'.repeat(32)}`, checkedAt = '2026-09-13T00:00:00Z';
    const previous = checkpointEntry(selectedRelease, 150n, hash, checkedAt);
    const state = { schemaVersion: CHECKPOINT_SCHEMA, chainId: 4663, releases: { [release.releaseDigest]: previous } };
    const file = path.join(directory, 'checkpoint.json'), initial = `${JSON.stringify(state)}\n`;
    await writeFile(file, initial);
    await checkpointVerifiedRelease(file, state, selectedRelease, 201n, hash, checkedAt, records);
    assert.equal(await readFile(file, 'utf8'), initial); assert.deepEqual(state.releases[release.releaseDigest], previous);
    await checkpointVerifiedRelease(file, state, selectedRelease, 201n, hash, checkedAt, [records[1]]);
    assert.equal(JSON.parse(await readFile(file)).releases[release.releaseDigest].nextBlock, '201');
    assert.equal(sourceRecordsStatus([{ status: 'not-published' }, records[1]]), 'source-publication-required');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an omitted empty library default needs the exact pinned provider recompilation and never permits links', () => {
  const { target, value } = publishedFixture();
  value.compilation.compilerSettings = structuredClone(value.compilation.compilerSettings);
  delete value.compilation.compilerSettings.libraries;
  delete value.stdJsonInput.settings.libraries;
  const proof = { compilerVersion: '0.8.26+commit.8a97fa7a', inputDigest: keccak256(textHex(canonicalJson(value.stdJsonInput))),
    creationBytecode: '0x1122', runtimeBytecode: '0x3344', abi: [] };
  assert.throws(() => validatePublished(target, value), /exact pinned recompilation/);
  assert.equal(validatePublished(target, value, proof).providerCompilerDefaultBinding, 'omitted-empty-library-map-after-exact-recompilation');
  assert.deepEqual(target.input.settings.libraries, {});
  for (const altered of [{ ...proof, compilerVersion: '0.8.25' }, { ...proof, inputDigest: `0x${'00'.repeat(32)}` },
    { ...proof, creationBytecode: '0x1123' }, { ...proof, runtimeBytecode: '0x3345' }, { ...proof, abi: [{}] }]) {
    assert.throws(() => validatePublished(target, value, altered), /exact pinned recompilation/);
  }
  const mismatched = structuredClone(value); mismatched.stdJsonInput.settings.libraries = {};
  assert.throws(() => validatePublished(target, mismatched, proof), /input\/settings disagree/);
  const linked = structuredClone(target); linked.artifact.evm.bytecode.linkReferences = { 'Lib.sol': {} };
  assert.throws(() => validatePublished(linked, value, proof), /exact pinned recompilation/);
  const configured = structuredClone(target); configured.input.settings.libraries = { 'Lib.sol': { Library: address } };
  assert.throws(() => validatePublished(configured, value, proof), /compiler settings differ/);
  const providerLink = structuredClone(value); providerLink.runtimeBytecode.linkReferences = { 'Lib.sol': {} };
  assert.throws(() => validatePublished(target, providerLink, proof), /library link/);
});
test('provider flags cannot replace the shared complete creation/runtime, settings, metadata and actual transaction proof', () => {
  const { target, value } = publishedFixture();
  assert.equal(validatePublished(target, value).comparison, 'exact-complete-creation-and-runtime');
  const changes = [v => { v.chainId = '1'; }, v => { v.runtimeMatch = null; }, v => { v.sources = {}; },
    v => { v.deployment.transactionHash = `0x${'00'.repeat(32)}`; }, v => { v.deployment.blockNumber = '124'; },
    v => { v.deployment.transactionIndex = '3'; }, v => { v.runtimeBytecode.onchainBytecode = '0x3345'; },
    v => { v.creationBytecode.onchainBytecode += '00'; }, v => { v.compilation.compilerSettings.optimizer.runs++; },
    v => { v.metadata.settings.compilationTarget = {}; }, v => { v.runtimeBytecode.transformations = [{ reason: 'cborAuxdata' }]; }];
  for (const change of changes) { const altered = structuredClone(value); change(altered); assert.throws(() => validatePublished(target, altered)); }
  assert.throws(() => validatePublished({ ...target, creation: undefined }, value), /Actual creation/);
});
test('provider id-space alignment still rejects a different immutable value or missing transformation', () => {
  const { target, value } = publishedFixture(), word = `0x${address.slice(2).padStart(64, '0')}`;
  const template = `11${'00'.repeat(32)}22`, runtime = `0x11${word.slice(2)}22`;
  target.runtime = runtime; target.artifact.evm.deployedBytecode = { object: template, immutableReferences: { 7: [{ start: 1, length: 32 }] } };
  value.runtimeBytecode = { ...value.runtimeBytecode, recompiledBytecode: `0x${template}`, onchainBytecode: runtime,
    immutableReferences: { 900: [{ start: 1, length: 32 }] }, transformations: [{ id: '700', type: 'replace', offset: 1, reason: 'immutable' }],
    transformationValues: { immutables: { 700: word } } };
  assert.deepEqual(validatePublished(target, value).providerImmutableIdRelabelling, { 900: '700' });
  const changed = structuredClone(value); changed.runtimeBytecode.transformationValues.immutables['700'] = `0x${'ff'.repeat(32)}`;
  assert.throws(() => validatePublished(target, changed), /immutable values/);
  changed.runtimeBytecode.transformationValues.immutables['700'] = word;
  changed.runtimeBytecode.transformationValues.immutables['701'] = word;
  assert.throws(() => validatePublished(target, changed), /immutable values/);
  const missing = structuredClone(value); missing.runtimeBytecode.transformations = [];
  assert.throws(() => validatePublished(target, missing), /Incomplete immutable/);
});

function forwarderFixture(sameTransaction = false) {
  const factory = `0x${'21'.repeat(20)}`, positionManager = `0x${'43'.repeat(20)}`;
  const launchWallet = `0x${'65'.repeat(20)}`, forwarder = `0x${'87'.repeat(20)}`;
  const salt = `0x${'a9'.repeat(32)}`, launchTransaction = `0x${'cb'.repeat(32)}`;
  const creationTransaction = sameTransaction ? launchTransaction : `0x${'ed'.repeat(32)}`;
  const launchBlockHash = `0x${'19'.repeat(32)}`, creationBlockHash = sameTransaction ? launchBlockHash : `0x${'39'.repeat(32)}`;
  const configurationHash = keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,address,address,address,uint256,address'),
    [4663n, factory, forwarder, positionManager, zeroAddress, (1n << 256n) - 1n, launchWallet]));
  const abi = parseAbi(['event LockedPositionFeeForwarderDeployed(address indexed forwarder,address indexed feeRecipient,bytes32 indexed salt,bytes32 configurationHash,address positionManager)']);
  const creationLog = { address: factory, blockNumber: toHex(sameTransaction ? 100 : 75), blockHash: creationBlockHash,
    transactionHash: creationTransaction, logIndex: '0x2', removed: false,
    topics: encodeEventTopics({ abi, args: { forwarder, feeRecipient: launchWallet, salt } }),
    data: encodeAbiParameters(parseAbiParameters('bytes32,address'), [configurationHash, positionManager]) };
  const input = { release: { ...release, contracts: { ...release.contracts, positionForwarderFactory: { address: factory }, positionManager: { address: positionManager } } },
    launch: { positionRecipient: forwarder, launchWallet }, launchLog: { transactionHash: launchTransaction, blockNumber: '0x64', blockHash: launchBlockHash, logIndex: '0x9' },
    launchReceipt: { status: '0x1', transactionHash: launchTransaction, blockNumber: '0x64', blockHash: launchBlockHash, logs: sameTransaction ? [creationLog] : [] },
    salt, configurationHash, factoryDeploymentBlock: 50n };
  const receipt = { status: '0x1', transactionHash: creationTransaction, blockNumber: creationLog.blockNumber, blockHash: creationBlockHash, logs: [creationLog] };
  return { input, creationLog, receipt, block: { number: creationLog.blockNumber, hash: creationBlockHash } };
}

test('a forwarder created before launch keeps its own verified creation transaction', async () => {
  const fixture = forwarderFixture();
  const requests = [];
  const result = await resolveCreationTransactions(fixture.input, async calls => {
    requests.push(calls);
    return requests.length === 1 ? [[fixture.creationLog]] : [fixture.receipt, fixture.block];
  });
  assert.deepEqual(result, { token: fixture.input.launchLog.transactionHash, forwarder: fixture.creationLog.transactionHash });
  assert.notEqual(result.token, result.forwarder);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], [{ method: 'eth_getLogs', params: [{ address: fixture.input.release.contracts.positionForwarderFactory.address,
    fromBlock: '0x32', toBlock: '0x64', topics: fixture.creationLog.topics }] }]);
  assert.deepEqual(requests[1], [
    { method: 'eth_getTransactionReceipt', params: [result.forwarder] },
    { method: 'eth_getBlockByNumber', params: ['0x4b', false] },
  ]);
});

test('a forwarder created during launch reuses the verified launch receipt without history reads', async () => {
  const fixture = forwarderFixture(true);
  const result = await resolveCreationTransactions(fixture.input, async () => assert.fail('Unexpected historical read'));
  assert.deepEqual(result, { token: fixture.input.launchLog.transactionHash, forwarder: fixture.input.launchLog.transactionHash });
});

test('forwarder creation requires the correct factory, configuration, ordering and successful canonical receipt', async () => {
  const fixture = forwarderFixture();
  const fakeRpc = (logs, receipt = fixture.receipt, block = fixture.block) => async calls => calls[0].method === 'eth_getLogs' ? [logs] : [receipt, block];
  await assert.rejects(resolveCreationTransactions({ ...fixture.input, configurationHash: `0x${'00'.repeat(32)}` }, async () => assert.fail('Unexpected RPC')), /factory configuration/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([])), /exactly one/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([fixture.creationLog, fixture.creationLog])), /exactly one/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([{ ...fixture.creationLog, address: zeroAddress }])), /factory range/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([{ ...fixture.creationLog, blockNumber: '0x31' }])), /factory range/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([{ ...fixture.creationLog, blockNumber: '0x64', logIndex: '0xa' }])), /precede/);
  const wrongConfiguration = { ...fixture.creationLog, data: encodeAbiParameters(parseAbiParameters('bytes32,address'), [fixture.input.configurationHash, zeroAddress]) };
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([wrongConfiguration])), /event configuration/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([fixture.creationLog], { ...fixture.receipt, status: '0x0' })), /receipt differs/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([fixture.creationLog], { ...fixture.receipt, transactionHash: fixture.input.launchLog.transactionHash })), /receipt differs/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([fixture.creationLog], { ...fixture.receipt, logs: [] })), /receipt differs/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([fixture.creationLog], fixture.receipt, { ...fixture.block, hash: fixture.input.launchLog.blockHash })), /no longer canonical/);
});
