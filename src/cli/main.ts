import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

import { generateApiDocs } from '../build/build-spec';
import { runFileCall, runInteractiveCall } from '../call';
import { getConfig, resetConfig } from '../config';
import { exportPostmanFiles } from '../export/postman';
import { writeFieldsFile } from '../fields/export-fields';
import { serveApiDocs } from '../serve';
import { getSpecJsonPath } from '../serve/paths';
import { readStrippedOpenApiJson } from '../serve/spec-utils';
import { installDaxta } from './install';
import { migrateProject, reportMigration } from './migrate';
import { runDaxtaTest } from './test';
import { runTreeWizard } from './tree';
import { runTitleCheck } from './titles';
import { uninstallDaxta } from './uninstall';
import { box, c, step } from './ui';

const VALUE_FLAGS = new Set([
  '--port',
  '--out',
  '--fields',
  '--file',
  '--main',
  '--layout',
  '--env',
  '--script',
  '--title',
  '--version',
  '--name',
]);

function usage() {
  const cmd = (name: string) => c.bold(c.ice(name.padEnd(14)));
  console.log('');
  console.log(`  ${c.bold(c.ice('◆  DAxTA'))}  ${c.dim('Tested behavior. Trusted API docs.')}`);
  console.log(`  ${c.dim('│')}  ${c.mint('Quick start')}  ${c.ice('pnpm dlx @t0.labs/daxta install')}`);
  console.log(`  ${c.dim('│')}`);
  console.log(`  ${c.dim('├─')} ${c.gold('Setup')}`);
  console.log(`  ${c.dim('│')}    ${cmd('install')}     ${c.dim('Attach DAxTA to Jest and NestJS')}`);
  console.log(`  ${c.dim('│')}    ${cmd('migrate')}     ${c.dim('Upgrade project wiring after a package bump')}`);
  console.log(`  ${c.dim('│')}    ${cmd('uninstall')}   ${c.dim('Remove DAxTA from this project')}`);
  console.log(`  ${c.dim('│')}`);
  console.log(`  ${c.dim('├─')} ${c.gold('Generate & Export')}`);
  console.log(`  ${c.dim('│')}    ${cmd('generate')}    ${c.dim('Build OpenAPI + HTML (--postman for Postman collection)')}`);
  console.log(`  ${c.dim('│')}    ${cmd('export')}      ${c.dim('Export Postman collection + env, or OpenAPI JSON')}`);
  console.log(`  ${c.dim('│')}    ${cmd('serve')}       ${c.dim('Serve API documentation locally')}`);
  console.log(`  ${c.dim('│')}`);
  console.log(`  ${c.dim('├─')} ${c.gold('Tests & Naming')}`);
  console.log(`  ${c.dim('│')}    ${cmd('test')}        ${c.dim('Run project test script (--check-titles to lint names)')}`);
  console.log(`  ${c.dim('│')}    ${cmd('titles')}      ${c.dim('Align describe/it() names with API docs & examples')}`);
  console.log(`  ${c.dim('│')}    ${cmd('tree')}        ${c.dim('Configure sidebar folder layout & example label style')}`);
  console.log(`  ${c.dim('│')}`);
  console.log(`  ${c.dim('└─')} ${c.gold('Try-it')}`);
  console.log(`       ${cmd('fields')}      ${c.dim('Export API field map')}`);
  console.log(`       ${cmd('call')}        ${c.dim('Send a Try-it request from the CLI')}`);
  console.log('');
  console.log(`  ${c.dim('Run')} ${c.ice('pnpm dlx @t0.labs/daxta <command> --help')} ${c.dim('for flags and examples.')}`);
  console.log('');
}

