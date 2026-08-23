import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { getConfig } from '../config';

export function getOutDir(): string {
  return getConfig().outDir;
}

export function getHtmlPath(): string {
  return path.join(getOutDir(), 'openapi.html');
}

export function getSpecJsonPath(): string {
  return path.join(getOutDir(), 'openapi.json');
}

export function getHitsJsonPath(): string {
  return path.join(getOutDir(), 'hits.json');
}

/** Try-it env/headers — outside outDir so rebuild does not wipe it. */
export function getViewerStorePath(): string {
  return getConfig().viewerStoreFile;
}

export function getViewerAssetPath(): string {
  return path.join(__dirname, '..', '..', 'assets', 'viewer.html');
}

export function getEmptyViewerAssetPath(): string {
  return path.join(__dirname, '..', '..', 'assets', 'empty.html');
}

const EMPTY_DOCS_FALLBACK = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>API Documentation</title></head><body style="font:13px/1.45 system-ui;background:#fafafa;color:#111;margin:0;padding:48px 24px">
<p style="font:600 10px/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#666">Waiting</p>
<h1 style="font-size:22px;letter-spacing:-.04em">No API documentation yet</h1>
<p>Run your integration tests, then refresh this page.</p>
</body></html>`;

export function readEmptyDocsHtml(): Buffer {
  const file = getEmptyViewerAssetPath();
  if (existsSync(file)) return readFileSync(file);
  return Buffer.from(EMPTY_DOCS_FALLBACK);
}

export function getFaviconAssetPath(): string {
  return path.join(__dirname, '..', '..', 'assets', 'favicon.png');
}

export function getDocsBasePath(): string {
  const configured = getConfig().docsPath ?? '/api-docs';
  return configured.startsWith('/') ? configured.replace(/\/$/, '') || '/api-docs' : `/${configured}`.replace(/\/$/, '');
}

/** App-origin URL where generated API docs are served (e.g. `http://localhost:3000/api-docs`). */
export function getApiDocUrl(): string {
  const config = getConfig();
  return `${String(config.baseUrl || '').replace(/\/$/, '')}${getDocsBasePath()}`;
}

/** Paths and URL for the generated API docs artifact. */
export function getApiDocs(): { url: string; specPath: string; htmlPath: string } {
  return {
    url: getApiDocUrl(),
    specPath: getSpecJsonPath(),
    htmlPath: getHtmlPath(),
  };
}
