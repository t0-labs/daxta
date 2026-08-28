const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');

const { docsEnabled } = require(path.join(__dirname, '..', 'dist/serve/middleware.js'));

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
