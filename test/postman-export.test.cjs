'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPostmanCollection, buildPostmanEnvironment } = require('../dist/export/postman');

describe('postman export', () => {
  it('builds Postman Collection v2.1 with nested folders and named examples', () => {
    const spec = {
      info: { title: 'Test API', version: '1.0.0', description: 'API from tests' },
      servers: [{ url: 'http://localhost:3000' }],
      paths: {
        '/v1/users/{userId}': {
          post: {
            summary: 'Update User',
            security: [{ bearerAuth: [] }],
            'x-tree-segments': ['v1', 'users'],
            'x-scenarios': [
              {
                name: '200 — valid payload',
                status: 200,
                pathParams: { userId: 'usr_123' },
                query: { expand: 'profile' },
                headers: { 'x-tenant': 'tr' },
                reqBody: { name: 'Ada' },
                resBody: { id: 'usr_123', name: 'Ada' },
              },
              {
                name: '400 — invalid email',
                status: 400,
                pathParams: { userId: 'usr_123' },
                reqBody: { name: '' },
                resBody: { message: 'email must be valid' },
              },
            ],
          },
        },
      },
    };

    const { collection, operations, examples } = buildPostmanCollection(spec);
    assert.equal(operations, 1);
    assert.equal(examples, 2);
    assert.equal(collection.info.name, 'Test API');
    assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');

    const v1Folder = collection.item[0];
    assert.equal(v1Folder.name, 'v1');
    const usersFolder = v1Folder.item[0];
    assert.equal(usersFolder.name, 'users');
    const reqItem = usersFolder.item[0];
    assert.equal(reqItem.name, 'Update User');
    assert.equal(reqItem.request.method, 'POST');
    assert.deepEqual(reqItem.request.url.path, ['v1', 'users', ':userId']);
    assert.deepEqual(reqItem.request.url.variable, [{ key: 'userId', value: 'usr_123' }]);
    assert.deepEqual(reqItem.request.url.query, [{ key: 'expand', value: 'profile' }]);
    assert.ok(reqItem.request.header.some((h) => h.key === 'Authorization' && h.value === 'Bearer {{authToken}}'));
    assert.equal(reqItem.response.length, 2);
    assert.equal(reqItem.response[0].name, '200 — valid payload');
    assert.equal(reqItem.response[0].code, 200);
    assert.equal(reqItem.response[1].name, '400 — invalid email');
    assert.equal(reqItem.response[1].code, 400);
  });

  it('builds Postman Environment from default config', () => {
    const env = buildPostmanEnvironment();
    assert.equal(env._postman_variable_scope, 'environment');
    assert.ok(env.values.some((v) => v.key === 'baseUrl'));
  });

  it('maps header values using headerVariables and includes them in environment', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daxta-hvars-'));
    const prev = process.cwd();
    process.chdir(tmp);
    try {
      fs.writeFileSync(
        path.join(tmp, 'daxta.config.ts'),
        `export default {\n  headerVariables: { 'x-user-id': '{{X_USER_ID}}' },\n};\n`,
      );
      const { resetConfig, getConfig } = require('../dist/config.js');
      resetConfig();
      getConfig(true);

      const spec = {
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/v1/me': {
            get: {
              summary: 'Get Me',
              'x-scenarios': [{ name: '200 — ok', status: 200, headers: { 'x-user-id': 'u_42' } }],
            },
          },
        },
      };
      const { collection } = buildPostmanCollection(spec);
      const req = collection.item[0].item[0].item[0].request;
      assert.ok(req.header.some((h) => h.key === 'x-user-id' && h.value === '{{X_USER_ID}}'));

      const env = buildPostmanEnvironment();
      assert.ok(env.values.some((v) => v.key === 'X_USER_ID'));
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
