const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');

function buildSpecIn(hits, config = '') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'daxta-tree-'));
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    if (config) fs.writeFileSync(path.join(cwd, 'daxta.config.ts'), config);
    const { resetConfig, getConfig } = require(path.join(root, 'dist/config.js'));
    const { startRun, clearRunMarker } = require(path.join(root, 'dist/recorder/index.js'));
    const { buildDaxtaSpec } = require(path.join(root, 'dist/build/build-spec.js'));
    resetConfig();
    const outDir = getConfig(true).outDir;
    fs.mkdirSync(outDir, { recursive: true });
    startRun();
    const { runId } = JSON.parse(fs.readFileSync(path.join(outDir, 'run.json'), 'utf8'));
    fs.writeFileSync(path.join(outDir, `hits-r${runId}-w1-p1.json`), JSON.stringify(hits));
    buildDaxtaSpec({ silent: true, html: false });
    clearRunMarker();
    return JSON.parse(fs.readFileSync(path.join(outDir, 'openapi.json'), 'utf8'));
  } finally {
    process.chdir(previous);
    fs.rmSync(cwd, { recursive: true, force: true });
    resetConfigQuietly();
  }
}

function resetConfigQuietly() {
  try {
    require(path.join(root, 'dist/config.js')).resetConfig();
  } catch {
    // ignore
  }
}

const hit = (method, hitPath, title) => ({
  method,
  path: hitPath,
  status: 200,
  reqBody: { a: 1 },
  resBody: { ok: true },
  test: `${title} POSITIVE CASES returns data when called`,
});

const segmentsOf = (spec, urlPath, method) => spec.paths[urlPath][method]['x-tree-segments'];

test('folds a leaf folder that holds a single operation', () => {
  const spec = buildSpecIn([
    hit('post', '/v1/integrator/onboarding-info', 'Onboard Merchant - POST /v1/integrator/onboarding-info'),
  ]);
  const [urlPath] = Object.keys(spec.paths);
  assert.strictEqual(urlPath, '/v1/integrator/onboarding-info');
  assert.deepStrictEqual(segmentsOf(spec, urlPath, 'post'), ['v1', 'integrator']);
});

test('leaves a param-folded folder alone', () => {
  const spec = buildSpecIn([
    hit('post', '/v1/baskets/17/lock', 'Lock Basket - POST /v1/baskets/{id}/lock'),
  ]);
  const [urlPath] = Object.keys(spec.paths);
  assert.deepStrictEqual(segmentsOf(spec, urlPath, 'post'), ['v1', 'baskets']);
});

test('keeps the folder when several operations live under it', () => {
  const spec = buildSpecIn([
    hit('get', '/v1/external-checkouts', 'List External Checkouts - GET /v1/external-checkouts'),
    hit('post', '/v1/external-checkouts', 'Create External Checkout - POST /v1/external-checkouts'),
  ]);
  assert.deepStrictEqual(segmentsOf(spec, '/v1/external-checkouts', 'get'), ['v1', 'external-checkouts']);
  assert.deepStrictEqual(segmentsOf(spec, '/v1/external-checkouts', 'post'), ['v1', 'external-checkouts']);
});

test('keeps the folder when it has subfolders', () => {
  const spec = buildSpecIn([
    hit('get', '/v1/integrator/status', 'Integrator Status - GET /v1/integrator/status'),
    hit('post', '/v1/integrator/status/retry', 'Retry Integrator Status - POST /v1/integrator/status/retry'),
  ]);
  assert.deepStrictEqual(segmentsOf(spec, '/v1/integrator/status', 'get'), ['v1', 'integrator', 'status']);
  assert.deepStrictEqual(segmentsOf(spec, '/v1/integrator/status/retry', 'post'), ['v1', 'integrator', 'status']);
});

test('folds one level only', () => {
  const spec = buildSpecIn([
    hit('post', '/v1/a/b/c', 'Deep Op - POST /v1/a/b/c'),
  ]);
  assert.deepStrictEqual(segmentsOf(spec, '/v1/a/b/c', 'post'), ['v1', 'a', 'b']);
});

test('treeCollapseSingle: false keeps every segment as a folder', () => {
  const spec = buildSpecIn(
    [hit('post', '/v1/integrator/onboarding-info', 'Onboard Merchant - POST /v1/integrator/onboarding-info')],
    'export default { treeCollapseSingle: false };\n',
  );
  assert.deepStrictEqual(segmentsOf(spec, '/v1/integrator/onboarding-info', 'post'), [
    'v1',
    'integrator',
    'onboarding-info',
  ]);
});
