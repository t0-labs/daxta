#!/usr/bin/env node
/**
 * Sanity check: a partial run must not resurrect endpoints recorded by an earlier run.
 * Simulates two Jest runs by writing worker hit files + run markers directly.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const scratch = path.join(root, '.scratch-run-scope');

fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });
process.chdir(scratch);

const { resetConfig, getConfig } = require(path.join(root, 'dist/config.js'));
const { startRun, clearRunMarker } = require(path.join(root, 'dist/recorder/index.js'));
const { buildDaxtaSpec } = require(path.join(root, 'dist/build/build-spec.js'));

resetConfig();
const outDir = getConfig(true).outDir;
fs.mkdirSync(outDir, { recursive: true });

const hit = (p) => ({
  method: 'post',
  path: p,
  status: 201,
  reqBody: { a: 1 },
  resBody: { ok: true },
  test: `${p} > POSITIVE CASES > creates thing when payload is valid`,
});

function run(runId, hits) {
  startRun();
  const marker = JSON.parse(fs.readFileSync(path.join(outDir, 'run.json'), 'utf8'));
  fs.writeFileSync(path.join(outDir, `hits-r${marker.runId}-w1-p${runId}.json`), JSON.stringify(hits));
  const result = buildDaxtaSpec({ silent: true, html: false });
  clearRunMarker();
  const spec = JSON.parse(fs.readFileSync(path.join(outDir, 'openapi.json'), 'utf8'));
  return { result, paths: Object.keys(spec.paths) };
}

const first = run(101, [hit('/v1/orders'), hit('/v1/baskets')]);
assert.deepStrictEqual(first.paths.sort(), ['/v1/baskets', '/v1/orders']);

const second = run(202, [hit('/v1/orders')]);
assert.deepStrictEqual(second.paths, ['/v1/orders'], `partial run leaked: ${second.paths.join(', ')}`);

// A stale worker file from an older run must be ignored by the next run.
fs.writeFileSync(path.join(outDir, 'hits-rstale-w1-p999.json'), JSON.stringify([hit('/v1/ghost')]));
const third = run(303, [hit('/v1/orders')]);
assert.deepStrictEqual(third.paths, ['/v1/orders'], `stale run leaked: ${third.paths.join(', ')}`);

process.chdir(root);
fs.rmSync(scratch, { recursive: true, force: true });
console.log('run scoping ok — partial runs no longer carry stale endpoints');
