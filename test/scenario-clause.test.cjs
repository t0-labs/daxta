const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');

const { docsScenarioClause, exampleLabel } = require(path.join(__dirname, '..', 'dist/catalog/index.js'));

test('ideal when-clause keeps only the condition', () => {
  assert.strictEqual(docsScenarioClause('creates mock tbs when cyprus payload shape'), 'cyprus payload shape');
  assert.strictEqual(docsScenarioClause('returns error when hold belongs to another patron'), 'hold belongs to another patron');
  assert.strictEqual(docsScenarioClause('returns copy when id exists'), 'id exists');
});

test('keeps pre-when field context so parametric cases stay unique', () => {
  assert.strictEqual(
    docsScenarioClause('should set TR companyName when value mode is sent'),
    'TR companyName when value mode is sent',
  );
  assert.strictEqual(
    docsScenarioClause('should set TRNC phone when value mode is sent'),
    'TRNC phone when value mode is sent',
  );
  assert.strictEqual(
    docsScenarioClause('should store TR address as null when null mode is sent'),
    'TR address as null when null mode is sent',
  );
});

test('field invalid cases keep property + should-not-be text', () => {
  assert.strictEqual(
    docsScenarioClause('companyName - should not be number'),
    'companyName should not be number',
  );
});

test('status-case labels stay unique for parametric TR/TRNC field modes', () => {
  const base = {
    status: 200,
    method: 'put',
    path: '/v1/admin/mock-tbs/{taxId}',
  };
  const title = '/v1/admin/mock-tbs/:taxId [PUT] (integration) POSITIVE CASES';
  assert.strictEqual(
    exampleLabel({ ...base, test: `${title} should set TR companyName when value mode is sent` }),
    '200 — TR companyName when value mode is sent',
  );
  assert.strictEqual(
    exampleLabel({ ...base, test: `${title} should set TR phone when value mode is sent` }),
    '200 — TR phone when value mode is sent',
  );
  assert.strictEqual(
    exampleLabel({ ...base, test: `${title} should set TRNC companyName when value mode is sent` }),
    '200 — TRNC companyName when value mode is sent',
  );
});
