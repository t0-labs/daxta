import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import * as path from 'path';

import { caseGroup, caseName, declaredMethods, defaultTitle, type FieldDoc, type OperationDoc, operationTag, STATUS_TEXT, treePathSegments, viewerTreeConfig } from '../catalog';
import { getConfig } from '../config';
import { dtoRequired } from '../fields/dto-fields';
import { extractPathParams, materializePath, pathParamNames, templatize } from '../path.util';
import type { RecordedHit } from '../recorder';
import { getFaviconAssetPath, getHitsJsonPath, getHtmlPath, getOutDir, getSpecJsonPath, getViewerAssetPath } from '../serve/paths';

const METHOD_RANK: Record<string, number> = { get: 0, post: 1, put: 2, patch: 3, delete: 4 };

/** Re-map old/mis-templated hits onto Nest routes (or stronger heuristics). */
function canonicalizeHit(hit: RecordedHit): RecordedHit | null {
  const concrete = hit.path.includes('{') ? materializePath(hit.path, hit.pathParams) : hit.path;
  const nextPath = templatize(concrete, hit.test, hit.method);
  if (!nextPath) return null;

  const pathParams =
    concrete !== nextPath || !hit.pathParams || !Object.keys(hit.pathParams).length
      ? extractPathParams(nextPath, concrete)
      : hit.pathParams;

  return {
    ...hit,
    path: nextPath,
    pathParams: Object.keys(pathParams).length ? pathParams : hit.pathParams,
  };
}

function canonicalizeHits(hits: RecordedHit[]): RecordedHit[] {
  return hits.map(canonicalizeHit).filter((hit): hit is RecordedHit => hit != null);
}

type JsonSchema = {
  type?: string;
  nullable?: boolean;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  anyOf?: JsonSchema[];
  description?: string;
};

export type Scenario = {
  name: string;
  group: string;
  status: number;
  pathParams?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  reqBody?: unknown;
  resBody?: unknown;
};

type OpenApiSpec = {
  openapi: string;
  info: Record<string, unknown>;
  servers: unknown[];
  tags: unknown[];
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
  'x-viewer'?: ReturnType<typeof viewerTreeConfig>;
};

export type BuildResult = {
  skipped: boolean;
  reason?: string;
  hits: number;
  operations: number;
  updated: number;
  unchanged: number;
  changed: boolean;
};

function readPackageMeta(): { title: string; version: string; description: string } {
  try {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      name?: string;
      version?: string;
      description?: string;
    };
    const title = pkg.name?.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) ?? 'API';
    return {
      title,
      version: pkg.version ?? '0.0.0',
      description: pkg.description || 'Generated from integration test traffic.',
    };
  } catch {
    return { title: 'API', version: '0.0.0', description: 'Generated from integration test traffic.' };
  }
}

function specInfo() {
  const pkg = readPackageMeta();
  const custom = getConfig().specInfo?.();
  const workspace = getConfig().workspace;
  return {
    title: custom?.title ?? pkg.title,
    version: custom?.version ?? pkg.version,
    description: custom?.description ?? pkg.description,
    workspace,
  };
}

function schemeIdFromHeader(headerName: string): string {
  const custom = getConfig().securitySchemeId?.(headerName);
  if (custom) return custom;
  const parts = headerName.replace(/^x-/, '').split('-').filter(Boolean);
  if (!parts.length) return headerName.replace(/[^a-zA-Z0-9]/g, '');
  return (
    parts[0] +
    parts
      .slice(1)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')
  );
}

function inferSchema(value: unknown): JsonSchema {
  if (value === null || value === undefined) return { nullable: true };
  if (Array.isArray(value)) return { type: 'array', items: inferSchema(value[0] ?? {}) };
  if (typeof value === 'object') {
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, inferSchema(nested)])),
    };
  }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}

