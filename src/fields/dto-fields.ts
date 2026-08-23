/**
 * Resolve Required / Optional from Nest controllers + class-validator DTO metadata.
 * Controllers are parsed via TypeScript AST (not executed). DTO classes are loaded
 * only to read reflect-metadata / class-validator / class-transformer.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';

import 'reflect-metadata';

import { defaultMetadataStorage } from 'class-transformer/cjs/storage';
import { getMetadataStorage } from 'class-validator';
import * as ts from 'typescript';

import { getConfig } from '../config';
import { pathMatchesTemplate } from '../path.util';

type ValidationMeta = {
  propertyName: string;
  type: string;
  name?: string;
};

export type FieldLocation = 'path' | 'query' | 'header' | 'body';

type DtoCtor = new (...args: unknown[]) => object;

type RouteBinding = {
  method: string;
  pathTemplate: string;
  body?: DtoCtor;
  query?: DtoCtor;
  param?: DtoCtor;
};

type RequiredMap = Map<string, boolean>; // field path → required

function controllerRoot() {
  return getConfig().controllersRoot;
}
const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All']);
const PARAM_DECORATORS: Record<string, 'body' | 'query' | 'param'> = {
  Body: 'body',
  Query: 'query',
  Param: 'param',
};

let routeCache: RouteBinding[] | null = null;
const requiredCache = new Map<string, RequiredMap>();

function walkFiles(dir: string, suffix: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walkFiles(full, suffix, out);
    else if (name.endsWith(suffix)) out.push(full);
  }
  return out;
}

function decoratorName(node: ts.Decorator): string | undefined {
  const expr = node.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return expr.expression.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return undefined;
}

function decoratorArgs(node: ts.Decorator): ts.NodeArray<ts.Expression> | undefined {
  const expr = node.expression;
  if (ts.isCallExpression(expr)) return expr.arguments;
  return undefined;
}

function litString(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function objectProp(obj: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
    if (name === key) return prop.initializer;
  }
  return undefined;
}

function normalizeSegments(...parts: Array<string | undefined>): string {
  const segments = parts
    .flatMap((part) => String(part ?? '').split('/'))
    .filter(Boolean)
    .map((segment) => segment.replace(/^:(.+)$/, '{$1}'));
  return '/' + segments.join('/');
}

function resolveImportPath(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('src/')) {
    // Only resolve project sources for DTO loading
    if (specifier.startsWith('@')) return null;
  }
  let resolved: string;
  if (specifier.startsWith('src/')) resolved = path.join(process.cwd(), specifier);
  else resolved = path.resolve(path.dirname(fromFile), specifier);

  const candidates = [`${resolved}.ts`, path.join(resolved, 'index.ts'), resolved];
  for (const candidate of candidates) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  return null;
}

function collectImports(source: ts.SourceFile, filePath: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const spec = litString(stmt.moduleSpecifier as ts.Expression);
    if (!spec) continue;
    const resolved = resolveImportPath(filePath, spec);
    if (!resolved) continue;

    const clause = stmt.importClause;
    if (clause.name) map.set(clause.name.text, resolved);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) map.set(el.name.text, resolved);
    }
  }
  return map;
}

let dtoLoader: ((id: string) => Record<string, DtoCtor>) | null = null;

function getDtoLoader(): (id: string) => Record<string, DtoCtor> {
  if (dtoLoader) return dtoLoader;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createJiti } = require('jiti') as typeof import('jiti');
  const cwd = process.cwd();
  const jiti = createJiti(__filename, {
    interopDefault: true,
    alias: {
      src: path.join(cwd, 'src'),
      test: path.join(cwd, 'test'),
    },
  });
  dtoLoader = (id: string) => jiti(id) as Record<string, DtoCtor>;
  return dtoLoader;
}

function loadDto(filePath: string, exportName: string): DtoCtor | undefined {
  try {
    const mod = getDtoLoader()(filePath);
    const ctor = mod[exportName];
    return typeof ctor === 'function' ? ctor : undefined;
  } catch (error) {
    console.warn(`DAxTA: could not load DTO ${exportName} from ${filePath}:`, error instanceof Error ? error.message : error);
    return undefined;
  }
}

function parseController(filePath: string): RouteBinding[] {
  const text = readFileSync(filePath, 'utf8');
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const imports = collectImports(source, filePath);
  const routes: RouteBinding[] = [];

  for (const stmt of source.statements) {
    if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
    const ctrlDecorators = ts.getDecorators?.(stmt) ?? (stmt as unknown as { decorators?: ts.Decorator[] }).decorators ?? [];
    const controller = ctrlDecorators.find((decorator) => decoratorName(decorator) === 'Controller');
    if (!controller) continue;

    let controllerPath = '';
    let versions: string[] = [''];
    const args = decoratorArgs(controller);
    const first = args?.[0];
    if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
      controllerPath = first.text;
    } else if (first && ts.isObjectLiteralExpression(first)) {
      const pathExpr = objectProp(first, 'path');
      const versionExpr = objectProp(first, 'version');
      controllerPath = litString(pathExpr) ?? '';
      if (versionExpr) {
        if (ts.isStringLiteral(versionExpr) || ts.isNoSubstitutionTemplateLiteral(versionExpr)) versions = [versionExpr.text];
        else if (ts.isArrayLiteralExpression(versionExpr)) {
          versions = versionExpr.elements.map((el) => litString(el) ?? '').filter(Boolean);
          if (!versions.length) versions = [''];
        }
      }
    }

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
      const methodDecorators = ts.getDecorators?.(member) ?? (member as unknown as { decorators?: ts.Decorator[] }).decorators ?? [];
      const http = methodDecorators.find((decorator) => HTTP_DECORATORS.has(decoratorName(decorator) ?? ''));
      if (!http) continue;

      const httpMethod = (decoratorName(http) ?? 'All').toLowerCase();
      const routePath = litString(decoratorArgs(http)?.[0]) ?? '';

      let bodyName: string | undefined;
      let queryName: string | undefined;
      let paramName: string | undefined;

      for (const param of member.parameters ?? []) {
        const paramDecorators = ts.getDecorators?.(param) ?? (param as unknown as { decorators?: ts.Decorator[] }).decorators ?? [];
        for (const decorator of paramDecorators) {
          const kind = PARAM_DECORATORS[decoratorName(decorator) ?? ''];
          if (!kind) continue;
          const typeNode = param.type;
          if (!typeNode || !ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) continue;
          const typeName = typeNode.typeName.text;
          if (kind === 'body') bodyName = typeName;
          if (kind === 'query') queryName = typeName;
          if (kind === 'param') paramName = typeName;
        }
      }

      const resolve = (name?: string) => {
        if (!name) return undefined;
        const dtoFile = imports.get(name);
        return dtoFile ? loadDto(dtoFile, name) : undefined;
      };

      for (const version of versions) {
        const versionPrefix = version ? `v${version.replace(/^v/i, '')}` : '';
        routes.push({
          method: httpMethod === 'all' ? 'post' : httpMethod,
          pathTemplate: normalizeSegments(versionPrefix, controllerPath, routePath),
          body: resolve(bodyName),
          query: resolve(queryName),
          param: resolve(paramName),
        });
      }
    }
  }

  return routes;
}

function getRoutes(): RouteBinding[] {
  if (routeCache) return routeCache;
  const files = walkFiles(controllerRoot(), '.controller.ts');
  routeCache = files.flatMap((file) => {
    try {
      return parseController(file);
    } catch (error) {
      console.warn(`DAxTA: failed parsing controller ${file}:`, error instanceof Error ? error.message : error);
      return [];
    }
  });
  return routeCache;
}

export function controllerRouteCount(): number {
  return getRoutes().length;
}

/** Unique Nest controller path templates (may omit URI version prefix). */
export function listControllerPathTemplates(): string[] {
  const seen = new Set<string>();
  for (const route of getRoutes()) {
    seen.add(route.pathTemplate);
    if (!/^\/v\d+/i.test(route.pathTemplate)) {
      seen.add(`/v1${route.pathTemplate.startsWith('/') ? route.pathTemplate : `/${route.pathTemplate}`}`);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function scoreTemplate(template: string): number {
  const parts = template.split('/').filter(Boolean);
  const params = parts.filter((part) => /^\{.+\}$/.test(part)).length;
  return parts.length * 10 - params;
}

function ensureVersionPrefix(template: string, actual: string): string {
  if (/^\/v\d+/i.test(template) || !/^\/v\d+/i.test(actual)) return template;
  const version = actual.match(/^\/(v\d+)/i)?.[1] ?? 'v1';
  return `/${version}${template.startsWith('/') ? template : `/${template}`}`;
}

/**
 * Map a concrete request path onto a Nest controller OpenAPI template.
 * Prefers the most specific declared route (longest path, fewest params).
 */
export function matchControllerTemplate(pathname: string, method?: string): string | null {
  const routes = getRoutes();
  if (!routes.length) return null;

  const actual = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  const stripped = actual.replace(/^\/v\d+(?=\/|$)/i, '') || '/';
  const methodKey = method?.toLowerCase();

  let best: { template: string; score: number } | null = null;

  for (const route of routes) {
    if (methodKey && route.method !== 'all' && route.method !== methodKey) continue;

    const base = route.pathTemplate;
    const versioned = ensureVersionPrefix(base, actual);
    const candidates = [...new Set([base, versioned])];

    for (const template of candidates) {
      const ok =
        pathMatchesTemplate(template, actual) ||
        pathMatchesTemplate(base, stripped) ||
        pathMatchesTemplate(template, stripped);
      if (!ok) continue;

      const resolved =
        pathMatchesTemplate(template, actual) ? template : ensureVersionPrefix(base, actual);
      const score = scoreTemplate(resolved);
      if (!best || score > best.score) best = { template: resolved, score };
    }
  }

  return best?.template ?? null;
}

function findRoute(method: string, pathTemplate: string): RouteBinding | undefined {
  const keyMethod = method.toLowerCase();
  const routes = getRoutes();
  return (
    routes.find((route) => route.method === keyMethod && route.pathTemplate === pathTemplate) ||
    routes.find((route) => route.method === keyMethod && ensureVersionPrefix(route.pathTemplate, pathTemplate) === pathTemplate)
  );
}

function isOptionalMetas(metas: ValidationMeta[]): boolean {
  return metas.some((meta) => meta.type === 'conditionalValidation' || meta.name === 'isOptional');
}

function requiredFromMetas(metas: ValidationMeta[]): boolean | undefined {
  if (!metas.length) return undefined;
  if (isOptionalMetas(metas)) return false;
  return true;
}

function nestedCtor(parent: DtoCtor, property: string): DtoCtor | undefined {
  try {
    const typeMeta = defaultMetadataStorage.findTypeMetadata(parent, property);
    const fromTransformer = typeMeta?.typeFunction?.() as DtoCtor | undefined;
    if (typeof fromTransformer === 'function' && fromTransformer !== Array) return fromTransformer;
  } catch {
    // ignore
  }
  const design = Reflect.getMetadata('design:type', parent.prototype, property) as DtoCtor | undefined;
  if (typeof design === 'function' && design !== Object && design !== Array && design !== String && design !== Number && design !== Boolean) {
    return design;
  }
  return undefined;
}

function buildRequiredMap(ctor: DtoCtor, prefix = '', seen = new Set<DtoCtor>()): RequiredMap {
  const map: RequiredMap = new Map();
  if (seen.has(ctor)) return map;
  seen.add(ctor);

  const storage = getMetadataStorage();
  const metas = storage.getTargetValidationMetadatas(ctor, '', false, false);
  const byProp = storage.groupByPropertyName(metas);

  for (const property of Object.keys(byProp)) {
    const fieldPath = prefix ? `${prefix}.${property}` : property;
    const required = requiredFromMetas(
      (byProp[property] ?? []).map((meta) => ({
        propertyName: meta.propertyName,
        type: meta.type,
        name: meta.name,
      })),
    );
    if (required !== undefined) map.set(fieldPath, required);

    const child = nestedCtor(ctor, property);
    if (!child) continue;

    // object nest: creditCard.cardNumber
    for (const [nestedPath, nestedRequired] of buildRequiredMap(child, fieldPath, new Set(seen))) {
      map.set(nestedPath, nestedRequired);
    }
    // array nest as recorded in Fields: saleAgreements[].id
    const arrayPrefix = `${fieldPath}[]`;
    for (const [nestedPath, nestedRequired] of buildRequiredMap(child, arrayPrefix, new Set(seen))) {
      map.set(nestedPath, nestedRequired);
    }
  }

  return map;
}

function mapFor(method: string, pathTemplate: string, location: FieldLocation): RequiredMap | undefined {
  const route = findRoute(method, pathTemplate);
  if (!route) return undefined;
  const ctor = location === 'body' ? route.body : location === 'query' ? route.query : location === 'path' ? route.param : undefined;
  if (!ctor) return undefined;

  const cacheKey = `${method} ${pathTemplate} ${location} ${ctor.name}`;
  const cached = requiredCache.get(cacheKey);
  if (cached) return cached;
  const built = buildRequiredMap(ctor);
  requiredCache.set(cacheKey, built);
  return built;
}

/** Returns required flag from DTO metadata, or undefined when unknown (no DTO / no validators). */
export function dtoRequired(method: string, pathTemplate: string, location: FieldLocation, fieldName: string): boolean | undefined {
  if (location === 'header') return undefined;
  if (location === 'path' && !mapFor(method, pathTemplate, 'path')) {
    // Path params in the URL template are structurally required when no Param DTO exists.
    return true;
  }
  const map = mapFor(method, pathTemplate, location);
  if (!map) return undefined;
  if (map.has(fieldName)) return map.get(fieldName);

  // Tolerate recorded array paths vs object paths
  const alt = fieldName.includes('[]') ? fieldName.replace(/\[\]/g, '') : null;
  if (alt && map.has(alt)) return map.get(alt);
  return undefined;
}
