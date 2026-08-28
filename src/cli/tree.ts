import { existsSync, readFileSync } from 'fs';

import {
  resetConfig,
  getConfig,
  normalizeTreeLayout,
  type ExampleLabelStyle,
  type TreeLayout,
} from '../config';
import { listControllerPathTemplates } from '../fields/dto-fields';
import { getSpecJsonPath } from '../serve/paths';
import {
  findDaxtaConfigPath,
  formatTsString,
  formatTsStringRecord,
  previewTree,
  readTreePathOverrides,
  upsertConfigValue,
} from './config-edit';
import { banner, c, readlineAsk } from './ui';

function normalizePathInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('/') ? trimmed.replace(/\/+$/, '') || '/' : `/${trimmed.replace(/\/+$/, '')}`;
}

function layoutSegments(pathTemplate: string, layout: TreeLayout, skipParams: boolean): string[] {
  let parts = pathTemplate.split('/').filter(Boolean);
  if (parts.length >= 3 && /^v\d+$/i.test(parts[0]) && layout === 'resource-role') {
    parts = [parts[0], parts[2], parts[1], ...parts.slice(3)];
  }
  if (skipParams) {
    const idx = parts.findIndex((part) => part.startsWith('{'));
    if (idx >= 0) parts = parts.slice(0, idx);
  }
  return parts;
}

function listKnownPaths(): string[] {
  const fromSpec = new Set<string>();
  try {
    const specPath = getSpecJsonPath();
    if (existsSync(specPath)) {
      const spec = JSON.parse(readFileSync(specPath, 'utf8')) as { paths?: Record<string, unknown> };
      for (const key of Object.keys(spec.paths ?? {})) fromSpec.add(key);
    }
  } catch {
    // ignore
  }
  try {
    for (const pathTemplate of listControllerPathTemplates()) fromSpec.add(pathTemplate);
  } catch {
    // ignore
  }
  return [...fromSpec].sort((a, b) => a.localeCompare(b));
}

function printPathChoices(paths: string[], limit = 12): void {
  if (!paths.length) {
    console.log(`  ${c.dim('tip')} type a path like ${c.ice('/v1/admin/baskets')}`);
    return;
  }
  console.log(`  ${c.dim('known paths')}`);
  paths.slice(0, limit).forEach((item, index) => {
    console.log(`    ${c.dim(String(index + 1).padStart(2, ' '))}  ${c.ice(item)}`);
  });
  if (paths.length > limit) console.log(`    ${c.dim(`… +${paths.length - limit} more`)}`);
}

async function pickPath(flagPath?: string): Promise<string | null> {
  if (flagPath) return normalizePathInput(flagPath);
  const known = listKnownPaths();
  printPathChoices(known);
  const answer = await readlineAsk(
    `  ${c.gold('?')} ${c.bold('Path')} override ${c.dim('(number · path · n skip)')}\n  ${c.ice('›')} `,
  );
  if (!answer || /^n(o)?$/i.test(answer)) return null;
  if (/^\d+$/.test(answer)) {
    const picked = known[Number(answer) - 1];
    if (!picked) throw new Error(`No path #${answer}`);
    return picked;
  }
  return normalizePathInput(answer);
}

async function pickLayout(current: TreeLayout): Promise<TreeLayout> {
  const sample = '/v1/admin/baskets/{id}/lock';
  console.log('');
  console.log(`  ${c.bold('Folder order')} ${c.dim('(company default)')}`);
  console.log(`  ${c.dim('sample')} ${c.ice(sample)}`);
  console.log('');
  console.log(`    ${c.ice('1')}  role → resource  ${c.dim('recommended')}`);
  console.log(`       ${previewTree(layoutSegments(sample, 'role-resource', true))}`);
  console.log(`       ${c.dim('v1 › admin › baskets   (ops under baskets, not under {id})')}`);
  console.log('');
  console.log(`    ${c.ice('2')}  resource → role`);
  console.log(`       ${previewTree(layoutSegments(sample, 'resource-role', true))}`);
  console.log(`       ${c.dim('v1 › baskets › admin')}`);
  console.log('');
  console.log(`    ${c.ice('3')}  keep ${c.dim(`(${current})`)}`);
  const answer = await readlineAsk(`  ${c.gold('?')} Choose\n  ${c.ice('›')} `);
  if (!answer || answer === '3' || /^k(eep)?$/i.test(answer)) return current;
  if (answer === '1' || /^role/i.test(answer)) return 'role-resource';
  if (answer === '2' || /^resource/i.test(answer)) return 'resource-role';
  throw new Error(`Unknown layout: ${answer}`);
}

