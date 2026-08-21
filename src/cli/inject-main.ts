import { createInterface } from 'readline';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import * as path from 'path';

import { c } from './ui';

const IMPORT_LINE = `import { apiDocs } from '@t0.labs/daxta';`;
const MARKER = 'apiDocs(';

function walk(dir: string, match: (name: string) => boolean, out: string[] = [], depth = 0): string[] {
  if (depth > 5 || !existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name === 'coverage') continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, match, out, depth + 1);
    else if (match(name)) out.push(full);
  }
  return out;
}

/** Prefer Nest entrypoints: src/main.ts, main.ts, then other *main*.ts */
export function findMainCandidates(cwd: string): string[] {
  const preferred = ['src/main.ts', 'src/main.js', 'main.ts', 'main.js']
    .map((rel) => path.join(cwd, rel))
    .filter((p) => existsSync(p));

  const scanned = walk(cwd, (name) => /^(main|bootstrap)\.(ts|js|mts|cts)$/i.test(name));
  const seen = new Set(preferred);
  for (const file of scanned) {
    if (!seen.has(file)) {
      seen.add(file);
      preferred.push(file);
    }
  }
  return preferred;
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Ask: use detected main, or type another path / n to skip.
 */
export async function resolveMainPath(cwd: string, candidates: string[]): Promise<string | null> {
  const def = candidates[0];
  if (!def) {
    const typed = await prompt(
      `  ${c.yellow('?')} ${c.bold('No main.ts found.')} Enter path, or ${c.dim('n')} to skip:\n  ${c.cyan('›')} `,
    );
    if (!typed || /^n(o)?$/i.test(typed)) return null;
    const full = path.isAbsolute(typed) ? typed : path.join(cwd, typed);
    if (!existsSync(full)) throw new Error(`File not found: ${full}`);
    return full;
  }

  const rel = path.relative(cwd, def);
  if (candidates.length > 1) {
    console.log(`  ${c.dim('candidates')}`);
    for (const file of candidates.slice(0, 5)) {
      const r = path.relative(cwd, file);
      console.log(`    ${r === rel ? c.cyan('●') : c.dim('○')} ${r === rel ? c.bold(r) : c.dim(r)}`);
    }
    if (candidates.length > 5) console.log(`    ${c.dim(`… +${candidates.length - 5} more`)}`);
  }

  const answer = await prompt(
    `  ${c.yellow('?')} Inject ${c.bold('apiDocs(app)')} into ${c.cyan(rel)}?\n` +
      `    ${c.dim('Y')} yes · ${c.dim('n')} skip · or type another path\n  ${c.cyan('›')} `,
  );

  if (!answer || /^y(es)?$/i.test(answer)) return def;
  if (/^n(o)?$/i.test(answer)) return null;

  const full = path.isAbsolute(answer) ? answer : path.join(cwd, answer);
  if (!existsSync(full)) throw new Error(`File not found: ${full}`);
  return full;
}

function ensureImport(source: string): string {
  if (source.includes("from '@t0.labs/daxta'") || source.includes('from "@t0.labs/daxta"')) {
    if (/import\s*\{[^}]*\bapiDocs\b/.test(source)) return source;
    return source.replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]@t0\.labs\/daxta['"]\s*;?/,
      (full, names: string) => {
        let next = names;
        next = next.replace(/\b(mountDaxtaDocs|docs)\b\s*,?\s*/g, '');
        if (/\bapiDocs\b/.test(next)) {
          return `import { ${next.trim().replace(/,$/, '')} } from '@t0.labs/daxta';`;
        }
        const trimmed = next.trim().replace(/,$/, '');
        return trimmed
          ? `import { ${trimmed}, apiDocs } from '@t0.labs/daxta';`
          : `import { apiDocs } from '@t0.labs/daxta';`;
      },
    );
  }

  const lastImport = [...source.matchAll(/^import\s.+;?\s*$/gm)].pop();
  if (lastImport && lastImport.index != null) {
    const insertAt = lastImport.index + lastImport[0].length;
    const after = source.slice(insertAt);
    const pad = after.startsWith('\n\n') ? '\n' : after.startsWith('\n') ? '\n' : '\n';
    return `${source.slice(0, insertAt)}${pad}${IMPORT_LINE}${source.slice(insertAt)}`;
  }
  return `${IMPORT_LINE}\n\n${source}`;
}

function ensureApiDocsCall(source: string): string {
  if (source.includes(MARKER) || source.includes('mountDaxtaDocs(') || /\bdocs\s*\(/.test(source)) {
    return source
      .replace(/\bmountDaxtaDocs\s*\(/g, 'apiDocs(')
      .replace(/\bdocs\s*\(/g, 'apiDocs(');
  }

  const constMatch = source.match(
    /(const|let|var)\s+(\w+)\s*=\s*await\s+NestFactory\.create\b[\s\S]*?;/,
  );
  if (constMatch && constMatch.index != null) {
    const varName = constMatch[2];
    const insertAt = constMatch.index + constMatch[0].length;
    const indent = guessIndent(source, insertAt);
    const hook = `\n${indent}apiDocs(${varName});`;
    return `${source.slice(0, insertAt)}${hook}${source.slice(insertAt)}`;
  }

  const assignMatch = source.match(/(\w+)\s*=\s*await\s+NestFactory\.create\b[\s\S]*?;/);
  if (assignMatch && assignMatch.index != null) {
    const varName = assignMatch[1];
    const insertAt = assignMatch.index + assignMatch[0].length;
    const indent = guessIndent(source, insertAt);
    const hook = `\n${indent}apiDocs(${varName});`;
    return `${source.slice(0, insertAt)}${hook}${source.slice(insertAt)}`;
  }

  throw new Error(
    'Could not find `await NestFactory.create(...)` to inject apiDocs(app). Add it manually near bootstrap.',
  );
}

function guessIndent(source: string, index: number): string {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const line = source.slice(lineStart, index);
  const m = line.match(/^\s*/);
  return m?.[0] ?? '  ';
}

export function injectApiDocs(filePath: string, dryRun = false): string {
  const before = readFileSync(filePath, 'utf8');
  if (before.includes(MARKER) && /import\s*\{[^}]*\bapiDocs\b/.test(before)) {
    return `already has apiDocs() in ${filePath}`;
  }
  let next = ensureImport(before);
  next = ensureApiDocsCall(next);
  if (next === before) return `no changes for ${filePath}`;
  if (!dryRun) writeFileSync(filePath, next);
  return `injected apiDocs() into ${path.relative(process.cwd(), filePath)}`;
}

export type InjectMainOptions = {
  cwd?: string;
  dryRun?: boolean;
  /** Skip prompt; use first candidate or this relative/absolute path */
  mainPath?: string;
  yes?: boolean;
};

/** Resolve which file to inject into (prompt / --main / --yes). Null = skip. */
export async function resolveMainTarget(options: InjectMainOptions = {}): Promise<string | null> {
  const cwd = options.cwd ?? process.cwd();
  const candidates = findMainCandidates(cwd);

  if (options.mainPath) {
    const target = path.isAbsolute(options.mainPath) ? options.mainPath : path.join(cwd, options.mainPath);
    if (!existsSync(target)) throw new Error(`File not found: ${target}`);
    return target;
  }
  if (options.yes) {
    const target = candidates[0] ?? null;
    if (!target) throw new Error('No main.ts found; pass --main <path>');
    return target;
  }
  if (!process.stdin.isTTY) {
    return candidates[0] ?? null;
  }
  return resolveMainPath(cwd, candidates);
}
