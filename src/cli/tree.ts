import { createInterface } from 'readline';
import { existsSync, readFileSync } from 'fs';

import { resetConfig, getConfig, type TreeLayout } from '../config';
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
import { banner, c } from './ui';

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function normalizePathInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('/') ? trimmed.replace(/\/+$/, '') || '/' : `/${trimmed.replace(/\/+$/, '')}`;
}

function urlOrderSegments(pathTemplate: string): string[] {
  return pathTemplate.split('/').filter(Boolean);
}

function resourceFirstSegments(pathTemplate: string): string[] {
  const parts = urlOrderSegments(pathTemplate);
  if (parts.length >= 3 && /^v\d+$/i.test(parts[0])) {
    return [parts[0], parts[2], parts[1], ...parts.slice(3)];
  }
  return parts;
}

/** Put known "area" segments (admin/device/…) right after version. */
function areaFirstSegments(pathTemplate: string): string[] {
  const parts = urlOrderSegments(pathTemplate);
  if (parts.length < 3 || !/^v\d+$/i.test(parts[0])) return parts;
  const areas = new Set(['admin', 'device', 'devices', 'user', 'users', 'me', 'internal', 'public']);
  const version = parts[0];
  const rest = parts.slice(1);
  const areaIdx = rest.findIndex((part) => areas.has(part.toLowerCase()) && !part.startsWith('{'));
  if (areaIdx <= 0) return parts;
  const area = rest[areaIdx];
  const without = [...rest.slice(0, areaIdx), ...rest.slice(areaIdx + 1)];
  return [version, area, ...without];
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
    // controllers may not parse yet
  }
  return [...fromSpec].sort((a, b) => a.localeCompare(b));
}

function printPathChoices(paths: string[], limit = 12): void {
  if (!paths.length) {
    console.log(`  ${c.dim('tip')} type a path like ${c.cyan('/v1/admin/baskets')}`);
    return;
  }
  console.log(`  ${c.dim('known paths')}`);
  paths.slice(0, limit).forEach((item, index) => {
    console.log(`    ${c.dim(String(index + 1).padStart(2, ' '))}  ${c.cyan(item)}`);
  });
  if (paths.length > limit) console.log(`    ${c.dim(`… +${paths.length - limit} more`)}`);
}

async function pickPath(flagPath?: string): Promise<string | null> {
  if (flagPath) return normalizePathInput(flagPath);

  const known = listKnownPaths();
  printPathChoices(known);

  const answer = await prompt(
    `  ${c.yellow('?')} ${c.bold('Path')} to arrange in the sidebar\n` +
      `    ${c.dim('number · /v1/admin/baskets · or n to skip')}\n  ${c.cyan('›')} `,
  );
  if (!answer || /^n(o)?$/i.test(answer)) return null;
  if (/^\d+$/.test(answer)) {
    const picked = known[Number(answer) - 1];
    if (!picked) throw new Error(`No path #${answer}`);
    return picked;
  }
  return normalizePathInput(answer);
}

async function pickGlobalLayout(current: TreeLayout): Promise<TreeLayout | null> {
  const sample = '/v1/admin/baskets';
  console.log('');
  console.log(`  ${c.bold('Docs sidebar layout')}`);
  console.log(`  ${c.dim('Example')} ${c.cyan(sample)}`);
  console.log('');
  console.log(`    ${c.cyan('1')}  resource-first`);
  console.log(`       ${previewTree(resourceFirstSegments(sample))}`);
  console.log(`       ${c.dim('v1 → baskets → admin')}`);
  console.log('');
  console.log(`    ${c.cyan('2')}  url-order`);
  console.log(`       ${previewTree(urlOrderSegments(sample))}`);
  console.log(`       ${c.dim('v1 → admin → baskets')}`);
  console.log('');
  console.log(`    ${c.cyan('3')}  keep ${c.dim(`(${current})`)}`);
  const answer = await prompt(`  ${c.yellow('?')} How should folders nest under /docs?\n  ${c.cyan('›')} `);
  if (!answer || answer === '3' || /^k(eep)?$/i.test(answer)) return null;
  if (answer === '1' || /^resource/i.test(answer)) return 'resource-first';
  if (answer === '2' || /^url/i.test(answer)) return 'url-order';
  throw new Error(`Unknown layout choice: ${answer}`);
}

type LayoutChoice = { id: string; label: string; segments: string[] };

function layoutChoicesFor(pathTemplate: string): LayoutChoice[] {
  const url = urlOrderSegments(pathTemplate);
  const resource = resourceFirstSegments(pathTemplate);
  const area = areaFirstSegments(pathTemplate);
  const choices: LayoutChoice[] = [
    { id: 'url', label: 'URL order', segments: url },
    { id: 'resource', label: 'Resource-first', segments: resource },
  ];
  if (area.join('/') !== url.join('/') && area.join('/') !== resource.join('/')) {
    choices.push({ id: 'area', label: 'Area-first (admin/device/…)', segments: area });
  }
  choices.push({ id: 'custom', label: 'Custom segments', segments: url });
  return choices;
}