async function pickSkipParams(current: boolean): Promise<boolean> {
  console.log('');
  console.log(`  ${c.bold('Stop folders at path params')}`);
  console.log(`  ${c.dim('Avoid')} ${c.ice('{id}')} ${c.dim('→ complete / lock / pay as nested folders')}`);
  console.log(`    ${c.ice('1')}  yes — fold under resource ${c.dim('(recommended)')}`);
  console.log(`    ${c.ice('2')}  no — nest full path`);
  console.log(`    ${c.ice('3')}  keep ${c.dim(`(${current ? 'yes' : 'no'})`)}`);
  const answer = await readlineAsk(`  ${c.gold('?')} Choose\n  ${c.ice('›')} `);
  if (!answer || answer === '3' || /^k(eep)?$/i.test(answer)) return current;
  if (answer === '1' || /^y/i.test(answer)) return true;
  if (answer === '2' || /^n/i.test(answer)) return false;
  throw new Error(`Unknown choice: ${answer}`);
}

async function pickExampleStyle(current: ExampleLabelStyle): Promise<ExampleLabelStyle> {
  console.log('');
  console.log(`  ${c.bold('Example / scenario labels')}`);
  console.log(`  ${c.dim('Sidebar + OpenAPI export name for each test hit.')}`);
  console.log(`  ${c.dim('From')} ${c.ice('it()')} ${c.dim('— text after')} ${c.ice('when')} ${c.dim('becomes the scenario clause.')}`);
  console.log('');
  console.log(`  ${c.dim('sample')} ${c.ice('creates mock tbs when cyprus payload shape')}`);
  console.log('');
  console.log(`    ${c.ice('1')}  status-title-case ${c.dim('(default)')}`);
  console.log(`       ${c.dim('201 — Create Mock Tbs — cyprus payload shape')}`);
  console.log(`       ${c.dim('status + operation title + scenario')}`);
  console.log('');
  console.log(`    ${c.ice('2')}  status-case ${c.dim('(short)')}`);
  console.log(`       ${c.dim('201 — cyprus payload shape')}`);
  console.log(`       ${c.dim('status + scenario only')}`);
  console.log('');
  console.log(`    ${c.ice('3')}  full ${c.dim('(verbose — path + section)')}`);
  console.log(`       ${c.dim('201 — Create Mock Tbs - POST /v1/admin/mock-tbs POSITIVE CASES cyprus payload shape')}`);
  console.log('');
  console.log(`    ${c.ice('4')}  keep ${c.dim(`(${current})`)}`);
  const answer = await readlineAsk(`  ${c.gold('?')} Choose\n  ${c.ice('›')} `);
  if (!answer || answer === '4' || /^k(eep)?$/i.test(answer)) return current;
  if (answer === '1' || /title/i.test(answer)) return 'status-title-case';
  if (answer === '2' || /status-case/i.test(answer)) return 'status-case';
  if (answer === '3' || /^full/i.test(answer)) return 'full';
  throw new Error(`Unknown style: ${answer}`);
}

type LayoutChoice = { id: string; label: string; segments: string[] };

function layoutChoicesFor(pathTemplate: string, layout: TreeLayout, skipParams: boolean): LayoutChoice[] {
  const role = layoutSegments(pathTemplate, 'role-resource', skipParams);
  const resource = layoutSegments(pathTemplate, 'resource-role', skipParams);
  const choices: LayoutChoice[] = [
    { id: 'role', label: 'role → resource', segments: role },
    { id: 'resource', label: 'resource → role', segments: resource },
    { id: 'custom', label: 'Custom segments', segments: role },
  ];
  return choices;
}

