import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

import { getConfig } from '../config';
import { getViewerStorePath } from './paths';

export type ViewerStoreRow = { key: string; value: string };

export type ViewerEnvConfig = {
  variables: ViewerStoreRow[];
  headerGroups: Record<string, ViewerStoreRow[]>;
  /** Name of the variable holding the base URL — renameable, e.g. `ONBOARDING_SERVICE`. */
  baseUrlKey?: string;
};

export type ViewerEnvStore = {
  activeEnv: string;
  activeGroup: string;
  envs: Record<string, ViewerEnvConfig>;
};

function isRow(value: unknown): value is ViewerStoreRow {
  return Boolean(value && typeof value === 'object' && typeof (value as ViewerStoreRow).key === 'string');
}

function normalizeRows(value: unknown): ViewerStoreRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRow).map((row) => ({ key: String(row.key || ''), value: String(row.value ?? '') }));
}

/** Validate / coerce UI store JSON. Returns null if unusable. */
export function normalizeViewerEnvStore(raw: unknown): ViewerEnvStore | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const envsIn = input.envs;
  if (!envsIn || typeof envsIn !== 'object') return null;

  const envs: Record<string, ViewerEnvConfig> = {};
  for (const [name, env] of Object.entries(envsIn as Record<string, unknown>)) {
    if (!env || typeof env !== 'object') continue;
    const envObj = env as Record<string, unknown>;
    const headerGroupsIn = envObj.headerGroups;
    const headerGroups: Record<string, ViewerStoreRow[]> = {};
    if (headerGroupsIn && typeof headerGroupsIn === 'object') {
      for (const [group, rows] of Object.entries(headerGroupsIn as Record<string, unknown>)) {
        headerGroups[group] = normalizeRows(rows);
      }
    }
    if (!Object.keys(headerGroups).length) {
      headerGroups.default = [{ key: 'content-type', value: 'application/json' }];
    }
    const baseUrlKey = typeof envObj.baseUrlKey === 'string' ? envObj.baseUrlKey.trim() : '';
    envs[name] = {
      variables: normalizeRows(envObj.variables),
      headerGroups,
      ...(baseUrlKey && baseUrlKey !== 'baseUrl' ? { baseUrlKey } : {}),
    };
  }
  if (!Object.keys(envs).length) return null;

  const activeEnv = typeof input.activeEnv === 'string' && envs[input.activeEnv] ? input.activeEnv : Object.keys(envs)[0];
  const groups = Object.keys(envs[activeEnv].headerGroups);
  const activeGroup =
    typeof input.activeGroup === 'string' && groups.includes(input.activeGroup) ? input.activeGroup : groups[0] || 'default';

  return { activeEnv, activeGroup, envs };
}

export function readViewerEnvStore(): ViewerEnvStore | null {
  const filePath = getViewerStorePath();
  if (!existsSync(filePath)) return null;
  try {
    return normalizeViewerEnvStore(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

export function writeViewerEnvStore(raw: unknown): ViewerEnvStore {
  const store = normalizeViewerEnvStore(raw);
  if (!store) throw new Error('Invalid viewer env store');
  const filePath = getViewerStorePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`);
  return store;
}

/**
 * If viewer-store.json is missing, seed it from the resolved env presets
 * (derived from baseUrl, plus any `envPresets` overrides in daxta.config).
 * Does not overwrite an existing file.
 */
export function ensureViewerStoreSeeded(): string | null {
  const filePath = getViewerStorePath();
  if (existsSync(filePath)) return null;

  const config = getConfig();
  const presets = config.envPresets ?? { local: { baseUrl: config.baseUrl } };
  const envs: Record<string, ViewerEnvConfig> = {};

  for (const [name, preset] of Object.entries(presets)) {
    const baseUrlKey = preset.baseUrlKey?.trim() || 'baseUrl';
    const variables: ViewerStoreRow[] = [{ key: baseUrlKey, value: String(preset.baseUrl || config.baseUrl) }];
    for (const [key, value] of Object.entries(preset.variables ?? {})) {
      if (!key || key === baseUrlKey) continue;
      variables.push({ key, value: String(value ?? '') });
    }
    envs[name] = {
      variables,
      headerGroups: { default: [{ key: 'content-type', value: 'application/json' }] },
      ...(baseUrlKey !== 'baseUrl' ? { baseUrlKey } : {}),
    };
  }

  const names = Object.keys(envs);
  if (!names.length) return null;
  writeViewerEnvStore({ activeEnv: names.includes('local') ? 'local' : names[0], activeGroup: 'default', envs });
  return filePath;
}
