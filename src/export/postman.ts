import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

import { STATUS_TEXT } from '../catalog';
import { getConfig, type EnvPreset } from '../config';
import { getOutDir, getSpecJsonPath } from '../serve/paths';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

type OpenApiExample = {
  summary?: string;
  description?: string;
  value?: unknown;
};

type OpenApiScenario = {
  name: string;
  group?: string;
  status: number;
  pathParams?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  reqBody?: unknown;
  resBody?: unknown;
};

type OpenApiOperation = {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Array<Record<string, unknown[]>>;
  parameters?: Array<{ name: string; in: string; required?: boolean; example?: unknown }>;
  requestBody?: {
    content?: Record<string, { examples?: Record<string, OpenApiExample> }>;
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, { examples?: Record<string, OpenApiExample> }>;
    }
  >;
  'x-tree-segments'?: string[];
  'x-scenarios'?: OpenApiScenario[];
  'x-daxta-url-path'?: string;
};

type OpenApiSpecLike = {
  info?: { title?: string; version?: string; description?: string; 'x-workspace'?: string };
  servers?: Array<{ url?: string; description?: string }>;
  paths?: Record<string, Record<string, OpenApiOperation>>;
};

export type PostmanHeader = {
  key: string;
  value: string;
  type?: string;
};

export type PostmanQueryParam = {
  key: string;
  value: string;
  disabled?: boolean;
};

export type PostmanRequest = {
  method: string;
  header: PostmanHeader[];
  url: {
    raw: string;
    host: string[];
    path: string[];
    query?: PostmanQueryParam[];
    variable?: Array<{ key: string; value: string }>;
  };
  body?: {
    mode: 'raw';
    raw: string;
    options: { raw: { language: 'json' } };
  };
  description?: string;
};

export type PostmanResponseExample = {
  name: string;
  originalRequest: PostmanRequest;
  status: string;
  code: number;
  _postman_previewlanguage: 'json';
  header: Array<{ key: string; value: string }>;
  body: string;
};

export type PostmanRequestItem = {
  name: string;
  request: PostmanRequest;
  response: PostmanResponseExample[];
};

export type PostmanFolderItem = {
  name: string;
  item: Array<PostmanFolderItem | PostmanRequestItem>;
};

export type PostmanCollection = {
  info: {
    _postman_id: string;
    name: string;
    description: string;
    schema: string;
  };
  item: Array<PostmanFolderItem | PostmanRequestItem>;
};

export type PostmanEnvironment = {
  id: string;
  name: string;
  values: Array<{ key: string; value: string; type: 'default' | 'secret'; enabled: boolean }>;
  _postman_variable_scope: 'environment';
  _postman_exported_at: string;
  _postman_exported_using: string;
};

function normalizeQueryEntries(
  query?: Record<string, string> | PostmanQueryParam[],
): PostmanQueryParam[] {
  if (!query) return [];
  if (Array.isArray(query)) {
    return query
      .filter((entry) => entry && entry.key)
      .map((entry) => ({
        key: String(entry.key),
        value: entry.value != null ? String(entry.value) : '',
        ...(entry.disabled ? { disabled: true } : {}),
      }));
  }
  return Object.entries(query).map(([key, value]) => ({
    key,
    value: value != null ? String(value) : '',
  }));
}

function buildOperationQueryEntries(
  operation: OpenApiOperation,
  primaryQuery?: Record<string, string>,
): PostmanQueryParam[] {
  const byKey = new Map<string, PostmanQueryParam>();

  for (const [key, value] of Object.entries(primaryQuery ?? {})) {
    if (!key) continue;
    byKey.set(key, { key, value: value != null ? String(value) : '' });
  }

  for (const param of operation.parameters ?? []) {
    if (param?.in !== 'query' || !param.name) continue;
    if (byKey.has(param.name)) continue;
    byKey.set(param.name, {
      key: param.name,
      value: param.example != null ? String(param.example) : '',
      ...(param.required ? {} : { disabled: true }),
    });
  }

  for (const scenario of operation['x-scenarios'] ?? []) {
    for (const [key, value] of Object.entries(scenario.query ?? {})) {
      if (!key || byKey.has(key)) continue;
      byKey.set(key, {
        key,
        value: value != null ? String(value) : '',
        disabled: true,
      });
    }
  }

  return [...byKey.values()];
}

