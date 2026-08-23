import { resourceLabel } from './test-title';

export type CaseSection = 'positive' | 'semantic' | 'invalid' | 'omitted' | 'auth';

const CASE_START = /^(returns|creates|updates|upserts|inserts|merges|replaces|deletes|lists|rejects|conflicts)\b/i;

const GENERIC_IT = new Set([
  'returns resource list when query is valid',
  'returns resource when payload is valid',
  'returns resource when request is valid',
  'rejects when resource already exists',
  'rejects when payload is invalid',
  'rejects when a required field is omitted',
  'rejects when unauthorized',
  'returns error when resource already exists',
  'returns error when payload is invalid',
  'returns error when a required field is omitted',
  'returns error when unauthorized',
]);

export function parseCaseSection(raw?: string): CaseSection | undefined {
  if (!raw) return undefined;
  if (/SEMANTIC ERROR CASES\s*-\s*AUTH/i.test(raw)) return 'auth';
  if (/POSITIVE CASES/i.test(raw)) return 'positive';
  if (/SEMANTIC ERROR CASES/i.test(raw)) return 'semantic';
  if (/INVALID CASES/i.test(raw)) return 'invalid';
  if (/OMITTED/i.test(raw)) return 'omitted';
  return undefined;
}

export function isDynamicItName(name?: string): boolean {
  return Boolean(name && /\$\{/.test(name));
}

export function isGenericItName(name?: string): boolean {
  const value = name?.trim().toLowerCase() ?? '';
  if (GENERIC_IT.has(value)) return true;
  if (/^rejects when (resource|payload) (already exists|is invalid)$/i.test(value)) return true;
  if (/^returns error when (resource|payload) (already exists|is invalid)$/i.test(value)) return true;
  if (/^returns [\w\s]+ list when query is valid$/i.test(value)) return true;
  if (/^returns resource\b/i.test(value)) return true;
  return false;
}

export function isValidItCase(name?: string): boolean {
  const value = name?.trim() ?? '';
  if (value.length < 12 || value.length > 120) return false;
  if (value.startsWith('/')) return false;
  if (/\[(GET|POST|PUT|PATCH|DELETE|UPDATE|UPSERT|INSERT|MERGE|REPLACE)\]/i.test(value)) return false;
  if (/(POSITIVE CASES|SEMANTIC ERROR CASES|INVALID CASES|OMITTED)/i.test(value)) return false;
  if (!CASE_START.test(value)) return false;
  if (!/\bwhen\b/i.test(value)) return false;
  return true;
}

function stemVerb(raw: string): string {
  const v = raw.toLowerCase().replace(/s$/, '');
  if (v === 'create') return 'creates';
  if (v === 'update') return 'updates';
  if (v === 'delete') return 'deletes';
  if (v === 'insert') return 'inserts';
  if (v === 'upsert') return 'upserts';
  if (v === 'merge') return 'merges';
  if (v === 'replace') return 'replaces';
  if (v === 'return') return 'returns';
  if (v === 'list') return 'lists';
  if (v === 'reject') return 'rejects';
  return `${v}s`;
}

function outcomeVerb(section: CaseSection | undefined, method?: string): string {
  if (section === 'auth' || section === 'invalid' || section === 'omitted' || section === 'semantic') {
    return 'returns error';
  }
  const m = (method || 'get').toLowerCase();
  if (m === 'post') return 'creates';
  if (m === 'upsert') return 'upserts';
  if (m === 'insert') return 'inserts';
  if (m === 'merge') return 'merges';
  if (m === 'replace') return 'replaces';
  if (m === 'delete') return 'deletes';
  if (m === 'put' || m === 'patch' || m === 'update') return 'updates';
  return 'returns';
}

function fitItName(value: string): string | undefined {
  let next = value.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  if (next.length > 120) {
    next = next.slice(0, 117).replace(/\s+\S*$/, '').trim();
  }
  if (!isValidItCase(next) || isGenericItName(next)) return undefined;
  return next;
}

/**
 * Keep the unique clause from `should …` / existing it() text.
 * Never collapse many cases into one generic sentence.
 */
export function rewriteItFromOriginal(
  raw: string,
  section?: CaseSection,
  method?: string,
  pathTemplate?: string,
): string | undefined {
  if (isDynamicItName(raw)) return undefined;
  let s = raw.trim().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '');
  if (!s) return undefined;
  s = s.replace(/^should\s+/i, '');

  const res = pathTemplate ? resourceLabel(pathTemplate).toLowerCase() : 'resource';
  const outcome = outcomeVerb(section, method);

  s = s
    .replace(/^rejects\s+/i, 'returns error ')
    .replace(/^returns?\s+unauthorized\s+/i, 'returns error ')
    .replace(/^returns?\s+conflict\s+/i, 'returns error ')
    .replace(/^returns?\s+error\s+/i, 'returns error ')
    .replace(/^returns?\s+bad request\s+/i, 'returns error ')
    .replace(/^returns?\s+not found\s+/i, 'returns error ');

  if (/^not\s+/i.test(s)) {
    const beforeWhen = s.replace(/^not\s+/i, '').split(/\bwhen\b/i)[0].trim();
    return fitItName(`${outcome} ${res} when not ${beforeWhen}`);
  }

  const withMatch = s.match(/^(create|update|delete|insert|upsert|merge|replace)s?\s+(.+?)\s+with\s+(.+)$/i);
  if (withMatch) {
    return fitItName(`${stemVerb(withMatch[1])} ${withMatch[2]} when ${withMatch[3]}`);
  }

  if (!/\bwhen\b/i.test(s)) {
    s = s.replace(/\bwith\b/i, 'when');
  }

  if (CASE_START.test(s) && /\bwhen\b/i.test(s)) return fitItName(s);

  const led = s.match(/^(create|update|delete|insert|upsert|merge|replace|return)s?\s+(.+)$/i);
  if (led) {
    const rest = led[2];
    if (/\bwhen\b/i.test(rest)) return fitItName(`${stemVerb(led[1])} ${rest}`);
    return fitItName(`${stemVerb(led[1])} ${rest.replace(/\bwith\b/i, 'when')}`);
  }

  if (/\bwhen\b/i.test(s)) {
    if (/^when\s+/i.test(s)) return fitItName(`${outcome} ${s}`);
    return fitItName(`${outcome} when ${s}`);
  }

  return fitItName(`${outcome} when ${s}`);
}

