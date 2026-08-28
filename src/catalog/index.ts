import { getConfig, normalizeTreeLayout, type TreeLayout } from '../config';
import { parseOperationLabel, HTTP_VERBS } from './test-title';
import { docsScenarioClause } from './it-case';

export { parseOperationLabel, suggestOperationTitles, suggestOperationTitleResult, formatTestTitle } from './test-title';
export { isValidItCase, suggestItCases, docsScenarioClause, parseCaseSection, type CaseSection } from './it-case';
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
  insert: ['post'],
  merge: ['post', 'put', 'patch'],
  replace: ['put'],
};

const CASE_SECTION_RE =
  /^((?:FALSE\s+)?POSITIVE CASES|SEMANTIC ERROR CASES(?:\s*-\s*AUTH)?|INVALID CASES|OMITTED(?: FIELD)? CASES)\s+/i;

export function declaredMethods(test?: string): string[] | null {
  if (!test) return null;
  const fromLabel = parseOperationLabel(test);
  if (fromLabel?.method) {
    const method = fromLabel.method.toLowerCase();
    return METHOD_ALIASES[method] ?? [method];
  }
  const declared = test.match(new RegExp(`\\[(${HTTP_VERBS})\\]`, 'i'));
  if (!declared) return null;
  const method = declared[1].toLowerCase();
  return METHOD_ALIASES[method] ?? [method];
}

export function pathSegments(pathTemplate: string): string[] {
  return pathTemplate.split('/').filter((part) => part && !part.startsWith('{') && !part.startsWith(':'));
}

function applyLayout(parts: string[], layout: TreeLayout): string[] {
  if (parts.length >= 3 && /^v\d+$/i.test(parts[0]) && layout === 'resource-role') {
    return [parts[0], parts[2], parts[1], ...parts.slice(3)];
  }
  return parts;
}

function applyFold(parts: string[], skipParams: boolean): string[] {
  if (!skipParams) return parts;
  const paramIdx = parts.findIndex((part) => part.startsWith('{'));
  if (paramIdx < 0) return parts;
  return parts.slice(0, paramIdx);
}

/**
 * Sidebar / export-tag folder segments for a path.
 * Honors treeLayout, treeSkipParams, and per-path overrides.
 */
export function treePathSegments(pathTemplate: string): string[] {
  const config = getConfig();
  const custom = config.treePathSegments?.(pathTemplate);
  if (custom) return custom;

  const exact = config.treePathOverrides[pathTemplate];
  if (exact?.length) return exact;

  const layout = normalizeTreeLayout(config.treeLayout);
  const parts = applyLayout(pathTemplate.split('/').filter(Boolean), layout);
  return applyFold(parts, config.treeSkipParams !== false);
}

export function viewerTreeConfig() {
  const config = getConfig();
  return {
    workspace: config.workspace,
    baseUrl: config.baseUrl,
    docsPath: config.docsPath,
    treeLayout: normalizeTreeLayout(config.treeLayout),
    treeSkipParams: config.treeSkipParams !== false,
    treeCollapseSingle: config.treeCollapseSingle !== false,
    treePathOverrides: config.treePathOverrides,
    exampleLabelStyle: config.exampleLabelStyle ?? 'status-title-case',
    envPresets: config.envPresets,
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

  const parts = treePathSegments(pathTemplate).filter((part) => !part.startsWith('{') && !/^v\d+$/i.test(part));
  if (!parts.length) return 'API';
  if (parts.length === 1) return titleCase(parts[0]);
  return `${titleCase(parts[0])} / ${titleCase(parts[1])}`;
}

export function defaultTitle(method: string, pathTemplate: string): string {
  const custom = getConfig().operationTitle?.(method, pathTemplate);
  if (custom) return custom;
  return pathTemplate;
}

export const CASE_GROUP_ORDER: string[] = [
  'POSITIVE CASES',
  'SEMANTIC ERROR CASES',
  'INVALID CASES',
  'OMITTED CASES',
  'SEMANTIC ERROR CASES - AUTH',
  'Other',
];

export function caseGroup(test?: string): string {
  if (!test) return 'Other';
  if (/SEMANTIC ERROR CASES\s*-\s*AUTH/i.test(test)) return 'SEMANTIC ERROR CASES - AUTH';
  // "FALSE POSITIVE CASES" is the same bucket the viewer renders as "False positive cases".
  if (/FALSE\s+POSITIVE CASES/i.test(test)) return 'SEMANTIC ERROR CASES';
  if (/POSITIVE CASES/i.test(test)) return 'POSITIVE CASES';
  if (/SEMANTIC ERROR CASES/i.test(test)) return 'SEMANTIC ERROR CASES';
  if (/INVALID CASES/i.test(test)) return 'INVALID CASES';
  if (/OMITTED/i.test(test)) return 'OMITTED CASES';
  return 'Other';
}

export function caseSectionLabel(test?: string): string {
  if (!test) return '';
  const match = test.match(
    /((?:FALSE\s+)?POSITIVE CASES|SEMANTIC ERROR CASES(?:\s*-\s*AUTH)?|INVALID CASES|OMITTED(?: FIELD)? CASES)/i,
  );
  return match?.[1]?.toUpperCase() ?? '';
}

/**
 * Human-readable API title from Jest test name, e.g.
 * "Admin Find One Basket By Id API".
 */
export function apiTitle(test?: string): string | undefined {
  if (!test) return undefined;

  const fromLabel = parseOperationLabel(test)?.title;
  if (fromLabel) return fromLabel;

  const patterns = [
    /^(.+?\bAPI)\s*[-–—]\s*(?:GET|POST|PUT|PATCH|DELETE|UPDATE|UPSERT|INSERT|MERGE|REPLACE)\b/i,
    /\]\s*(?:\([^)]*\)\s*)?(.+?\bAPI)\s+(?:POSITIVE|SEMANTIC|INVALID|OMITTED)\b/i,
    /^(.+?\bAPI)\s+\/\S+\s+\[(?:GET|POST|PUT|PATCH|DELETE)/i,
    new RegExp(`\\[(?:${HTTP_VERBS})\\]\\s*(?:\\([^)]*\\)\\s*)?(.+?\\bAPI)\\b`, 'i'),
  ];
  for (const re of patterns) {
    const match = test.match(re);
    const title = match?.[1]?.trim();
    if (title && title.length < 120) return title;
  }
  return undefined;
}

