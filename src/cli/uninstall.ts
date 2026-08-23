import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { findDaxtaConfigPath } from './config-edit';
import { findMainCandidates, removeApiDocs } from './inject-main';
import { removeJestHooks, resolveJestConfigPath, unwrapDaxtaTestScript } from './jest-hooks';
import { banner, box, c, readlineAsk, sleep, step } from './ui';

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
};

export type UninstallOptions = {
  cwd?: string;
  dryRun?: boolean;
  yes?: boolean;
  fast?: boolean;
  /** Keep @t0.labs/daxta in package.json (only unwind project wiring) */
  keepDep?: boolean;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function detectPackageManager(cwd: string, pkg: PackageJson): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml')) || pkg.packageManager?.startsWith('pnpm')) return 'pnpm';
  if (existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function readConfigString(configText: string, key: string): string | null {
  const m = configText.match(new RegExp(`${key}\\s*:\\s*['\`"]([^'\`"]+)['\`"]`));
  return m?.[1] ?? null;
}

function stripGitignore(cwd: string, dryRun: boolean): string[] {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) return [];
  const remove = new Set([
    'daxta/out/',
    'daxta/',
    'daxta/viewer-store.json',
    '.daxta/out/',
    '.daxta/',
    '.daxta/viewer-store.json',
    '**/.jest.daxta.runtime.json',
  ]);
  const before = readFileSync(gitignorePath, 'utf8');
  const lines = before.split(/\r?\n/);
  const kept = lines.filter((line) => !remove.has(line.trim()));
  if (kept.length === lines.length) return [];
  if (!dryRun) writeFileSync(gitignorePath, `${kept.join('\n').replace(/\n+$/, '')}\n`);
  return [...remove].filter((entry) => lines.some((line) => line.trim() === entry));
}

function stripEnvDaxta(cwd: string, dryRun: boolean): string[] {
  const notes: string[] = [];
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    const filePath = path.join(cwd, name);
    if (!existsSync(filePath)) continue;
    const before = readFileSync(filePath, 'utf8');
    const lines = before.split(/\r?\n/);
    const kept = lines.filter((line) => !/^\s*DAXTA_DOCS\s*=/.test(line));
    if (kept.length === lines.length) continue;
    if (!dryRun) writeFileSync(filePath, `${kept.join('\n').replace(/\n+$/, '')}\n`);
    notes.push(name);
  }
  return notes;
}

