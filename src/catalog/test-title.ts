/** Verbs that appear in TEST_TITLE `[METHOD]` / `— METHOD path`. */
export const HTTP_VERBS = 'GET|POST|PUT|PATCH|DELETE|UPDATE|UPSERT|INSERT|MERGE|REPLACE';
const METHODS = HTTP_VERBS;

const PATH_ONLY_BRACKET_RE = new RegExp(
  `^(?<path>\\/\\S+)\\s+\\[(?<method>${METHODS})\\](?:\\s+\\(integration\\))?\\s*$`,
  'i',
);
const TITLE_BRACKET_RE = new RegExp(
  `^(?<title>.+?)\\s+(?<path>\\/\\S+)\\s+\\[(?<method>${METHODS})\\](?:\\s+\\(integration\\))?\\s*$`,
  'i',
);
/** `Create Mock Tbs — POST /v1/admin/mock-tbs` */
const TITLE_DASH_RE = new RegExp(
  `^(?<title>.+?)\\s+[—–-]\\s+(?<method>${METHODS})\\s+(?<path>\\/\\S+)(?:\\s+\\(integration\\))?\\s*$`,
  'i',
);
const PATH_ONLY_DASH_RE = new RegExp(
  `^(?<method>${METHODS})\\s+(?<path>\\/\\S+)(?:\\s+\\(integration\\))?\\s*$`,
  'i',
);

const ROLE_WORDS = new Set([
  'admin',
  'user',
  'users',
  'me',
  'public',
  'internal',
  'internal-application',
  'internal-service',
  'integrator',
  'partner',
  'device',
  'staff',
  'customer',
  'vendor',
  'merchant',
  'operator',
  'system',
  'superadmin',
]);

const MODULE_WORDS = new Set(['validator', 'validation', 'validators', 'business-data']);

const ACTION_WORDS = new Set([
  'validate',
  'approve',
  'reject',
  'sync',
  'search',
  'export',
  'import',
  'login',
  'logout',
  'preview',
  'lock',
  'unlock',
  'publish',
  'archive',
  'restore',
  'verify',
  'confirm',
  'complete',
  'activate',
  'deactivate',
  'check',
  'calculate',
  'retry',
  'send',
  'insert',
  'merge',
  'upsert',
  'onboard',
  'assign',
]);

const NOTIFY_WORDS = new Set(['sms', 'email', 'phone', 'push']);

export type ParsedOperationLabel = {
  title?: string;
  path: string;
  method: string;
  integration: boolean;
};

export function isPathParam(part: string): boolean {
  const value = part.trim();
  if (!value) return false;
  if (value.startsWith('{') || value.startsWith(':') || value.startsWith('${')) return true;
  if (/\$\{[^}]+\}/.test(value)) return true;
  return false;
}

