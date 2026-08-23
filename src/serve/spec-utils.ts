import { existsSync, readFileSync } from 'fs';

import { getSpecJsonPath } from './paths';

const VIEWER_EXTENSION_KEYS = new Set(['x-viewer', 'x-docs', 'x-scenarios', 'x-tree-segments', 'x-workspace']);
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

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

function treeSegmentsForOperation(urlPath: string, operation: Record<string, unknown>): string[] {
  const fromExt = operation['x-tree-segments'];
  if (Array.isArray(fromExt) && fromExt.every((part) => typeof part === 'string')) {
    return fromExt as string[];
  }
  return urlPath.split('/').filter(Boolean);
}

/**
 * Build export path keys from sidebar tree segments (same order as docs),
 * appending any `{param}` tail from the real URL so templates stay complete.
 * Real URL is preserved on `x-daxta-url-path` when it differs.
 */
export function exportPathFromTree(urlPath: string, treeSegments: string[]): string {
  const originalParts = urlPath.split('/').filter(Boolean);
  const paramIdx = originalParts.findIndex((part) => part.startsWith('{'));
  const tail = paramIdx >= 0 ? originalParts.slice(paramIdx) : [];
  const treeHasParam = treeSegments.some((part) => part.startsWith('{'));

  const parts =
    treeSegments.length === 0
      ? originalParts
      : treeHasParam || paramIdx < 0
        ? treeSegments
        : [...treeSegments, ...tail];

  return `/${parts.join('/')}`;
}

type ExampleObj = { summary?: string; description?: string; value?: unknown };

function promoteExampleLabels(examples: Record<string, ExampleObj> | undefined): Record<string, ExampleObj> | undefined {
  if (!examples || typeof examples !== 'object') return examples;
  const out: Record<string, ExampleObj> = {};
  for (const [key, example] of Object.entries(examples)) {
    if (!example || typeof example !== 'object') continue;
    const summary = String(example.summary || example.description || key).trim() || key;
    let name = summary;
    let n = 2;
    while (Object.prototype.hasOwnProperty.call(out, name)) {
      name = `${summary} (${n})`;
      n += 1;
    }
    out[name] = { summary, description: summary, value: example.value };
  }
  return out;
}

function promoteOperationExampleLabels(operation: Record<string, unknown>): Record<string, unknown> {
  const next = { ...operation };
  const requestBody = next.requestBody as
    | { content?: Record<string, { examples?: Record<string, ExampleObj> }> }
    | undefined;
  if (requestBody?.content?.['application/json']?.examples) {
    const media = { ...requestBody.content['application/json'] };
    media.examples = promoteExampleLabels(media.examples);
    next.requestBody = {
      ...requestBody,
      content: { ...requestBody.content, 'application/json': media },
    };
  }
  const responses = next.responses as
    | Record<string, { description?: string; content?: Record<string, { examples?: Record<string, ExampleObj> }> }>
    | undefined;
  if (responses) {
    const out: typeof responses = {};
    for (const [status, response] of Object.entries(responses)) {
      const examples = response?.content?.['application/json']?.examples;
      if (!examples) {
        out[status] = response;
        continue;
      }
      const media = { ...response.content!['application/json'] };
      media.examples = promoteExampleLabels(examples);
      const labels = Object.keys(media.examples || {});
      out[status] = {
        ...response,
        description: labels.length === 1 ? labels[0] : response.description || status,
        content: { ...response.content, 'application/json': media },
      };
    }
    next.responses = out;
  }
  return next;
}

/**
 * Export OpenAPI with path keys ordered like the docs sidebar (`x-tree-segments`).
 * Real request URLs stay on `x-daxta-url-path` when remapped.
 */
export function toTreeOrderedOpenApi(raw: Record<string, unknown>): Record<string, unknown> {
  const sourcePaths = (raw.paths ?? {}) as Record<string, Record<string, unknown>>;
  const exportPaths: Record<string, Record<string, unknown>> = {};
  const tagNames = new Set<string>();

  for (const [urlPath, pathItem] of Object.entries(sourcePaths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    let treeSegments: string[] | null = null;
    for (const [key, value] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(key) || !value || typeof value !== 'object') continue;
      treeSegments = treeSegmentsForOperation(urlPath, value as Record<string, unknown>);
      break;
    }
    if (!treeSegments) treeSegments = urlPath.split('/').filter(Boolean);

    const exportPath = exportPathFromTree(urlPath, treeSegments);
    const exportPathItem: Record<string, unknown> = { ...(exportPaths[exportPath] ?? {}) };

    for (const [key, value] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(key) || !value || typeof value !== 'object') {
        if (!HTTP_METHODS.has(key) && exportPathItem[key] === undefined) {
          exportPathItem[key] = stripViewerExtensions(value);
        }
        continue;
      }
      const operation = value as Record<string, unknown>;
      const segments = treeSegmentsForOperation(urlPath, operation);
      let cleaned = stripViewerExtensions(operation) as Record<string, unknown>;
      cleaned = promoteOperationExampleLabels(cleaned);

      const tagParts = segments.filter((part) => !part.startsWith('{'));
      const tag = tagParts.length ? tagParts.join(' / ') : 'API';
      cleaned.tags = [tag];
      cleaned['x-tree-segments'] = segments;
      tagNames.add(tag);

      if (exportPath !== urlPath) {
        cleaned['x-daxta-url-path'] = urlPath;
      }

      exportPathItem[key] = cleaned;
    }

    exportPaths[exportPath] = exportPathItem;
  }

  const orderedPaths: Record<string, Record<string, unknown>> = {};
  for (const key of Object.keys(exportPaths).sort((a, b) => a.localeCompare(b))) {
    orderedPaths[key] = exportPaths[key];
  }

  const info = stripViewerExtensions(raw.info ?? { title: 'API', version: '0.0.0' }) as Record<string, unknown>;
  const tags = [...tagNames].sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));

  return {
    openapi: (raw.openapi as string) || '3.0.3',
    info,
    ...(raw.servers ? { servers: stripViewerExtensions(raw.servers) } : {}),
    tags,
    paths: orderedPaths,
    ...(raw.components ? { components: stripViewerExtensions(raw.components) } : {}),
  };
}

export function readStrippedOpenApiJson(): string | null {
  const specPath = getSpecJsonPath();
  if (!existsSync(specPath)) return null;
  const raw = JSON.parse(readFileSync(specPath, 'utf8')) as Record<string, unknown>;
  return `${JSON.stringify(toTreeOrderedOpenApi(raw), null, 2)}\n`;
}
