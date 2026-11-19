'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { templateFromTestName } = require('../dist/path.util');
const { parseOperationLabel, docsScenarioClause } = require('../dist/catalog');

describe('title and template parsing', () => {
  it('parses Title — METHOD /path format', () => {
    assert.deepEqual(parseOperationLabel('Create Mock Tbs — POST /v1/admin/mock-tbs'), {
      title: 'Create Mock Tbs',
      path: '/v1/admin/mock-tbs',
      method: 'POST',
      integration: false,
    });
  });

  it('parses reversed METHOD /path — Title format', () => {
    assert.deepEqual(parseOperationLabel('POST /v1/users — Create User'), {
      title: 'Create User',
      path: '/v1/users',
      method: 'POST',
      integration: false,
    });
  });

  it('extracts path template from bracket format', () => {
    assert.equal(templateFromTestName('/v1/orders/:orderId [DELETE]'), '/v1/orders/{orderId}');
  });

  it('extracts scenario clauses from with and if patterns', () => {
    assert.equal(docsScenarioClause('creates user with valid payload'), 'valid payload');
    assert.equal(docsScenarioClause('returns error if token is expired'), 'token is expired');
  });

  it('parses paths without a leading slash and normalizes them', () => {
    assert.deepEqual(parseOperationLabel('v1/external/checkout/complete [POST] (integration)'), {
      title: undefined,
      path: '/v1/external/checkout/complete',
      method: 'POST',
      integration: true,
    });
    assert.deepEqual(parseOperationLabel('Complete Checkout — POST v1/external/checkout/complete'), {
      title: 'Complete Checkout',
      path: '/v1/external/checkout/complete',
      method: 'POST',
      integration: false,
    });
  });
});
