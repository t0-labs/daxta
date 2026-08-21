import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { injectApiDocs, resolveMainTarget } from './inject-main';
import {
  isDaxtaWrappedScript,
  resolveTestScript,
  upsertTestWiringInConfig,
} from './discover-test';
import { injectJestHooks, resolveJestConfigPath, unwrapDaxtaTestScript } from './jest-hooks';
import { runTreeWizard } from './tree';
import { banner, box, c, nextSteps, sleep, step } from './ui';

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
};

export type InstallOptions = {
  cwd?: string;
  skipDep?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  mainPath?: string;
  skipMain?: boolean;
  /** Skip dramatic pacing delays */
  fast?: boolean;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function selfVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    return (readJson<{ version?: string }>(pkgPath).version || '').trim() || 'latest';
  } catch {
    return 'latest';
  }
}

function detectPackageManager(cwd: string, pkg: PackageJson): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml')) || pkg.packageManager?.startsWith('pnpm')) return 'pnpm';
  if (existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function isDaxtaListed(pkg: PackageJson): boolean {
  return Boolean(pkg.dependencies?.['@t0.labs/daxta'] || pkg.devDependencies?.['@t0.labs/daxta']);
}

function isDaxtaInstalled(cwd: string): boolean {
  return existsSync(path.join(cwd, 'node_modules', '@t0.labs', 'daxta', 'package.json'));
}

function removeDaxtaAliasScripts(pkg: PackageJson): string[] {
  const scripts = pkg.scripts ?? {};
  const removed: string[] = [];
  for (const key of Object.keys(scripts)) {
    if (!key.startsWith('daxta:')) continue;
    delete scripts[key];
    removed.push(key);
  }
  return removed;
}

function stripRegisterNodeOptions(pkg: PackageJson): string[] {
  const scripts = pkg.scripts ?? {};
  const changed: string[] = [];
  const re =
    /^NODE_OPTIONS=(['"])?(?:[^'"]*\s)?--require\s+@t0\.labs\/daxta\/register\s*([^'"]*)\1\s+/i;

  for (const [key, value] of Object.entries(scripts)) {
    if (!value.includes('@t0.labs/daxta/register')) continue;
    let next = value.replace(re, '');
    next = next
      .replace(/\s*--require\s+@t0\.labs\/daxta\/register\b/g, '')
      .replace(/NODE_OPTIONS=(['"])\s*\1\s*/g, '')
      .replace(/NODE_OPTIONS=\s+/g, '')
      .trim();
    if (next !== value) {
      scripts[key] = next;
      changed.push(key);
    }
  }
  return changed;
}

function writeConfig(cwd: string, dryRun: boolean): { created: boolean; rel: string } {
  const configPath = path.join(cwd, 'daxta.config.ts');
  const rel = 'daxta.config.ts';
  if (existsSync(configPath)) return { created: false, rel };
  const body = `import { defineConfig } from '@t0.labs/daxta';

export default defineConfig({
  workspace: 'API',
  baseUrl: 'http://localhost:3000',
  controllersRoot: 'src',
  outDir: 'daxta/out',
  docsPath: '/docs',
  treeLayout: 'resource-first',
  fieldsFile: 'daxta/out/daxta.fields.json',
});
`;
  if (!dryRun) writeFileSync(configPath, body);
  return { created: true, rel };
}

function ensureGitignore(cwd: string, dryRun: boolean): string[] {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entries = ['daxta/out/', '**/.jest.daxta.runtime.json'];
  if (!existsSync(gitignorePath)) {
    if (!dryRun) writeFileSync(gitignorePath, `${entries.join('\n')}\n`);
    return entries.map((e) => `created .gitignore (+ ${e})`);
  }
  const text = readFileSync(gitignorePath, 'utf8');
  const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const added: string[] = [];
  let next = text;
  for (const entry of entries) {
    if (lines.has(entry) || lines.has('daxta/') || (entry === 'daxta/out/' && lines.has('daxta/out'))) continue;
    next = next.endsWith('\n') ? `${next}${entry}\n` : `${next}\n${entry}\n`;
    added.push(entry);
  }
  if (added.length && !dryRun) writeFileSync(gitignorePath, next);
  return added.map((e) => `.gitignore += ${e}`);
}

function runPackageInstall(cwd: string, pm: 'pnpm' | 'yarn' | 'npm', version: string, dryRun: boolean) {
  if (dryRun) return 'dry-run';
  const spec = version === 'latest' ? '@t0.labs/daxta' : `@t0.labs/daxta@${version}`;
  const args = pm === 'npm' ? ['install', '-D', spec] : ['add', '-D', spec];
  const result = spawnSync(pm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`${pm} ${args.join(' ')} failed`);
  return spec;
}

/**
 * One-shot bootstrap with paced, colored steps.
 * Prefer: `pnpm dlx @t0.labs/daxta install`
 */
export async function installDaxta(options: InstallOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = Boolean(options.dryRun);
  const paceMs = options.fast || dryRun || process.env.CI ? 0 : 2200;
  const pkgPath = path.join(cwd, 'package.json');
  if (!existsSync(pkgPath)) throw new Error(`No package.json in ${cwd}`);

  let pkg = readJson<PackageJson>(pkgPath);
  const pm = detectPackageManager(cwd, pkg);
  const version = selfVersion();
  const project = pkg.name || path.basename(cwd);

  banner('DAxTA install', `v${version} · ${project}`);
  if (paceMs) await sleep(700);

  await step('Detect package manager', () => pm, { paceMs });

  if (!options.skipDep) {
    if (!isDaxtaListed(pkg) || !isDaxtaInstalled(cwd)) {
      await step(
        `Add @t0.labs/daxta via ${pm}`,
        () => {
          const spec = runPackageInstall(cwd, pm, version, dryRun);
          if (!dryRun) pkg = readJson<PackageJson>(pkgPath);
          return { summary: 'devDependency', details: [spec] };
        },
        { paceMs: paceMs ? 600 : 0 },
      );
    } else {
      await step('Package dependency', () => 'already installed — skip add', { paceMs });
    }
  }

  await step(
    'Write daxta.config.ts',
    () => {
      const { created, rel } = writeConfig(cwd, dryRun);
      return created ? `created ${rel}` : `exists · ${rel}`;
    },
    { paceMs },
  );

  await step(
    'Clean package.json scripts',
    () => {
      const stripped = stripRegisterNodeOptions(pkg);
      const removed = removeDaxtaAliasScripts(pkg);
      if (!dryRun) writeJson(pkgPath, pkg);
      const details: string[] = [];
      if (stripped.length) details.push(`removed NODE_OPTIONS register: ${stripped.join(', ')}`);
      if (removed.length) details.push(`removed aliases: ${removed.join(', ')}`);
      if (!details.length) return 'no daxta:* aliases';
      return { summary: `${details.length} cleanup(s)`, details };
    },
    { paceMs },
  );

  await step(
    'Prepare output dir',
    () => {
      if (!dryRun) mkdirSync(path.join(cwd, 'daxta', 'out'), { recursive: true });
      return 'daxta/out';
    },
    { paceMs },
  );

  await step(
    'Update .gitignore',
    () => {
      const notes = ensureGitignore(cwd, dryRun);
      if (!notes.length) return 'already ignored';
      return { summary: `${notes.length} entr${notes.length === 1 ? 'y' : 'ies'}`, details: notes };
    },
    { paceMs },
  );

  if (!options.skipMain) {
    console.log('');
    console.log(`  ${c.yellow(c.bold('?'))} ${c.bold('Nest entry')} ${c.dim('— wire apiDocs(app)')}`);
    const target = await resolveMainTarget({
      cwd,
      yes: options.yes,
      mainPath: options.mainPath,
    });

    if (!target) {
      await step('Inject apiDocs(app)', () => 'skipped', { paceMs });
    } else {
      await step(
        'Inject apiDocs(app)',
        () => {
          const note = injectApiDocs(target, dryRun);
          const rel = path.relative(cwd, target);
          return {
            summary: rel,
            details: [
              note.includes('already') ? 'apiDocs(app) already present' : 'import { apiDocs } + apiDocs(app)',
              `file · ${rel}`,
            ],
          };
        },
        { paceMs },
      );
    }
  }

  console.log('');
  console.log(`  ${c.yellow(c.bold('?'))} ${c.bold('Test script')} ${c.dim('— Jest plugin, your script stays the parent')}`);
  const testScript = await resolveTestScript({
    cwd,
    scripts: pkg.scripts,
    yes: options.yes,
  });
  if (testScript && pkg.scripts?.[testScript]) {
    await step(
      `Attach to ${testScript}`,
      () => {
        const details: string[] = [];
        let command = pkg.scripts![testScript];

        // Load existing testCommand from config if script was wrapped previously
        const configPath = path.join(cwd, 'daxta.config.ts');
        let savedCommand: string | undefined;
        if (existsSync(configPath)) {
          const cfg = readFileSync(configPath, 'utf8');
          const m = cfg.match(/testCommand\s*:\s*['"`]([^'"`]+)['"`]/);
          savedCommand = m?.[1];
        }

        if (isDaxtaWrappedScript(command) && savedCommand && !isDaxtaWrappedScript(savedCommand)) {
          if (unwrapDaxtaTestScript(pkg.scripts!, testScript, savedCommand)) {
            command = savedCommand;
            details.push(`unwrapped ${testScript} → original jest command`);
            if (!dryRun) writeJson(pkgPath, pkg);
          }
        }

        if (isDaxtaWrappedScript(command)) {
          throw new Error(
            `${testScript} is still "daxta test …" and testCommand is missing. Set testCommand in daxta.config.ts then re-run install.`,
          );
        }

        const jestPath = resolveJestConfigPath(cwd, { scriptCommand: command });
        if (!jestPath) {
          throw new Error(
            `No --config in "${testScript}". Add jestConfig: '…' to daxta.config.ts`,
          );
        }

        const hookNotes = injectJestHooks(jestPath, dryRun);
        details.push(...hookNotes);
        details.push(`plugin on ${path.relative(cwd, jestPath)}`);

        const note = upsertTestWiringInConfig(
          cwd,
          {
            testScript,
            testCommand: command,
            jestConfig: path.relative(cwd, jestPath),
          },
          dryRun,
        );
        details.push(note);

        return {
          summary: 'hooks in Jest config',
          details,
        };
      },
      { paceMs },
    );
  } else {
    await step('Attach test hooks', () => 'skipped', { paceMs });
  }

  if (!dryRun) {
    await runTreeWizard({ embedded: true, yes: Boolean(options.yes) });
  }

  box('Done', [
    `${c.green('✔')} DAxTA wired for ${c.bold(project)}`,
    `${c.dim('env')} ${c.cyan('DAXTA_DOCS=true')} or ${c.cyan('false')}`,
    `${c.dim('tests')} run your usual script — Docs ready prints when Jest finishes`,
    `${c.dim('sidebar')} ${c.cyan('daxta tree')} anytime to re-arrange folders`,
  ]);

  const wired = testScript && pkg.scripts?.[testScript] ? testScript : null;
  nextSteps([
    { cmd: 'echo "DAXTA_DOCS=true" >> .env', why: 'enable /docs on the app port' },
    {
      cmd: wired ? `${pm} run ${wired}` : 'pnpm test',
      why: 'unchanged entrypoint — DAxTA is a Jest plugin',
    },
  ]);
}
