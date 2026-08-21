import { existsSync, readFileSync, statSync } from 'fs';
import * as http from 'http';
import { URL } from 'url';

import { getConfig } from '../config';
import { getDocsBasePath, getHtmlPath } from './paths';
import { CORS_PREFLIGHT_HEADERS, forwardProxyRequest } from './proxy';
import { readStrippedOpenApiJson } from './spec-utils';

export { apiDocs, apiDocsHandler, type ApiDocsHandler, type ApiDocsOptions } from './middleware';
export { getDocsBasePath, getHtmlPath, getOutDir, getSpecJsonPath } from './paths';

function send(res: http.ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

/** Standalone docs HTTP server (CLI: `daxta serve`). Prefer `apiDocs(app)` on the app port. */
export function serveApiDocs(options: { port?: number } = {}) {
  const config = getConfig();
  const port = options.port ?? Number(process.env.DAXTA_DOCS_PORT || process.env.OPENAPI_DOCS_PORT || config.port);
  const htmlPath = getHtmlPath();
  const docsBase = getDocsBasePath();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      send(res, 204, '', { ...CORS_PREFLIGHT_HEADERS });
      return;
    }

    if (url.pathname === '/__proxy') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null) continue;
        const lower = key.toLowerCase();
        if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue;
        headers[key] = Array.isArray(value) ? value.join(',') : value;
      }
      const proxied = await forwardProxyRequest({
        target: url.searchParams.get('target') || '',
        method,
        headers,
        body: Buffer.concat(chunks),
      });
      send(res, proxied.status, proxied.body, proxied.headers);
      return;
    }

    if (url.pathname === '/' || url.pathname === docsBase || url.pathname === `${docsBase}/`) {
      if (!existsSync(htmlPath)) {
        send(res, 404, 'openapi.html not found. Run `daxta build` first.');
        return;
      }
      send(res, 200, readFileSync(htmlPath), {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'last-modified': statSync(htmlPath).mtime.toUTCString(),
      });
      return;
    }

    if (url.pathname === '/openapi.json' || url.pathname === `${docsBase}/openapi.json`) {
      const body = readStrippedOpenApiJson();
      if (!body) {
        send(res, 404, 'openapi.json not found. Run `daxta build` first.');
        return;
      }
      send(res, 200, body, {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="openapi.json"',
        'cache-control': 'no-store',
      });
      return;
    }

    send(res, 404, 'Not found');
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`DAxTA docs:    http://127.0.0.1:${port}${docsBase}`);
    console.log(`DAxTA OpenAPI: http://127.0.0.1:${port}${docsBase}/openapi.json`);
  });

  return server;
}
