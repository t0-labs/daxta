import { getConfig, type TreeLayout } from '../config';

export type { TreeLayout };

export type FieldDoc = {
  name: string;
  in: 'path' | 'query' | 'header' | 'body';
  type: string;
  required?: boolean;
};

export type OperationDoc = {
  title: string;
  fields: FieldDoc[];
};

export const STATUS_TEXT: Record<string, string> = {
  '200': 'OK',
  '201': 'Created',
  '204': 'No Content',
  '400': 'Bad Request',
  '401': 'Unauthorized',
  '403': 'Forbidden',
  '404': 'Not Found',
  '409': 'Conflict',
  '422': 'Unprocessable Entity',
  '500': 'Internal Server Error',
};

const METHOD_ALIASES: Record<string, string[]> = {
  update: ['patch', 'put'],
  upsert: ['put', 'post', 'patch'],
};

export function declaredMethods(test?: string): string[] | null {
  if (!test) return null;
  const declared = test.match(/\[(GET|POST|PUT|PATCH|DELETE|UPDATE|UPSERT)\]/i);
  if (!declared) return null;
  const method = declared[1].toLowerCase();
  return METHOD_ALIASES[method] ?? [method];
}

export function pathSegments(pathTemplate: string): string[] {
  return pathTemplate.split('/').filter((part) => part && !part.startsWith('{'));
}

export function treePathSegments(pathTemplate: string): string[] {
  const config = getConfig();
  const custom = config.treePathSegments?.(pathTemplate);
  if (custom) return custom;

  const exact = config.treePathOverrides[pathTemplate];
  if (exact?.length) return exact;

  const parts = pathTemplate.split('/').filter(Boolean);
  if (parts.length >= 3 && /^v\d+$/i.test(parts[0]) && config.treeLayout === 'resource-first') {
    return [parts[0], parts[2], parts[1], ...parts.slice(3)];
  }
  return parts;
}

export function viewerTreeConfig() {
  const config = getConfig();
  return {
    workspace: config.workspace,
    baseUrl: config.baseUrl,
    docsPath: config.docsPath,
    treeLayout: config.treeLayout,
    treePathOverrides: config.treePathOverrides,
  };
}

function titleCase(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function operationTag(pathTemplate: string, method: string): string {
  const custom = getConfig().operationTag?.(pathTemplate, method);
  if (custom) return custom;

  const parts = pathSegments(pathTemplate).filter((part) => !/^v\d+$/i.test(part));
  if (!parts.length) return 'API';
  if (parts.length === 1) return titleCase(parts[0]);
  return `${titleCase(parts[0])} / ${titleCase(parts[1])}`;
}

export function defaultTitle(method: string, pathTemplate: string): string {
  const custom = getConfig().operationTitle?.(method, pathTemplate);
  if (custom) return custom;
  return pathTemplate;
}

export function caseGroup(test?: string): string {
  if (!test) return 'Other';
  if (/SEMANTIC ERROR CASES\s*-\s*AUTH/i.test(test)) return 'Auth';
  if (/POSITIVE CASES/i.test(test)) return 'Success';
  if (/SEMANTIC ERROR CASES/i.test(test)) return 'Business errors';
  if (/INVALID CASES/i.test(test)) return 'Invalid input';
  if (/OMITTED/i.test(test)) return 'Missing fields';
  return 'Other';
}

export function caseName(test?: string): string {
  if (!test) return 'example';
  return (
    test
      .replace(/^.*?\[(?:GET|POST|PUT|PATCH|DELETE|UPDATE|UPSERT)\]\s*(?:\(integration\))?\s*/i, '')
      .replace(/^(POSITIVE CASES|SEMANTIC ERROR CASES(?:\s*-\s*AUTH)?|INVALID CASES|OMITTED(?: FIELD)? CASES)\s+/i, '')
      .trim() || test
  );
}
