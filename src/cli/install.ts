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
import { runTitleCheck } from './titles';
import { box, c, nextSteps, phase, sleep, splash, step } from './ui';

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
  specInfo: () => ({
    title: 'API',
    version: '1.0.0',
  }),
  workspace: 'API',
  baseUrl: 'http://localhost:3000',
  controllersRoot: 'src',
  outDir: '.daxta/out',
  docsPath: '/docs',
  treeLayout: 'role-resource',
  treeSkipParams: true,
  treeCollapseSingle: true,
  exampleLabelStyle: 'status-title-case',
  fieldsFile: '.daxta/out/fields.json',
  viewerStoreFile: '.daxta/viewer-store.json',
  // Try-it envs are derived from baseUrl / spec servers. Add envPresets only to
  // override or add extra environments:
  // envPresets: { staging: { baseUrl: 'https://api.staging.example.com' } },
});
`;
  if (!dryRun) writeFileSync(configPath, body);
  return { created: true, rel };
}

function ensureGitignore(cwd: string, dryRun: boolean): string[] {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entries = ['.daxta/out/', '.daxta/viewer-store.json', '**/.jest.daxta.runtime.json'];
  if (!existsSync(gitignorePath)) {
    if (!dryRun) writeFileSync(gitignorePath, `${entries.join('\n')}\n`);
    return entries.map((e) => `created .gitignore (+ ${e})`);
  }
  const text = readFileSync(gitignorePath, 'utf8');
  const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const added: string[] = [];
  let next = text;
  for (const entry of entries) {
    if (lines.has(entry) || lines.has('.daxta/') || lines.has('daxta/') || (entry === '.daxta/out/' && (lines.has('.daxta/out') || lines.has('daxta/out/')))) continue;
    next = next.endsWith('\n') ? `${next}${entry}\n` : `${next}\n${entry}\n`;
    added.push(entry);
  }
  if (added.length && !dryRun) writeFileSync(gitignorePath, next);
  return added.map((e) => `.gitignore += ${e}`);
}

const ENV_CANDIDATES = ['.env', '.env.local', '.env.development', '.env.development.local'] as const;

/**
 * Docs are gated on NODE_ENV, so the project needs one. Seed `development` only when
 * no env file declares it; an existing value is the project's call and stays untouched.
 */
function ensureEnvNodeEnv(cwd: string, dryRun: boolean): string {
  for (const name of ENV_CANDIDATES) {
    const filePath = path.join(cwd, name);
    if (!existsSync(filePath)) continue;
    const match = readFileSync(filePath, 'utf8').match(/^\s*NODE_ENV\s*=\s*(\S*)/m);
    if (match) return `${name} · NODE_ENV=${match[1] || '(empty)'} — kept`;
  }

  const targetName = ENV_CANDIDATES.find((name) => existsSync(path.join(cwd, name))) ?? '.env';
  const targetPath = path.join(cwd, targetName);
  const created = !existsSync(targetPath);
  const line = 'NODE_ENV=development';
  if (!dryRun) {
    if (created) {
      writeFileSync(targetPath, `${line}\n`);
    } else {
      const text = readFileSync(targetPath, 'utf8');
      const next = text.endsWith('\n') || text.length === 0 ? `${text}${line}\n` : `${text}\n${line}\n`;
      writeFileSync(targetPath, next);
    }
  }
  return created ? `created ${targetName} (+ ${line})` : `${targetName} += ${line}`;
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
  const paceMs = options.fast || dryRun || process.env.CI ? 0 : 380;
  const pkgPath = path.join(cwd, 'package.json');
  if (!existsSync(pkgPath)) throw new Error(`No package.json in ${cwd}`);

  let pkg = readJson<PackageJson>(pkgPath);
  const pm = detectPackageManager(cwd, pkg);
  const version = selfVersion();
  const project = pkg.name || path.basename(cwd);
  const of = 5;

  splash({ version, project, dryRun });
  if (paceMs) await sleep(220);

  phase(1, of, 'Project', 'package manager and DAxTA package');

  await step('Detect package manager', () => pm, { paceMs, n: 1, of });

  if (!options.skipDep) {
    if (!isDaxtaListed(pkg) || !isDaxtaInstalled(cwd)) {
      await step(
        `Add @t0.labs/daxta via ${pm}`,
        () => {
          const spec = runPackageInstall(cwd, pm, version, dryRun);
          if (!dryRun) pkg = readJson<PackageJson>(pkgPath);
          return { summary: 'devDependency', details: [spec] };
        },
        { paceMs: paceMs ? 180 : 0, n: 1, of },
      );
    } else {
      await step('Package dependency', () => 'already installed — skip add', { paceMs, n: 1, of });
    }
  }

  phase(2, of, 'Workspace files', 'config, gitignore, NODE_ENV');

  await step(
    'Write daxta.config.ts',
    () => {
      const { created, rel } = writeConfig(cwd, dryRun);
      return created ? `created ${rel}` : `exists · ${rel}`;
    },
    { paceMs, n: 2, of },
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
    { paceMs, n: 2, of },
  );

  await step(
    'Prepare output dir',
    () => {
      if (!dryRun) mkdirSync(path.join(cwd, '.daxta', 'out'), { recursive: true });
      return '.daxta/out';
    },
    { paceMs, n: 2, of },
  );

  await step(
    'Update .gitignore',
    () => {
      const notes = ensureGitignore(cwd, dryRun);
      if (!notes.length) return 'already ignored';
      return { summary: `${notes.length} entr${notes.length === 1 ? 'y' : 'ies'}`, details: notes };
    },
    { paceMs, n: 2, of },
  );

  await step('Ensure NODE_ENV in env', () => ensureEnvNodeEnv(cwd, dryRun), { paceMs, n: 2, of });

  phase(3, of, 'Nest', 'apiDocs(app) on the HTTP bootstrap');

  if (!options.skipMain) {
    const target = await resolveMainTarget({
      cwd,
      yes: options.yes,
      mainPath: options.mainPath,
    });

    if (!target) {
      await step('Inject apiDocs(app)', () => 'skipped', { paceMs, n: 3, of });
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
        { paceMs, n: 3, of },
      );
    }
  } else {
    await step('Inject apiDocs(app)', () => 'skipped (--skip-main)', { paceMs, n: 3, of });
  }

  phase(4, of, 'Tests', 'Jest plugin — your script stays the parent');

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
      { paceMs, n: 4, of },
    );
  } else {
    await step('Attach test hooks', () => 'skipped', { paceMs, n: 4, of });
  }

  phase(5, of, 'API docs taste', 'sidebar folders + test titles for the viewer');

  if (!dryRun) {
    await runTreeWizard({ embedded: true, yes: Boolean(options.yes) });
    await runTitleCheck({ cwd, yes: Boolean(options.yes) });
  }

  box('Ready', [
    `${c.mint('✔')}  ${c.bold(project)}  ·  DAxTA ${c.gold(`v${version}`)}`,
    `${c.dim('api docs')} ${c.ice('/docs')}  ·  on when ${c.ice('NODE_ENV')} is dev/test/staging`,
    `${c.dim('tests')}    same script — titles first, spec after`,
    `${c.dim('retune')}   ${c.ice('daxta tree')}  ·  ${c.ice('daxta titles')}`,
  ]);

  const wired = testScript && pkg.scripts?.[testScript] ? testScript : null;
  nextSteps([
    {
      cmd: wired ? `${pm} run ${wired}` : 'pnpm test',
      why: 'unchanged entrypoint — DAxTA is a Jest plugin',
    },
    {
      cmd: `${pm} start:dev`,
      why: 'open /docs — served outside production',
    },
  ]);
}
