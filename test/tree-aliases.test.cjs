'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

describe('treeResourceAliases and treeSubResourceMode', () => {
  it('merges nested resource segments into a single folder before applying layout', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daxta-alias-'));
    const prev = process.cwd();
    process.chdir(tmp);
    try {
      fs.writeFileSync(
        path.join(tmp, 'daxta.config.ts'),
        `export default {\n  treeLayout: 'resource-role',\n  treeSkipParams: true,\n  treeResourceAliases: { 'shopping-cart/items': 'shopping-cart-items' },\n};\n`,
      );
      const { resetConfig, getConfig } = require('../dist/config.js');
      const { treePathSegments } = require('../dist/catalog/index.js');
      resetConfig();
      getConfig(true);
      assert.deepEqual(
        treePathSegments('/v1/public/shopping-cart/items/{itemId}/quantity'),
        ['v1', 'shopping-cart-items', 'public'],
      );
      assert.deepEqual(
        treePathSegments('/v1/me/shopping-cart/items'),
        ['v1', 'shopping-cart-items', 'me'],
      );
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('supports treeSubResourceMode merge and root globally', () => {
    const tmpMerge = fs.mkdtempSync(path.join(os.tmpdir(), 'daxta-submerge-'));
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daxta-subroot-'));
    const prev = process.cwd();
    try {
      const { resetConfig, getConfig } = require('../dist/config.js');
      const { treePathSegments } = require('../dist/catalog/index.js');

      process.chdir(tmpMerge);
      fs.writeFileSync(
        path.join(tmpMerge, 'daxta.config.ts'),
        `export default {\n  treeLayout: 'resource-role',\n  treeSkipParams: true,\n  treeSubResourceMode: 'merge',\n};\n`,
      );
      resetConfig();
      getConfig(true);
      assert.deepEqual(
        treePathSegments('/v1/public/shopping-cart/items/{itemId}/quantity'),
        ['v1', 'shopping-cart-items', 'public'],
      );

      process.chdir(tmpRoot);
      fs.writeFileSync(
        path.join(tmpRoot, 'daxta.config.ts'),
        `export default {\n  treeLayout: 'resource-role',\n  treeSkipParams: true,\n  treeSubResourceMode: 'root',\n};\n`,
      );
      resetConfig();
      getConfig(true);
      assert.deepEqual(
        treePathSegments('/v1/public/shopping-cart/items/{itemId}/quantity'),
        ['v1', 'shopping-cart', 'public'],
      );
    } finally {
      process.chdir(prev);
      fs.rmSync(tmpMerge, { recursive: true, force: true });
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('stops folders at Nest @Controller(...) prefix when treeSubResourceMode is controller', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daxta-ctrl-'));
    const prev = process.cwd();
    process.chdir(tmp);
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'src', 'auth.controller.ts'),
        `import { Controller, Post } from '@nestjs/common';\n@Controller('public/solution-partner-identity')\nexport class AuthController {\n  @Post('auth/phone/verify-otp')\n  verifyOtp() {}\n}\n`,
      );
      fs.writeFileSync(
        path.join(tmp, 'daxta.config.ts'),
        `export default {\n  controllersRoot: 'src',\n  treeLayout: 'resource-role',\n  treeSkipParams: true,\n  treeSubResourceMode: 'controller',\n};\n`,
      );
      const { resetConfig, getConfig } = require('../dist/config.js');
      const { treePathSegments } = require('../dist/catalog/index.js');
      resetConfig();
      getConfig(true);
      assert.deepEqual(
        treePathSegments('/v1/public/solution-partner-identity/auth/phone/verify-otp'),
        ['v1', 'solution-partner-identity', 'public'],
      );
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