function mergeSchema(left?: JsonSchema, right?: JsonSchema): JsonSchema {
  if (!left) return right ?? {};
  if (!right) return left;

  const leftNullOnly = Boolean(left.nullable && !left.type);
  const rightNullOnly = Boolean(right.nullable && !right.type);
  if (leftNullOnly && rightNullOnly) return { nullable: true };
  if (leftNullOnly) return { ...right, nullable: true };
  if (rightNullOnly) return { ...left, nullable: true };

  if (left.type && right.type && left.type !== right.type) return { anyOf: [left, right] };
  if (left.type === 'object' || right.type === 'object') {
    const keys = new Set([...Object.keys(left.properties ?? {}), ...Object.keys(right.properties ?? {})]);
    const properties: Record<string, JsonSchema> = {};
    for (const key of keys) properties[key] = mergeSchema(left.properties?.[key], right.properties?.[key]);
    return { type: 'object', properties, description: left.description ?? right.description };
  }
  if (left.type === 'array' || right.type === 'array') {
    return { type: 'array', items: mergeSchema(left.items, right.items), description: left.description ?? right.description };
  }
  return { ...left, description: left.description ?? right.description };
}

function slug(value: string, index: number): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  return base || `example-${index + 1}`;
}

function valueFingerprint(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined';
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** Stable shared key so request + response examples from the same hit stay paired. */
function exampleKeyForHit(hit: RecordedHit, index: number): string {
  const base = slug(exampleLabel(hit), index);
  return `${base}-${index}`;
}

function putExample(
  store: Record<string, { summary: string; value: unknown }>,
  key: string,
  summary: string,
  value: unknown,
) {
  store[key] = { summary, value };
}

function isPrimaryHit(hit: RecordedHit): boolean {
  if (!hit.test) return false;
  if (getConfig().includeHit?.(hit.method, hit.path, hit.test) === false) return false;
  const methods = declaredMethods(hit.test);
  if (!methods) return true;
  return methods.includes(hit.method);
}

function pathParamsFromHit(hit: RecordedHit): Record<string, string> {
  if (hit.pathParams && Object.keys(hit.pathParams).length) return hit.pathParams;
  const responsePath = hit.resBody && typeof hit.resBody === 'object' ? (hit.resBody as { path?: string }).path : undefined;
  if (!responsePath) return {};
  return extractPathParams(hit.path, responsePath);
}

function inferParamSchema(values: string[]): JsonSchema {
  const meaningful = values.filter((value) => value !== '');
  if (!meaningful.length) return { type: 'string' };
  if (meaningful.every((value) => /^-?(0|[1-9]\d*)$/.test(value))) return { type: 'integer' };
  if (meaningful.every((value) => value === 'true' || value === 'false')) return { type: 'boolean' };
  return { type: 'string' };
}

function firstSuccessValue(opHits: RecordedHit[], read: (hit: RecordedHit) => string | undefined): string | undefined {
  const success = opHits.find((hit) => hit.status >= 200 && hit.status < 300 && read(hit) !== undefined);
  return success ? read(success) : opHits.map(read).find((value) => value !== undefined);
}

function buildParameters(pathTemplate: string, opHits: RecordedHit[]) {
  const parameters: any[] = [];
  const successHits = opHits.filter((hit) => hit.status >= 200 && hit.status < 300);

  for (const name of pathParamNames(pathTemplate)) {
    const values = opHits.map((hit) => pathParamsFromHit(hit)[name]).filter((value): value is string => value !== undefined);
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: inferParamSchema(values),
      example: firstSuccessValue(opHits, (hit) => pathParamsFromHit(hit)[name]),
    });
  }

  const queryNames = [...new Set(opHits.flatMap((hit) => Object.keys(hit.query ?? {})))];
  for (const name of queryNames) {
    const values = opHits.map((hit) => hit.query?.[name]).filter((value): value is string => value !== undefined);
    const required = successHits.length > 0 && successHits.every((hit) => hit.query?.[name] !== undefined);
    parameters.push({
      name,
      in: 'query',
      required,
      schema: inferParamSchema(values),
      example: firstSuccessValue(opHits, (hit) => hit.query?.[name]),
    });
  }

  const headerNames = [...new Set(opHits.flatMap((hit) => Object.keys(hit.headers ?? {}).filter((name) => name !== 'content-type')))];
  for (const name of headerNames) {
    const required = successHits.length > 0 && successHits.every((hit) => hit.headers?.[name] !== undefined);
    parameters.push({
      name,
      in: 'header',
      required,
      schema: { type: 'string' },
      example: firstSuccessValue(opHits, (hit) => hit.headers?.[name]),
    });
  }

  return parameters;
}

