import { existsSync, readFileSync, statSync } from 'fs';

import { getDocsBasePath, getHtmlPath, readEmptyDocsHtml } from './paths';
import { CORS_PREFLIGHT_HEADERS, forwardProxyRequest } from './proxy';
import { readStrippedOpenApiJson } from './spec-utils';
import { readViewerEnvStore, writeViewerEnvStore } from './viewer-store';

export type ApiDocsOptions = {
  /** URL prefix for the API docs viewer. Default from config (`docsPath`) / `DAXTA_DOCS_PATH` or `/docs`. */
  basePath?: string;
};

type LooseRequest = {
  method?: string;
  path?: string;
  url?: string;
  originalUrl?: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type LooseResponse = {
  statusCode?: number;
  status?: (code: number) => LooseResponse;
  type?: (value: string) => LooseResponse;
  setHeader: (name: string, value: string) => void;
  send?: (body: string | Buffer | object) => void;
  end: (body?: string | Buffer) => void;
  writeHead?: (code: number, headers?: Record<string, string>) => void;
};

export type ApiDocsHandler = (
  req: LooseRequest,
  res: LooseResponse,
  next: (error?: unknown) => void,
) => void | Promise<void>;

function requestPathname(req: LooseRequest): string {
  const raw = req.originalUrl || req.url || req.path || '/';
  try {
    return new URL(raw, 'http://localhost').pathname;
  } catch {
    return String(raw).split('?')[0] || '/';
  }
}

function write(res: LooseResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  if (typeof res.status === 'function' && typeof res.send === 'function') {
    const typed = res.status(status);
    if (headers['content-type']?.includes('html') && typed.type) typed.type('html');
    if (headers['content-type']?.includes('json') && typed.type) typed.type('json');
    typed.send?.(body);
    return;
  }
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, headers);
    res.end(body);
    return;
  }
  res.statusCode = status;
  res.end(body);
}

function collectHeaders(req: LooseRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (value == null) continue;
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue;
    headers[key] = Array.isArray(value) ? value.join(',') : value;
  }
  return headers;
}

function bodyToBuffer(body: unknown): Buffer | undefined {
  if (body == null) return undefined;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  return Buffer.from(JSON.stringify(body));
}

async function readRequestJson(req: LooseRequest): Promise<unknown> {
  if (req.body != null && req.body !== '') {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return null;
      }
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        return JSON.parse(req.body.toString('utf8'));
      } catch {
        return null;
      }
    }
    return req.body;
  }

  const stream = req as unknown as NodeJS.ReadableStream & { readableEnded?: boolean };
  if (typeof stream.on !== 'function' || stream.readableEnded) return null;

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Express / Nest handler that serves generated API docs under `/docs`
 * (or `basePath`), Try-it proxy at `/__proxy`, and env store at `{base}/env.json`.
 */
export function apiDocsHandler(options: ApiDocsOptions = {}): ApiDocsHandler {
  const basePath = (options.basePath ?? getDocsBasePath()).replace(/\/$/, '') || '/docs';

  return async (req, res, next) => {
    const method = (req.method || 'GET').toUpperCase();
    const pathname = requestPathname(req);

    if (method === 'OPTIONS' && (pathname === '/__proxy' || pathname.startsWith(basePath))) {
      write(res, 204, '', { ...CORS_PREFLIGHT_HEADERS });
      return;
    }

    if (pathname === '/__proxy') {
      const target =
        typeof req.query?.target === 'string'
          ? req.query.target
          : new URL(req.originalUrl || req.url || '/', 'http://localhost').searchParams.get('target') || '';
      const proxied = await forwardProxyRequest({
        target,
        method,
        headers: collectHeaders(req),
        body: bodyToBuffer(req.body),
      });
      write(res, proxied.status, proxied.body, proxied.headers);
      return;
    }

    const isDocsRoot = pathname === basePath || pathname === `${basePath}/`;
    const isDocsSpec = pathname === `${basePath}/openapi.json`;
    const isDocsEnv = pathname === `${basePath}/env.json`;

    if (!isDocsRoot && !isDocsSpec && !isDocsEnv) {
      next();
      return;
    }

    if (isDocsEnv) {
      if (method === 'GET' || method === 'HEAD') {
        const store = readViewerEnvStore();
        write(res, 200, `${JSON.stringify(store ?? null)}\n`, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        return;
      }
      if (method === 'PUT' || method === 'POST') {
        try {
          const payload = await readRequestJson(req);
          const saved = writeViewerEnvStore(payload);
          write(res, 200, `${JSON.stringify(saved)}\n`, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
        } catch (error) {
          write(res, 400, `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`, {
            'content-type': 'application/json; charset=utf-8',
          });
        }
        return;
      }
      next();
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      next();
      return;
    }

    if (isDocsSpec) {
      const body = readStrippedOpenApiJson();
      if (!body) {
        write(res, 404, 'openapi.json not found. Run `daxta generate` first.', { 'content-type': 'text/plain; charset=utf-8' });
        return;
      }
      write(res, 200, body, {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="openapi.json"',
        'cache-control': 'no-store',
      });
      return;
    }

    const htmlPath = getHtmlPath();
    if (!existsSync(htmlPath)) {
      write(res, 200, readEmptyDocsHtml(), {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }

    const html = readFileSync(htmlPath);
    write(res, 200, html, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'last-modified': statSync(htmlPath).mtime.toUTCString(),
    });
  };
}

/**
 * `NODE_ENV` values that open the docs. The list is deliberately closed: an
 * unset or unrecognised `NODE_ENV` keeps the docs off so a misconfigured
 * deployment never exposes them.
 */
const WORKING_ENVS = new Set(['dev', 'development', 'test', 'sta', 'staging']);

/** Docs follow `NODE_ENV`, and stay closed unless it names a known working env. */
export function docsEnabled(): boolean {
  const nodeEnv = String(process.env.NODE_ENV ?? '').trim().toLowerCase();
  return WORKING_ENVS.has(nodeEnv);
}

/**
 * Mount generated API docs on a Nest / Express app (`app.use(...)`).
 *
 * Served only when `NODE_ENV` is dev, development, test, sta or staging.
 *
 * Path defaults to `/docs`. Override with `DAXTA_DOCS_PATH` or `docsPath` in config.
 */
export function apiDocs(
  app: { use: (...handlers: unknown[]) => unknown },
  options: ApiDocsOptions = {},
): void {
  if (!docsEnabled()) return;
  app.use(apiDocsHandler(options));
}