function stripRegisterScripts(scripts: Record<string, string>): string[] {
  const changed: string[] = [];
  const re =
    /^NODE_OPTIONS=(['"])?(?:[^'"]*\s)?--require\s+@t0\.labs\/daxta\/register\s*([^'"]*)\1\s+/i;
  for (const [key, value] of Object.entries(scripts)) {
    if (!value.includes('@t0.labs/daxta/register') && !/\bdaxta\s+test\b/.test(value)) continue;
    let next = value
      .replace(re, '')
      .replace(/\s*--require\s+@t0\.labs\/daxta\/register\b/g, '')
      .replace(/NODE_OPTIONS=(['"])\s*\1\s*/g, '')
      .replace(/NODE_OPTIONS=\s+/g, '')
      .trim();
    if (/\bdaxta\s+test\b/.test(next)) {
      // can't unwrap without testCommand — leave a marker note via caller
      continue;
    }
    if (next !== value) {
      scripts[key] = next;
      changed.push(key);
    }
  }
  return changed;
}

function removePackage(cwd: string, pm: 'pnpm' | 'yarn' | 'npm', dryRun: boolean): string {
  if (dryRun) return `${pm} remove @t0.labs/daxta (dry-run)`;
  const args =
    pm === 'pnpm' ? ['remove', '@t0.labs/daxta'] : pm === 'yarn' ? ['remove', '@t0.labs/daxta'] : ['uninstall', '@t0.labs/daxta'];
  const result = spawnSync(pm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`${pm} ${args.join(' ')} failed`);
  return `${pm} ${args.join(' ')}`;
}

/**
 * Fully unwind DAxTA from a consumer project.
 */
export async function uninstallDaxta(options: UninstallOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = Boolean(options.dryRun);
  const paceMs = options.fast ? 0 : 280;
  const pkgPath = path.join(cwd, 'package.json');
  if (!existsSync(pkgPath)) throw new Error('package.json not found');

  let pkg = readJson<PackageJson>(pkgPath);
  const project = pkg.name || path.basename(cwd);
  const pm = detectPackageManager(cwd, pkg);

  banner('DAxTA uninstall', project);

  if (!options.yes && process.stdin.isTTY) {
    const answer = await readlineAsk(
      `  ${c.gold('?')}  Remove DAxTA from ${c.bold(project)}?\n` +
        `     ${c.dim('Y yes  ·  n cancel')}\n  ${c.ice('›')} `,
    );
    if (answer && !/^y(es)?$/i.test(answer)) {
      console.log(`  ${c.dim('cancelled')}`);
      return;
    }
  }

  if (paceMs) await sleep(400);

  const configPath = findDaxtaConfigPath(cwd);
  let configText = '';
  if (configPath && existsSync(configPath)) {
    configText = readFileSync(configPath, 'utf8');
  }

  await step(
    'Remove apiDocs from Nest entry',
    () => {
      const details: string[] = [];
      for (const file of findMainCandidates(cwd).slice(0, 8)) {
        try {
          const source = readFileSync(file, 'utf8');
          if (!source.includes('@t0.labs/daxta') && !source.includes('apiDocs(')) continue;
          details.push(removeApiDocs(file, dryRun));
        } catch {
          // ignore
        }
      }
      if (!details.length) return 'nothing to remove';
      return { summary: `${details.length} file(s)`, details };
    },
    { paceMs },
  );

  await step(
    'Remove Jest plugin hooks',
    () => {
      const details: string[] = [];
      const testScript = readConfigString(configText, 'testScript');
      const testCommand = readConfigString(configText, 'testCommand');
      const jestConfigField = readConfigString(configText, 'jestConfig');
      const scriptCommand =
        testCommand ||
        (testScript && pkg.scripts?.[testScript] ? pkg.scripts[testScript] : undefined);

      const jestPath = resolveJestConfigPath(cwd, {
        jestConfig: jestConfigField ?? undefined,
        scriptCommand,
      });

      const candidates = [
        jestPath,
        path.join(cwd, 'jest.config.integration.js'),
        path.join(cwd, 'jest.config.integration.ts'),
        path.join(cwd, 'jest.config.js'),
        path.join(cwd, 'jest.config.ts'),
        path.join(cwd, 'jest.config.json'),
      ].filter((p): p is string => Boolean(p && existsSync(p)));

      const seen = new Set<string>();
      for (const file of candidates) {
        if (seen.has(file)) continue;
        seen.add(file);
        try {
          const notes = removeJestHooks(file, dryRun);
          if (notes.length) details.push(`${path.relative(cwd, file)}: ${notes.join(', ')}`);
        } catch (error) {
          details.push(`${path.relative(cwd, file)}: ${error instanceof Error ? error.message : error}`);
        }
      }
      if (!details.length) return 'nothing to remove';
      return { summary: `${details.length} config(s)`, details };
    },
    { paceMs },
  );

  await step(
    'Clean package.json scripts',
    () => {
      pkg.scripts ??= {};
      const details: string[] = [];
      const testScript = readConfigString(configText, 'testScript');
      const testCommand = readConfigString(configText, 'testCommand');
      if (testScript && testCommand && unwrapDaxtaTestScript(pkg.scripts, testScript, testCommand)) {
        details.push(`unwrapped ${testScript}`);
      }
      details.push(...stripRegisterScripts(pkg.scripts).map((key) => `cleaned ${key}`));
      for (const key of Object.keys(pkg.scripts)) {
        if (!key.startsWith('daxta:')) continue;
        delete pkg.scripts[key];
        details.push(`removed script ${key}`);
      }
      if (!dryRun && details.length) writeJson(pkgPath, pkg);
      if (!details.length) return 'no script changes';
      return { summary: `${details.length} change(s)`, details };
    },
    { paceMs },
  );

  await step(
    'Remove daxta.config + output',
    () => {
      const details: string[] = [];
      if (configPath && existsSync(configPath)) {
        if (!dryRun) rmSync(configPath, { force: true });
        details.push(path.relative(cwd, configPath));
      }
      for (const dir of ['daxta', '.daxta']) {
        const outDir = path.join(cwd, dir);
        if (existsSync(outDir)) {
          if (!dryRun) rmSync(outDir, { recursive: true, force: true });
          details.push(`${dir}/`);
        }
      }
      if (!details.length) return 'already gone';
      return { summary: 'deleted', details };
    },
    { paceMs },
  );

  await step(
    'Clean .gitignore / .env',
    () => {
      const details: string[] = [];
      const gi = stripGitignore(cwd, dryRun);
      if (gi.length) details.push(`.gitignore − ${gi.join(', ')}`);
      const env = stripEnvDaxta(cwd, dryRun);
      if (env.length) details.push(`DAXTA_DOCS removed from ${env.join(', ')}`);
      if (!details.length) return 'nothing to clean';
      return { summary: 'cleaned', details };
    },
    { paceMs },
  );

  if (!options.keepDep) {
    const listed =
      Boolean(pkg.dependencies?.['@t0.labs/daxta'] || pkg.devDependencies?.['@t0.labs/daxta']) ||
      existsSync(path.join(cwd, 'node_modules', '@t0.labs', 'daxta'));
    if (listed) {
      await step(
        `Remove @t0.labs/daxta via ${pm}`,
        () => removePackage(cwd, pm, dryRun),
        { paceMs: paceMs ? 500 : 0 },
      );
    } else {
      await step('Package dependency', () => 'not listed — skip', { paceMs });
    }
  }

  box('Removed', [
    `${c.mint('✔')}  DAxTA unwound from ${c.bold(project)}`,
    `${c.dim('check')} Nest main + Jest config if anything custom remained`,
  ]);
}