const COMMAND_HELP: Record<string, { summary: string; usage: string; flags: Array<[string, string]>; examples: string[] }> = {
  install: {
    summary: 'Attach DAxTA to Jest, create daxta.config.ts, and wire apiDocs(app).',
    usage: 'daxta install [--dry-run] [--yes] [--main <path>] [--skip-dep] [--skip-main]',
    flags: [
      ['--dry-run', 'Preview changes without writing files'],
      ['--yes', 'Accept defaults without interactive prompts'],
      ['--main <path>', 'Path to NestJS main.ts'],
      ['--skip-dep', 'Skip installing @t0.labs/daxta'],
      ['--skip-main', 'Do not inject apiDocs(app) into main.ts'],
    ],
    examples: ['daxta install', 'daxta install --yes --main src/main.ts'],
  },
  generate: {
    summary: 'Build OpenAPI spec and standalone HTML viewer from recorded test hits.',
    usage: 'daxta generate [--postman] [--ui] [--out <path>] [--env <name>]',
    flags: [
      ['--postman', 'Also export Postman Collection v2.1 + Environment'],
      ['--ui', 'Refresh only the HTML viewer from existing openapi.json'],
      ['--out <path>', 'Output file/directory for Postman export (with --postman)'],
      ['--env <name>', 'Environment preset name from daxta.config.ts'],
    ],
    examples: ['daxta generate', 'daxta generate --ui', 'daxta generate --postman', 'daxta generate --postman --out ./collections'],
  },
  export: {
    summary: 'Export Postman Collection v2.1 (+ Environment) or stripped OpenAPI JSON.',
    usage: 'daxta export [postman|openapi] [--out <path>] [--env <name>] [--no-env] [--no-vars]',
    flags: [
      ['--out <path>', 'Output file or directory'],
      ['--env <name>', 'Select envPreset from daxta.config.ts'],
      ['--no-env', 'Skip writing .postman_environment.json'],
      ['--no-vars', 'Use concrete server URL instead of {{baseUrl}}'],
    ],
    examples: [
      'daxta export',
      'daxta export postman --out ./postman',
      'daxta export openapi --out ./openapi.json',
    ],
  },
  serve: {
    summary: 'Serve generated API docs locally with Try-it proxy.',
    usage: 'daxta serve [--port <number>]',
    flags: [['--port <number>', 'Port to listen on (default from daxta.config.ts or 4400)']],
    examples: ['daxta serve', 'daxta serve --port 4500'],
  },
  test: {
    summary: 'Run the project test script (Jest stays parent and records HTTP traffic).',
    usage: 'daxta test [--check-titles] [--yes] [--strict] [--script <name>] [-- <jest args>]',
    flags: [
      ['--check-titles', 'Run title/example naming check before tests'],
      ['--yes', 'Auto-apply safe naming fixes (with --check-titles)'],
      ['--strict', 'Fail if unformatted test names remain'],
      ['--script <name>', 'Override package.json test script'],
    ],
    examples: ['daxta test', 'daxta test --check-titles', 'daxta test -- --runInBand'],
  },
  titles: {
    summary: 'Scan and align describe() / it() test names for clean operation & example labels.',
    usage: 'daxta titles [--check] [--yes] [--strict]',
    flags: [
      ['--check', 'Report findings without modifying files'],
      ['--yes', 'Auto-apply recommended rewrites'],
      ['--strict', 'Exit with code 1 if findings remain'],
    ],
    examples: ['daxta titles', 'daxta titles --check', 'daxta titles --yes'],
  },
  tree: {
    summary: 'Configure sidebar folder layout and example label style in daxta.config.ts.',
    usage: 'daxta tree [<path>] [--layout <role-resource|resource-role>]',
    flags: [['--layout <mode>', 'Set treeLayout: role-resource or resource-role']],
    examples: ['daxta tree', 'daxta tree --layout resource-role'],
  },
  fields: {
    summary: 'Export API field map JSON for Try-it / CLI calls.',
    usage: 'daxta fields [<method> <path>] [--out <file>]',
    flags: [['--out <file>', 'Target JSON file path']],
    examples: ['daxta fields', 'daxta fields post /v1/users'],
  },
  call: {
    summary: 'Send an interactive or file-driven Try-it HTTP request.',
    usage: 'daxta call [<method> <path>] [--file <values.json>] [--fields <file>] [--header <k:v>]',
    flags: [
      ['--file <path>', 'Execute request from a JSON values file'],
      ['--fields <path>', 'Field map JSON file'],
      ['--header <k:v>', 'Add a request header (repeatable)'],
    ],
    examples: ['daxta call', 'daxta call get /v1/users --header "Authorization: Bearer ..."'],
  },
};

