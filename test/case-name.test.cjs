const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');

const { caseName, caseGroup } = require(path.join(__dirname, '..', 'dist/catalog/index.js'));

const TITLE = 'Onboard Tr Merchant API - POST /v1/solution-partner/merchants/tr/onboarding-info';

test('drops the describe qualifier and case section from the example label', () => {
  const name = `${TITLE} (solution partner) INVALID CASES location.street - should not be empty`;
  assert.strictEqual(caseName(name), 'location.street - should not be empty');
  assert.strictEqual(caseGroup(name), 'INVALID CASES');
});

test('drops the case section when there is no qualifier', () => {
  const name = `${TITLE} OMITTED CASES authorizedPerson.phone - should not be omitted`;
  assert.strictEqual(caseName(name), 'authorizedPerson.phone - should not be omitted');
  assert.strictEqual(caseGroup(name), 'OMITTED CASES');
});

test('keeps a trailing parenthetical that is part of the case text', () => {
  const name = `${TITLE} POSITIVE CASES new merchant is created (corporate)`;
  assert.strictEqual(caseName(name), 'new merchant is created (corporate)');
});