function valueTypeLabel(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const item = value.find((entry) => entry !== null && entry !== undefined);
    if (item === undefined) return 'array';
    if (Array.isArray(item)) return 'array';
    if (typeof item === 'object') return 'array<object>';
    if (typeof item === 'number') return Number.isInteger(item) ? 'array<integer>' : 'array<number>';
    return `array<${typeof item}>`;
  }
  if (typeof value === 'object') return 'object';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/** Flatten request-body values into dotted / [] field paths (nested objects & arrays). */
function collectBodyFields(value: unknown, prefix: string, add: (field: Omit<FieldDoc, 'required'> & { required?: boolean }) => void): void {
  if (value === null || value === undefined) {
    if (prefix) add({ name: prefix, in: 'body', type: 'null' });
    return;
  }

  if (Array.isArray(value)) {
    if (prefix) add({ name: prefix, in: 'body', type: valueTypeLabel(value) });
    const sample = value.find((entry) => entry !== null && entry !== undefined);
    if (sample === undefined) return;
    if (Array.isArray(sample)) {
      collectBodyFields(sample, `${prefix}[]`, add);
      return;
    }
    if (typeof sample === 'object') {
      for (const [key, nested] of Object.entries(sample as Record<string, unknown>)) {
        const nestedPath = `${prefix}[].${key}`;
        if (nested !== null && typeof nested === 'object') collectBodyFields(nested, nestedPath, add);
        else add({ name: nestedPath, in: 'body', type: valueTypeLabel(nested) });
      }
    }
    return;
  }

  if (typeof value === 'object') {
    if (prefix) add({ name: prefix, in: 'body', type: 'object' });
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const nestedPath = prefix ? `${prefix}.${key}` : key;
      if (nested !== null && typeof nested === 'object') collectBodyFields(nested, nestedPath, add);
      else add({ name: nestedPath, in: 'body', type: valueTypeLabel(nested) });
    }
  }
}

