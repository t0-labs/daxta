import { existsSync } from 'fs';
import * as path from 'path';

export type TreeLayout = 'resource-first' | 'url-order';

export type SpecInfo = {
  title?: string;
  version?: string;
  description?: string;
};

export type DaxtaConfig = {
  workspace?: string;
  baseUrl?: string;
  controllersRoot?: string;
  outDir?: string;
  treeLayout?: TreeLayout;
  treePathOverrides?: Record<string, string[]>;
  port?: number;
  fieldsFile?: string;
  docsPath?: string;
  /** package.json script name wired to DAxTA (e.g. test:integration) */
  testScript?: string;
  /** Original test command before wrap (e.g. jest --config …) */
  testCommand?: string;
  /** Last auto-migrated @t0.labs/daxta version */
  daxtaVersion?: string;
  /** Optional explicit Jest JSON config path */
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
    'workspace' | 'baseUrl' | 'controllersRoot' | 'outDir' | 'treeLayout' | 'treePathOverrides' | 'port' | 'fieldsFile' | 'docsPath'
  >
> &
  DaxtaConfig;

const DEFAULTS: ResolvedDaxtaConfig = {
  workspace: 'API',
  baseUrl: 'http://localhost:3000',
  controllersRoot: 'src',
  outDir: 'daxta/out',
  treeLayout: 'resource-first',
  treePathOverrides: {},
  port: 5199,
  fieldsFile: 'daxta.fields.json',
  docsPath: '/docs',
};

let cached: ResolvedDaxtaConfig | null = null;

export function defineConfig(config: DaxtaConfig): DaxtaConfig {
  return config;
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
  merged.controllersRoot = path.isAbsolute(merged.controllersRoot)
    ? merged.controllersRoot
    : path.join(cwd, merged.controllersRoot);
  merged.outDir = path.isAbsolute(merged.outDir) ? merged.outDir : path.join(cwd, merged.outDir);
  merged.fieldsFile = path.isAbsolute(merged.fieldsFile) ? merged.fieldsFile : path.join(cwd, merged.fieldsFile);
  return merged;
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
