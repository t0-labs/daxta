import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import * as path from 'path';

import { formatTestTitle, parseOperationLabel, suggestOperationTitleResult } from '../catalog/test-title';
import { isDynamicItName, parseCaseSection, suggestItCaseResult, type CaseSection } from '../catalog/it-case';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  'daxta',
  'out',
]);

const TEST_FILE_RE = /\.(spec|test|e2e|int)\.(ts|js|mts|cts|tsx|jsx)$/i;
const TEST_DIR_RE = /(^|\/)(test|tests|e2e|integration)(\/|$)/i;
const SOURCE_RE = /\.(ts|js|mts|cts|tsx|jsx)$/i;

const STRING_RE = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

export type TitleFinding = {
  file: string;
  line: number;
  column: number;
  raw: string;
  quote: string;
  path: string;
  method: string;
  suggestions: string[];
  auto: boolean;
};

function shouldScanFile(rel: string): boolean {
  if (TEST_FILE_RE.test(rel)) return true;
  return TEST_DIR_RE.test(rel.replace(/\\/g, '/')) && SOURCE_RE.test(rel);
}

function walk(dir: string, cwd: string, out: string[]): void {
  if (!existsSync(dir)) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.') && name !== '.ts') continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    const rel = path.relative(cwd, full);
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, cwd, out);
      continue;
    }
    if (stat.isFile() && shouldScanFile(rel)) out.push(full);
  }
}

function listTestFiles(cwd: string): string[] {
  const roots = ['test', 'tests', 'e2e', 'src'];
  const files: string[] = [];
  for (const root of roots) {
    const dir = path.join(cwd, root);
    if (existsSync(dir)) walk(dir, cwd, files);
  }
  return [...new Set(files)];
}

export function scanMissingTitles(cwd = process.cwd()): TitleFinding[] {
  const findings: TitleFinding[] = [];
  for (const file of listTestFiles(cwd)) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(cwd, file) || file;
    const lines = text.split(/\n/);
    lines.forEach((line, index) => {
      STRING_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = STRING_RE.exec(line))) {
        const quote = match[1];
        const body = match[2];
        const parsed = parseOperationLabel(body);
        if (!parsed || parsed.title) continue;
        const suggestion = suggestOperationTitleResult(parsed.method, parsed.path);
        findings.push({
          file: rel,
          line: index + 1,
          column: (match.index ?? 0) + 1,
          raw: body,
          quote,
          path: parsed.path,
          method: parsed.method,
          suggestions: suggestion.titles,
          auto: suggestion.auto,
        });
      }
    });
  }
  return findings;
}

export function applyTitle(cwd: string, finding: TitleFinding, title: string): boolean {
  const abs = path.isAbsolute(finding.file) ? finding.file : path.join(cwd, finding.file);
  if (!existsSync(abs)) return false;
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\n/);
  const line = lines[finding.line - 1];
  if (!line) return false;
  const nextLabel = formatTestTitle(title, finding.path, finding.method);
  const needle = `${finding.quote}${finding.raw}${finding.quote}`;
  const replacement = `${finding.quote}${nextLabel}${finding.quote}`;
  if (!line.includes(needle)) return false;
  lines[finding.line - 1] = line.replace(needle, replacement);
  writeFileSync(abs, lines.join('\n'));
  finding.raw = nextLabel;
  return true;
}

export function printTitleFindings(
  findings: TitleFinding[],
  paint: { dim: (s: string) => string; yellow: (s: string) => string; cyan: (s: string) => string; bold: (s: string) => string },
): void {
  if (!findings.length) return;
  console.log('');
  console.log(
    `  ${paint.yellow('!')} ${paint.bold(`${findings.length} test title(s) missing a human name`)} ${paint.dim('(docs would show the path)')}`,
  );
  console.log(`  ${paint.dim('Format:')} ${paint.cyan('Create Mock Tbs — POST /v1/admin/mock-tbs')}`);
  for (const item of findings) {
    console.log('');
    console.log(`  ${paint.cyan(item.file)}${paint.dim(`:${item.line}:${item.column}`)}`);
    console.log(`    ${paint.dim(item.raw)}`);
    if (item.suggestions.length && item.auto) {
      console.log(`    ${paint.dim('suggest')} ${item.suggestions.map((name, i) => `${i + 1}:${name}`).join('  ')}`);
    } else {
      console.log(`    ${paint.yellow('custom title required')} ${paint.dim('(Create Bulk / Validate … — not applied by --yes)')}`);
    }
  }
  console.log('');
  console.log(`  ${paint.dim('Fix interactively:')} ${paint.cyan('daxta titles')}`);
  console.log('');
}

