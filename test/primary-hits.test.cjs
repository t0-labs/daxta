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

test('exports one example per Jest case when a case calls its endpoint twice', () => {
  const subject = '/v1/admin/subscription-transfers/product';
  const title = `${subject} [POST] (admin)`;
  const firstCase = `${title} POSITIVE CASES preserve the third subscription when two subscriptions are transferred`;
  const secondCase = `${title} POSITIVE CASES complete consecutive transfers to different products`;
  const thirdCase = `${title} POSITIVE CASES complete a single transfer`;
  const transfer = (name, source, target) => ({
    method: 'post',
    path: subject,
    status: 200,
    reqBody: { subscriptionId: source, targetProductId: target },
    resBody: { data: { subscriptionId: target } },
    test: name,
  });

  const spec = buildSpecIn([
    transfer(firstCase, 'source-1', 'target-1'),
    transfer(firstCase, 'source-2', 'target-1'),
    transfer(secondCase, 'source-3', 'target-2'),
    transfer(secondCase, 'target-2', 'target-3'),
    transfer(thirdCase, 'source-4', 'target-4'),
  ]);
  const operation = spec.paths[subject].post;
  const scenarios = operation['x-scenarios'];
  const requestExamples = Object.values(operation.requestBody.content['application/json'].examples);
  const responseExamples = Object.values(operation.responses['200'].content['application/json'].examples);

  assert.strictEqual(scenarios.length, 3);
  assert.strictEqual(requestExamples.length, 3);
  assert.strictEqual(responseExamples.length, 3);
  assert.deepStrictEqual(scenarios.map((scenario) => scenario.reqBody.subscriptionId).sort(), ['source-2', 'source-4', 'target-2']);
});

test('isolates untitled suites with identical test names across separate test files', () => {
  const sharedPositive = 'POSITIVE CASES should return items successfully';
  const sharedMissingHeaders = 'SEMANTIC ERROR CASES returns error when headers are missing';

  const spec = buildSpecIn([
    // File A: arrange POST + act GET /v1/me/branches
    {
      method: 'post',
      path: '/v1/me/merchant/onboarding-info',
      status: 201,
      reqBody: { taxId: '1' },
      resBody: {},
      test: sharedPositive,
      testFile: 'test/modules/branch/get-branch.test.ts',
    },
    {
      method: 'get',
      path: '/v1/me/branches',
      status: 200,
      reqBody: undefined,
      resBody: { items: ['branch-1'] },
      test: sharedPositive,
      testFile: 'test/modules/branch/get-branch.test.ts',
    },
    {
      method: 'get',
      path: '/v1/me/branches',
      status: 401,
      reqBody: undefined,
      resBody: { error: 'unauthorized' },
      test: sharedMissingHeaders,
      testFile: 'test/modules/branch/get-branch.test.ts',
    },
    // File B: identical test names, different endpoint GET /v1/me/shopping-cart
    {
      method: 'get',
      path: '/v1/me/shopping-cart',
      status: 200,
      reqBody: undefined,
      resBody: { items: ['cart-1'] },
      test: sharedPositive,
      testFile: 'test/modules/shopping-cart/get-cart.test.ts',
    },
    {
      method: 'get',
      path: '/v1/me/shopping-cart',
      status: 401,
      reqBody: undefined,
      resBody: { error: 'unauthorized' },
      test: sharedMissingHeaders,
      testFile: 'test/modules/shopping-cart/get-cart.test.ts',
    },
  ]);

  assert.deepStrictEqual(Object.keys(spec.paths).sort(), ['/v1/me/branches', '/v1/me/shopping-cart']);
  assert.strictEqual(spec.paths['/v1/me/branches'].get['x-scenarios'].length, 2);
  assert.strictEqual(spec.paths['/v1/me/shopping-cart'].get['x-scenarios'].length, 2);
});

test('drops unexpected 500 crash responses unless the test explicitly expects 5xx', () => {
  const spec = buildSpecIn([
    {
      method: 'post',
      path: '/v1/public/checkouts/{id}/complete',
      pathParams: { id: '6a3fbef3-6590-4f7c-8d50-e156be524f98' },
      status: 500,
      reqBody: { bad: true },
      resBody: { message: 'Internal server error' },
      test: 'INVALID CASES kycInfo.email - should not be uppercase email',
      testFile: 'test/modules/external-checkout/complete.test.ts',
    },
    {
      method: 'post',
      path: '/v1/public/checkouts/{id}/complete',
      pathParams: { id: '6a3fbef3-6590-4f7c-8d50-e156be524f98' },
      status: 200,
      reqBody: { ok: true },
      resBody: { completed: true },
      test: 'POSITIVE CASES completes external checkout',
      testFile: 'test/modules/external-checkout/complete.test.ts',
    },
    {
      method: 'get',
      path: '/v1/admin/health-fail',
      status: 500,
      reqBody: undefined,
      resBody: { message: 'Internal server error' },
      test: 'SEMANTIC ERROR CASES should return 500 internal server error on downstream crash',
      testFile: 'test/modules/health/fail.test.ts',
    },
  ]);

  const completeOp = spec.paths['/v1/public/checkouts/{checkoutId}/complete'].post;
  assert.deepStrictEqual(Object.keys(completeOp.responses), ['200']);
  assert.strictEqual(completeOp['x-scenarios'].length, 1);

  const expected500Op = spec.paths['/v1/admin/health-fail'].get;
  assert.deepStrictEqual(Object.keys(expected500Op.responses), ['500']);
});

