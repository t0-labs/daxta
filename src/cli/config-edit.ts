import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

import { c } from './ui';

const CONFIG_NAMES = ['daxta.config.ts', 'daxta.config.js', 'daxta.config.mjs', 'daxta.config.cjs'];

export function findDaxtaConfigPath(cwd = process.cwd()): string | null {
  for (const name of CONFIG_NAMES) {
    const full = path.join(cwd, name);
    if (existsSync(full)) return full;
  }
  return null;
}

/** Replace or insert a top-level `key: <value>` inside `defineConfig({ ... })`. */
export function upsertConfigValue(configPath: string, key: string, valueLiteral: string): void {
  let text = readFileSync(configPath, 'utf8');
  const keyRe = new RegExp(`${key}\\s*:`);
  const match = keyRe.exec(text);
  if (!match) {
    const next = text.replace(/defineConfig\(\s*\{/, `defineConfig({\n  ${key}: ${valueLiteral},`);
    if (next === text) throw new Error(`Could not insert ${key} into ${path.basename(configPath)}`);
    writeFileSync(configPath, next);
    return;
  }

  const afterColon = match.index + match[0].length;
  let i = afterColon;
  while (i < text.length && /\s/.test(text[i])) i += 1;

  const start = i;
  let end = i;
  const ch = text[i];
  if (ch === '{' || ch === '[') {
    const open = ch;
    const close = ch === '{' ? '}' : ']';
    let depth = 0;
    let quote: '"' | "'" | '`' | null = null;
    let escaped = false;
    for (; end < text.length; end += 1) {
      const cur = text[end];
      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (cur === '\\' && quote !== '`') {
          escaped = true;
          continue;
        }
        if (cur === quote) quote = null;
        continue;
      }
      if (cur === '"' || cur === "'" || cur === '`') {
        quote = cur;
        continue;
      }
      if (cur === open) depth += 1;
      else if (cur === close) {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
  } else if (ch === '"' || ch === "'" || ch === '`') {
    const quote = ch;
    end = i + 1;
    let escaped = false;
    for (; end < text.length; end += 1) {
      const cur = text[end];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (cur === '\\') {
        escaped = true;
        continue;
      }
      if (cur === quote) {
        end += 1;
        break;
      }
    }
  } else {
    while (end < text.length && !/[,}\n]/.test(text[end])) end += 1;
  }

  text = `${text.slice(0, start)}${valueLiteral}${text.slice(end)}`;
  writeFileSync(configPath, text);
}

export function formatTsString(value: string): string {
  return JSON.stringify(value);
}

export function formatTsStringArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

export function formatTsStringRecord(record: Record<string, string[]>): string {
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  if (!keys.length) return '{}';
  const lines = keys.map((key) => `    ${JSON.stringify(key)}: ${formatTsStringArray(record[key])},`);
  return `{\n${lines.join('\n')}\n  }`;
}

export function readTreePathOverrides(cwd = process.cwd()): Record<string, string[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createJiti } = require('jiti') as typeof import('jiti');
    const configPath = findDaxtaConfigPath(cwd);
    if (!configPath) return {};
    const jiti = createJiti(__filename);
    const mod = jiti(configPath) as { default?: { treePathOverrides?: Record<string, string[]> }; treePathOverrides?: Record<string, string[]> };
    const cfg = (mod.default ?? mod) as { treePathOverrides?: Record<string, string[]> };
    return { ...(cfg.treePathOverrides ?? {}) };
  } catch {
    return {};
  }
}

export function previewTree(segments: string[]): string {
  return segments.map((part) => c.cyan(part)).join(c.dim(' › '));
}
