import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

import { extractJestConfigFromCommand } from './discover-test';

type JestConfig = Record<string, unknown>;

const SETUP = '@t0.labs/daxta/setup';
const REPORTER = '@t0.labs/daxta/jest-reporter';

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

function isJsonConfigPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.json';
}

function isJsLikeConfigPath(filePath: string): boolean {
  return ['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts'].includes(path.extname(filePath).toLowerCase());
}

/** Find `[`…`]` for `key: [` while skipping strings. */
function findArrayPropRange(source: string, key: string): { open: number; close: number } | null {
  const re = new RegExp(`${key}\\s*:\\s*\\[`);
  const match = re.exec(source);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && quote !== '`') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return { open, close: i };
    }
  }
  return null;
}

function insertIntoObjectLiteral(source: string, propertyLine: string): string | null {
  const anchors = [/module\.exports\s*=\s*\{/, /export\s+default\s+\{/, /exports\s*=\s*\{/];
  for (const re of anchors) {
    const match = re.exec(source);
    if (!match) continue;
    const brace = match.index + match[0].length - 1;
    return `${source.slice(0, brace + 1)}\n  ${propertyLine}${source.slice(brace + 1)}`;
  }
  return null;
}

function injectIntoJsSource(source: string): { source: string; notes: string[] } {
  const notes: string[] = [];
  let next = source;

  if (!next.includes(SETUP)) {
    const range = findArrayPropRange(next, 'setupFilesAfterEnv');
    if (range) {
      const afterOpen = next.slice(range.open + 1);
      const multiline = /^\s*\n/.test(afterOpen);
      const insertion = multiline ? `\n    '${SETUP}',` : `'${SETUP}', `;
      next = `${next.slice(0, range.open + 1)}${insertion}${multiline ? afterOpen : afterOpen.trimStart()}`;
      notes.push(`setupFilesAfterEnv += ${SETUP}`);
    } else {
      const inserted = insertIntoObjectLiteral(next, `setupFilesAfterEnv: ['${SETUP}'],`);
      if (!inserted) {
        throw new Error(
          'Could not find setupFilesAfterEnv or module.exports / export default object to inject DAxTA setup',
        );
      }
      next = inserted;
      notes.push(`setupFilesAfterEnv = [${SETUP}]`);
    }
  }

  if (!next.includes(REPORTER)) {
    const range = findArrayPropRange(next, 'reporters');
    if (range) {
      const beforeClose = next.slice(range.open + 1, range.close);
      const needsComma = beforeClose.trim().length > 0 && !/,\s*$/.test(beforeClose.trim());
      const injection = `${needsComma ? ',' : ''}\n    '${REPORTER}',\n  `;
      next = `${next.slice(0, range.close)}${injection}${next.slice(range.close)}`;
      notes.push(`reporters += ${REPORTER}`);
    } else {
      const inserted = insertIntoObjectLiteral(next, `reporters: ['default', '${REPORTER}'],`);
      if (!inserted) {
        throw new Error(
          'Could not find reporters or module.exports / export default object to inject DAxTA reporter',
        );
      }
      next = inserted;
      notes.push(`reporters = [default, ${REPORTER}]`);
    }
  }

  return { source: next, notes };
}

function injectIntoJsonConfig(filePath: string, dryRun: boolean): string[] {
  const notes: string[] = [];
  const data = loadJestJson(filePath);

  const setup = Array.isArray(data.setupFilesAfterEnv) ? [...(data.setupFilesAfterEnv as string[])] : [];
  if (!setup.includes(SETUP)) {
    setup.unshift(SETUP);
    data.setupFilesAfterEnv = setup;
    notes.push(`setupFilesAfterEnv += ${SETUP}`);
  }

  const reporters = Array.isArray(data.reporters) ? [...data.reporters] : ['default'];
  const hasReporter = reporters.some((entry) => {
    if (entry === REPORTER) return true;
    if (Array.isArray(entry) && entry[0] === REPORTER) return true;
    return false;
  });
  if (!hasReporter) {
    reporters.push(REPORTER);
    data.reporters = reporters;
    notes.push(`reporters += ${REPORTER}`);
  }

  if (!dryRun && notes.length) {
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  }
  return notes;
}

/**
 * Inject DAxTA as a Jest plugin (setup + reporter). Does not wrap the test process.
 * Supports JSON and JS/CJS/MJS/TS config files. Leaves globalSetup / globalTeardown untouched.
 */
export function injectJestHooks(jestConfigPath: string, dryRun = false): string[] {
  if (!existsSync(jestConfigPath)) throw new Error(`Jest config not found: ${jestConfigPath}`);

  if (isJsonConfigPath(jestConfigPath)) {
    return injectIntoJsonConfig(jestConfigPath, dryRun);
  }

  if (!isJsLikeConfigPath(jestConfigPath)) {
    throw new Error(
      `Unsupported Jest config type (${path.extname(jestConfigPath) || 'unknown'}). Use .json, .js, .cjs, .mjs, or .ts: ${jestConfigPath}`,
    );
  }

  const original = readFileSync(jestConfigPath, 'utf8');
  const { source, notes } = injectIntoJsSource(original);
  if (!dryRun && notes.length && source !== original) {
    writeFileSync(jestConfigPath, source);
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
