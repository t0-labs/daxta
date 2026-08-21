import { existsSync, readFileSync } from 'fs';

import { getSpecJsonPath } from './paths';

const VIEWER_EXTENSION_KEYS = new Set(['x-viewer', 'x-docs', 'x-scenarios', 'x-tree-segments', 'x-workspace']);

export function stripViewerExtensions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripViewerExtensions);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (VIEWER_EXTENSION_KEYS.has(key)) continue;
    out[key] = stripViewerExtensions(child);
  }
  return out;
}

export function readStrippedOpenApiJson(): string | null {
  const specPath = getSpecJsonPath();
  if (!existsSync(specPath)) return null;
  const raw = JSON.parse(readFileSync(specPath, 'utf8')) as Record<string, unknown>;
  return `${JSON.stringify(stripViewerExtensions(raw), null, 2)}\n`;
}
