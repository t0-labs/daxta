import { getConfig } from './config';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_RE = /^\d{5,}$/;
const TOKENISH_RE = /^[A-Za-z0-9_-]{16,}$/;

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

function isDynamicSegment(segment: string, previous?: string): boolean {
  if (UUID_RE.test(segment)) return true;
  if (NUMERIC_ID_RE.test(segment)) return true;
  if (TOKENISH_RE.test(segment) && previous && !/^v\d+$/i.test(previous)) return true;
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

function heuristicTemplatize(pathname: string): string {
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

export function templatize(pathname: string, test?: string): string | null {
  const trimmed = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (trimmed === '/') return null;

  const custom = getConfig().templatize?.(trimmed, test);
  if (custom) return custom;

  const declared = templateFromTestName(test);
  if (declared && pathMatchesTemplate(declared, trimmed)) return declared;

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
