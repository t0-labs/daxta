import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { getConfig, resetConfig } from '../config';
import { isDaxtaWrappedScript, resolveTestScript } from './discover-test';
import { c } from './ui';

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  packageManager?: string;
};

function readPkg(cwd: string): PackageJson {
  return JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')) as PackageJson;
}

function detectPackageManager(cwd: string, pkg: PackageJson): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml')) || pkg.packageManager?.startsWith('pnpm')) return 'pnpm';
  if (existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Thin convenience: runs the project's own test script via the package manager.
 * Does NOT wrap Jest — DAxTA must already be attached as a Jest plugin (install/migrate).
 */
export async function runDaxtaTest(options: { cwd?: string; argv?: string[] } = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const pkg = readPkg(cwd);
  const pm = detectPackageManager(cwd, pkg);

  resetConfig();
  const config = getConfig(true);

  const passthrough: string[] = [];
  let yes = false;
  let scriptFlag: string | undefined;
  for (let i = 0; i < (options.argv ?? []).length; i += 1) {
    const token = (options.argv ?? [])[i];
    if (token === '--yes' || token === '-y') yes = true;
    else if (token === '--script') scriptFlag = (options.argv ?? [])[++i];
    else if (token === '--') passthrough.push(...(options.argv ?? []).slice(i + 1));
    else passthrough.push(token);
  }

  const scriptName = await resolveTestScript({
    cwd,
    scripts: pkg.scripts,
    configured: config.testScript,
    yes,
    flag: scriptFlag,
  });

  if (!scriptName || !pkg.scripts?.[scriptName]) {
    console.log(
      `${c.yellow('!')} No test script configured. Run ${c.cyan('daxta install')} to attach the Jest plugin.`,
    );
    process.exitCode = 1;
    return;
  }

  if (isDaxtaWrappedScript(pkg.scripts[scriptName])) {
    console.log(
      `${c.yellow('!')} ${scriptName} still wraps ${c.bold('daxta test')}. Run ${c.cyan('daxta migrate')} to unwrap and attach as a Jest plugin.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `${c.dim('DAxTA')} forwarding to ${c.cyan(`${pm} run ${scriptName}`)} ${c.dim('(Jest stays parent)')}`,
  );

  const args = pm === 'npm' ? ['run', scriptName, '--', ...passthrough] : ['run', scriptName, ...passthrough];
  const result = spawnSync(pm, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.status && result.status !== 0) process.exit(result.status);
  if (result.error) throw result.error;
}
