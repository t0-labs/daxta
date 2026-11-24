const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const { apiDocsHandler, docsEnabled } = require(path.join(__dirname, '..', 'dist/serve/middleware.js'));
const { resolveConfig, serversFromEnvPresets } = require(path.join(__dirname, '..', 'dist/config.js'));

function withNodeEnv(value, run) {
  const previous = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

test('docs are served on the known working envs', () => {
  for (const nodeEnv of ['dev', 'development', 'test', 'sta', 'staging', 'DEVELOPMENT', ' staging ']) {
    assert.strictEqual(withNodeEnv(nodeEnv, docsEnabled), true, `NODE_ENV=${nodeEnv}`);
  }
});

test('production keeps the docs closed', () => {
  for (const nodeEnv of ['production', 'PRODUCTION', ' production ', 'prod']) {
    assert.strictEqual(withNodeEnv(nodeEnv, docsEnabled), false, `NODE_ENV=${nodeEnv}`);
  }
});

test('an unset or unknown NODE_ENV keeps the docs closed', () => {
  for (const nodeEnv of [undefined, '', '  ', 'local', 'qa', 'preprod', 'whatever']) {
    assert.strictEqual(withNodeEnv(nodeEnv, docsEnabled), false, `NODE_ENV=${nodeEnv}`);
  }
});

test('default config does not hardcode localhost:3000 and uses relative server "/"', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daxta-cfg-'));
  try {
    const cfg = resolveConfig(tmpDir);
    assert.strictEqual(cfg.baseUrl, '');
    assert.deepStrictEqual(cfg.envPresets, {});
    assert.deepStrictEqual(serversFromEnvPresets(cfg.envPresets, cfg.baseUrl), [{ url: '/' }]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('apiDocsHandler disables /__proxy by default and keeps /docs/env.json read-only', async () => {
  const handler = apiDocsHandler({ basePath: '/docs' });
  let nextCalled = false;
  await handler(
    { method: 'GET', url: '/__proxy?target=http://127.0.0.1:9999', headers: {} },
    { setHeader() {}, end() {} },
    () => {
      nextCalled = true;
    },
  );
  assert.strictEqual(nextCalled, true, '/__proxy should fall through to next() when enableProxy is not true');

  for (const method of ['PUT', 'POST']) {
    let envWriteNext = false;
    await handler(
      { method, url: '/docs/env.json', headers: {}, body: { envs: { dev: { variables: [] } } } },
      { setHeader() {}, end() {} },
      () => {
        envWriteNext = true;
      },
    );
    assert.strictEqual(envWriteNext, true, `${method} /docs/env.json should not be handled (env edits stay browser-only)`);
  }
});

test('viewer.html inline scripts compile without syntax errors', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'assets', 'viewer.html'), 'utf8').replace('__SPEC_JSON__', '{}');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, code] of scripts) {
    new vm.Script(code);
  }
});
