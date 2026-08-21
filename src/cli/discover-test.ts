import { createInterface } from 'readline';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

import { c } from './ui';

export type TestScriptChoice = {
  name: string;
  command: string;
};

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function scoreScript(name: string, command: string): number {
  const n = name.toLowerCase();
  const cmd = command.toLowerCase();
  let score = 0;
  if (n.includes('integration')) score += 100;
  if (n.includes('e2e')) score += 80;
  if (n.includes('api')) score += 40;
  if (n === 'test') score += 10;
  if (cmd.includes('jest')) score += 30;
  if (cmd.includes('daxta test')) score += 25; // already wired
  if (cmd.includes('integration')) score += 20;
  if (n.includes('unit') || n.includes('watch') || n.includes('cov')) score -= 50;
  return score;
}

export function isDaxtaWrappedScript(command: string | undefined): boolean {
  return Boolean(command && /\bdaxta\s+test\b/.test(command));
}

/** package.json scripts that look like runnable test entrypoints */
export function listTestScripts(scripts: Record<string, string> | undefined): TestScriptChoice[] {
  if (!scripts) return [];
  const out: TestScriptChoice[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (name.startsWith('daxta:')) continue;
    const n = name.toLowerCase();
    if (!(n === 'test' || n.startsWith('test:') || n.includes('e2e') || n.includes('integration'))) continue;
    out.push({ name, command });
  }
  return out.sort((a, b) => scoreScript(b.name, b.command) - scoreScript(a.name, a.command));
}

/** Extract `--config` / `-c` path from a script command string */
export function extractJestConfigFromCommand(command: string): string | null {
  const m =
    command.match(/--config(?:=|\s+)(['"]?)([^'"\s]+)\1/) ||
    command.match(/(?:^|\s)-c(?:=|\s+)(['"]?)([^'"\s]+)\1/);
  return m?.[2] ?? null;
}

/**
 * Ask which package.json script to wire.
 * Returns script name (e.g. test:integration) or null to skip.
 */
export async function resolveTestScript(options: {
  cwd: string;
  scripts?: Record<string, string>;
  configured?: string;
  yes?: boolean;
  flag?: string;
}): Promise<string | null> {
  if (options.flag) return options.flag;
  if (options.configured) return options.configured;

  const choices = listTestScripts(options.scripts);
  if (!choices.length) {
    if (options.yes || !process.stdin.isTTY) return null;
    const typed = await prompt(
      `  ${c.yellow('?')} ${c.bold('No test script found.')} Enter script name, or ${c.dim('n')} to skip:\n  ${c.cyan('›')} `,
    );
    if (!typed || /^n(o)?$/i.test(typed)) return null;
    return typed;
  }

  const def = choices[0];
  if (options.yes || !process.stdin.isTTY) return def.name;

  console.log(`  ${c.dim('your scripts')}`);
  choices.slice(0, 8).forEach((choice, i) => {
    const mark = i === 0 ? c.cyan('●') : c.dim('○');
    const label = i === 0 ? c.bold(choice.name) : c.dim(choice.name);
    const cmd = isDaxtaWrappedScript(choice.command) ? '(already wired → daxta test)' : choice.command.slice(0, 56);
    console.log(`    ${mark} ${label}  ${c.dim(cmd)}`);
  });

  const answer = await prompt(
    `  ${c.yellow('?')} Attach DAxTA plugin to ${c.cyan(def.name)}?\n` +
      `    ${c.dim('Y')} yes · ${c.dim('n')} skip · or type another script name\n  ${c.cyan('›')} `,
  );

  if (!answer || /^y(es)?$/i.test(answer)) return def.name;
  if (/^n(o)?$/i.test(answer)) return null;
  return answer;
}

function upsertConfigFields(
  cwd: string,
  fields: Record<string, string>,
  dryRun = false,
): string {
  const configPath = path.join(cwd, 'daxta.config.ts');
  if (!existsSync(configPath)) return 'no daxta.config.ts to update';

  let text = readFileSync(configPath, 'utf8');
  const notes: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    const literal = JSON.stringify(value);
    const re = new RegExp(`${key}\\s*:\\s*['\`][^'\`"]*['\`]|${key}\\s*:\\s*"[^"]*"`);
    if (re.test(text)) {
      text = text.replace(re, `${key}: ${literal}`);
      notes.push(`updated ${key}`);
    } else {
      const next = text.replace(/defineConfig\(\s*\{/, `defineConfig({\n  ${key}: ${literal},`);
      if (next === text) throw new Error(`Could not insert ${key} into daxta.config.ts`);
      text = next;
      notes.push(`set ${key}`);
    }
  }

  if (!dryRun) writeFileSync(configPath, text);
  return notes.join(', ');
}

/** Persist test wiring + optional jestConfig path */
export function upsertTestWiringInConfig(
  cwd: string,
  wiring: { testScript: string; testCommand: string; jestConfig?: string },
  dryRun = false,
): string {
  const fields: Record<string, string> = {
    testScript: wiring.testScript,
    testCommand: wiring.testCommand,
  };
  if (wiring.jestConfig) fields.jestConfig = wiring.jestConfig;
  return upsertConfigFields(cwd, fields, dryRun);
}

/**
 * @deprecated wrapping scripts made DAxTA the parent process — do not use.
 * Kept for migrate unwrap only.
 */
export function wrapUserTestScript(
  scripts: Record<string, string>,
  scriptName: string,
): { original: string; changed: boolean } {
  const current = scripts[scriptName];
  if (!current) throw new Error(`Script not found: ${scriptName}`);
  if (isDaxtaWrappedScript(current)) {
    return { original: current, changed: false };
  }
  scripts[scriptName] = 'daxta test --yes';
  return { original: current, changed: true };
}
