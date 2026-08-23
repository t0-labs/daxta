import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

import { findMainCandidates, injectApiDocs } from './inject-main';
import { isDaxtaWrappedScript } from './discover-test';
import { injectJestHooks, resolveJestConfigPath, unwrapDaxtaTestScript } from './jest-hooks';
import { c } from './ui';

type PackageJson = {
  scripts?: Record<string, string>;
};

const CONFIG_NAMES = ['daxta.config.ts', 'daxta.config.js', 'daxta.config.mjs', 'daxta.config.cjs'];

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function packageVersion(): string {
  try {
    return readJson<{ version?: string }>(path.join(__dirname, '..', '..', 'package.json')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function findConfigPath(cwd: string): string | null {
  for (const name of CONFIG_NAMES) {
    const full = path.join(cwd, name);
    if (existsSync(full)) return full;
  }
  return null;
}

function readConfigVersion(configText: string): string | null {
  const m = configText.match(/daxtaVersion\s*:\s*['"`]([^'"`]+)['"`]/);
  return m?.[1] ?? null;
}

function upsertConfigField(configPath: string, key: string, value: string): boolean {
  let text = readFileSync(configPath, 'utf8');
  const literal = JSON.stringify(value);
  const re = new RegExp(`${key}\\s*:\\s*['\`][^'\`"]*['\`]|${key}\\s*:\\s*"[^"]*"`);
  if (re.test(text)) {
    const next = text.replace(re, `${key}: ${literal}`);
    if (next === text) return false;
    writeFileSync(configPath, next);
    return true;
  }
  const next = text.replace(/defineConfig\(\s*\{/, `defineConfig({\n  ${key}: ${literal},`);
  if (next === text) return false;
  writeFileSync(configPath, next);
  return true;
}

function readStringField(configText: string, key: string): string | null {
  const m = configText.match(new RegExp(`${key}\\s*:\\s*['\`"]([^'\`"]+)['\`"]`));
  return m?.[1] ?? null;
}

function stripRegisterNodeOptions(scripts: Record<string, string>): string[] {
  const changed: string[] = [];
  const re =
    /^NODE_OPTIONS=(['"])?(?:[^'"]*\s)?--require\s+@t0\.labs\/daxta\/register\s*([^'"]*)\1\s+/i;

  for (const [key, value] of Object.entries(scripts)) {
    if (!value.includes('@t0.labs/daxta/register')) continue;
    let next = value
      .replace(re, '')
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

function removeDaxtaAliases(scripts: Record<string, string>): string[] {
  const removed: string[] = [];
  for (const key of Object.keys(scripts)) {
    if (!key.startsWith('daxta:')) continue;
    delete scripts[key];
    removed.push(key);
  }
  return removed;
}

function migrateTestWiring(cwd: string, configPath: string, configText: string, pkg: PackageJson): string[] {
  const notes: string[] = [];
  const scripts = (pkg.scripts ??= {});
  const testScript = readStringField(configText, 'testScript');
  const testCommand = readStringField(configText, 'testCommand');
  const jestConfigField = readStringField(configText, 'jestConfig');

  if (testScript && scripts[testScript] && testCommand && !isDaxtaWrappedScript(testCommand)) {
    if (unwrapDaxtaTestScript(scripts, testScript, testCommand)) {
      notes.push(`unwrapped ${testScript} (DAxTA is no longer the parent)`);
    }
  }

  const commandForJest =
    (testCommand && !isDaxtaWrappedScript(testCommand) ? testCommand : undefined) ||
    (testScript && scripts[testScript] && !isDaxtaWrappedScript(scripts[testScript])
      ? scripts[testScript]
      : undefined);

  const jestPath = resolveJestConfigPath(cwd, {
    jestConfig: jestConfigField ?? undefined,
    scriptCommand: commandForJest,
  });

  if (jestPath) {
    try {
      const hooks = injectJestHooks(jestPath, false);
      notes.push(...hooks);
      if (!jestConfigField) {
        upsertConfigField(configPath, 'jestConfig', path.relative(cwd, jestPath));
        notes.push(`jestConfig ← ${path.relative(cwd, jestPath)}`);
      }
    } catch (error) {
      notes.push(`jest hooks: ${error instanceof Error ? error.message : error}`);
    }
  }

  return notes;
}

function migrateMainApiDocs(cwd: string): string[] {
  const notes: string[] = [];
  for (const file of findMainCandidates(cwd).slice(0, 5)) {
    let before: string;
    try {
      before = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const hasLegacy =
      before.includes('mountDaxtaDocs') ||
      (before.includes('@t0.labs/daxta') && /\bdocs\s*\(/.test(before) && !before.includes('apiDocs('));
    if (!hasLegacy) continue;
    try {
      const note = injectApiDocs(file, false);
      if (!note.startsWith('already')) notes.push(note);
    } catch {
      // ignore
    }
  }
  return notes;
}

function migrateConfigDefaults(configPath: string, configText: string): string[] {
  const notes: string[] = [];
  const fields = readStringField(configText, 'fieldsFile');
  const outDir = readStringField(configText, 'outDir') || '.daxta/out';
  if (fields === 'daxta.fields.json' || fields === './daxta.fields.json') {
    const next = `${outDir.replace(/\\/g, '/').replace(/\/$/, '')}/fields.json`;
    if (upsertConfigField(configPath, 'fieldsFile', next)) {
      notes.push(`fieldsFile → ${next}`);
    }
  }
  return notes;
}

export type MigrateResult = {
  changed: boolean;
  fromVersion: string | null;
  toVersion: string;
  notes: string[];
  skipped?: boolean;
};

/**
 * Migrate only when package version ≠ daxta.config `daxtaVersion`
 * (or when `daxtaVersion` is missing). Otherwise no-op.
 * Interactive sidebar prompts run from `daxta migrate` / `daxta install` (CLI), not here.
 */
export function migrateProject(cwd = process.cwd(), options: { force?: boolean } = {}): MigrateResult {
  const toVersion = packageVersion();
  const notes: string[] = [];
  const configPath = findConfigPath(cwd);
  if (!configPath) {
    return { changed: false, fromVersion: null, toVersion, notes: [], skipped: true };
  }

  let configText = readFileSync(configPath, 'utf8');
  const fromVersion = readConfigVersion(configText);

  if (!options.force && fromVersion === toVersion) {
    return { changed: false, fromVersion, toVersion, notes: [], skipped: true };
  }

  const pkgPath = path.join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = readJson<PackageJson>(pkgPath);
    pkg.scripts ??= {};
    const before = JSON.stringify(pkg.scripts);

    const stripped = stripRegisterNodeOptions(pkg.scripts);
    const removed = removeDaxtaAliases(pkg.scripts);
    if (stripped.length) notes.push(`stripped register from: ${stripped.join(', ')}`);
    if (removed.length) notes.push(`removed aliases: ${removed.join(', ')}`);

    notes.push(...migrateTestWiring(cwd, configPath, configText, pkg));

    if (JSON.stringify(pkg.scripts) !== before) writeJson(pkgPath, pkg);
  }

  configText = readFileSync(configPath, 'utf8');
  notes.push(...migrateConfigDefaults(configPath, configText));
  notes.push(...migrateMainApiDocs(cwd));

  upsertConfigField(configPath, 'daxtaVersion', toVersion);
  if (fromVersion && fromVersion !== toVersion) notes.push(`daxtaVersion ${fromVersion} → ${toVersion}`);
  else if (!fromVersion) notes.push(`daxtaVersion set to ${toVersion}`);

  return { changed: notes.length > 0, fromVersion, toVersion, notes };
}

export function reportMigration(result: MigrateResult): void {
  if (result.skipped || !result.changed) return;
  console.log('');
  console.log(
    `  ${c.magenta('↻')} ${c.bold('DAxTA migrate')} ${c.dim(
      result.fromVersion ? `${result.fromVersion} → ${result.toVersion}` : `→ ${result.toVersion}`,
    )}`,
  );
  for (const note of result.notes) {
    console.log(`      ${c.dim('→')} ${note}`);
  }
  console.log('');
}
