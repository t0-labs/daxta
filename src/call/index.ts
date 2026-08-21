import * as readline from 'readline';

import type { FieldDoc } from '../catalog';
import { getConfig } from '../config';
import { readFieldsFile, type FieldsFile } from '../fields/export-fields';

export type CallValues = {
  method: string;
  path: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
};

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function setNested(target: Record<string, unknown>, dotted: string, raw: string, type: string) {
  const parts = dotted.replace(/\[\]/g, '.0').split('.').filter(Boolean);
  let cursor: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = parts[i + 1];
    const asIndex = /^\d+$/.test(next);
    const container = cursor as Record<string, unknown>;
    if (container[key] == null) container[key] = asIndex ? [] : {};
    cursor = container[key] as Record<string, unknown> | unknown[];
  }
  const leaf = parts[parts.length - 1];
  let value: unknown = raw;
  if (type.includes('integer') || type === 'number') {
    const n = Number(raw);
    value = Number.isNaN(n) ? raw : n;
  } else if (type === 'boolean') {
    value = raw.toLowerCase() === 'true';
  } else if (raw === 'null') {
    value = null;
  } else {
    try {
      if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) value = JSON.parse(raw);
    } catch {
      // keep string
    }
  }
  if (Array.isArray(cursor) && /^\d+$/.test(leaf)) (cursor as unknown[])[Number(leaf)] = value;
  else (cursor as Record<string, unknown>)[leaf] = value;
}

export async function promptForOperation(
  fieldsFile: FieldsFile,
  options: { method?: string; path?: string } = {},
): Promise<CallValues> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    let ops = fieldsFile.operations;
    if (options.method) ops = ops.filter((op) => op.method === options.method!.toLowerCase());
    if (options.path) ops = ops.filter((op) => op.path === options.path);

    if (!ops.length) throw new Error('No matching operations in fields file.');

    let selected = ops[0];
    if (ops.length > 1 && !options.method && !options.path) {
      console.log('Operations:');
      ops.forEach((op, i) => console.log(`  [${i + 1}] ${op.method.toUpperCase()} ${op.path}`));
      const pick = await ask(rl, 'Select operation number: ');
      const index = Number(pick) - 1;
      if (!ops[index]) throw new Error('Invalid selection');
      selected = ops[index];
    } else if (ops.length > 1) {
      console.log('Operations:');
      ops.forEach((op, i) => console.log(`  [${i + 1}] ${op.method.toUpperCase()} ${op.path}`));
      const pick = await ask(rl, 'Select operation number: ');
      const index = Number(pick) - 1;
      if (!ops[index]) throw new Error('Invalid selection');
      selected = ops[index];
    }

    console.log(`\n${selected.method.toUpperCase()} ${selected.path}`);
    const pathParams: Record<string, string> = {};
    const query: Record<string, string> = {};
    const headers: Record<string, string> = {};
    const body: Record<string, unknown> = {};

    // Prefer leaf fields for body (skip pure object containers when children exist)
    const bodyLeaves = selected.fields.filter((f) => f.in === 'body');
    const hasChild = (name: string) => bodyLeaves.some((f) => f.name.startsWith(`${name}.`) || f.name.startsWith(`${name}[]`));
    const effective: FieldDoc[] = [
      ...selected.fields.filter((f) => f.in !== 'body'),
      ...bodyLeaves.filter((f) => !hasChild(f.name)),
    ];

    for (const field of effective) {
      const reqLabel = field.required === true ? 'required' : field.required === false ? 'optional' : 'unknown';
      const hint = field.required === false || field.required === undefined ? ' (Enter to skip)' : '';
      const answer = (await ask(rl, `${field.in}.${field.name} [${field.type}, ${reqLabel}]${hint}: `)).trim();
      if (!answer) {
        if (field.required === true) throw new Error(`Missing required field: ${field.in}.${field.name}`);
        continue;
      }
      if (field.in === 'path') pathParams[field.name] = answer;
      else if (field.in === 'query') query[field.name] = answer;
      else if (field.in === 'header') headers[field.name] = answer;
      else setNested(body, field.name, answer, field.type);
    }

    return {
      method: selected.method,
      path: selected.path,
      pathParams: Object.keys(pathParams).length ? pathParams : undefined,
      query: Object.keys(query).length ? query : undefined,
      headers: Object.keys(headers).length ? headers : undefined,
      body: Object.keys(body).length ? body : undefined,
    };
  } finally {
    rl.close();
  }
}

function applyPathParams(template: string, params?: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params?.[name];
    if (value == null) throw new Error(`Missing path param: ${name}`);
    return encodeURIComponent(value);
  });
}

export async function executeCall(values: CallValues, extraHeaders: Record<string, string> = {}): Promise<void> {
  const baseUrl = getConfig().baseUrl.replace(/\/$/, '');
  const url = new URL(applyPathParams(values.path, values.pathParams), `${baseUrl}/`);
  for (const [key, value] of Object.entries(values.query ?? {})) url.searchParams.set(key, value);

  const headers: Record<string, string> = {
    accept: 'application/json',
    ...extraHeaders,
    ...(values.headers ?? {}),
  };
  const hasBody = values.body !== undefined && !['get', 'head'].includes(values.method);
  if (hasBody && !headers['content-type']) headers['content-type'] = 'application/json';

  const response = await fetch(url, {
    method: values.method.toUpperCase(),
    headers,
    body: hasBody ? JSON.stringify(values.body) : undefined,
  });
  const text = await response.text();
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // keep raw
  }
  console.log(`\nHTTP ${response.status}`);
  console.log(pretty || '(empty body)');
}

export async function runInteractiveCall(options: {
  fieldsFile?: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
} = {}) {
  const file = readFieldsFile(options.fieldsFile);
  const values = await promptForOperation(file, { method: options.method, path: options.path });
  await executeCall(values, options.headers);
}

export async function runFileCall(options: {
  valuesFile: string;
  headers?: Record<string, string>;
}) {
  const { readFileSync } = await import('fs');
  const values = JSON.parse(readFileSync(options.valuesFile, 'utf8')) as CallValues;
  if (!values.method || !values.path) throw new Error('values file must include method and path');
  await executeCall(values, options.headers);
}
