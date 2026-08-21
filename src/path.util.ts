import { getConfig } from './config';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_RE = /^-?\d+(\.\d+)?$/;
const TOKENISH_RE = /^[A-Za-z0-9_-]{16,}$/;
const BOOLISH_RE = /^(true|false|null|undefined)$/i;
const ENCODED_RE = /%[0-9A-Fa-f]{2}/;
const LITERAL_PARAM_RE = /^\{[^}]+\}$/;

/** Path segments that are real route actions/resources, not id-like test values. */
const STATIC_SEGMENTS = new Set([
  'lock',
  'unlock',
  'pay',
  'complete',
  'cancel',
  'confirm',
  'status',
  'start',
  'stop',
  'retry',
  'approve',
  'reject',
  'search',
  'export',
  'import',
  'me',
  'admin',
  'device',
  'devices',
  'basket',
  'baskets',
  'user',
  'users',
  'health',
  'ready',
  'live',
]);

export function toOpenApiTemplate(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

export function templateFromTestName(test?: string): string | null {
  if (!test) return null;
  const match = test.match(/^\/?(\S+)\s+\[(?:GET|POST|PUT|PATCH|DELETE|UPDATE|UPSERT)\]/i);
  if (!match) return null;
  const raw = `/${match[1].replace(/^\/+/, '')}`.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, ':$1').replace(/\/+$/, '') || '/';
  return toOpenApiTemplate(raw);
}

export function pathMatchesTemplate(template: string, actual: string): boolean {
  const templateParts = template.split('/').filter(Boolean);
  const actualParts = (actual.replace(/\/+$/, '') || '/').split('/').filter(Boolean);
  if (templateParts.length !== actualParts.length) return false;
  return templateParts.every((part, index) => /^\{.+\}$/.test(part) || part === actualParts[index]);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function looksLikeCollection(segment: string): boolean {
  if (!segment || /^v\d+$/i.test(segment) || /^\{.+\}$/.test(segment)) return false;
  const lower = segment.toLowerCase();
  if (STATIC_SEGMENTS.has(lower) && !lower.endsWith('s')) return false;
  return /s$/i.test(segment) || /list|items|records/i.test(segment);
}

function looksLikeStaticSegment(segment: string): boolean {
  return STATIC_SEGMENTS.has(safeDecode(segment).toLowerCase());
}

export function isDynamicSegment(segment: string, previous?: string): boolean {
  const decoded = safeDecode(segment);
  if (UUID_RE.test(decoded)) return true;
  if (NUMERIC_ID_RE.test(decoded)) return true;
  if (BOOLISH_RE.test(decoded)) return true;
  if (LITERAL_PARAM_RE.test(decoded)) return true;
  if (ENCODED_RE.test(segment)) return true;
  if (/^(\[\]|\{\}|\[.*\]|\{.*\})$/.test(decoded.replace(/\s/g, ''))) return true;
  if (TOKENISH_RE.test(decoded) && previous && !/^v\d+$/i.test(previous)) return true;
  // After a collection, only known actions/resources stay literal — test junk becomes {id}
  if (previous && looksLikeCollection(previous) && !looksLikeStaticSegment(decoded)) return true;
  return false;
}

function camelFromKebab(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function singularize(segment: string): string {
  const camel = camelFromKebab(segment);
  if (camel.endsWith('ies') && camel.length > 3) return camel.slice(0, -3) + 'y';
  if (camel.endsWith('ses') && camel.length > 3) return camel.slice(0, -2);
  if (camel.endsWith('s') && !camel.endsWith('ss') && camel.length > 1) return camel.slice(0, -1);
  return camel;
}

function uniqueParamName(base: string, used: Set<string>): string {
  let name = base || 'id';
  let suffix = 2;
  while (used.has(name)) {
    name = `${base || 'id'}${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

function paramName(previous: string, used: Set<string>): string {
  const byId = previous.match(/^by-(.+)-id$/i);
  const base = byId ? `${camelFromKebab(byId[1])}Id` : `${singularize(previous)}Id`;
  return uniqueParamName(base, used);
}

export function heuristicTemplatize(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const used = new Set<string>();
  const templated = parts.map((part, index) => {
    const previous = parts[index - 1];
    if (!isDynamicSegment(part, previous)) return part;
    if (!previous || /^v\d+$/i.test(previous)) return `{${uniqueParamName('id', used)}}`;
    return `{${paramName(previous, used)}}`;
  });
  return `/${templated.join('/')}`;
}

function matchAgainstControllers(pathname: string, method?: string): { matched: string } | { skip: true } | { none: true } {
  try {
    // Lazy require avoids circular init with dto-fields → path.util
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dto = require('./fields/dto-fields') as {
      matchControllerTemplate: (pathname: string, method?: string) => string | null;
      controllerRouteCount: () => number;
    };
    const matched = dto.matchControllerTemplate(pathname, method);
    if (matched) return { matched };
    if (dto.controllerRouteCount() > 0) return { skip: true };
  } catch {
    // controllers unavailable
  }
  return { none: true };
}

/**
 * Map a concrete (or already-templated) path onto an OpenAPI template.
 * Returns null when the hit should not be recorded (unknown vs Nest controllers).
 */
export function templatize(pathname: string, test?: string, method?: string): string | null {
  const trimmed = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (trimmed === '/') return null;

  const custom = getConfig().templatize?.(trimmed, test);
  if (custom) return custom;
  if (custom === null) return null;

  const declared = templateFromTestName(test);
  if (declared && pathMatchesTemplate(declared, trimmed)) return declared;

  const controller = matchAgainstControllers(trimmed, method);
  if ('matched' in controller) return controller.matched;
  if ('skip' in controller) return null;

  return heuristicTemplatize(trimmed);
}

export function pathParamNames(pathTemplate: string): string[] {
  return [...pathTemplate.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

export function extractPathParams(pathTemplate: string, actualPath: string): Record<string, string> {
  const actual = (actualPath.split('?')[0] || '').replace(/\/+$/, '') || '/';
  const templateParts = pathTemplate.split('/');
  const actualParts = actual.split('/');
  const params: Record<string, string> = {};

  for (let index = 0; index < templateParts.length; index += 1) {
    const match = templateParts[index].match(/^\{(.+)\}$/);
    if (match && actualParts[index]) params[match[1]] = decodeURIComponent(actualParts[index]);
  }

  return params;
}

/** Fill `{param}` slots so a stored template can be re-matched / re-heuristic'd. */
export function materializePath(pathTemplate: string, pathParams?: Record<string, string>): string {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = pathParams?.[name];
    return value != null && value !== '' ? encodeURIComponent(value) : name;
  });
}
