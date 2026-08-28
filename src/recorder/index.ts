import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

import { getConfig } from '../config';
import { getRunMarkerPath } from '../serve/paths';
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

/** Hit files carry the run id so a later build can never pick up an earlier run's traffic. */
export const HIT_FILE_PATTERN = /^hits-(?:r([A-Za-z0-9]+)-)?w[^-]+-p\d+\.json$/;

export function readRunId(): string | null {
  try {
    const marker = JSON.parse(readFileSync(getRunMarkerPath(), 'utf8')) as { runId?: unknown };
    return typeof marker.runId === 'string' && marker.runId ? marker.runId : null;
  } catch {
    return null;
  }
}

/** Called once per Jest run (global setup) so every worker tags its hits identically. */
export function startRun(): string {
  const dir = outDir();
  mkdirSync(dir, { recursive: true });
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(getRunMarkerPath(), `${JSON.stringify({ runId, startedAt: new Date().toISOString() }, null, 2)}\n`);
  return runId;
}

export function clearRunMarker() {
  try {
    rmSync(getRunMarkerPath());
  } catch {
    // ignore
  }
}

function hitFilePath() {
  const workerId = process.env.JEST_WORKER_ID ?? '0';
  const runId = readRunId();
  const prefix = runId ? `hits-r${runId}-` : 'hits-';
  return path.join(outDir(), `${prefix}w${workerId}-p${process.pid}.json`);
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
    if (HIT_FILE_PATTERN.test(fileName)) rmSync(path.join(dir, fileName));
  }
}

export function getHits() {
  return hits;
}
