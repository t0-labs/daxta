import { existsSync, readFileSync } from 'fs';

import {
  resetConfig,
  getConfig,
  normalizeTreeLayout,
  type ExampleLabelStyle,
  type SubResourceMode,
  type TreeLayout,
  type WriteMode,
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
import { banner, c, confirmPrompt, readlineAsk, selectMenu } from './ui';

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
  return selectMenu<TreeLayout>({
    title: 'Folder order',
    subtitle: `sample: ${sample}`,
    initialIndex: current === 'resource-role' ? 1 : 0,
    options: [
      {
        value: 'role-resource',
        label: 'role → resource',
        badge: 'recommended',
        preview: previewTree(layoutSegments(sample, 'role-resource', true)),
        hint: 'URL order — ops grouped under resource',
      },
      {
        value: 'resource-role',
        label: 'resource → role',
        preview: previewTree(layoutSegments(sample, 'resource-role', true)),
        hint: 'Resource first, then role',
      },
    ],
  });
}

async function pickSkipParams(current: boolean): Promise<boolean> {
  return selectMenu<boolean>({
    title: 'Stop folders at path params',
    subtitle: 'Avoid {id} → complete / lock as nested folders',
    initialIndex: current ? 0 : 1,
    options: [
      {
        value: true,
        label: 'Fold under resource',
        badge: 'recommended',
        hint: 'POST /baskets/{id}/lock stays under baskets',
      },
      {
        value: false,
        label: 'Nest full path',
        hint: 'Create folders for every URL segment',
      },
    ],
  });
}

async function pickSubResourceMode(current: SubResourceMode, layout: TreeLayout): Promise<SubResourceMode> {
  const roleFirst = layout === 'role-resource';
  const initialIndex = current === 'controller' ? 0 : current === 'merge' ? 1 : current === 'root' ? 2 : 3;
  return selectMenu<SubResourceMode>({
    title: 'Sub-resources after main resource',
    subtitle: 'e.g. /v1/public/solution-partner-identity/auth/phone/verify-otp',
    initialIndex,
    options: [
      {
        value: 'controller',
        label: 'Group by @Controller path',
        badge: 'recommended',
        preview: roleFirst ? 'v1 › public › solution-partner-identity' : 'v1 › solution-partner-identity › public',
        hint: 'Stops folders at each Nest @Controller(...) prefix; method routes sit inside',
      },
      {
        value: 'merge',
        label: 'Merge into one folder (shopping-cart-items)',
        preview: roleFirst ? 'v1 › public › shopping-cart-items' : 'v1 › shopping-cart-items › public',
        hint: 'Joins sub-resources with "-" instead of opening extra subfolders',
      },
      {
        value: 'root',
        label: 'Group under main resource (shopping-cart)',
        preview: roleFirst ? 'v1 › public › shopping-cart' : 'v1 › shopping-cart › public',
        hint: 'Keeps all sub-routes directly under the first resource segment',
      },
      {
        value: 'nested',
        label: 'Keep nested subfolders (auth › phone)',
        preview: roleFirst
          ? 'v1 › public › solution-partner-identity › auth › phone'
          : 'v1 › solution-partner-identity › public › auth › phone',
        hint: 'Creates a separate subfolder for every segment',
      },
    ],
  });
}

async function pickWriteMode(current: WriteMode): Promise<WriteMode> {
  return selectMenu<WriteMode>({
    title: 'When to write API docs',
    subtitle: 'During Jest test execution',
    initialIndex: current === 'incremental' ? 1 : 0,
    options: [
      {
        value: 'on-complete',
        label: 'When all tests finish',
        badge: 'recommended',
        hint: 'Fastest — builds OpenAPI + HTML once in onRunComplete',
      },
      {
        value: 'incremental',
        label: 'As tests run (after each suite)',
        hint: 'Live updates — rebuilds docs after each test file finishes',
      },
    ],
  });
}