function printCommandHelp(command: string): boolean {
  const canonical =
    command === 'build'
      ? 'generate'
      : command === 'init'
        ? 'install'
        : command === 'title'
          ? 'titles'
          : command;
  const info = COMMAND_HELP[canonical];
  if (!info) return false;
  console.log('');
  console.log(`  ${c.bold(c.ice(`daxta ${canonical}`))}  ${c.dim(info.summary)}`);
  console.log('');
  console.log(`  ${c.gold('Usage')}`);
  console.log(`    ${info.usage}`);
  if (info.flags.length) {
    console.log('');
    console.log(`  ${c.gold('Flags')}`);
    for (const [flag, desc] of info.flags) {
      console.log(`    ${c.ice(flag.padEnd(20))} ${c.dim(desc)}`);
    }
  }
  if (info.examples.length) {
    console.log('');
    console.log(`  ${c.gold('Examples')}`);
    for (const ex of info.examples) {
      console.log(`    ${c.dim('$')} ${ex}`);
    }
  }
  console.log('');
  return true;
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const headers: Record<string, string> = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--') break;
    if (VALUE_FLAGS.has(token)) {
      const next = rest[++i];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${token}`);
      }
      flags[token.slice(2)] = next;
    } else if (token === '--header') {
      const raw = rest[++i] ?? '';
      const idx = raw.indexOf(':');
      if (idx === -1) throw new Error(`Invalid --header "${raw}"; expected name:value`);
      headers[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
    } else if (token.startsWith('--no-')) {
      flags[token.slice(5)] = false;
    } else if (token.startsWith('--')) {
      flags[token.slice(2)] = true;
    } else if (token === '-h') {
      flags.help = true;
    } else if (token === '-y') {
      flags.yes = true;
    } else {
      positional.push(token);
    }
  }

  return { command, rest, positional, flags, headers };
}

async function handleExport(positional: string[], flags: Record<string, string | boolean>) {
  const format = (positional[0] || 'postman').toLowerCase();
  if (format !== 'postman' && format !== 'openapi') {
    throw new Error(`Unknown export format "${format}". Expected "postman" or "openapi".`);
  }

  if (!existsSync(getSpecJsonPath())) {
    await step('Building OpenAPI spec from recorded hits', () => {
      const build = generateApiDocs({ requireHits: false, silent: true });
      if (build.skipped) {
        throw new Error('No OpenAPI spec or recorded hits found. Run your integration tests first.');
      }
      return `${build.operations} ops · ${build.hits} hits`;
    });
  }

  if (format === 'openapi') {
    const body = readStrippedOpenApiJson();
    if (!body) throw new Error('Failed to read OpenAPI spec.');
    const target = typeof flags.out === 'string' ? path.resolve(flags.out) : path.resolve('openapi.json');
    await step('Writing OpenAPI JSON', () => {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, body);
      return path.basename(target);
    });
    box('OpenAPI Export Ready', [`Spec: ${c.ice(path.relative(process.cwd(), target) || target)}`]);
    return;
  }

  let result!: ReturnType<typeof exportPostmanFiles>;
  await step('Exporting Postman Collection v2.1', () => {
    result = exportPostmanFiles({
      out: typeof flags.out === 'string' ? flags.out : undefined,
      envName: typeof flags.env === 'string' ? flags.env : undefined,
      includeEnv: flags.env !== false,
      useEnvVar: flags.vars !== false,
    });
    return `${result.operations} ops · ${result.examples} examples`;
  });

  const relCol = path.relative(process.cwd(), result.collectionPath) || result.collectionPath;
  const lines = [`Collection:  ${c.ice(relCol)}`];
  if (result.environmentPath) {
    const relEnv = path.relative(process.cwd(), result.environmentPath) || result.environmentPath;
    lines.push(`Environment: ${c.ice(relEnv)}`);
  }
  lines.push(`Coverage:    ${result.operations} operations · ${result.examples} named examples`);
  box('Postman Export Ready', lines);
}

async function main() {
  const { command, rest, positional, flags, headers } = parseArgs(process.argv);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    if (positional[0] && printCommandHelp(positional[0])) return;
    usage();
    return;
  }

  if (flags.help) {
    if (printCommandHelp(command)) return;
    usage();
    return;
  }

  if (command === 'migrate') {
    const migration = migrateProject(process.cwd(), { force: true });
    if (!migration.changed) {
      console.log(`DAxTA already up to date (v${migration.toVersion})`);
    } else {
      reportMigration({ ...migration, skipped: false });
    }
    await runTreeWizard({ embedded: true, yes: Boolean(flags.yes) });
    await runTitleCheck({ yes: Boolean(flags.yes) });
    return;
  }

  if (command === 'uninstall' || command === 'remove') {
    await uninstallDaxta({
      dryRun: Boolean(flags['dry-run']),
      yes: Boolean(flags.yes),
      fast: Boolean(flags.fast),
      keepDep: Boolean(flags['keep-dep']),
    });
    return;
  }

  resetConfig();
  getConfig(true);

  if (typeof flags.title === 'string') process.env.DAXTA_SPEC_TITLE = flags.title;
  if (typeof flags.version === 'string') process.env.DAXTA_SPEC_VERSION = flags.version;

  if (command === 'install' || command === 'init') {
    await installDaxta({
      dryRun: Boolean(flags['dry-run']),
      skipDep: Boolean(flags['skip-dep']),
      skipMain: Boolean(flags['skip-main']),
      yes: Boolean(flags.yes),
      fast: Boolean(flags.fast),
      mainPath: typeof flags.main === 'string' ? flags.main : undefined,
      serviceName:
        typeof flags.name === 'string'
          ? flags.name
          : typeof flags.title === 'string'
            ? flags.title
            : undefined,
    });
    reportMigration(migrateProject(process.cwd(), { force: true }));
    return;
  }

  if (command === 'titles' || command === 'title') {
    const code = await runTitleCheck({
      checkOnly: Boolean(flags.check),
      apply: Boolean(flags.yes) && !flags.check,
      yes: Boolean(flags.yes),
      strict: Boolean(flags.strict),
    });
    if (code) process.exitCode = code;
    return;
  }

  if (command === 'test') {
    const argv = rest[0] === '--' ? rest.slice(1) : rest;
    await runDaxtaTest({ argv });
    return;
  }

  if (command === 'generate' || command === 'build') {
    reportMigration(migrateProject());
    generateApiDocs({ requireHits: !flags.ui, uiOnly: Boolean(flags.ui) });
    if (flags.postman) {
      await handleExport(['postman'], flags);
    }
    return;
  }

  if (command === 'export') {
    await handleExport(positional, flags);
    return;
  }

  if (command === 'serve') {
    const port = flags.port ? Number(flags.port) : undefined;
    serveApiDocs({ port });
    return;
  }

  if (command === 'tree') {
    await runTreeWizard({
      path: positional[0],
      layout: typeof flags.layout === 'string' ? flags.layout : undefined,
    });
    return;
  }

  if (command === 'fields') {
    const method = positional[0]?.toLowerCase();
    const pathTemplate = positional[1];
    const out = typeof flags.out === 'string' ? flags.out : undefined;
    const target = writeFieldsFile(method || pathTemplate ? { method, path: pathTemplate } : undefined, out);
    console.log(`Wrote ${target}`);
    return;
  }

  if (command === 'call') {
    if (typeof flags.file === 'string') {
      await runFileCall({ valuesFile: flags.file, headers });
      return;
    }
    const method = positional[0]?.toLowerCase();
    const pathTemplate = positional[1];
    await runInteractiveCall({
      fieldsFile: typeof flags.fields === 'string' ? flags.fields : undefined,
      method,
      path: pathTemplate,
      headers,
    });
    return;
  }

  console.error(`  ${c.red('✖')} Unknown command: ${c.bold(command)}`);
  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
