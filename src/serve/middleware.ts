import { existsSync, readFileSync, statSync } from 'fs';

import { getDocsBasePath, getHtmlPath } from './paths';
import { CORS_PREFLIGHT_HEADERS, forwardProxyRequest } from './proxy';
import { readStrippedOpenApiJson } from './spec-utils';

export type ApiDocsOptions = {
  /** URL prefix for the viewer. Default from config (`docsPath`) or `/docs`. */
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

/**
 * Express / Nest handler that serves the DAxTA viewer under `/docs`
 * (or `basePath`) and the Try-it proxy at `/__proxy`.
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
    if (!isDocsRoot && !isDocsSpec) {
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
        write(res, 404, 'openapi.json not found. Run `daxta build` first.', { 'content-type': 'text/plain; charset=utf-8' });
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
      write(res, 404, 'openapi.html not found. Run integration tests or `daxta build` first.', {
        'content-type': 'text/plain; charset=utf-8',
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
 * Enable DAxTA `/docs` on a Nest / Express app (`app.use(...)`).
 *
 * Requires `DAXTA_DOCS` in the environment:
 * - missing / empty → throws (app must set it explicitly)
 * - `true` | `1` | `yes` | `on` → serve `/docs`
 * - `false` | `0` | `no` | `off` → no-op
 */
export function apiDocs(
  app: { use: (...handlers: unknown[]) => unknown },
  options: ApiDocsOptions = {},
): void {
  const raw = process.env.DAXTA_DOCS;
  if (raw == null || String(raw).trim() === '') {
    throw new Error(
      'DAxTA: DAXTA_DOCS is not set. Set DAXTA_DOCS=true to enable /docs, or DAXTA_DOCS=false to disable.',
    );
  }
  const normalized = String(raw).trim().toLowerCase();
  const enabled = ['1', 'true', 'yes', 'on'].includes(normalized);
  const disabled = ['0', 'false', 'no', 'off'].includes(normalized);
  if (!enabled && !disabled) {
    throw new Error(
      `DAxTA: invalid DAXTA_DOCS="${raw}". Use true/false (or 1/0).`,
    );
  }
  if (!enabled) return;
  app.use(apiDocsHandler(options));
}