async function pickExampleStyle(current: ExampleLabelStyle): Promise<ExampleLabelStyle> {
  const initialIndex = current === 'status-case' ? 0 : current === 'status-title-case' ? 1 : 2;
  return selectMenu<ExampleLabelStyle>({
    title: 'Example / scenario labels',
    subtitle: 'How each test case appears in API docs & Postman',
    initialIndex,
    options: [
      {
        value: 'status-case',
        label: 'status-case (short)',
        badge: 'recommended',
        preview: c.ice('201 — cyprus payload shape'),
        hint: 'Clean status + scenario clause (best for Postman)',
      },
      {
        value: 'status-title-case',
        label: 'status-title-case',
        preview: c.ice('201 — Create Mock Tbs — cyprus payload shape'),
        hint: 'Status + operation title + scenario clause',
      },
      {
        value: 'full',
        label: 'full (verbose)',
        preview: c.ice('201 — Create Mock Tbs - POST /v1/admin/mock-tbs POSITIVE CASES cyprus payload shape'),
        hint: 'Includes HTTP method, path, and test section',
      },
    ],
  });
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

type NestedResourceGroup = {
  pattern: string;
  suggested: string;
  roles: string[];
  samplePath: string;
};

function detectNestedResources(paths: string[], skipParams: boolean): NestedResourceGroup[] {
  const groups = new Map<string, { roles: Set<string>; samplePath: string }>();
  for (const p of paths) {
    const rawParts = p.split('/').filter(Boolean);
    const paramIdx = skipParams ? rawParts.findIndex((seg) => seg.startsWith('{') || seg.startsWith(':')) : -1;
    const folded = paramIdx >= 0 ? rawParts.slice(0, paramIdx) : rawParts;
    // Expect /v1/<role>/<resource1>/<resource2>...
    const startIdx = /^v\d+$/i.test(folded[0] || '') ? 2 : 1;
    const role = startIdx === 2 ? folded[1] : 'api';
    const resourceParts = folded.slice(startIdx).filter((seg) => !seg.startsWith('{') && !seg.startsWith(':'));
    if (resourceParts.length < 2) continue;

    const pattern = resourceParts.slice(0, 2).join('/');
    const existing = groups.get(pattern) ?? { roles: new Set<string>(), samplePath: p };
    if (role) existing.roles.add(role);
    groups.set(pattern, existing);
  }

  return [...groups.entries()]
    .map(([pattern, info]) => ({
      pattern,
      suggested: pattern.replace(/\//g, '-'),
      roles: [...info.roles].sort(),
      samplePath: info.samplePath,
    }))
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

async function pickResourceAliases(
  current: Record<string, string>,
  skipParams: boolean,
): Promise<Record<string, string> | null> {
  const detected = detectNestedResources(listKnownPaths(), skipParams);
  if (!detected.length) return null;

  const previewList = detected
    .slice(0, 4)
    .map((g) => g.pattern)
    .join(', ') + (detected.length > 4 ? ` (+${detected.length - 4})` : '');

  const review = await confirmPrompt({
    title: `${detected.length} nested resource(s) detected — merge any into single folders?`,
    hint: previewList,
    defaultYes: detected.length <= 5,
  });
  if (!review) return null;

  const next: Record<string, string> = { ...current };
  // Let the user pick only the specific groups they want to merge instead of stepping through all 60+.
  while (true) {
    const picked = await selectMenu<string>({
      title: 'Select a nested resource to merge (or Done)',
      subtitle: `${Object.keys(next).length} merged so far`,
      options: [
        { value: '__done__', label: 'Done — save & continue', badge: 'finish' },
        ...detected.map((group) => ({
          value: group.pattern,
          label: group.pattern,
          badge: next[group.pattern] ? `→ ${next[group.pattern]}` : undefined,
          hint: `${group.roles.join(', ')} · e.g. ${group.samplePath}`,
        })),
      ],
    });
    if (picked === '__done__') break;

    const group = detected.find((g) => g.pattern === picked);
    if (!group) break;
    const existing = next[group.pattern];
    const choice = await selectMenu<string>({
      title: `Folder for ${group.pattern}`,
      subtitle: `${group.roles.join(', ')} · e.g. ${group.samplePath}`,
      initialIndex: existing ? 1 : 0,
      options: [
        {
          value: '__keep__',
          label: `Keep nested (${group.pattern.replace('/', ' › ')})`,
          hint: 'Separate subfolders',
        },
        {
          value: group.suggested,
          label: `Merge → ${group.suggested}`,
          badge: existing === group.suggested ? 'active' : 'flatten',
          hint: `Single folder: ${group.suggested}`,
        },
        {
          value: '__custom__',
          label: 'Custom folder name',
          hint: 'Type your own folder name',
        },
      ],
    });

    if (choice === '__keep__') {
      delete next[group.pattern];
    } else if (choice === '__custom__') {
      const typed = (await readlineAsk(`  ${c.gold('?')} Folder name ${c.dim(`(for ${group.pattern})`)}\n  ${c.ice('›')} `)).trim();
      if (typed) next[group.pattern] = typed;
    } else {
      next[group.pattern] = choice;
    }
  }
  return next;
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

  const skipParams = await pickSkipParams(config.treeSkipParams !== false);
  upsertConfigValue(configPath, 'treeSkipParams', skipParams ? 'true' : 'false');

  const subResourceMode = await pickSubResourceMode(config.treeSubResourceMode ?? 'nested', layout);
  upsertConfigValue(configPath, 'treeSubResourceMode', formatTsString(subResourceMode));

  const exampleStyle = await pickExampleStyle(config.exampleLabelStyle ?? 'status-title-case');
  upsertConfigValue(configPath, 'exampleLabelStyle', formatTsString(exampleStyle));

  const writeMode = await pickWriteMode(config.writeMode ?? 'on-complete');
  upsertConfigValue(configPath, 'writeMode', formatTsString(writeMode));

  if (!options.path && subResourceMode === 'nested') {
    const aliases = await pickResourceAliases(config.treeResourceAliases ?? {}, skipParams);
    if (aliases) {
      const entries = Object.entries(aliases)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `    ${formatTsString(k)}: ${formatTsString(v)},`);
      const literal = entries.length ? `{\n${entries.join('\n')}\n  }` : '{}';
      upsertConfigValue(configPath, 'treeResourceAliases', literal);
    }
  }

  if (options.path) {
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
