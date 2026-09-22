import { build, version } from 'esbuild';
import { readFile, mkdir, writeFile, link, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPOSITORY_ROOT } from './build.mjs';
import { need, sha256 } from './core.mjs';
import { moduleEngineSdkBundle } from '../module-engine/sdk-bundle.mjs';
let loaded;
/** Same locked esbuild and content-addressed cache as shared.mjs; never loads contributor JavaScript. */
export async function launchSourceWire() {
  if (loaded) return loaded;
  const lock = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'package-lock.json'), 'utf8'));
  need(lock.packages['node_modules/esbuild'].version === version, 'Source validator compiler differs from package-lock');
  const result = await build({ ...moduleEngineSdkBundle(), absWorkingDir: REPOSITORY_ROOT, entryPoints: ['contracts/scripts/module-mode/launch-source-shared.ts'], write: false,
    bundle: true, platform: 'node', target: 'node24', format: 'esm', packages: 'external', treeShaking: true, sourcemap: false,
    tsconfig: path.join(REPOSITORY_ROOT, 'tsconfig.json'), logLevel: 'silent' });
  const output = result.outputFiles[0].contents, directory = path.join(REPOSITORY_ROOT, 'contracts/out/module-mode-deployment/shared');
  await mkdir(directory, { recursive: true }); const file = path.join(directory, `${sha256(output)}.mjs`);
  // Publish only a complete file. Concurrent test workers must never observe a partially written
  // cache entry; an existing entry still has to match its content-addressed digest exactly.
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, output, { flag: 'wx', mode: 0o600 });
    try { await link(temporary, file); }
    catch (error) { if (error.code !== 'EEXIST') throw error; need(sha256(await readFile(file)) === sha256(output), 'Source validator cache differs'); }
  } finally { await rm(temporary, { force: true }); }
  loaded = await import(pathToFileURL(file).href); return loaded;
}
