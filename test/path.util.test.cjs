'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toOpenApiTemplate, heuristicTemplatize, pathMatchesTemplate } = require('../dist/path.util');

describe('path.util', () => {
  it('converts Express params to OpenAPI templates', () => {
    assert.equal(toOpenApiTemplate('/v1/users/:id'), '/v1/users/{id}');
  });

  it('templatizes numeric ids after a collection', () => {
    assert.equal(heuristicTemplatize('/v1/users/42'), '/v1/users/{userId}');
  });

  it('matches concrete paths against templates', () => {
    assert.equal(pathMatchesTemplate('/v1/users/{id}', '/v1/users/42'), true);
    assert.equal(pathMatchesTemplate('/v1/users/{id}', '/v1/orders/42'), false);
  });
});
