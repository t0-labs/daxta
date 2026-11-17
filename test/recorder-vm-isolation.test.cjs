const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');

test('separate suites in the same Jest worker process do not overwrite each other on flush', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'daxta-vm-'));
  const previous = process.cwd();
  const prevWorker = process.env.JEST_WORKER_ID;
  process.chdir(cwd);
  process.env.JEST_WORKER_ID = '1';

  const recorderPath = path.join(root, 'dist/recorder/index.js');

  try {
    const { resetConfig, getConfig } = require(path.join(root, 'dist/config.js'));
    resetConfig();
    getConfig(true);

    const { startRun, clearRunMarker } = require(recorderPath);
    startRun();

    // Suite 1 (fresh VM context)
    delete globalThis.__DAXTA_HITS__;
    delete globalThis.__DAXTA_SUITE_SEQ__;
    delete require.cache[recorderPath];
    const rec1 = require(recorderPath);
    rec1.getHits().push({
      method: 'get',
      path: '/v1/me/branches',
      status: 200,
      reqBody: undefined,
      resBody: { ok: true },
      test: 'Branches V1 - GET /v1/me/branches POSITIVE CASES returns v1',
    });
    rec1.flush();

    // Suite 2 in the SAME worker process (fresh VM context)
    delete globalThis.__DAXTA_HITS__;
    delete globalThis.__DAXTA_SUITE_SEQ__;
    delete require.cache[recorderPath];
    const rec2 = require(recorderPath);
    rec2.getHits().push({
      method: 'get',
      path: '/v2/me/branches',
      status: 200,
      reqBody: undefined,
      resBody: { ok: true },
      test: 'Branches V2 - GET /v2/me/branches POSITIVE CASES returns v2',
    });
    rec2.flush();

    const { loadHits } = require(path.join(root, 'dist/build/build-spec.js'));
    const loaded = loadHits();
    clearRunMarker();

    const paths = loaded.map((h) => h.path).sort();
    assert.deepStrictEqual(paths, ['/v1/me/branches', '/v2/me/branches']);
  } finally {
    delete globalThis.__DAXTA_HITS__;
    delete globalThis.__DAXTA_SUITE_SEQ__;
    delete require.cache[recorderPath];
    if (prevWorker === undefined) delete process.env.JEST_WORKER_ID;
    else process.env.JEST_WORKER_ID = prevWorker;
    process.chdir(previous);
    fs.rmSync(cwd, { recursive: true, force: true });
    try {
      require(path.join(root, 'dist/config.js')).resetConfig();
    } catch {
      // ignore
    }
  }
});
