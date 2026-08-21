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

export function getViewerAssetPath(): string {
  return path.join(__dirname, '..', '..', 'assets', 'viewer.html');
}

export function getFaviconAssetPath(): string {
  return path.join(__dirname, '..', '..', 'assets', 'favicon.png');
}

export function getDocsBasePath(): string {
  const configured = getConfig().docsPath ?? '/docs';
  return configured.startsWith('/') ? configured.replace(/\/$/, '') || '/docs' : `/${configured}`.replace(/\/$/, '');
}
