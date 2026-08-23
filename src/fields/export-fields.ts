import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

import type { FieldDoc, OperationDoc } from '../catalog';
import { getConfig } from '../config';
import { loadHits } from '../build/build-spec';
import { dtoRequired } from './dto-fields';
import { pathParamNames } from '../path.util';
import type { RecordedHit } from '../recorder';

export type FieldsFile = {
  version: 1;
  baseUrl: string;
  generatedAt: string;
  operations: Array<{
    method: string;
    path: string;
    title?: string;
    fields: FieldDoc[];
  }>;
};

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

export function inferOperationFields(method: string, pathTemplate: string, opHits: RecordedHit[]): OperationDoc {
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

  return { title: pathTemplate, fields };
}

function loadSpecOperations(): Array<{ method: string; path: string; title?: string; fields: FieldDoc[] }> {
  const specPath = path.join(getConfig().outDir, 'openapi.json');
  if (!existsSync(specPath)) return [];
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
    paths?: Record<string, Record<string, { summary?: string; 'x-docs'?: OperationDoc }>>;
  };
  const ops: Array<{ method: string; path: string; title?: string; fields: FieldDoc[] }> = [];
  for (const [pathTemplate, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation || typeof operation !== 'object') continue;
      const docs = operation['x-docs'];
      ops.push({
        method: method.toLowerCase(),
        path: pathTemplate,
        title: docs?.title ?? operation.summary,
        fields: docs?.fields ?? [],
      });
    }
  }
  return ops;
}

export function buildFieldsFile(filter?: { method?: string; path?: string }): FieldsFile {
  const config = getConfig();
  const fromSpec = loadSpecOperations();
  const hits = loadHits();
  const grouped = new Map<string, RecordedHit[]>();
  for (const hit of hits) {
    const key = `${hit.method} ${hit.path}`;
    const list = grouped.get(key) ?? [];
    list.push(hit);
    grouped.set(key, list);
  }

  const byKey = new Map<string, { method: string; path: string; title?: string; fields: FieldDoc[] }>();
  for (const op of fromSpec) {
    byKey.set(`${op.method} ${op.path}`, op);
  }
  for (const [key, opHits] of grouped) {
    const method = key.split(' ')[0];
    const pathTemplate = key.slice(method.length + 1);
    const inferred = inferOperationFields(method, pathTemplate, opHits);
    const existing = byKey.get(key);
    if (!existing || !existing.fields.length) {
      byKey.set(key, { method, path: pathTemplate, title: inferred.title, fields: inferred.fields });
    } else {
      // merge required flags from DTO when missing
      const fieldMap = new Map(existing.fields.map((f) => [`${f.in}:${f.name}`, f]));
      for (const field of inferred.fields) {
        const k = `${field.in}:${field.name}`;
        const prev = fieldMap.get(k);
        if (!prev) fieldMap.set(k, field);
        else if (prev.required === undefined && field.required !== undefined) fieldMap.set(k, { ...prev, required: field.required });
      }
      byKey.set(key, { ...existing, fields: [...fieldMap.values()] });
    }
  }

  let operations = [...byKey.values()].sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
  if (filter?.method) {
    operations = operations.filter((op) => op.method === filter.method!.toLowerCase());
  }
  if (filter?.path) {
    operations = operations.filter((op) => op.path === filter.path);
  }

  return {
    version: 1,
    baseUrl: config.baseUrl,
    generatedAt: new Date().toISOString(),
    operations,
  };
}

export function writeFieldsFile(filter?: { method?: string; path?: string }, outFile?: string): string {
  const file = buildFieldsFile(filter);
  const target = outFile ?? getConfig().fieldsFile;
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
  return target;
}

export function readFieldsFile(filePath?: string): FieldsFile {
  const target = filePath ?? getConfig().fieldsFile;
  if (!existsSync(target)) {
    throw new Error(`Fields file not found: ${target}. Run \`daxta fields\` first.`);
  }
  return JSON.parse(readFileSync(target, 'utf8')) as FieldsFile;
}
