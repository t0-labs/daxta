import { existsSync } from 'fs';
import * as path from 'path';

/** role→resource (URL order) vs resource→role (swap after version) */
export type TreeLayout = 'role-resource' | 'resource-role';

/** @deprecated use role-resource / resource-role */
export type LegacyTreeLayout = 'url-order' | 'resource-first';

export type ExampleLabelStyle = 'status-case' | 'status-title-case' | 'full';

export type SpecInfo = {
  title?: string;
  version?: string;
  description?: string;
};

/** Named Try-it preset: own baseUrl + optional extra variables (tokens, etc.). */
export type EnvPreset = {
  baseUrl: string;
  /** Extra variables merged into the preset (baseUrl wins from EnvPreset.baseUrl). */
  variables?: Record<string, string>;
};

export type DaxtaConfig = {
  workspace?: string;
  baseUrl?: string;
  /**
   * Multi-base Try-it presets (local / staging / production, …).
   * Seeded into the API docs env picker and `.daxta/viewer-store.json` on first write.
   * Default: `{ local: { baseUrl } }` from `baseUrl`.
   */
  envPresets?: Record<string, EnvPreset>;
  controllersRoot?: string;
  outDir?: string;
  /**
   * Sidebar / tag folder order after version:
   * - role-resource → v1 › admin › baskets (URL order, recommended)
   * - resource-role → v1 › baskets › admin
   */
  treeLayout?: TreeLayout | LegacyTreeLayout;
  /**
   * Do not create sidebar folders for `{param}` segments (and anything after).
   * Ops like POST …/{id}/lock sit under the parent resource. Default true.
   */
  treeSkipParams?: boolean;
  treePathOverrides?: Record<string, string[]>;
  /**
   * OpenAPI example + scenario labels:
   * - status-case → `201 — cyprus payload shape`
   * - status-title-case → `201 — Create Mock Tbs — cyprus payload shape`
   * - full → includes path + POSITIVE CASES + clause
   * Test it() stays `creates mock tbs when cyprus payload shape`; API docs take the `when` clause.
   */
  exampleLabelStyle?: ExampleLabelStyle;
  port?: number;
  fieldsFile?: string;
  /**
   * URL prefix for the viewer. Default `/docs`.
   * Override with env `DAXTA_DOCS_PATH` (e.g. `/docs` or `docs`).
   */
  docsPath?: string;
  /**
   * Persisted Try-it env/header store (survives rebuild). Default `.daxta/viewer-store.json`.
   * Served at `{docsPath}/env.json`. Keep out of git if it holds secrets.
   */
  viewerStoreFile?: string;
  testScript?: string;
  testCommand?: string;
  daxtaVersion?: string;
  jestConfig?: string;
  templatize?: (pathname: string, test?: string) => string | null | undefined;
  operationTag?: (pathTemplate: string, method: string) => string | undefined;
  operationTitle?: (method: string, pathTemplate: string) => string | undefined;
  securitySchemeId?: (headerName: string) => string | undefined;
  specInfo?: () => SpecInfo | undefined;
  operationOrder?: (opKey: string) => number | undefined;
  includeHit?: (method: string, pathTemplate: string, test?: string) => boolean;
  treePathSegments?: (pathTemplate: string) => string[] | undefined;
};

export type ResolvedDaxtaConfig = Required<
  Pick<
    DaxtaConfig,
    | 'workspace'
    | 'baseUrl'
    | 'controllersRoot'
    | 'outDir'
    | 'treeLayout'
    | 'treePathOverrides'
    | 'treeSkipParams'
    | 'exampleLabelStyle'
    | 'port'
    | 'fieldsFile'
    | 'docsPath'
    | 'viewerStoreFile'
  >
> &
  DaxtaConfig;

const DEFAULTS: ResolvedDaxtaConfig = {
  workspace: 'API',
  baseUrl: 'http://localhost:3000',
  controllersRoot: 'src',
  outDir: '.daxta/out',
  treeLayout: 'role-resource',
  treeSkipParams: true,
  treePathOverrides: {},
  exampleLabelStyle: 'status-title-case',
  port: 5199,
  fieldsFile: '.daxta/out/fields.json',
  docsPath: '/docs',
  viewerStoreFile: '.daxta/viewer-store.json',
  envPresets: {
    local: { baseUrl: 'http://localhost:3000' },
  },
};

let cached: ResolvedDaxtaConfig | null = null;