/**
 * Drop a describe-level qualifier that only precedes the case section, e.g.
 * "(solution partner) INVALID CASES field - should not be empty". The section itself
 * is already shown as the example's group, so both are redundant in the label.
 */
function stripSectionPrefix(value: string): string {
  let rest = value.replace(CASE_SECTION_RE, '').trim();
  const qualifier = rest.match(/^\(([^)]*)\)\s*/);
  if (qualifier && CASE_SECTION_RE.test(rest.slice(qualifier[0].length))) {
    rest = rest.slice(qualifier[0].length).replace(CASE_SECTION_RE, '').trim();
  }
  return rest;
}

export function caseName(test?: string): string {
  if (!test) return 'example';
  let rest = test
    .replace(new RegExp(`^.+?\\s+[—–-]\\s+(?:${HTTP_VERBS})\\s+\\S+\\s*`, 'i'), '')
    .replace(new RegExp(`^.*?\\[(?:${HTTP_VERBS})\\]\\s*(?:\\(integration\\))?\\s*`, 'i'), '');
  rest = stripSectionPrefix(rest.trim());

  // "Admin Find One Basket By Id API - GET /path POSITIVE CASES returns…"
  rest = stripSectionPrefix(rest.replace(/^.+?\bAPI\s*[-–—]\s*(?:GET|POST|PUT|PATCH|DELETE)\s+\S+\s+/i, ''));

  // Drop leading human title if still present before the case text
  const title = apiTitle(test);
  if (title && rest.startsWith(title)) {
    rest = stripSectionPrefix(rest.slice(title.length).replace(/^[-–—\s]+/, ''));
  }

  return rest || test;
}

export type ExampleLabelHit = {
  status: number;
  method: string;
  path: string;
  test?: string;
};

/** OpenAPI example summary / scenario display name. */
export function exampleLabel(hit: ExampleLabelHit): string {
  const style = getConfig().exampleLabelStyle ?? 'status-title-case';
  const cas = docsScenarioClause(caseName(hit.test));
  const title = apiTitle(hit.test);
  const method = (hit.method || 'get').toUpperCase();
  const section = caseSectionLabel(hit.test);

  if (style === 'full') {
    const head = title ? `${title} - ${method} ${hit.path}` : `${method} ${hit.path}`;
    const tail = [section, cas].filter(Boolean).join(' ');
    return `${hit.status} — ${head}${tail ? ` ${tail}` : ''}`;
  }

  if (style === 'status-title-case' && title) {
    return `${hit.status} — ${title} — ${cas}`;
  }

  return `${hit.status} — ${cas}`;
}

/** Prefer human API title from hits; else path. */
export function operationSummary(method: string, pathTemplate: string, tests: Array<string | undefined>): string {
  const custom = getConfig().operationTitle?.(method, pathTemplate);
  if (custom) return custom;
  for (const test of tests) {
    const title = apiTitle(test);
    if (title) return title;
  }
  return defaultTitle(method, pathTemplate);
}