export type ItFinding = {
  file: string;
  line: number;
  column: number;
  raw: string;
  quote: string;
  section?: CaseSection;
  path?: string;
  method?: string;
  suggestions: string[];
  auto: boolean;
};

export type NamingReport = {
  titles: TitleFinding[];
  cases: ItFinding[];
};

function indexToLineCol(text: string, index: number): { line: number; column: number } {
  const until = text.slice(0, index);
  const lines = until.split(/\n/);
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

const BLOCK_RE =
  /\b((?:describe|it|test)(?:\.(?:only|skip|todo))?)\s*\(\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/g;

function scanFileCases(rel: string, text: string): ItFinding[] {
  const labels: Array<{ index: number; path: string; method: string }> = [];
  STRING_RE.lastIndex = 0;
  let strMatch: RegExpExecArray | null;
  while ((strMatch = STRING_RE.exec(text))) {
    const parsed = parseOperationLabel(strMatch[2]);
    if (!parsed) continue;
    labels.push({ index: strMatch.index, path: parsed.path, method: parsed.method });
  }

  const describes: Array<{ index: number; section?: CaseSection }> = [];
  const findings: ItFinding[] = [];
  BLOCK_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = BLOCK_RE.exec(text))) {
    const kind = block[1].replace(/\.(?:only|skip|todo)$/, '');
    const quote = block[2];
    const body = block[3];
    const index = block.index;
    if (kind === 'describe') {
      describes.push({ index, section: parseCaseSection(body) });
      continue;
    }
    const section = [...describes].reverse().find((entry) => entry.index < index && entry.section)?.section;
    if (!section) continue;
    if (isDynamicItName(body)) continue;
    const label = [...labels].reverse().find((entry) => entry.index < index);
    const suggestion = suggestItCaseResult(section, label?.method, label?.path, body);
    if (!suggestion.names.length) continue;
    if (suggestion.auto && suggestion.names[0] === body.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '')) continue;
    const { line, column } = indexToLineCol(text, index);
    findings.push({
      file: rel,
      line,
      column,
      raw: body,
      quote,
      section,
      path: label?.path,
      method: label?.method,
      suggestions: suggestion.names,
      auto: suggestion.auto,
    });
  }
  return findings;
}

export function scanMissingItCases(cwd = process.cwd()): ItFinding[] {
  const findings: ItFinding[] = [];
  for (const file of listTestFiles(cwd)) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(cwd, file) || file;
    findings.push(...scanFileCases(rel, text));
  }
  return findings;
}

export function scanTestNaming(cwd = process.cwd()): NamingReport {
  return { titles: scanMissingTitles(cwd), cases: scanMissingItCases(cwd) };
}

export function applyItCase(cwd: string, finding: ItFinding, name: string): boolean {
  const abs = path.isAbsolute(finding.file) ? finding.file : path.join(cwd, finding.file);
  if (!existsSync(abs)) return false;
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\n/);
  const line = lines[finding.line - 1];
  if (!line) return false;
  const needle = `${finding.quote}${finding.raw}${finding.quote}`;
  const replacement = `${finding.quote}${name}${finding.quote}`;
  if (!line.includes(needle)) return false;
  lines[finding.line - 1] = line.replace(needle, replacement);
  writeFileSync(abs, lines.join('\n'));
  finding.raw = name;
  return true;
}

export function printNamingFindings(
  report: NamingReport,
  paint: { dim: (s: string) => string; yellow: (s: string) => string; cyan: (s: string) => string; bold: (s: string) => string },
): void {
  printTitleFindings(report.titles, paint);
  if (!report.cases.length) return;
  if (report.titles.length) {
    // spacer already from titles
  }
  console.log('');
  console.log(
    `  ${paint.yellow('!')} ${paint.bold(`${report.cases.length} it() case(s) to rewrite`)} ${paint.dim('keep unique when-clause')}`,
  );
  console.log(
    `  ${paint.dim('Positive')} ${paint.cyan('creates … when …')}  ${paint.dim('errors')} ${paint.cyan('returns error when …')}  ${paint.dim('docs = after when')}`,
  );
  for (const item of report.cases) {
    console.log('');
    console.log(`  ${paint.cyan(item.file)}${paint.dim(`:${item.line}:${item.column}`)}`);
    console.log(`    ${paint.dim(item.raw)}`);
    if (item.suggestions.length) {
      console.log(`    ${paint.dim('suggest')} ${item.suggestions.map((name, i) => `${i + 1}:${name}`).join('  ')}`);
    }
  }
  console.log('');
  console.log(`  ${paint.dim('Fix interactively:')} ${paint.cyan('daxta titles')}`);
  console.log('');
}
