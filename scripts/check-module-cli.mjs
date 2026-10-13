import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';
import { assertModuleCliSourceClean, buildModuleCli, MODULE_CLI_RELEASE_ROOT } from './build-module-cli.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const need = (condition, reason) => { if (!condition) throw new Error(reason); };

// Check compatibility with a published immutable CLI. Its historical full-lock
// digest stays intact; unrelated website dependencies do not create a CLI release.
export async function verifyPublishedModuleCli(root = process.cwd()) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  need(major === 24 && minor >= 14, "Use Node.js >=24.14.0 <25");
  assertModuleCliSourceClean(root);
  const read = async relative => {
    need(!path.isAbsolute(relative) && !relative.split('/').includes('..'), 'Invalid source path');
    const file = path.join(root, relative), stat = await lstat(file);
    need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 * 1024, 'Invalid source file');
    return readFile(file);
  };
  const metadata = JSON.parse(await read('packages/classic-modules/package.json'));
  need(/^[\d.]+(?:-[\w.-]+)?$/.test(metadata.version), 'Invalid CLI version');
  const directory = `${MODULE_CLI_RELEASE_ROOT}/v${metadata.version}`;
  const manifest = JSON.parse(await read(`${directory}/manifest.json`));
  need(manifest.version === metadata.version && manifest.source.builder.esbuild === esbuildVersion, 'CLI compiler changed');
  const source = Object.fromEntries(['format', 'packageVersion', 'entryPoint', 'builder', 'files'].map(key => [key, manifest.source[key]]));
  need(hash(Buffer.from(`${JSON.stringify(canonical(source), null, 2)}\n`)) === manifest.source.digest, 'CLI source digest changed');
  const lock = JSON.parse(await read('package-lock.json'));
  need(lock.packages?.['node_modules/esbuild']?.version === esbuildVersion, 'CLI compiler lock changed');
  for (const dependency of manifest.dependencies) {
    const installed = lock.packages?.[dependency.lockPath];
    need(installed?.version === dependency.version && installed?.integrity === dependency.integrity, 'CLI dependency changed');
  }
  for (const file of manifest.source.files) {
    if (file.path === 'package-lock.json') continue;
    const bytes = await read(file.path);
    need(bytes.length === file.bytes && hash(bytes) === file.sha256, `CLI input changed: ${file.path}`);
  }
  for (const entry of [manifest.artifact, manifest.licenses]) {
    const bytes = await read(`${directory}/${entry.file}`);
    need(bytes.length === entry.bytes && hash(bytes) === entry.sha256, 'CLI published bytes changed');
  }
  const sums = await read(`${directory}/SHA256SUMS`);
  need(sums.toString() === `${manifest.artifact.sha256}  ${manifest.artifact.file}\n${manifest.licenses.sha256}  LICENSES.txt\n`, 'CLI checksums changed');
  const banner = [
    `// Programmable Module Mode CLI ${metadata.version}; source sha256:${manifest.source.digest}.`,
    "import { createRequire as moduleCliCreateRequire } from 'node:module';",
    'const require = moduleCliCreateRequire(import.meta.url);',
    "if (Number(process.versions.node.split('.')[0]) !== 24 || Number(process.versions.node.split('.')[1]) < 14) { process.stderr.write('Use Node.js >=24.14.0 <25.\\n'); process.exit(1); }",
    `if (process.argv.length === 3 && process.argv[2] === '--version') { process.stdout.write(${JSON.stringify(`${metadata.version}\n`)}); process.exit(0); }`,
  ].join('\n');
  const rebuilt = await build({ ...manifest.source.builder.options, absWorkingDir: root,
    entryPoints: [manifest.source.entryPoint], outfile: manifest.artifact.file,
    write: false, metafile: true, logLevel: 'silent', banner: { js: banner } });
  need(rebuilt.outputFiles.length === 1 && hash(rebuilt.outputFiles[0].contents) === manifest.artifact.sha256, 'CLI executable changed');
  return { ok: true, mode: 'published-compatible', version: metadata.version, sha256: manifest.artifact.sha256 };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    let result;
    try { result = await verifyPublishedModuleCli(); }
    catch { result = await buildModuleCli({ root: process.cwd() }); }
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.code ?? error.message); process.exitCode = 1; }
}
