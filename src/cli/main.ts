import { generateApiDocs } from '../build/build-spec';
import { runFileCall, runInteractiveCall } from '../call';
import { getConfig, resetConfig } from '../config';
import { writeFieldsFile } from '../fields/export-fields';
import { serveApiDocs } from '../serve';
import { installDaxta } from './install';
import { migrateProject, reportMigration } from './migrate';
import { runDaxtaTest } from './test';
import { runTreeWizard } from './tree';
import { runTitleCheck } from './titles';
import { uninstallDaxta } from './uninstall';
import { c } from './ui';

function usage() {
  const cmd = (name: string) => c.bold(c.ice(name));
  console.log('');
  console.log(`  ${c.bold(c.ice('DAxTA'))}`);
  console.log(`  ${c.dim('Tested behavior. Trusted API docs.')}`);
  console.log('');
  console.log(`  ${c.gold('Setup')}`);
  console.log(`    ${cmd('daxta install')}     ${c.dim('Install DAxTA in this project')}`);
  console.log(`    ${cmd('daxta uninstall')}   ${c.dim('Remove DAxTA from this project')}`);
  console.log(`    ${cmd('daxta migrate')}     ${c.dim('Upgrade project wiring after a package bump')}`);
  console.log('');
  console.log(`  ${c.gold('API docs')}`);
  console.log(`    ${cmd('daxta generate')}    ${c.dim('Generate API documentation from test execution')}`);
  console.log(`    ${cmd('daxta serve')}       ${c.dim('Serve API documentation locally')}`);
  console.log(`    ${cmd('daxta tree')}        ${c.dim('Configure API docs sidebar layout')}`);
  console.log(`    ${cmd('daxta titles')}      ${c.dim('Align test titles with API docs examples')}`);
  console.log(`    ${cmd('daxta test')}        ${c.dim('Run the project test script (Jest stays parent)')}`);
  console.log('');
  console.log(`  ${c.gold('Try-it')}`);
  console.log(`    ${cmd('daxta fields')}      ${c.dim('Export API field map')}`);
  console.log(`    ${cmd('daxta call')}        ${c.dim('Send a Try-it request from the CLI')}`);
  console.log('');
  console.log(`  ${c.mint('First time')}  ${c.ice('pnpm dlx @t0.labs/daxta install')}`);
  console.log('');
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
    if (token === '--port' || token === '--out' || token === '--fields' || token === '--file' || token === '--main' || token === '--layout') {
      flags[token.slice(2)] = rest[++i];
    } else if (token === '--header') {
      const raw = rest[++i] ?? '';
      const idx = raw.indexOf(':');
      if (idx === -1) throw new Error(`Invalid --header ${raw}; expected name:value`);
      headers[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
    } else if (token.startsWith('--')) {
      flags[token.slice(2)] = true;
    } else {
      positional.push(token);
    }
  }

  return { command, rest, positional, flags, headers };
}

async function main() {
  const { command, rest, positional, flags, headers } = parseArgs(process.argv);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  // Migrate only on package version bump (or daxta migrate --force)
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

  reportMigration(migrateProject());

  resetConfig();
  getConfig(true);

  if (command === 'install' || command === 'init') {
    await installDaxta({
      dryRun: Boolean(flags['dry-run']),
      skipDep: Boolean(flags['skip-dep']),
      skipMain: Boolean(flags['skip-main']),
      yes: Boolean(flags.yes),
      fast: Boolean(flags.fast),
      mainPath: typeof flags.main === 'string' ? flags.main : undefined,
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
    generateApiDocs({ requireHits: true });
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

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