const OUTCOME_PREFIX =
  /^(returns|creates|updates|upserts|inserts|merges|replaces|deletes|lists|rejects|conflicts)\s+/i;

/**
 * Docs / Postman example line: the unique condition only.
 * Test keeps `creates mock tbs when cyprus payload shape` → docs `cyprus payload shape`.
 */
export function docsScenarioClause(raw?: string): string {
  if (!raw) return 'example';
  let s = raw.trim().replace(/\s+/g, ' ');
  const field = s.match(/^([A-Za-z0-9_.]+)\s+-\s+(should not be\s+.+)$/i);
  if (field) return `${field[1]} ${field[2]}`.trim();
  const when = s.match(/\bwhen\s+(.+)$/i);
  if (when?.[1]) return when[1].trim();
  s = s.replace(OUTCOME_PREFIX, '').replace(/^resource\s+/i, '').trim();
  return s || 'example';
}

export type ItSuggestion = {
  names: string[];
  /** Safe for --yes / `a` — rewritten from this case's own text. */
  auto: boolean;
};

/**
 * Prefer a unique rewrite of the current it() name.
 * Generic section templates are never auto-applied.
 */
export function suggestItCases(
  section: CaseSection | undefined,
  method?: string,
  pathTemplate?: string,
  original?: string,
): string[] {
  return suggestItCaseResult(section, method, pathTemplate, original).names;
}

export function suggestItCaseResult(
  section: CaseSection | undefined,
  method?: string,
  pathTemplate?: string,
  original?: string,
): ItSuggestion {
  if (original && isDynamicItName(original)) return { names: [], auto: false };

  const fromOriginal = original ? rewriteItFromOriginal(original, section, method, pathTemplate) : undefined;
  if (fromOriginal) return { names: [fromOriginal], auto: true };

  return { names: [], auto: false };
}
