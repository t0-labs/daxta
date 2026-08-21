import { buildDaxtaSpec } from '../build/build-spec';
import { runFileCall, runInteractiveCall } from '../call';
import { getConfig, resetConfig } from '../config';
import { writeFieldsFile } from '../fields/export-fields';
import { serveApiDocs } from '../serve';
import { installDaxta } from './install';
import { migrateProject, reportMigration } from './migrate';
import { runDaxtaTest } from './test';
import { runTreeWizard } from './tree';

function usage() {
  console.log(`DAxTA CLI (@t0.labs/daxta)

Usage:
  daxta install [--dry-run] [--skip-dep] [--skip-main] [--yes] [--main <path>] [--fast]
  daxta init                 (alias of install)
  daxta migrate [--yes]      (force upgrade + sidebar prompts)
  daxta test [--script <name>] [--config <jest.json>] [--serve] [--port <n>] [--yes]
  daxta build
  daxta serve [--port <n>]
  daxta tree [PATH] [--layout resource-first|url-order]
  daxta fields [METHOD] [PATH] [--out <file>]
  daxta call [METHOD] [PATH] [--fields <file>] [--header k:v ...]
  daxta call --file <values.json> [--header k:v ...]

One-shot setup:
  pnpm dlx @t0.labs/daxta install
  npx @t0.labs/daxta install

daxta test = forwards to your package script (Jest stays parent; DAxTA is a plugin)
daxta tree = choose how paths appear in the /docs sidebar
`);
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

  if (command === 'test') {
    const argv = rest[0] === '--' ? rest.slice(1) : rest;
    await runDaxtaTest({ argv });
    return;
  }

  if (command === 'build') {
    buildDaxtaSpec({ requireHits: true });
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
