import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

import { extractJestConfigFromCommand } from './discover-test';

type JestConfig = Record<string, unknown>;

export function loadJestJson(filePath: string): JestConfig {
  return JSON.parse(readFileSync(filePath, 'utf8')) as JestConfig;
}

export function resolveJestConfigPath(
  cwd: string,
  options: { jestConfig?: string; scriptCommand?: string },
): string | null {
  if (options.jestConfig) {
    return path.isAbsolute(options.jestConfig) ? options.jestConfig : path.join(cwd, options.jestConfig);
  }
  if (options.scriptCommand) {
    const fromScript = extractJestConfigFromCommand(options.scriptCommand);
    if (fromScript) {
      return path.isAbsolute(fromScript) ? fromScript : path.join(cwd, fromScript);
    }
  }
  return null;
}

/**
 * Inject DAxTA as a Jest plugin (setup + reporter). Does not wrap the test process.
 * Leaves existing globalSetup / globalTeardown untouched.
 */
export function injectJestHooks(jestConfigPath: string, dryRun = false): string[] {
  const notes: string[] = [];
  if (!existsSync(jestConfigPath)) throw new Error(`Jest config not found: ${jestConfigPath}`);

  let data: JestConfig;
  try {
    data = loadJestJson(jestConfigPath);
  } catch {
    throw new Error(`Jest config must be JSON to inject DAxTA hooks: ${jestConfigPath}`);
  }

  const setup = Array.isArray(data.setupFilesAfterEnv) ? [...(data.setupFilesAfterEnv as string[])] : [];
  if (!setup.includes('@t0.labs/daxta/setup')) {
    setup.unshift('@t0.labs/daxta/setup');
    data.setupFilesAfterEnv = setup;
    notes.push('setupFilesAfterEnv += @t0.labs/daxta/setup');
  }

  const reporters = Array.isArray(data.reporters) ? [...data.reporters] : ['default'];
  const hasReporter = reporters.some((entry) => {
    if (entry === '@t0.labs/daxta/jest-reporter') return true;
    if (Array.isArray(entry) && entry[0] === '@t0.labs/daxta/jest-reporter') return true;
    return false;
  });
  if (!hasReporter) {
    reporters.push('@t0.labs/daxta/jest-reporter');
    data.reporters = reporters;
    notes.push('reporters += @t0.labs/daxta/jest-reporter');
  }

  if (!dryRun && notes.length) {
    writeFileSync(jestConfigPath, `${JSON.stringify(data, null, 2)}\n`);
  }
  return notes;
}

/** Restore package.json script if it was wrapped as `daxta test --yes`. */
export function unwrapDaxtaTestScript(
  scripts: Record<string, string>,
  scriptName: string,
  originalCommand: string,
): boolean {
  const current = scripts[scriptName];
  if (!current || !/\bdaxta\s+test\b/.test(current)) return false;
  scripts[scriptName] = originalCommand;
  return true;
}
