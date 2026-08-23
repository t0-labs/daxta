import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

import { getConfig } from '../config';
import { extractPathParams, templatize } from '../path.util';

export type RecordedHit = {
  method: string;
  path: string;
  status: number;
  reqBody: unknown;
  resBody: unknown;
  query?: Record<string, string>;
  pathParams?: Record<string, string>;
  headers?: Record<string, string>;
  test?: string;
};

type GlobalHits = typeof globalThis & {
  __DAXTA_HITS__?: RecordedHit[];
  __DAXTA_FLUSH_HOOK__?: boolean;
};

const g = globalThis as GlobalHits;
const hits: RecordedHit[] = (g.__DAXTA_HITS__ ??= []);
const nodeRequire = createRequire(__filename);
const SKIP_HEADERS = new Set(['host', 'accept-encoding', 'connection', 'content-length', 'user-agent', 'accept']);

function outDir() {
  return getConfig().outDir;
}

function currentTestName(): string | undefined {
  try {
    const jestExpect = (globalThis as { expect?: { getState?: () => { currentTestName?: string } } }).expect;
    return jestExpect?.getState?.().currentTestName;
  } catch {
    return undefined;
  }
}

function pickHeaders(request: { header?: Record<string, unknown> }): Record<string, string> | undefined {
  const source = request.header ?? {};
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(source)) {
    const name = rawName.toLowerCase();
    if (SKIP_HEADERS.has(name)) continue;
    if (name !== 'content-type' && !name.startsWith('x-')) continue;
    if (rawValue == null || rawValue === '') continue;
    headers[name] = String(rawValue);
  }
  return Object.keys(headers).length ? headers : undefined;
}

function recordFromSuperagent(
  request: { method?: string; url?: string; _data?: unknown; header?: Record<string, unknown> },
  res: { status?: number; body?: unknown },
) {
  const rawUrl = request.url || '';
  const url = new URL(rawUrl, 'http://localhost');
  const test = currentTestName();
  const pathTemplate = templatize(url.pathname, test, (request.method || 'GET').toLowerCase());
  if (!pathTemplate) return;

  const query = Object.fromEntries(url.searchParams.entries());
  const pathParams = extractPathParams(pathTemplate, url.pathname);
  hits.push({
    method: (request.method || 'GET').toLowerCase(),
    path: pathTemplate,
    status: res.status ?? 0,
    reqBody: request._data,
    resBody: res.body,
    query: Object.keys(query).length ? query : undefined,
    pathParams: Object.keys(pathParams).length ? pathParams : undefined,
    headers: pickHeaders(request),
    test,
  });
}

function patchSuperagent(superagent: { Request?: { prototype?: { end?: unknown; __daxtaPatched?: boolean } } }) {
  const proto = superagent.Request?.prototype as {
    end: (callback?: (err: unknown, res: unknown) => void) => unknown;
    __daxtaPatched?: boolean;
  };
  if (!proto?.end || proto.__daxtaPatched) return false;
  proto.__daxtaPatched = true;

  const originalEnd = proto.end;
  proto.end = function (
    this: { method?: string; url?: string; _data?: unknown; header?: Record<string, unknown> },
    callback?: (err: unknown, res: unknown) => void,
  ) {
    return originalEnd.call(this, (err: unknown, res: unknown) => {
      try {
        if (res) recordFromSuperagent(this, res as { status?: number; body?: unknown });
      } catch {
        // recording must never fail a test
      }
      if (typeof callback === 'function') callback(err, res);
    });
  };
  return true;
}

export function install() {
  const candidates = new Set<string>();
  try {
    const supertestDir = path.dirname(nodeRequire.resolve('supertest'));
    candidates.add(nodeRequire.resolve('superagent', { paths: [supertestDir] }));
  } catch {
    // ignore
  }
  try {
    candidates.add(nodeRequire.resolve('superagent'));
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    try {
      patchSuperagent(nodeRequire(candidate));
    } catch {
      // ignore
    }
  }

  if (!g.__DAXTA_FLUSH_HOOK__) {
    g.__DAXTA_FLUSH_HOOK__ = true;
    const flushSafe = () => {
      try {
        flush();
      } catch {
        // ignore
      }
    };
    process.once('beforeExit', flushSafe);
    process.once('exit', flushSafe);
  }
}

function hitFilePath() {
  const workerId = process.env.JEST_WORKER_ID ?? '0';
  return path.join(outDir(), `hits-w${workerId}-p${process.pid}.json`);
}

export function flush() {
  const dir = outDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(hitFilePath(), `${JSON.stringify(hits, null, 2)}\n`);
}

export function clearWorkerHits() {
  const dir = outDir();
  if (!existsSync(dir)) return;
  for (const fileName of readdirSync(dir)) {
    if (fileName.startsWith('hits-w') && fileName.endsWith('.json')) {
      rmSync(path.join(dir, fileName));
    }
  }
}

export function getHits() {
  return hits;
}
