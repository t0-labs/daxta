const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');

function buildSpecIn(hits) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'daxta-spec-'));
  const previous = process.cwd();
  process.chdir(cwd);
  try {
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
  }
}

const TITLE = 'Onboard Tr Merchant API - POST /v1/solution-partner/merchants/tr/onboarding-info';
const testName = `${TITLE} POSITIVE CASES new merchant is created (corporate)`;

const hit = (method, hitPath) => ({
  method,
  path: hitPath,
  status: 201,
  reqBody: { a: 1 },
  resBody: { ok: true },
  test: testName,
});

test('documents only the endpoint named in the test title', () => {
  const spec = buildSpecIn([
    hit('post', '/v1/solution-partner/merchants/tr/onboarding-info'),
    hit('post', '/v1/me/checkout/init'),
    hit('post', '/v1/me/merchant/onboarding-info'),
  ]);
  assert.deepStrictEqual(Object.keys(spec.paths), ['/v1/solution-partner/merchants/{merchantId}/onboarding-info']);
});

test('keeps the endpoint when the recorded path carries a global prefix', () => {
  const spec = buildSpecIn([hit('post', '/api/v1/solution-partner/merchants/tr/onboarding-info')]);
  assert.deepStrictEqual(Object.keys(spec.paths), ['/api/v1/solution-partner/merchants/{merchantId}/onboarding-info']);
});

test('reads the path from a "<path> [METHOD] (qualifier)" title', () => {
  const title = '/v1/solution-partner/merchants/tr/onboarding-info [POST] (solution partner)';
  const named = (name, hitPath, status) => ({
    method: 'post',
    path: hitPath,
    status,
    reqBody: { a: 1 },
    resBody: { ok: true },
    test: name,
  });
  const positive = `${title} POSITIVE CASES should return inserted merchant id when new individual company is onboarded`;
  const falsePositive = `${title} FALSE POSITIVE CASES should return fiscal id merchant mismatch when a tbs terminal is registered to another merchant`;

  const spec = buildSpecIn([
    named(positive, '/v1/me/merchant/onboarding-info', 201),
    named(positive, '/v1/solution-partner/merchants/tr/onboarding-info', 201),
    named(falsePositive, '/v1/me/checkout/init', 201),
    named(falsePositive, '/v1/solution-partner/merchants/tr/onboarding-info', 422),
  ]);
  const subject = '/v1/solution-partner/merchants/tr/onboarding-info';
  assert.deepStrictEqual(Object.keys(spec.paths), [subject]);

  const groups = spec.paths[subject].post['x-scenarios'].map((scenario) => scenario.group);
  assert.deepStrictEqual([...new Set(groups)].sort(), ['POSITIVE CASES', 'SEMANTIC ERROR CASES']);
});

test('infers the endpoint under test when the title carries no path', () => {
  // Mirrors a suite whose describe is "<TEST_TITLE> POSITIVE CASES" etc.: every case ends
  // with the Act call to the subject route, arrange helpers hit other endpoints first.
  const subject = '/v1/solution-partner/merchants/tr/onboarding-info';
  const act = (name, status) => ({
    method: 'post',
    path: subject,
    status,
    reqBody: { a: 1 },
    resBody: { ok: true },
    test: name,
  });
  const arrange = (name, hitPath) => ({
    method: 'post',
    path: hitPath,
    status: 201,
    reqBody: {},
    resBody: {},
    test: name,
  });

  const positive = 'Onboard Tr Merchant API POSITIVE CASES new individual company is onboarded';
  const positiveTwo = 'Onboard Tr Merchant API POSITIVE CASES all dependencies are present for existing energy merchant';
  const falsePositive = 'Onboard Tr Merchant API FALSE POSITIVE CASES a tbs terminal is registered to another merchant';

  const spec = buildSpecIn([
    arrange(positive, '/v1/me/merchant/onboarding-info'),
    act(positive, 201),
    arrange(positiveTwo, '/v1/me/merchant/onboarding-info'),
    act(positiveTwo, 201),
    arrange(falsePositive, '/v1/me/checkout/init'),
    act(falsePositive, 422),
  ]);
  assert.deepStrictEqual(Object.keys(spec.paths), ['/v1/solution-partner/merchants/{merchantId}/onboarding-info']);
});

test('treats :id and {id} params as the same route', () => {
  const name = 'Update Merchant API - PATCH /v1/merchants/:id POSITIVE CASES merchant is updated';
  const spec = buildSpecIn([
    { ...hit('patch', '/v1/merchants/{id}'), status: 200, test: name },
    { ...hit('patch', '/v1/other/{id}'), status: 200, test: name },
  ]);
  assert.deepStrictEqual(Object.keys(spec.paths), ['/v1/merchants/{merchantId}']);
});