async function pickSegments(
  pathTemplate: string,
  layout: TreeLayout,
  skipParams: boolean,
): Promise<string[] | null> {
  const choices = layoutChoicesFor(pathTemplate, layout, skipParams);
  console.log('');
  console.log(`  ${c.bold('Override')} ${c.ice(pathTemplate)}`);
  choices.forEach((choice, index) => {
    console.log(`    ${c.ice(String(index + 1))}  ${c.bold(choice.label)}`);
    console.log(`       ${previewTree(choice.segments)}`);
  });
  const answer = await readlineAsk(`  ${c.gold('?')} Choose\n  ${c.ice('›')} `);
  if (!answer || /^n(o)?$/i.test(answer)) return null;
  const index = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
  const selected = choices[index];
  if (!selected) throw new Error(`Unknown choice: ${answer}`);
  if (selected.id !== 'custom') return selected.segments;
  const typed = await readlineAsk(`  ${c.gold('?')} Segments ${c.dim('(space separated)')}\n  ${c.ice('›')} `);
  if (!typed) return null;
  return typed.split(/›|>|,|\s+/).map((part) => part.trim()).filter(Boolean);
}

export type TreeWizardOptions = {
  path?: string;
  layout?: string;
  embedded?: boolean;
  yes?: boolean;
};

/**
 * Company API docs presentation wizard — install / migrate / `daxta tree`.
 */
export async function runTreeWizard(options: TreeWizardOptions = {}): Promise<void> {
  if (options.yes || !process.stdin.isTTY) {
    if (!options.embedded) console.log(`  ${c.dim('tree wizard skipped (non-interactive)')}`);
    return;
  }

  if (!options.embedded) banner('DAxTA tree', 'API docs presentation');

  const configPath = findDaxtaConfigPath();
  if (!configPath) throw new Error('No daxta.config.ts found. Run `daxta install` first.');

  resetConfig();
  const config = getConfig(true);

  console.log('');
  console.log(`  ${c.gold(c.bold('?'))} ${c.bold('API docs presentation')} ${c.dim('— sidebar + OpenAPI export')}`);

  let layout = normalizeTreeLayout(
    options.layout === 'resource-first' || options.layout === 'resource-role'
      ? 'resource-role'
      : options.layout === 'url-order' || options.layout === 'role-resource'
        ? 'role-resource'
        : config.treeLayout,
  );

  if (!options.layout) layout = await pickLayout(layout);
  upsertConfigValue(configPath, 'treeLayout', formatTsString(layout));
  console.log(`  ${c.mint('✔')} treeLayout → ${c.ice(layout)}`);

  const skipParams = await pickSkipParams(config.treeSkipParams !== false);
  upsertConfigValue(configPath, 'treeSkipParams', skipParams ? 'true' : 'false');
  console.log(`  ${c.mint('✔')} treeSkipParams → ${c.ice(String(skipParams))}`);

  const exampleStyle = await pickExampleStyle(config.exampleLabelStyle ?? 'status-title-case');
  upsertConfigValue(configPath, 'exampleLabelStyle', formatTsString(exampleStyle));
  console.log(`  ${c.mint('✔')} exampleLabelStyle → ${c.ice(exampleStyle)}`);

  const customize = options.path
    ? 'y'
    : await readlineAsk(
        `  ${c.gold('?')} Per-path override now?\n` +
          `    ${c.dim('Y')} yes · ${c.dim('n')} later\n  ${c.ice('›')} `,
      );

  if (customize && !/^n(o)?$/i.test(customize)) {
    const pathTemplate = await pickPath(options.path);
    if (pathTemplate) {
      const segments = await pickSegments(pathTemplate, layout, skipParams);
      if (segments?.length) {
        const overrides = readTreePathOverrides();
        overrides[pathTemplate] = segments;
        upsertConfigValue(configPath, 'treePathOverrides', formatTsStringRecord(overrides));
        console.log(`  ${c.mint('✔')} ${c.ice(pathTemplate)} → ${previewTree(segments)}`);
      }
    }
  }

  if (!options.embedded) {
    console.log(`  ${c.dim('saved')} ${configPath}`);
    console.log(`  ${c.dim('refresh')} ${c.ice('daxta generate')}`);
    console.log('');
  }
}
