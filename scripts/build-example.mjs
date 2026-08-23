#!/usr/bin/env node
/**
 * Writes assets/example.html from assets/viewer.html + an anonymous sample spec.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STAFF_ID = 'stf_7c91e2a4';
const PATRON_ID = 'ptr_3b18d0f6';
const AUTH = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…';
const TS = '2026-08-22T14:08:03.120Z';

function envelope(statusCode, extra = {}) {
  return {
    statusCode,
    success: statusCode < 400,
    timestamp: TS,
    ...extra,
  };
}

function field(name, loc, type, required) {
  return { name, in: loc, type, required };
}

function scenario(name, group, status, extras) {
  return { name, group, status, pathParams: {}, query: {}, headers: {}, ...extras };
}

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Lumen Library API',
    version: '2.1.0',
    description: 'Generated from observed test execution',
    'x-workspace': 'lumen',
  },
  'x-viewer': {
    workspace: 'lumen',
    baseUrl: 'http://localhost:3000',
    docsPath: '/api-docs',
    treeLayout: 'role-resource',
    treeSkipParams: true,
    exampleLabelStyle: 'status-title-case',
    envPresets: {
      local: { baseUrl: 'http://localhost:3000' },
      staging: { baseUrl: 'https://api.staging.lumen.example' },
      production: { baseUrl: 'https://api.lumen.example' },
    },
  },
  servers: [{ url: 'http://localhost:3000' }],
  tags: [{ name: 'titles' }, { name: 'copies' }, { name: 'holds' }, { name: 'loans' }, { name: 'rooms' }],
  components: {
    securitySchemes: {
      staffId: { type: 'apiKey', in: 'header', name: 'x-staff-id' },
      patronId: { type: 'apiKey', in: 'header', name: 'x-patron-id' },
      authorization: { type: 'apiKey', in: 'header', name: 'authorization' },
    },
  },
  paths: {
    '/v1/staff/titles': {
      post: {
        tags: ['titles'],
        summary: 'Create Title',
        security: [{ staffId: [] }],
        'x-tree-segments': ['v1', 'titles', 'staff'],
        'x-docs': {
          title: 'Create Title',
          fields: [
            field('x-staff-id', 'header', 'string', true),
            field('isbn', 'body', 'string', true),
            field('name', 'body', 'string', true),
            field('copies', 'body', 'array<object>', false),
            field('copies[].count', 'body', 'integer', false),
            field('copies[].binding', 'body', 'string', false),
          ],
        },
        'x-scenarios': [
          scenario('Creates title when counted paperback copies are provided', 'POSITIVE CASES', 201, {
            headers: { 'x-staff-id': STAFF_ID, 'content-type': 'application/json' },
            reqBody: { isbn: '9780141439518', name: 'Pride and Prejudice', copies: [{ count: 4 }] },
            resBody: envelope(201, { path: '/v1/staff/titles', error: null, data: { id: 'ttl_01PP', isbn: '9780141439518', copyCount: 4 } }),
          }),
          scenario('Creates title when hardcover binding specs are provided', 'POSITIVE CASES', 201, {
            headers: { 'x-staff-id': STAFF_ID, 'content-type': 'application/json' },
            reqBody: { isbn: '9780141439518', name: 'Pride and Prejudice', copies: [{ count: 2, binding: 'hardcover' }] },
            resBody: envelope(201, { path: '/v1/staff/titles', error: null, data: { id: 'ttl_01PP', bindings: ['hardcover'] } }),
          }),
          scenario('Returns error when isbn already exists', 'SEMANTIC ERROR CASES', 409, {
            headers: { 'x-staff-id': STAFF_ID, 'content-type': 'application/json' },
            reqBody: { isbn: '9780141439518', name: 'Pride and Prejudice' },
            resBody: envelope(409, { path: '/v1/staff/titles', error: 'ISBN already exists' }),
          }),
          scenario('Returns error when publisher catalog has no match', 'SEMANTIC ERROR CASES', 404, {
            headers: { 'x-staff-id': STAFF_ID, 'content-type': 'application/json' },
            reqBody: { isbn: '0000000000000', name: 'Unknown Volume' },
            resBody: envelope(404, { path: '/v1/staff/titles', error: 'Publisher catalog has no match' }),
          }),
          scenario('Returns error when isbn is an array', 'INVALID CASES', 400, {
            headers: { 'x-staff-id': STAFF_ID, 'content-type': 'application/json' },
            reqBody: { isbn: ['9780141439518'], name: 'Pride and Prejudice' },
            resBody: envelope(400, { path: '/v1/staff/titles', error: 'isbn should not be array' }),
          }),
          scenario('Returns error when isbn has invalid format', 'INVALID CASES', 400, {
            headers: { 'x-staff-id': STAFF_ID, 'content-type': 'application/json' },
            reqBody: { isbn: 'abc', name: 'Pride and Prejudice' },
            resBody: envelope(400, { path: '/v1/staff/titles', error: 'isbn has invalid format' }),
          }),
          scenario('Creates title when copies are omitted', 'OMITTED CASES', 201, {
            headers: { 'x-staff-id': STAFF_ID, 'content-type': 'application/json' },
            reqBody: { isbn: '9780061120084', name: 'To Kill a Mockingbird' },
            resBody: envelope(201, { path: '/v1/staff/titles', error: null, data: { id: 'ttl_01MK', copyCount: 0 } }),
          }),
          scenario('Returns error when x-staff-id is missing', 'SEMANTIC ERROR CASES - AUTH', 401, {
            headers: { 'content-type': 'application/json' },
            reqBody: { isbn: '9780141439518', name: 'Pride and Prejudice' },
            resBody: envelope(401, { path: '/v1/staff/titles', error: 'Unauthorized' }),
          }),
        ],
      },
    },
    '/v1/staff/copies': {
      get: {
        tags: ['copies'],
        summary: 'List Copies',
        security: [{ staffId: [] }],
        'x-tree-segments': ['v1', 'copies', 'staff'],
        'x-docs': {
          title: 'List Copies',
          fields: [
            field('x-staff-id', 'header', 'string', true),
            field('status', 'query', 'string', false),
            field('page', 'query', 'integer', false),
            field('limit', 'query', 'integer', false),
          ],
        },
        'x-scenarios': [
          scenario('Lists copies when query is valid', 'POSITIVE CASES', 200, {
            headers: { 'x-staff-id': STAFF_ID },
            query: { status: 'SHELVED', page: '1', limit: '20' },
            resBody: envelope(200, {
              data: [
                { id: 'cpy_01AA', barcode: 'LUM-1001', binding: 'paperback', status: 'SHELVED' },
                { id: 'cpy_01AB', barcode: 'LUM-1002', binding: 'hardcover', status: 'SHELVED' },
              ],
              meta: { page: 1, limit: 20, total: 2 },
            }),
          }),
          scenario('Lists copies when filters are omitted', 'OMITTED CASES', 200, {
            headers: { 'x-staff-id': STAFF_ID },
            resBody: envelope(200, { data: [], meta: { page: 1, limit: 20, total: 0 } }),
          }),
          scenario('Returns error when page is not a number', 'INVALID CASES', 400, {
            headers: { 'x-staff-id': STAFF_ID },
            query: { page: 'first' },
            resBody: envelope(400, { error: 'page must be an integer' }),
          }),
          scenario('Returns error when x-staff-id is missing', 'SEMANTIC ERROR CASES - AUTH', 401, {
            resBody: envelope(401, { error: 'Unauthorized' }),
          }),
        ],
      },
    },
    '/v1/staff/copies/{copyId}': {
      get: {
        tags: ['copies'],
        summary: 'Get Copy',
        security: [{ staffId: [] }],
        'x-tree-segments': ['v1', 'copies', 'staff'],
        'x-docs': {
          title: 'Get Copy',
          fields: [
            field('x-staff-id', 'header', 'string', true),
            field('copyId', 'path', 'string', true),
          ],
        },
        'x-scenarios': [
          scenario('Returns copy when id exists', 'POSITIVE CASES', 200, {
            headers: { 'x-staff-id': STAFF_ID },
            pathParams: { copyId: 'cpy_01AA' },
            resBody: envelope(200, {
              data: { id: 'cpy_01AA', barcode: 'LUM-1001', binding: 'paperback', status: 'SHELVED', branch: 'river-north' },
            }),
          }),
          scenario('Returns error when copy does not exist', 'SEMANTIC ERROR CASES', 404, {
            headers: { 'x-staff-id': STAFF_ID },
            pathParams: { copyId: 'cpy_missing' },
            resBody: envelope(404, { error: 'Copy not found' }),
          }),
          scenario('Returns error when x-staff-id is missing', 'SEMANTIC ERROR CASES - AUTH', 401, {
            pathParams: { copyId: 'cpy_01AA' },
            resBody: envelope(401, { error: 'Unauthorized' }),
          }),
        ],
      },
      patch: {
        tags: ['copies'],
        summary: 'Update Copy',
        security: [{ staffId: [] }],
        'x-tree-segments': ['v1', 'copies', 'staff'],
        'x-docs': {
          title: 'Update Copy',
          fields: [
            field('x-staff-id', 'header', 'string', true),
            field('copyId', 'path', 'string', true),
            field('status', 'body', 'string', false),
            field('shelf', 'body', 'string', false),
            field('condition.notes', 'body', 'string', false),
          ],
        },
        'x-scenarios': [
          scenario('Updates copy when status is valid', 'POSITIVE CASES', 200, {
            headers: { 'x-staff-id': STAFF_ID, 'content-type': 'application/json' },
            pathParams: { copyId: 'cpy_01AA' },
            reqBody: { status: 'REPAIR', shelf: 'B-14', condition: { notes: 'loose spine' } },
            resBody: envelope(200, { data: { id: 'cpy_01AA', status: 'REPAIR', shelf: 'B-14' } }),
          }),
          scenario('Returns error when status is unknown', 'INVALID CASES', 400, {
            headers: { 'x-staff-id': STAFF_ID, 'content-type': 'application/json' },
            pathParams: { copyId: 'cpy_01AA' },
            reqBody: { status: 'LOST-IN-SPACE' },
            resBody: envelope(400, { error: 'status must be one of SHELVED, LOANED, REPAIR, WITHDRAWN' }),
          }),
          scenario('Returns error when copy is already withdrawn', 'SEMANTIC ERROR CASES', 409, {
            headers: { 'x-staff-id': STAFF_ID, 'content-type': 'application/json' },
            pathParams: { copyId: 'cpy_withdrawn' },
            reqBody: { status: 'SHELVED' },
            resBody: envelope(409, { error: 'Withdrawn copies cannot be reshelved' }),
          }),
        ],
      },
      delete: {
        tags: ['copies'],
        summary: 'Delete Copy',
        security: [{ staffId: [] }],
        'x-tree-segments': ['v1', 'copies', 'staff'],
        'x-docs': {
          title: 'Delete Copy',
          fields: [
            field('x-staff-id', 'header', 'string', true),
            field('copyId', 'path', 'string', true),
          ],
        },
        'x-scenarios': [
          scenario('Deletes copy when it is unused', 'POSITIVE CASES', 204, {
            headers: { 'x-staff-id': STAFF_ID },
            pathParams: { copyId: 'cpy_01AB' },
          }),
          scenario('Returns error when copy is on loan', 'SEMANTIC ERROR CASES', 409, {
            headers: { 'x-staff-id': STAFF_ID },
            pathParams: { copyId: 'cpy_01AA' },
            resBody: envelope(409, { error: 'Copy is on loan' }),
          }),
          scenario('Returns error when x-staff-id is missing', 'SEMANTIC ERROR CASES - AUTH', 401, {
            pathParams: { copyId: 'cpy_01AB' },
            resBody: envelope(401, { error: 'Unauthorized' }),
          }),
        ],
      },
    },
    '/v1/patron/holds': {
      post: {
        tags: ['holds'],
        summary: 'Create Hold',
        security: [{ patronId: [] }],
        'x-tree-segments': ['v1', 'holds', 'patron'],
        'x-docs': {
          title: 'Create Hold',
          fields: [
            field('x-patron-id', 'header', 'string', true),
            field('titleId', 'body', 'string', true),
            field('pickup.branch', 'body', 'string', true),
            field('pickup.by', 'body', 'string', false),
            field('notes', 'body', 'string', false),
          ],
        },
        'x-scenarios': [
          scenario('Creates hold when pickup branch is open', 'POSITIVE CASES', 201, {
            headers: { 'x-patron-id': PATRON_ID, 'content-type': 'application/json' },
            reqBody: { titleId: 'ttl_01PP', pickup: { branch: 'river-north', by: '2026-09-01' }, notes: 'large print if available' },
            resBody: envelope(201, { data: { id: 'hld_01PP', status: 'QUEUED', position: 2 } }),
          }),
          scenario('Returns error when patron already holds this title', 'SEMANTIC ERROR CASES', 409, {
            headers: { 'x-patron-id': PATRON_ID, 'content-type': 'application/json' },
            reqBody: { titleId: 'ttl_01PP', pickup: { branch: 'river-north' } },
            resBody: envelope(409, { error: 'A hold already exists for this title' }),
          }),
          scenario('Returns error when branch code is invalid', 'INVALID CASES', 400, {
            headers: { 'x-patron-id': PATRON_ID, 'content-type': 'application/json' },
            reqBody: { titleId: 'ttl_01PP', pickup: { branch: 'moon-base' } },
            resBody: envelope(400, { error: 'pickup.branch must be a known branch' }),
          }),
          scenario('Returns error when titleId is omitted', 'OMITTED CASES', 400, {
            headers: { 'x-patron-id': PATRON_ID, 'content-type': 'application/json' },
            reqBody: { pickup: { branch: 'river-north' } },
            resBody: envelope(400, { error: 'titleId should not be empty' }),
          }),
          scenario('Returns error when x-patron-id is missing', 'SEMANTIC ERROR CASES - AUTH', 401, {
            headers: { 'content-type': 'application/json' },
            reqBody: { titleId: 'ttl_01PP', pickup: { branch: 'river-north' } },
            resBody: envelope(401, { error: 'Unauthorized' }),
          }),
        ],
      },
    },
    '/v1/patron/holds/{holdId}': {
      get: {
        tags: ['holds'],
        summary: 'Get Hold',
        security: [{ patronId: [] }],
        'x-tree-segments': ['v1', 'holds', 'patron'],
        'x-docs': {
          title: 'Get Hold',
          fields: [
            field('x-patron-id', 'header', 'string', true),
            field('holdId', 'path', 'string', true),
          ],
        },
        'x-scenarios': [
          scenario('Returns hold when it belongs to patron', 'POSITIVE CASES', 200, {
            headers: { 'x-patron-id': PATRON_ID },
            pathParams: { holdId: 'hld_01PP' },
            resBody: envelope(200, { data: { id: 'hld_01PP', status: 'QUEUED', titleId: 'ttl_01PP' } }),
          }),
          scenario('Returns error when hold belongs to another patron', 'SEMANTIC ERROR CASES', 403, {
            headers: { 'x-patron-id': PATRON_ID },
            pathParams: { holdId: 'hld_other' },
            resBody: envelope(403, { error: 'Forbidden' }),
          }),
        ],
      },
      put: {
        tags: ['holds'],
        summary: 'Replace Hold',
        security: [{ patronId: [] }],
        'x-tree-segments': ['v1', 'holds', 'patron'],
        'x-docs': {
          title: 'Replace Hold',
          fields: [
            field('x-patron-id', 'header', 'string', true),
            field('holdId', 'path', 'string', true),
            field('titleId', 'body', 'string', true),
            field('pickup.branch', 'body', 'string', true),
            field('pickup.by', 'body', 'string', false),
          ],
        },
        'x-scenarios': [
          scenario('Replaces hold when pickup branch is valid', 'POSITIVE CASES', 200, {
            headers: { 'x-patron-id': PATRON_ID, 'content-type': 'application/json' },
            pathParams: { holdId: 'hld_01PP' },
            reqBody: { titleId: 'ttl_01PP', pickup: { branch: 'west-end', by: '2026-09-08' } },
            resBody: envelope(200, { data: { id: 'hld_01PP', pickup: { branch: 'west-end' }, status: 'QUEUED' } }),
          }),
          scenario('Returns error when hold is already ready', 'SEMANTIC ERROR CASES', 409, {
            headers: { 'x-patron-id': PATRON_ID, 'content-type': 'application/json' },
            pathParams: { holdId: 'hld_ready' },
            reqBody: { titleId: 'ttl_01PP', pickup: { branch: 'west-end' } },
            resBody: envelope(409, { error: 'Ready holds cannot be replaced' }),
          }),
        ],
      },
    },
    '/v1/loans': {
      get: {
        tags: ['loans'],
        summary: 'List Loans',
        security: [{ authorization: [] }],
        'x-tree-segments': ['v1', 'loans'],
        'x-docs': {
          title: 'List Loans',
          fields: [
            field('authorization', 'header', 'string', true),
            field('from', 'query', 'string', false),
            field('to', 'query', 'string', false),
            field('status', 'query', 'string', false),
            field('cursor', 'query', 'string', false),
          ],
        },
        'x-scenarios': [
          scenario('Lists loans when date range is valid', 'POSITIVE CASES', 200, {
            headers: { authorization: AUTH },
            query: { from: '2026-08-01', to: '2026-08-22', status: 'OPEN' },
            resBody: envelope(200, {
              data: [{ id: 'lon_9f2a', copyId: 'cpy_01AA', dueOn: '2026-09-05', status: 'OPEN' }],
              nextCursor: null,
            }),
          }),
          scenario('Returns error when from is after to', 'INVALID CASES', 400, {
            headers: { authorization: AUTH },
            query: { from: '2026-08-22', to: '2026-08-01' },
            resBody: envelope(400, { error: 'from must be before to' }),
          }),
          scenario('Returns error when authorization is missing', 'SEMANTIC ERROR CASES - AUTH', 401, {
            query: { from: '2026-08-01', to: '2026-08-22' },
            resBody: envelope(401, { error: 'Unauthorized' }),
          }),
        ],
      },
      post: {
        tags: ['loans'],
        summary: 'Create Loan',
        security: [{ authorization: [] }],
        'x-tree-segments': ['v1', 'loans'],
        'x-docs': {
          title: 'Create Loan',
          fields: [
            field('authorization', 'header', 'string', true),
            field('copyId', 'body', 'string', true),
            field('patronId', 'body', 'string', true),
            field('days', 'body', 'integer', true),
            field('idempotencyKey', 'body', 'string', true),
            field('notice.email', 'body', 'string', false),
          ],
        },
        'x-scenarios': [
          scenario('Creates loan when copy is shelved', 'POSITIVE CASES', 201, {
            headers: { authorization: AUTH, 'content-type': 'application/json' },
            reqBody: { copyId: 'cpy_01AA', patronId: PATRON_ID, days: 21, idempotencyKey: 'chk_88', notice: { email: 'reader@example.com' } },
            resBody: envelope(201, { data: { id: 'lon_9f2a', status: 'OPEN', dueOn: '2026-09-12' } }),
          }),
          scenario('Returns open loan when idempotency key is reused', 'POSITIVE CASES', 200, {
            headers: { authorization: AUTH, 'content-type': 'application/json' },
            reqBody: { copyId: 'cpy_01AA', patronId: PATRON_ID, days: 21, idempotencyKey: 'chk_88' },
            resBody: envelope(200, { data: { id: 'lon_9f2a', status: 'OPEN', dueOn: '2026-09-12' } }),
          }),
          scenario('Returns error when copy is in repair', 'SEMANTIC ERROR CASES', 422, {
            headers: { authorization: AUTH, 'content-type': 'application/json' },
            reqBody: { copyId: 'cpy_repair', patronId: PATRON_ID, days: 14, idempotencyKey: 'chk_89' },
            resBody: envelope(422, { error: 'Copy is not available for loan' }),
          }),
          scenario('Returns error when days is negative', 'INVALID CASES', 400, {
            headers: { authorization: AUTH, 'content-type': 'application/json' },
            reqBody: { copyId: 'cpy_01AA', patronId: PATRON_ID, days: -1, idempotencyKey: 'chk_90' },
            resBody: envelope(400, { error: 'days must be a positive integer' }),
          }),
          scenario('Returns error when patronId is omitted', 'OMITTED CASES', 400, {
            headers: { authorization: AUTH, 'content-type': 'application/json' },
            reqBody: { copyId: 'cpy_01AA', days: 21, idempotencyKey: 'chk_91' },
            resBody: envelope(400, { error: 'patronId should not be empty' }),
          }),
          scenario('Returns error when authorization is expired', 'SEMANTIC ERROR CASES - AUTH', 401, {
            headers: { authorization: 'Bearer expired', 'content-type': 'application/json' },
            reqBody: { copyId: 'cpy_01AA', patronId: PATRON_ID, days: 21, idempotencyKey: 'chk_92' },
            resBody: envelope(401, { error: 'Unauthorized' }),
          }),
        ],
      },
    },
    '/v1/loans/{loanId}': {
      get: {
        tags: ['loans'],
        summary: 'Get Loan',
        security: [{ authorization: [] }],
        'x-tree-segments': ['v1', 'loans'],
        'x-docs': {
          title: 'Get Loan',
          fields: [
            field('authorization', 'header', 'string', true),
            field('loanId', 'path', 'string', true),
          ],
        },
        'x-scenarios': [
          scenario('Returns loan when it exists', 'POSITIVE CASES', 200, {
            headers: { authorization: AUTH },
            pathParams: { loanId: 'lon_9f2a' },
            resBody: envelope(200, {
              data: { id: 'lon_9f2a', copyId: 'cpy_01AA', patronId: PATRON_ID, status: 'OPEN', dueOn: '2026-09-12' },
            }),
          }),
          scenario('Returns error when loan does not exist', 'SEMANTIC ERROR CASES', 404, {
            headers: { authorization: AUTH },
            pathParams: { loanId: 'lon_missing' },
            resBody: envelope(404, { error: 'Loan not found' }),
          }),
        ],
      },
    },
    '/v1/rooms/bookings': {
      post: {
        tags: ['rooms'],
        summary: 'Create Booking',
        security: [{ authorization: [] }],
        'x-tree-segments': ['v1', 'rooms', 'bookings'],
        'x-docs': {
          title: 'Create Booking',
          fields: [
            field('authorization', 'header', 'string', true),
            field('roomId', 'body', 'string', true),
            field('slot', 'body', 'string', true),
            field('seats', 'body', 'integer', false),
          ],
        },
        'x-scenarios': [
          scenario('Creates booking when room is free', 'POSITIVE CASES', 201, {
            headers: { authorization: AUTH, 'content-type': 'application/json' },
            reqBody: { roomId: 'rm_quiet', slot: '2026-08-24T10:00:00Z', seats: 4 },
            resBody: envelope(201, { data: { id: 'bkg_9f2a', roomId: 'rm_quiet', status: 'CONFIRMED' } }),
          }),
          scenario('Returns error when slot overlaps an existing booking', 'SEMANTIC ERROR CASES', 409, {
            headers: { authorization: AUTH, 'content-type': 'application/json' },
            reqBody: { roomId: 'rm_quiet', slot: '2026-08-24T10:00:00Z' },
            resBody: envelope(409, { error: 'Room is already booked for this slot' }),
          }),
          scenario('Returns error when slot is not ISO-8601', 'INVALID CASES', 400, {
            headers: { authorization: AUTH, 'content-type': 'application/json' },
            reqBody: { roomId: 'rm_quiet', slot: 'tomorrow-morning' },
            resBody: envelope(400, { error: 'slot must be an ISO-8601 datetime' }),
          }),
          scenario('Creates booking when seats are omitted', 'OMITTED CASES', 201, {
            headers: { authorization: AUTH, 'content-type': 'application/json' },
            reqBody: { roomId: 'rm_map', slot: '2026-08-24T15:00:00Z' },
            resBody: envelope(201, { data: { id: 'bkg_map', roomId: 'rm_map', seats: 1, status: 'CONFIRMED' } }),
          }),
        ],
      },
    },
  },
};

function main() {
  const root = path.resolve(__dirname, '..');
  const favicon = fs.readFileSync(path.join(root, 'assets', 'favicon.svg'));
  const faviconUri = `data:image/svg+xml;base64,${favicon.toString('base64')}`;
  let html = fs.readFileSync(path.join(root, 'assets', 'viewer.html'), 'utf8');
  html = html
    .replace('__SPEC_JSON__', JSON.stringify(spec).replace(/</g, '\\u003c'))
    .replaceAll('__FAVICON_DATA_URI__', faviconUri);
  const out = path.join(root, 'assets', 'example.html');
  fs.writeFileSync(out, html);
  const ops = Object.values(spec.paths).reduce((n, item) => n + Object.keys(item).length, 0);
  const scenarios = Object.values(spec.paths).reduce(
    (n, item) => n + Object.values(item).reduce((m, op) => m + ((op['x-scenarios'] || []).length), 0),
    0,
  );
  console.log(`wrote ${path.relative(root, out)} (${ops} operations, ${scenarios} examples)`);
}

main();
