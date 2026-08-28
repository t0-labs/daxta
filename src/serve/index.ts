import { existsSync, readFileSync, statSync } from 'fs';
import * as http from 'http';
import { URL } from 'url';

import { getConfig } from '../config';
import { getDocsBasePath, getHtmlPath, readEmptyDocsHtml } from './paths';
import { CORS_PREFLIGHT_HEADERS, forwardProxyRequest } from './proxy';
import { readStrippedOpenApiJson } from './spec-utils';
import { readViewerEnvStore, writeViewerEnvStore } from './viewer-store';

export { apiDocs, apiDocsHandler, docsEnabled, type ApiDocsHandler, type ApiDocsOptions } from './middleware';
export { getApiDocs, getApiDocUrl, getDocsBasePath, getHtmlPath, getOutDir, getSpecJsonPath } from './paths';

function send(res: http.ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Standalone API docs HTTP server (CLI: `daxta serve`). Prefer `apiDocs(app)` on the app port. */
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
      const body = await readBody(req);
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
        body,
      });
      send(res, proxied.status, proxied.body, proxied.headers);
      return;
    }

    if (url.pathname === `${docsBase}/env.json` || url.pathname === '/env.json') {
      if (method === 'GET' || method === 'HEAD') {
        const store = readViewerEnvStore();
        send(res, 200, `${JSON.stringify(store ?? null)}\n`, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        return;
      }
      if (method === 'PUT' || method === 'POST') {
        try {
          const raw = (await readBody(req)).toString('utf8');
          const saved = writeViewerEnvStore(raw ? JSON.parse(raw) : null);
          send(res, 200, `${JSON.stringify(saved)}\n`, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
        } catch (error) {
          send(res, 400, `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`, {
            'content-type': 'application/json; charset=utf-8',
          });
        }
        return;
      }
    }

    if (url.pathname === '/' || url.pathname === docsBase || url.pathname === `${docsBase}/`) {
      if (!existsSync(htmlPath)) {
        send(res, 200, readEmptyDocsHtml(), {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
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
        send(res, 404, 'openapi.json not found. Run `daxta generate` first.');
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
    console.log(`API docs:    http://127.0.0.1:${port}${docsBase}`);
    console.log(`API spec:    http://127.0.0.1:${port}${docsBase}/openapi.json`);
    console.log(`API docs env: http://127.0.0.1:${port}${docsBase}/env.json`);
  });

  return server;
}