test('falls back to suite voting when TEST_TITLE has a typo path that matches no recorded hits', () => {
  const typoTitle = 'Find One Checkout By Id — GET /v1/public/checkout/:id';
  const case1 = `${typoTitle} POSITIVE CASES returns record when initialized`;
  const case2 = `${typoTitle} POSITIVE CASES returns record when completed`;

  const spec = buildSpecIn([
    {
      method: 'post',
      path: '/v1/integrator/checkouts',
      status: 201,
      reqBody: { a: 1 },
      resBody: { id: '1' },
      test: case1,
      testFile: 'test/modules/checkout/find-checkout.test.ts',
    },
    {
      method: 'get',
      path: '/v1/public/checkouts/{id}',
      pathParams: { id: '6a3fbef3-6590-4f7c-8d50-e156be524f98' },
      status: 200,
      reqBody: undefined,
      resBody: { id: '1' },
      test: case1,
      testFile: 'test/modules/checkout/find-checkout.test.ts',
    },
    {
      method: 'post',
      path: '/v1/integrator/checkouts',
      status: 201,
      reqBody: { a: 1 },
      resBody: { id: '2' },
      test: case2,
      testFile: 'test/modules/checkout/find-checkout.test.ts',
    },
    {
      method: 'get',
      path: '/v1/public/checkouts/{id}',
      pathParams: { id: '6a3fbef3-6590-4f7c-8d50-e156be524f98' },
      status: 200,
      reqBody: undefined,
      resBody: { id: '2' },
      test: case2,
      testFile: 'test/modules/checkout/find-checkout.test.ts',
    },
  ]);

  assert.deepStrictEqual(Object.keys(spec.paths), ['/v1/public/checkouts/{checkoutId}']);
  assert.strictEqual(spec.paths['/v1/public/checkouts/{checkoutId}'].get['x-scenarios'].length, 2);
});

test('mergeHitsWithExisting replaces full run, updates single suite, and updates single case', () => {
  const { mergeHitsWithExisting } = require(path.join(root, 'dist/build/build-spec.js'));
  const existing = [
    { method: 'get', path: '/v1/a', status: 200, resBody: { v: 1 }, test: 'POSITIVE CASES a1', testFile: 'a.test.ts' },
    { method: 'get', path: '/v1/a', status: 400, resBody: { v: 1 }, test: 'INVALID CASES a2', testFile: 'a.test.ts' },
    { method: 'get', path: '/v1/b', status: 200, resBody: { v: 1 }, test: 'POSITIVE CASES b1', testFile: 'b.test.ts' },
  ];

  // Full run replaces everything
  const fullOnly = [{ method: 'get', path: '/v1/c', status: 200, resBody: { v: 2 }, test: 'POSITIVE CASES c1', testFile: 'c.test.ts' }];
  assert.deepStrictEqual(
    mergeHitsWithExisting(existing, fullOnly, 'none').map((h) => h.path),
    ['/v1/c'],
  );

  // Suite-filtered run replaces only a.test.ts and preserves b.test.ts
  const suiteUpdate = [{ method: 'get', path: '/v1/a', status: 200, resBody: { v: 2 }, test: 'POSITIVE CASES a1', testFile: 'a.test.ts' }];
  const afterSuite = mergeHitsWithExisting(existing, suiteUpdate, 'suite');
  assert.deepStrictEqual(
    afterSuite.map((h) => `${h.testFile}:${h.resBody.v}`),
    ['b.test.ts:1', 'a.test.ts:2'],
  );

  // Case-filtered (-t) run replaces only the matching case in a.test.ts
  const caseUpdate = [{ method: 'get', path: '/v1/a', status: 200, resBody: { v: 3 }, test: 'POSITIVE CASES a1', testFile: 'a.test.ts' }];
  const afterCase = mergeHitsWithExisting(existing, caseUpdate, 'case');
  assert.deepStrictEqual(
    afterCase.map((h) => `${h.test}:${h.resBody.v}`),
    ['INVALID CASES a2:1', 'POSITIVE CASES b1:1', 'POSITIVE CASES a1:3'],
  );
});

test('does not leak same-method setup calls when title has [METHOD] without a parsed path', () => {
  const testTitle = 'v1/admin/terminals/available-terminals [GET] (integration) should return terminals';
  const testFile = 'find-available-merchant-terminals.integration.test.ts';
  const spec = buildSpecIn([
    { ...hit('get', '/v1/me/shopping-cart/agreements'), test: testTitle, testFile },
    { ...hit('get', '/v1/admin/terminals/available-terminals'), test: testTitle, testFile },
  ]);
  assert.deepStrictEqual(Object.keys(spec.paths), ['/v1/admin/terminals/available-terminals']);
});