function inferDocs(method: string, pathTemplate: string, opHits: RecordedHit[]): OperationDoc {
  const fields: FieldDoc[] = [];
  const seen = new Set<string>();
  const add = (field: Omit<FieldDoc, 'required'> & { required?: boolean }) => {
    const key = `${field.in}:${field.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const required = dtoRequired(method, pathTemplate, field.in, field.name);
    fields.push({ ...field, ...(required === undefined ? {} : { required }) });
  };

  for (const name of pathParamNames(pathTemplate)) add({ name, in: 'path', type: 'string' });
  for (const hit of opHits) {
    for (const name of Object.keys(hit.query ?? {})) add({ name, in: 'query', type: 'string' });
    for (const name of Object.keys(hit.headers ?? {})) {
      if (name === 'content-type') continue;
      add({ name, in: 'header', type: 'string' });
    }
    if (hit.reqBody && typeof hit.reqBody === 'object') {
      collectBodyFields(hit.reqBody, '', add);
    }
  }

  return { title: defaultTitle(method, pathTemplate), fields };
}

function securityForHits(opHits: RecordedHit[]): Array<Record<string, unknown[]>> | undefined {
  const headers = new Set<string>();
  for (const hit of opHits) {
    for (const name of Object.keys(hit.headers ?? {})) {
      if (name.startsWith('x-')) headers.add(name);
    }
  }
  if (!headers.size) return undefined;
  // One requirement object = AND (all headers used together on this operation).
  const requirement: Record<string, unknown[]> = {};
  for (const header of headers) requirement[schemeIdFromHeader(header)] = [];
  return [requirement];
}

function exampleLabel(hit: RecordedHit): string {
  return `${hit.status} - ${caseName(hit.test)}`;
}

function toScenario(hit: RecordedHit): Scenario {
  return {
    name: caseName(hit.test),
    group: caseGroup(hit.test),
    status: hit.status,
    pathParams: pathParamsFromHit(hit),
    query: hit.query,
    headers: hit.headers,
    reqBody: hit.reqBody,
    resBody: hit.resBody,
  };
}

function sortScenarios(scenarios: Scenario[]): Scenario[] {
  const groupRank = (group: string) => {
    const order = ['Success', 'Business errors', 'Invalid input', 'Missing fields', 'Auth', 'Other'];
    const index = order.indexOf(group);
    return index === -1 ? order.length : index;
  };
  return [...scenarios].sort((left, right) => {
    const byGroup = groupRank(left.group) - groupRank(right.group);
    if (byGroup !== 0) return byGroup;
    if (left.status !== right.status) return left.status - right.status;
    return left.name.localeCompare(right.name);
  });
}

function dedupeScenarios(scenarios: Scenario[]): Scenario[] {
  const seen = new Set<string>();
  return scenarios.filter((scenario) => {
    // Full request+response fingerprint so matching headers/body stay with each example.
    const key = JSON.stringify([
      scenario.group,
      scenario.name,
      scenario.status,
      scenario.reqBody,
      scenario.resBody,
      scenario.query,
      scenario.pathParams,
      scenario.headers,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function loadHits(): RecordedHit[] {
  if (!existsSync(getOutDir())) return [];
  const workerFiles = readdirSync(getOutDir()).filter((fileName) => fileName.startsWith('hits-w') && fileName.endsWith('.json'));
  if (workerFiles.length) {
    return canonicalizeHits(
      workerFiles.flatMap((fileName) => {
        try {
          const parsed = JSON.parse(readFileSync(path.join(getOutDir(), fileName), 'utf8')) as RecordedHit[];
          return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
          console.error(`DAxTA: skipped corrupt hits file ${fileName}:`, error);
          return [];
        }
      }),
    );
  }

  // Fallback after workers were cleaned — rebuild from last merged hits.json
  try {
    if (!existsSync(getHitsJsonPath())) return [];
    const parsed = JSON.parse(readFileSync(getHitsJsonPath(), 'utf8')) as RecordedHit[];
    return canonicalizeHits(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    console.error('DAxTA: skipped corrupt hits.json:', error);
    return [];
  }
}

function sortOperations<T>(entries: [string, T][]): [string, T][] {
  return [...entries].sort((left, right) => {
    const leftRank = getConfig().operationOrder?.(left[0]);
    const rightRank = getConfig().operationOrder?.(right[0]);
    if (leftRank != null || rightRank != null) {
      return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
    }

    const [leftMethod, ...leftPathParts] = left[0].split(' ');
    const [rightMethod, ...rightPathParts] = right[0].split(' ');
    const leftPath = leftPathParts.join(' ');
    const rightPath = rightPathParts.join(' ');
    const pathCompare = leftPath.localeCompare(rightPath);
    if (pathCompare !== 0) return pathCompare;
    return (METHOD_RANK[leftMethod] ?? 99) - (METHOD_RANK[rightMethod] ?? 99);
  });
}

function buildSpec(hits: RecordedHit[]): OpenApiSpec {
  const grouped = new Map<string, RecordedHit[]>();
  for (const hit of hits.filter(isPrimaryHit)) {
    const key = `${hit.method} ${hit.path}`;
    const opHits = grouped.get(key) ?? [];
    opHits.push(hit);
    grouped.set(key, opHits);
  }

  const paths: Record<string, any> = {};
  const tags = new Set<string>();
  const securitySchemes: Record<string, { type: string; in: string; name: string }> = {};

  for (const [key, opHits] of sortOperations([...grouped.entries()])) {
    const method = key.split(' ')[0];
    const pathTemplate = key.slice(method.length + 1);
    const docs = inferDocs(method, pathTemplate, opHits);
    const tag = operationTag(pathTemplate, method);
    tags.add(tag);
    const security = securityForHits(opHits);
    for (const item of security ?? []) {
      for (const schemeId of Object.keys(item)) {
        const headerName = [...new Set(opHits.flatMap((hit) => Object.keys(hit.headers ?? {})))].find((header) => schemeIdFromHeader(header) === schemeId);
        if (headerName) securitySchemes[schemeId] = { type: 'apiKey', in: 'header', name: headerName };
      }
    }

    const pathItem = (paths[pathTemplate] ??= {});
    const operation = (pathItem[method] ??= {
      tags: [tag],
      summary: docs.title,
      security,
      responses: {},
      'x-docs': docs,
      'x-scenarios': [],
      'x-tree-segments': treePathSegments(pathTemplate),
    });

    const parameters = buildParameters(pathTemplate, opHits);
    if (parameters.length) operation.parameters = parameters;

    for (let index = 0; index < opHits.length; index += 1) {
      const hit = opHits[index];
      const label = exampleLabel(hit);
      const exampleKey = exampleKeyForHit(hit, index);

      if (hit.reqBody !== undefined) {
        operation.requestBody ??= { required: method === 'post' || method === 'put', content: { 'application/json': { schema: inferSchema(hit.reqBody), examples: {} } } };
        const media = operation.requestBody.content['application/json'];
        media.schema = mergeSchema(media.schema, inferSchema(hit.reqBody));
        media.examples ??= {};
        putExample(media.examples, exampleKey, label, hit.reqBody);
      }

      const status = String(hit.status);
      operation.responses[status] ??= {
        description: STATUS_TEXT[status] ?? status,
        content: hit.resBody === undefined || hit.resBody === '' || status === '204' ? undefined : { 'application/json': { schema: inferSchema(hit.resBody), examples: {} } },
      };
      if (operation.responses[status].content) {
        const responseMedia = operation.responses[status].content['application/json'];
        responseMedia.schema = mergeSchema(responseMedia.schema, inferSchema(hit.resBody));
        responseMedia.examples ??= {};
        putExample(responseMedia.examples, exampleKey, label, hit.resBody);
      }
    }

    operation['x-scenarios'] = sortScenarios(dedupeScenarios(opHits.map(toScenario)));
  }

  const info = specInfo();
  return {
    openapi: '3.0.3',
    info: {
      title: info.title,
      version: info.version,
      description: info.description,
      'x-workspace': info.workspace,
    },
    'x-viewer': viewerTreeConfig(),
    servers: [{ url: getConfig().baseUrl }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: { securitySchemes },
  };
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function sortedKeys(value?: Record<string, unknown>): string[] {
  return Object.keys(value ?? {}).sort();
}

function signatureSchema(value: unknown): JsonSchema {
  if (value === null || value === undefined) return { nullable: true };
  if (Array.isArray(value)) return { type: 'array' };
  if (typeof value === 'object') {
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, signatureSchema(nested)])),
    };
  }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}

function scenarioSignature(scenario: Scenario) {
  return JSON.stringify({
    group: scenario.group,
    name: scenario.name,
    status: scenario.status,
    queryKeys: sortedKeys(scenario.query),
    pathParamKeys: sortedKeys(scenario.pathParams),
    headerKeys: sortedKeys(scenario.headers as Record<string, unknown> | undefined),
    reqSchema: signatureSchema(scenario.reqBody),
    resSchema: signatureSchema(scenario.resBody),
    reqValue: valueFingerprint(scenario.reqBody),
    resValue: valueFingerprint(scenario.resBody),
    headerValue: valueFingerprint(scenario.headers),
    queryValue: valueFingerprint(scenario.query),
    pathParamValue: valueFingerprint(scenario.pathParams),
  });
}

function exampleFingerprints(operation: Record<string, unknown>): string[] {
  const fingerprints: string[] = [];
  const collect = (examples?: Record<string, { summary?: string; value?: unknown }>) => {
    for (const [key, example] of Object.entries(examples ?? {})) {
      fingerprints.push(`${key}:${example?.summary ?? ''}:${valueFingerprint(example?.value)}`);
    }
  };

  const requestBody = operation.requestBody as { content?: Record<string, { examples?: Record<string, { summary?: string; value?: unknown }> }> } | undefined;
  collect(requestBody?.content?.['application/json']?.examples);

  const responses = (operation.responses as Record<string, { content?: Record<string, { examples?: Record<string, { summary?: string; value?: unknown }> }> }>) ?? {};
  for (const response of Object.values(responses)) {
    collect(response?.content?.['application/json']?.examples);
  }

  return fingerprints.sort((left, right) => left.localeCompare(right));
}

function operationSignature(operation: Record<string, unknown>): string {
  const scenarios = ((operation['x-scenarios'] as Scenario[]) ?? []).map(scenarioSignature).sort((left, right) => left.localeCompare(right));

  const parameters = ((operation.parameters as Array<Record<string, unknown>>) ?? []).map((parameter) => ({
    name: parameter.name,
    in: parameter.in,
    required: parameter.required,
    schema: parameter.schema,
  }));

  return JSON.stringify({
    summary: operation.summary,
    parameters,
    security: operation.security,
    docs: operation['x-docs'],
    responseStatuses: Object.keys((operation.responses as object) ?? {}).sort(),
    examples: exampleFingerprints(operation),
    scenarios,
  });
}

function operationsEquivalent(existing: unknown, fresh: unknown): boolean {
  return operationSignature(existing as Record<string, unknown>) === operationSignature(fresh as Record<string, unknown>);
}

function hitSignature(hit: RecordedHit): string {
  return JSON.stringify({
    method: hit.method,
    path: hit.path,
    status: hit.status,
    test: hit.test,
    queryKeys: sortedKeys(hit.query),
    pathParamKeys: sortedKeys(hit.pathParams),
    headerKeys: sortedKeys(hit.headers),
    reqSchema: signatureSchema(hit.reqBody),
    resSchema: signatureSchema(hit.resBody),
    reqValue: valueFingerprint(hit.reqBody),
    resValue: valueFingerprint(hit.resBody),
    headerValue: valueFingerprint(hit.headers),
    queryValue: valueFingerprint(hit.query),
    pathParamValue: valueFingerprint(hit.pathParams),
  });
}

function hitsStructureSame(existing: RecordedHit[] | null, fresh: RecordedHit[]): boolean {
  if (!existing) return false;
  const left = existing.filter(isPrimaryHit).map(hitSignature).sort();
  const right = fresh.filter(isPrimaryHit).map(hitSignature).sort();
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeSpecs(existing: OpenApiSpec | null, fresh: OpenApiSpec): { spec: OpenApiSpec; updated: number; unchanged: number; changed: boolean } {
  // Spec mirrors this run's recorded hits only — no carry-over of stale endpoints from older runs.
  if (!existing) return { spec: fresh, updated: countOperations(fresh), unchanged: 0, changed: true };

  const mergedPaths: Record<string, Record<string, unknown>> = {};
  let updated = 0;
  let unchanged = 0;

  for (const [pathTemplate, freshPathItem] of Object.entries(fresh.paths)) {
    mergedPaths[pathTemplate] = {};
    for (const [method, freshOperation] of Object.entries(freshPathItem)) {
      const existingOperation = existing.paths[pathTemplate]?.[method];
      if (existingOperation && operationsEquivalent(existingOperation, freshOperation)) {
        mergedPaths[pathTemplate][method] = existingOperation;
        unchanged += 1;
      } else {
        mergedPaths[pathTemplate][method] = freshOperation;
        updated += 1;
      }
    }
  }

  const spec: OpenApiSpec = {
    ...fresh,
    paths: mergedPaths,
  };

  const removed =
    countOperations(existing) !== countOperations(spec) ||
    Object.keys(existing.paths).some((pathTemplate) => !fresh.paths[pathTemplate]) ||
    Object.entries(existing.paths).some(([pathTemplate, pathItem]) => Object.keys(pathItem).some((method) => !fresh.paths[pathTemplate]?.[method]));

  return {
    spec,
    updated,
    unchanged,
    changed: updated > 0 || removed,
  };
}

function countOperations(spec: OpenApiSpec): number {
  return Object.values(spec.paths).reduce((count, pathItem) => count + Object.keys(pathItem).length, 0);
}

function toStandaloneHtml(spec: unknown): string {
  const template = readFileSync(getViewerAssetPath(), 'utf8');
  const faviconUri = existsSync(getFaviconAssetPath())
    ? `data:image/png;base64,${readFileSync(getFaviconAssetPath()).toString('base64')}`
    : '';
  return template
    .replace('__SPEC_JSON__', JSON.stringify(spec).replace(/</g, '\\u003c'))
    .replaceAll('__FAVICON_DATA_URI__', faviconUri);
}

function viewerTemplateNewerThanHtml(): boolean {
  if (!existsSync(getHtmlPath())) return true;
  const htmlMtime = statSync(getHtmlPath()).mtimeMs;
  const newerThan = (filePath: string) => existsSync(filePath) && statSync(filePath).mtimeMs > htmlMtime;
  return newerThan(getViewerAssetPath()) || newerThan(getFaviconAssetPath());
}

function applyViewerMeta(spec: OpenApiSpec): OpenApiSpec {
  const info = specInfo();
  return {
    ...spec,
    info: {
      ...spec.info,
      title: info.title,
      version: info.version,
      description: info.description,
      'x-workspace': info.workspace,
    },
    'x-viewer': viewerTreeConfig(),
    servers: [{ url: getConfig().baseUrl }],
  };
}

export function buildDaxtaSpec(options: { silent?: boolean; requireHits?: boolean; html?: boolean } = {}): BuildResult {
  const hits = loadHits();
  const existingHits = readJson<RecordedHit[]>(getHitsJsonPath());
  const existingSpec = readJson<OpenApiSpec>(getSpecJsonPath());
  const writeHtml = options.html !== false;

  if (!hits.length) {
    if (existingSpec && writeHtml && viewerTemplateNewerThanHtml()) {
      const refreshed = applyViewerMeta(existingSpec);
      writeJson(getSpecJsonPath(), refreshed);
      writeFileSync(getHtmlPath(), toStandaloneHtml(refreshed));
      if (!options.silent) console.log(`Wrote ${getHtmlPath()} from existing spec (viewer template updated)`);
      return { skipped: false, reason: 'viewer only', hits: 0, operations: countOperations(existingSpec), updated: 0, unchanged: countOperations(existingSpec), changed: true };
    }
    if (options.requireHits) {
      throw new Error('No HTTP hits recorded. Run integration tests first.');
    }
    return { skipped: true, reason: 'no hits', hits: 0, operations: 0, updated: 0, unchanged: 0, changed: false };
  }

  const freshSpec = applyViewerMeta(buildSpec(hits));
  const { spec: merged, updated, unchanged, changed: operationsChanged } = mergeSpecs(existingSpec, freshSpec);
  const spec = applyViewerMeta(merged);
  const hitsChanged = !hitsStructureSame(existingHits, hits);
  const metaChanged =
    !existingSpec ||
    JSON.stringify(existingSpec.info) !== JSON.stringify(spec.info) ||
    JSON.stringify(existingSpec['x-viewer']) !== JSON.stringify(spec['x-viewer']) ||
    JSON.stringify(existingSpec.servers) !== JSON.stringify(spec.servers);
  const refreshHtml = writeHtml && (operationsChanged || metaChanged || viewerTemplateNewerThanHtml());
  const changed = operationsChanged || hitsChanged || metaChanged || refreshHtml;

  if (changed) {
    if (hitsChanged) writeJson(getHitsJsonPath(), hits);
    if (operationsChanged || metaChanged) writeJson(getSpecJsonPath(), spec);
    if (refreshHtml) writeFileSync(getHtmlPath(), toStandaloneHtml(spec));
  }

  const operations = countOperations(spec);
  const result: BuildResult = {
    skipped: false,
    hits: hits.length,
    operations,
    updated,
    unchanged,
    changed,
  };

  if (!options.silent) {
    if (!changed) {
      console.log(`DAxTA unchanged (${hits.length} hits, ${operations} operations — ${unchanged} kept as-is)`);
    } else {
      console.log(`Wrote ${getSpecJsonPath()} from ${hits.length} hits (${operations} operations — ${updated} updated, ${unchanged} unchanged)`);
      console.log(`Wrote ${getHtmlPath()}`);
    }
  }

  return result;
}

/** @deprecated Use `buildDaxtaSpec` */
export const buildOpenApi = buildDaxtaSpec;