async function pickSegments(pathTemplate: string): Promise<string[] | null> {
  const choices = layoutChoicesFor(pathTemplate);
  console.log('');
  console.log(`  ${c.bold('Sidebar for')} ${c.cyan(pathTemplate)}`);
  console.log(`  ${c.dim('Which nesting do you want?')}`);
  choices.forEach((choice, index) => {
    const mark = c.cyan(String(index + 1));
    console.log(`    ${mark}  ${c.bold(choice.label)}`);
    console.log(`       ${previewTree(choice.segments)}`);
  });

  const answer = await prompt(`  ${c.yellow('?')} Choose\n  ${c.cyan('›')} `);
  if (!answer || /^n(o)?$/i.test(answer)) return null;

  const index = /^\d+$/.test(answer)
    ? Number(answer) - 1
    : choices.findIndex((choice) => choice.id === answer || choice.label.toLowerCase().startsWith(answer.toLowerCase()));
  const selected = choices[index];
  if (!selected) throw new Error(`Unknown choice: ${answer}`);

  if (selected.id !== 'custom') return selected.segments;

  const typed = await prompt(
    `  ${c.yellow('?')} Segments in order ${c.dim('(space or › separated)')}\n` +
      `    ${c.dim('e.g. v1 baskets admin')}\n  ${c.cyan('›')} `,
  );
  if (!typed) return null;
  return typed
    .split(/›|>|,|\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function saveLayout(configPath: string, layout: TreeLayout): void {
  upsertConfigValue(configPath, 'treeLayout', formatTsString(layout));
}

function saveOverride(configPath: string, pathTemplate: string, segments: string[]): void {
  const overrides = readTreePathOverrides();
  overrides[pathTemplate] = segments;
  upsertConfigValue(configPath, 'treePathOverrides', formatTsStringRecord(overrides));
}

export type TreeWizardOptions = {
  path?: string;
  layout?: string;
  /** Called from install — no extra banner, always ask layout when TTY */
  embedded?: boolean;
  yes?: boolean;
};

/**
 * Interactive sidebar layout wizard.
 * Also used at the end of `daxta install` so the question is not a hidden separate command.
 */
export async function runTreeWizard(options: TreeWizardOptions = {}): Promise<void> {
  if (options.yes || !process.stdin.isTTY) {
    if (!options.embedded) {
      console.log(`  ${c.dim('tree wizard skipped (non-interactive)')}`);
    }
    return;
  }

  if (!options.embedded) banner('DAxTA tree', 'sidebar folder order');

  const configPath = findDaxtaConfigPath();
  if (!configPath) {
    throw new Error('No daxta.config.ts found. Run `daxta install` first.');
  }

  resetConfig();
  const config = getConfig(true);

  console.log('');
  console.log(`  ${c.yellow(c.bold('?'))} ${c.bold('Sidebar')} ${c.dim('— how /docs folders nest')}`);

  if (options.layout === 'resource-first' || options.layout === 'url-order') {
    saveLayout(configPath, options.layout);
    console.log(`  ${c.green('✔')} treeLayout → ${c.cyan(options.layout)}`);
  } else {
    const layout = await pickGlobalLayout(config.treeLayout);
    if (layout) {
      saveLayout(configPath, layout);
      console.log(`  ${c.green('✔')} treeLayout → ${c.cyan(layout)}`);
    } else {
      console.log(`  ${c.dim('kept')} treeLayout ${c.cyan(config.treeLayout)}`);
    }
  }

  const customize = options.path
    ? 'y'
    : await prompt(
        `  ${c.yellow('?')} Customize a specific path now?\n` +
          `    ${c.dim('Y')} yes · ${c.dim('n')} later ${c.dim('(daxta tree)')}\n  ${c.cyan('›')} `,
      );

  if (customize && !/^n(o)?$/i.test(customize)) {
    const pathTemplate = await pickPath(options.path);
    if (pathTemplate) {
      const segments = await pickSegments(pathTemplate);
      if (segments?.length) {
        saveOverride(configPath, pathTemplate, segments);
        console.log('');
        console.log(`  ${c.green('✔')} ${c.cyan(pathTemplate)}`);
        console.log(`     ${previewTree(segments)}`);
      }
    }
  }

  if (!options.embedded) {
    console.log(`  ${c.dim('saved to')} ${configPath}`);
    console.log(`  ${c.dim('refresh docs:')} ${c.cyan('daxta build')}`);
    console.log('');
  }
}