export const DEFAULT_DOCS_PATH = '/docs';

export function normalizeDocsPath(raw?: string | null): string {
  const value = String(raw ?? DEFAULT_DOCS_PATH).trim() || DEFAULT_DOCS_PATH;
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  return withSlash.replace(/\/$/, '') || DEFAULT_DOCS_PATH;
}

export function defineConfig(config: DaxtaConfig): DaxtaConfig {
  return config;
}

export function normalizeTreeLayout(layout: TreeLayout | LegacyTreeLayout | undefined): TreeLayout {
  if (layout === 'resource-first' || layout === 'resource-role') return 'resource-role';
  if (layout === 'url-order' || layout === 'role-resource') return 'role-resource';
  return 'role-resource';
}

function loadConfigFile(cwd: string): DaxtaConfig {
  const candidates = ['daxta.config.ts', 'daxta.config.js', 'daxta.config.mjs', 'daxta.config.cjs'];
  for (const name of candidates) {
    const full = path.join(cwd, name);
    if (!existsSync(full)) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createJiti } = require('jiti') as typeof import('jiti');
      const jiti = createJiti(__filename);
      const mod = jiti(full) as { default?: DaxtaConfig } & DaxtaConfig;
      return (mod.default ?? mod) as DaxtaConfig;
    } catch (error) {
      throw new Error(`Failed to load ${name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return {};
}

export function resolveConfig(cwd = process.cwd(), overrides?: DaxtaConfig): ResolvedDaxtaConfig {
  const file = loadConfigFile(cwd);
  const merged: ResolvedDaxtaConfig = {
    ...DEFAULTS,
    ...file,
    ...overrides,
    treePathOverrides: {
      ...DEFAULTS.treePathOverrides,
      ...(file.treePathOverrides ?? {}),
      ...(overrides?.treePathOverrides ?? {}),
    },
  };
  merged.treeLayout = normalizeTreeLayout(merged.treeLayout);
  if (merged.treeSkipParams == null) merged.treeSkipParams = DEFAULTS.treeSkipParams;
  if (merged.exampleLabelStyle == null) merged.exampleLabelStyle = DEFAULTS.exampleLabelStyle;
  merged.envPresets = normalizeEnvPresets(merged.envPresets, merged.baseUrl);
  merged.docsPath = normalizeDocsPath(process.env.DAXTA_DOCS_PATH || merged.docsPath);
  merged.controllersRoot = path.isAbsolute(merged.controllersRoot)
    ? merged.controllersRoot
    : path.join(cwd, merged.controllersRoot);
  merged.outDir = path.isAbsolute(merged.outDir) ? merged.outDir : path.join(cwd, merged.outDir);
  merged.fieldsFile = path.isAbsolute(merged.fieldsFile) ? merged.fieldsFile : path.join(cwd, merged.fieldsFile);
  merged.viewerStoreFile = path.isAbsolute(merged.viewerStoreFile)
    ? merged.viewerStoreFile
    : path.join(cwd, merged.viewerStoreFile);
  return merged;
}

function normalizeEnvPresets(
  presets: Record<string, EnvPreset> | undefined,
  fallbackBaseUrl: string,
): Record<string, EnvPreset> {
  const input = presets && typeof presets === 'object' ? presets : {};
  const out: Record<string, EnvPreset> = {};
  for (const [name, preset] of Object.entries(input)) {
    if (!name.trim() || !preset || typeof preset !== 'object') continue;
    const baseUrl = String(preset.baseUrl || fallbackBaseUrl).replace(/\/$/, '') || fallbackBaseUrl;
    const variables: Record<string, string> = {};
    if (preset.variables && typeof preset.variables === 'object') {
      for (const [key, value] of Object.entries(preset.variables)) {
        if (!key || key === 'baseUrl') continue;
        variables[key] = String(value ?? '');
      }
    }
    out[name] = Object.keys(variables).length ? { baseUrl, variables } : { baseUrl };
  }
  if (!Object.keys(out).length) {
    out.local = { baseUrl: String(fallbackBaseUrl).replace(/\/$/, '') || 'http://localhost:3000' };
  }
  return out;
}

export function getConfig(forceReload = false): ResolvedDaxtaConfig {
  if (!cached || forceReload) cached = resolveConfig();
  return cached;
}

export function setConfig(config: ResolvedDaxtaConfig) {
  cached = config;
}

export function resetConfig() {
  cached = null;
}