function paramName(part: string): string {
  return part
    .trim()
    .replace(/^\$\{/, '')
    .replace(/^[:{]+/, '')
    .replace(/[}]+$/, '')
    .replace(/^\$/, '');
}

export function titleCaseToken(value: string): string {
  return value
    .replace(/^[:]/, '')
    .replace(/[{}]/g, '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function isHumanOperationTitle(title: string | undefined): boolean {
  const value = title?.trim() ?? '';
  if (value.length < 2 || value.length > 80) return false;
  if (value.startsWith('/') || value.startsWith(':')) return false;
  if (/[{}]/.test(value) || /:[a-zA-Z]/.test(value)) return false;
  if (!/[a-zA-Z]/.test(value)) return false;
  return true;
}

function stripCaseTail(raw: string): string {
  return raw
    .replace(
      /\s+(POSITIVE CASES|SEMANTIC ERROR CASES(?:\s*-\s*AUTH)?|INVALID CASES|OMITTED(?: FIELD)? CASES)\b[\s\S]*$/i,
      '',
    )
    .trim();
}

/**
 * Pull path / method / optional human title from a TEST_TITLE or Jest name.
 */
export function parseOperationLabel(raw?: string): ParsedOperationLabel | undefined {
  if (!raw) return undefined;
  const cut = stripCaseTail(raw);
  const integration = /\(integration\)/i.test(cut);

  const fromGroups = (match: RegExpMatchArray | null): ParsedOperationLabel | undefined => {
    const path = match?.groups?.path;
    const method = match?.groups?.method;
    if (!path || !method) return undefined;
    const title = match.groups?.title?.trim();
    return {
      title: isHumanOperationTitle(title) ? title : undefined,
      path,
      method: method.toUpperCase(),
      integration,
    };
  };

  return (
    fromGroups(cut.match(TITLE_DASH_RE)) ||
    fromGroups(cut.match(PATH_ONLY_DASH_RE)) ||
    fromGroups(cut.match(PATH_ONLY_BRACKET_RE)) ||
    fromGroups(cut.match(TITLE_BRACKET_RE))
  );
}

/** Readable TEST_TITLE: `Create Mock Tbs — POST /v1/admin/mock-tbs` */
export function formatTestTitle(title: string, pathTemplate: string, method: string): string {
  const clean = title.trim().replace(/\s+/g, ' ');
  return `${clean} — ${method.toUpperCase()} ${pathTemplate}`;
}

function namedSegments(pathTemplate: string): string[] {
  return pathTemplate.split('/').filter((part) => part && !isPathParam(part) && !/^v\d+$/i.test(part));
}

function operationSegments(pathTemplate: string): string[] {
  return namedSegments(pathTemplate).filter(
    (part) => !ROLE_WORDS.has(part.toLowerCase()) && !MODULE_WORDS.has(part.toLowerCase()),
  );
}

export function resourceLabel(pathTemplate: string): string {
  const rest = operationSegments(pathTemplate);
  const last = rest[rest.length - 1] || namedSegments(pathTemplate)[namedSegments(pathTemplate).length - 1] || 'resource';
  const prev = rest[rest.length - 2];
  if ((ACTION_WORDS.has(last.toLowerCase()) || last.toLowerCase() === 'bulk') && prev) return titleCaseToken(prev);
  return titleCaseToken(last);
}

function lastSegment(pathTemplate: string): string {
  const rest = operationSegments(pathTemplate);
  return (rest[rest.length - 1] || '').toLowerCase();
}

function singularSimple(raw: string): string {
  const value = raw.toLowerCase();
  if (value.length <= 3) return value;
  if (value.endsWith('ies') && value.length > 4) return value.slice(0, -3) + 'y';
  if (value.endsWith('ches') || value.endsWith('shes') || value.endsWith('sses')) return value.slice(0, -2);
  if (value.endsWith('ses') && value.length > 4) return value.slice(0, -2);
  if (value.endsWith('s') && !value.endsWith('ss')) return value.slice(0, -1);
  return value;
}

function singularStem(token: string): string {
  if (token.includes('-')) {
    const bits = token.split('-');
    bits[bits.length - 1] = singularSimple(bits[bits.length - 1]);
    return bits.join('-');
  }
  return singularSimple(token);
}

/** `{id}` after `merchants` (parent) → Merchant Id; trailing `:id` → Id */
function byClauseFromParam(param: string, precedingNamed: string | undefined, role: 'end' | 'parent'): string {
  const name = paramName(param);
  if (!name) return 'By Id';
  if (/^id$/i.test(name)) {
    if (role === 'parent' && precedingNamed) {
      return `By ${titleCaseToken(singularStem(precedingNamed))} Id`;
    }
    return 'By Id';
  }
  if (/Id$/i.test(name)) return `By ${titleCaseToken(name.replace(/Id$/i, ''))} Id`;
  return `By ${titleCaseToken(name)}`;
}

function pathTokens(pathTemplate: string): string[] {
  return pathTemplate.split('/').filter(Boolean);
}

function trailingParam(pathTemplate: string): string | undefined {
  const tokens = pathTokens(pathTemplate);
  const last = tokens[tokens.length - 1];
  return last && isPathParam(last) ? last : undefined;
}

function parentParam(pathTemplate: string): { param: string; named: string } | undefined {
  const tokens = pathTokens(pathTemplate);
  for (let i = tokens.length - 1; i >= 1; i -= 1) {
    if (!isPathParam(tokens[i])) continue;
    if (i === tokens.length - 1) continue;
    let named = '';
    for (let j = i - 1; j >= 0; j -= 1) {
      if (!isPathParam(tokens[j]) && !/^v\d+$/i.test(tokens[j]) && !ROLE_WORDS.has(tokens[j].toLowerCase())) {
        named = tokens[j];
        break;
      }
    }
    return { param: tokens[i], named };
  }
  return undefined;
}

function collectionAll(rest: string[], leafAll: string): string {
  const last = rest[rest.length - 1];
  const prev = rest[rest.length - 2];
  if (prev && /^(items?|entries)$/i.test(last || '')) {
    return `${titleCaseToken(prev)} ${titleCaseToken(last)}`;
  }
  return leafAll;
}

function collectionOne(rest: string[], leafOne: string): string {
  const last = rest[rest.length - 1];
  const prev = rest[rest.length - 2];
  if (prev && /^(items?|entries)$/i.test(last || '')) {
    return `${titleCaseToken(prev)} ${titleCaseToken(singularStem(last))}`;
  }
  return leafOne;
}

export type TitleSuggestion = {
  titles: string[];
  /** Safe to apply with --yes / `a`. False → user must type a custom name. */
  auto: boolean;
};

/**
 * POST /v1/admin/mock-tbs → Create Mock Tbs
 * GET /v1/me/branches → Find All Branches
 * GET /v1/integrator/merchants/{id}/branches → Find All Branches By Merchant Id
 * GET /v1/admin/addresses/:id → Find One Address By Id
 * POST /v1/me/branches/:id/addresses/billing → Create Billing Address
 * POST /v1/public/external-checkout/:id/complete → Complete External Checkout
 */
export function suggestOperationTitleResult(method: string, pathTemplate: string): TitleSuggestion {
  const rest = operationSegments(pathTemplate);
  const last = lastSegment(pathTemplate);
  const prev = rest.length >= 2 ? rest[rest.length - 2] : undefined;
  const leafAll = collectionAll(rest, last ? titleCaseToken(last) : resourceLabel(pathTemplate));
  const leafOne = collectionOne(rest, last ? titleCaseToken(singularStem(last)) : leafAll);
  const m = method.toLowerCase();
  const endParam = trailingParam(pathTemplate);
  const nested = parentParam(pathTemplate);
  const out: string[] = [];
  const add = (value: string) => {
    const next = value.replace(/\s+/g, ' ').trim();
    if (next && !out.includes(next) && isHumanOperationTitle(next)) out.push(next);
  };

  if (last === 'bulk') {
    const resource = resourceLabel(pathTemplate);
    add(m === 'get' ? `Find Bulk ${resource}` : `Create Bulk ${resource}`);
    return { titles: out.slice(0, 3), auto: out.length > 0 };
  }

  if (last.startsWith('by-')) {
    const target = prev ? titleCaseToken(prev) : resourceLabel(pathTemplate);
    const by = titleCaseToken(last);
    if (m === 'get') {
      add(`Find All ${target} ${by}`);
      add(`Find ${target} ${by}`);
    } else if (m === 'post') add(`Create ${target} ${by}`);
    else add(`${titleCaseToken(m)} ${target} ${by}`);
    return { titles: out.slice(0, 3), auto: out.length > 0 };
  }

  if (NOTIFY_WORDS.has(last) && (prev === 'send' || prev === 'validations' || ACTION_WORDS.has(prev || ''))) {
    if (prev === 'send' || last !== 'phone') add(`Send ${titleCaseToken(last)}`);
    if (prev === 'validations' || prev === 'validate') add(`Validate ${titleCaseToken(last)}`);
    if (out.length) return { titles: out.slice(0, 3), auto: true };
  }

  if (NOTIFY_WORDS.has(last) && m === 'post') {
    add(`Send ${titleCaseToken(last)}`);
    return { titles: out.slice(0, 3), auto: out.length > 0 };
  }

  if (last.endsWith('-retries') || last === 'retries') {
    const subject = prev ? titleCaseToken(prev) : titleCaseToken(last.replace(/-?retries$/, '') || 'operation');
    add(`Retry ${subject}`);
    add('Retry Operation');
    return { titles: out.slice(0, 3), auto: out.length > 0 };
  }

  if (ACTION_WORDS.has(last)) {
    const resource = prev ? titleCaseToken(prev) : resourceLabel(pathTemplate);
    add(`${titleCaseToken(last)} ${resource}`);
    return { titles: out.slice(0, 3), auto: out.length > 0 };
  }

  if (prev && /^(addresses?|items?)$/i.test(prev) && !ACTION_WORDS.has(last) && !endParam) {
    const kind = titleCaseToken(last);
    const noun = titleCaseToken(singularStem(prev));
    if (m === 'post') add(`Create ${kind} ${noun}`);
    else if (m === 'get') add(`Find ${kind} ${noun}`);
    else add(`${titleCaseToken(m)} ${kind} ${noun}`);
    if (out.length) return { titles: out.slice(0, 3), auto: true };
  }

  const byEnd = endParam ? byClauseFromParam(endParam, last, 'end') : undefined;
  const byParent = nested ? byClauseFromParam(nested.param, nested.named, 'parent') : undefined;

  if (m === 'get' && endParam) add(`Find One ${leafOne} ${byEnd}`);
  else if (m === 'get' && byParent) {
    add(`Find All ${leafAll} ${byParent}`);
    add(`Find All ${leafAll}`);
  } else if (m === 'get') add(`Find All ${leafAll}`);
  else if (m === 'post') add(`Create ${leafOne}`);
  else if (m === 'upsert') add(`Upsert ${leafAll}`);
  else if (m === 'insert') add(`Insert ${leafOne}`);
  else if (m === 'merge') add(`Merge ${leafAll}`);
  else if (m === 'replace') add(`Replace ${leafOne}`);
  else if (m === 'delete' && endParam) add(`Delete One ${leafOne} ${byEnd}`);
  else if (m === 'delete') add(`Delete ${leafAll}`);
  else if ((m === 'put' || m === 'patch' || m === 'update') && endParam) add(`Update ${leafOne} ${byEnd}`);
  else if (m === 'put' || m === 'patch' || m === 'update') add(`Update ${leafAll}`);
  else add(`${titleCaseToken(m)} ${leafAll}`);

  return { titles: out.slice(0, 3), auto: out.length > 0 };
}

export function suggestOperationTitles(method: string, pathTemplate: string): string[] {
  return suggestOperationTitleResult(method, pathTemplate).titles;
}