function buildOperationPathParams(
  operation: OpenApiOperation,
  primaryPathParams?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const param of operation.parameters ?? []) {
    if (param?.in === 'path' && param.name && param.example != null) {
      out[param.name] = String(param.example);
    }
  }
  for (const [key, value] of Object.entries(primaryPathParams ?? {})) {
    if (key && value != null) out[key] = String(value);
  }
  return out;
}

function postmanUrl(
  serverUrl: string,
  pathTemplate: string,
  pathParams?: Record<string, string>,
  query?: Record<string, string> | PostmanQueryParam[],
): PostmanRequest['url'] {
  const base = (serverUrl || '{{baseUrl}}').replace(/\/$/, '');
  const cleanPath = pathTemplate.startsWith('/') ? pathTemplate : `/${pathTemplate}`;
  const segments = cleanPath.split('/').filter(Boolean);
  const paramKeys = [...cleanPath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

  const queryEntries = normalizeQueryEntries(query);
  const enabledQuery = queryEntries.filter((q) => !q.disabled);
  const querySuffix = enabledQuery.length
    ? `?${enabledQuery.map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`).join('&')}`
    : '';

  return {
    raw: `${base}${cleanPath.replace(/\{([^}]+)\}/g, ':$1')}${querySuffix}`,
    host: base.startsWith('{{') ? [base] : [base.replace(/^https?:\/\//, '').split('/')[0]],
    path: segments.map((seg) => (seg.startsWith('{') && seg.endsWith('}') ? `:${seg.slice(1, -1)}` : seg)),
    ...(queryEntries.length ? { query: queryEntries } : {}),
    ...(paramKeys.length
      ? { variable: paramKeys.map((key) => ({ key, value: pathParams?.[key] ?? '' })) }
      : {}),
  };
}

function resolveConfiguredHeaderValue(key: string): string | undefined {
  const config = getConfig();
  const lower = key.toLowerCase();
  const fromFn = config.headerVariable?.(lower) ?? config.headerVariable?.(key);
  if (fromFn) return fromFn;
  const map = config.headerVariables ?? {};
  for (const [k, v] of Object.entries(map)) {
    if (k.toLowerCase() === lower) return v;
  }
  if (config.headerVarStyle === 'upper-snake') {
    if (lower === 'authorization') return 'Bearer {{AUTH_TOKEN}}';
    if (lower.startsWith('x-')) return `{{${lower.toUpperCase().replace(/-/g, '_')}}}`;
  }
  return undefined;
}

function buildHeaders(
  operation: OpenApiOperation,
  scenarioHeaders?: Record<string, string>,
  hasBody?: boolean,
): PostmanHeader[] {
  const byLower = new Map<string, PostmanHeader>();
  const add = (key: string, value: string) => {
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'content-length') return;
    const configured = lower === 'content-type' ? undefined : resolveConfiguredHeaderValue(key);
    byLower.set(lower, { key, value: configured ?? value, type: 'text' });
  };

  for (const param of operation.parameters ?? []) {
    if (param.in === 'header' && param.name) {
      add(param.name, param.example != null ? String(param.example) : '');
    }
  }
  for (const sec of operation.security ?? []) {
    if ('bearerAuth' in sec && !byLower.has('authorization')) {
      add('Authorization', 'Bearer {{authToken}}');
    }
  }
  for (const [key, value] of Object.entries(scenarioHeaders ?? {})) {
    add(key, value);
  }
  if (hasBody && !byLower.has('content-type')) {
    add('Content-Type', 'application/json');
  }
  return [...byLower.values()];
}

function stringifyJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function folderSegmentsForOperation(urlPath: string, operation: OpenApiOperation): string[] {
  const fromTree = operation['x-tree-segments'];
  const parts = Array.isArray(fromTree) && fromTree.length ? fromTree.map(String) : urlPath.split('/').filter(Boolean);
  const named = parts.filter((part) => part && !part.startsWith('{'));
  return named.length ? named : ['API'];
}

function pushIntoFolderTree(
  root: Array<PostmanFolderItem | PostmanRequestItem>,
  segments: string[],
  requestItem: PostmanRequestItem,
) {
  let level = root;
  for (let i = 0; i < segments.length; i += 1) {
    const name = segments[i];
    let folder = level.find(
      (entry): entry is PostmanFolderItem => entry.name === name && 'item' in entry && !('request' in entry),
    );
    if (!folder) {
      folder = { name, item: [] };
      level.push(folder);
    }
    if (i === segments.length - 1) folder.item.push(requestItem);
    else level = folder.item;
  }
}

function sortCollectionTree(
  items: Array<PostmanFolderItem | PostmanRequestItem>,
): Array<PostmanFolderItem | PostmanRequestItem> {
  const folders = items.filter((entry): entry is PostmanFolderItem => 'item' in entry && !('request' in entry));
  const requests = items.filter((entry): entry is PostmanRequestItem => 'request' in entry);
  folders.sort((a, b) => a.name.localeCompare(b.name));
  for (const folder of folders) folder.item = sortCollectionTree(folder.item);
  requests.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...requests];
}

function resolveEnvPreset(envName?: string): { name: string; preset: EnvPreset } {
  const config = getConfig();
  const presets = config.envPresets ?? {};
  if (envName && presets[envName]) return { name: envName, preset: presets[envName] };
  const firstKey = Object.keys(presets)[0];
  if (firstKey) return { name: firstKey, preset: presets[firstKey] };
  return { name: 'local', preset: { baseUrl: config.baseUrl, baseUrlKey: 'baseUrl' } };
}

export function buildPostmanCollection(
  spec: OpenApiSpecLike,
  options: { useEnvVar?: boolean; envName?: string } = {},
): { collection: PostmanCollection; operations: number; examples: number } {
  const useEnvVar = options.useEnvVar !== false;
  const { preset } = resolveEnvPreset(options.envName);
  const baseUrlKey = preset.baseUrlKey || 'baseUrl';
  const serverUrl = useEnvVar ? `{{${baseUrlKey}}}` : spec.servers?.[0]?.url || preset.baseUrl;

  const root: Array<PostmanFolderItem | PostmanRequestItem> = [];
  let operations = 0;
  let totalExamples = 0;

  for (const [urlPath, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;
      operations += 1;

      const requestPath = operation['x-daxta-url-path'] || urlPath;
      const scenarios = Array.isArray(operation['x-scenarios']) ? operation['x-scenarios'] : [];
      const primaryScenario = scenarios.find((s) => s.status >= 200 && s.status < 300) ?? scenarios[0];

      const reqExamples = operation.requestBody?.content?.['application/json']?.examples ?? {};
      const firstReqExample = Object.values(reqExamples)[0];
      const defaultReqBody = primaryScenario?.reqBody !== undefined ? primaryScenario.reqBody : firstReqExample?.value;
      const hasDefaultBody = defaultReqBody !== undefined;

      const baseRequest: PostmanRequest = {
        method: method.toUpperCase(),
        header: buildHeaders(operation, primaryScenario?.headers, hasDefaultBody),
        url: postmanUrl(
          serverUrl,
          requestPath,
          buildOperationPathParams(operation, primaryScenario?.pathParams),
          buildOperationQueryEntries(operation, primaryScenario?.query),
        ),
        description: operation.summary || operation.description || '',
        ...(hasDefaultBody
          ? {
              body: {
                mode: 'raw',
                raw: stringifyJson(defaultReqBody),
                options: { raw: { language: 'json' } },
              },
            }
          : {}),
      };

      const responses: PostmanResponseExample[] = [];

      if (scenarios.length) {
        for (const scenario of scenarios) {
          const hasBody = scenario.reqBody !== undefined;
          const originalRequest: PostmanRequest = {
            method: method.toUpperCase(),
            header: buildHeaders(operation, scenario.headers, hasBody),
            url: postmanUrl(serverUrl, requestPath, scenario.pathParams, scenario.query),
            description: operation.summary || '',
            ...(hasBody
              ? {
                  body: {
                    mode: 'raw',
                    raw: stringifyJson(scenario.reqBody),
                    options: { raw: { language: 'json' } },
                  },
                }
              : {}),
          };
          const code = Number(scenario.status) || 0;
          responses.push({
            name: scenario.name,
            originalRequest,
            status: STATUS_TEXT[String(code)] ?? String(code),
            code,
            _postman_previewlanguage: 'json',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: stringifyJson(scenario.resBody),
          });
        }
      } else {
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          const examples = response?.content?.['application/json']?.examples ?? {};
          const entries = Object.entries(examples);
          const code = Number(status) || 0;
          if (!entries.length) {
            responses.push({
              name: response.description || STATUS_TEXT[status] || status,
              originalRequest: baseRequest,
              status: STATUS_TEXT[status] || response.description || status,
              code,
              _postman_previewlanguage: 'json',
              header: [{ key: 'Content-Type', value: 'application/json' }],
              body: '',
            });
            continue;
          }
          for (const [exKey, example] of entries) {
            const name = example.summary || example.description || exKey;
            const reqMatch = reqExamples[exKey] || reqExamples[name] || firstReqExample;
            const hasBody = reqMatch?.value !== undefined;
            const originalRequest: PostmanRequest = {
              ...baseRequest,
              header: buildHeaders(operation, undefined, hasBody),
              ...(hasBody
                ? {
                    body: {
                      mode: 'raw',
                      raw: stringifyJson(reqMatch.value),
                      options: { raw: { language: 'json' } },
                    },
                  }
                : {}),
            };
            responses.push({
              name,
              originalRequest,
              status: STATUS_TEXT[status] || status,
              code,
              _postman_previewlanguage: 'json',
              header: [{ key: 'Content-Type', value: 'application/json' }],
              body: stringifyJson(example.value),
            });
          }
        }
      }

      totalExamples += responses.length;
      pushIntoFolderTree(root, folderSegmentsForOperation(urlPath, operation), {
        name: operation.summary || `${method.toUpperCase()} ${requestPath}`,
        request: baseRequest,
        response: responses,
      });
    }
  }

  const collection: PostmanCollection = {
    info: {
      _postman_id: randomUUID(),
      name: spec.info?.title || spec.info?.['x-workspace'] || getConfig().workspace || 'API',
      description: spec.info?.description || 'Generated by DAxTA from observed test execution.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: sortCollectionTree(root),
  };

  return { collection, operations, examples: totalExamples };
}

export function buildPostmanEnvironment(envName?: string): PostmanEnvironment {
  const { name, preset } = resolveEnvPreset(envName);
  const baseUrlKey = preset.baseUrlKey || 'baseUrl';
  const values: PostmanEnvironment['values'] = [
    { key: baseUrlKey, value: preset.baseUrl, type: 'default', enabled: true },
  ];
  const known = new Set<string>([baseUrlKey]);
  for (const [key, value] of Object.entries(preset.variables ?? {})) {
    if (key === baseUrlKey) continue;
    known.add(key);
    values.push({
      key,
      value: String(value ?? ''),
      type: /token|secret|key|password/i.test(key) ? 'secret' : 'default',
      enabled: true,
    });
  }
  for (const tmpl of Object.values(getConfig().headerVariables ?? {})) {
    for (const match of String(tmpl).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
      if (known.has(match[1])) continue;
      known.add(match[1]);
      values.push({
        key: match[1],
        value: '',
        type: /token|secret|key|password/i.test(match[1]) ? 'secret' : 'default',
        enabled: true,
      });
    }
  }
  return {
    id: randomUUID(),
    name: `${getConfig().workspace || 'API'} (${name})`,
    values,
    _postman_variable_scope: 'environment',
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: 'DAxTA',
  };
}

export function exportPostmanFiles(options: {
  out?: string;
  envName?: string;
  includeEnv?: boolean;
  useEnvVar?: boolean;
} = {}): {
  collectionPath: string;
  environmentPath?: string;
  operations: number;
  examples: number;
} {
  const specPath = getSpecJsonPath();
  if (!existsSync(specPath)) {
    throw new Error(`OpenAPI spec not found at ${specPath}. Run \`daxta generate\` or your tests first.`);
  }
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as OpenApiSpecLike;
  const { collection, operations, examples } = buildPostmanCollection(spec, {
    useEnvVar: options.useEnvVar,
    envName: options.envName,
  });

  const outDir = getOutDir();
  const collectionPath = options.out
    ? path.resolve(options.out.endsWith('.json') ? options.out : path.join(options.out, 'postman_collection.json'))
    : path.join(outDir, 'postman_collection.json');

  mkdirSync(path.dirname(collectionPath), { recursive: true });
  writeFileSync(collectionPath, `${JSON.stringify(collection, null, 2)}\n`);

  let environmentPath: string | undefined;
  if (options.includeEnv !== false) {
    const envDir = path.dirname(collectionPath);
    const baseName = path.basename(collectionPath).replace(/\.postman_collection\.json$|\.json$/i, '');
    environmentPath = path.join(envDir, `${baseName}.postman_environment.json`);
    writeFileSync(environmentPath, `${JSON.stringify(buildPostmanEnvironment(options.envName), null, 2)}\n`);
  }

  return { collectionPath, environmentPath, operations, examples };
}
