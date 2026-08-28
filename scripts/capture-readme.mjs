#!/usr/bin/env node
/**
 * Regenerates assets/readme/*.png from assets/viewer.html + a sample OpenAPI spec.
 * Requires: npm install --no-save playwright && npx playwright install chromium
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const { chromium } = require('playwright');
  const root = path.resolve(__dirname, '..');
  const outDir = path.join(root, 'assets', 'readme');
  fs.mkdirSync(outDir, { recursive: true });

  const pngDataUri = (filePath) => `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
  const faviconUri = pngDataUri(path.join(root, 'assets', 'logo-dark.png'));
  const faviconLightUri = pngDataUri(path.join(root, 'assets', 'logo-light.png'));

  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Onboarding API',
      version: '1.4.0',
      description: 'Generated from observed test execution',
      'x-workspace': 'token-x',
    },
    'x-viewer': { groupBy: 'path' },
    servers: [{ url: 'http://localhost:3000' }],
    tags: [{ name: 'customers' }, { name: 'kyc' }],
    paths: {
      '/v1/customers': {
        post: {
          tags: ['customers'],
          summary: 'Create customer',
          security: [{ authorization: [] }],
          responses: { '201': { description: 'Created' }, '400': { description: 'Bad Request' } },
          'x-tree-segments': ['v1', 'customers'],
          'x-docs': {
            title: 'Create customer',
            fields: [
              { name: 'authorization', in: 'header', type: 'string', required: true },
              { name: 'email', in: 'body', type: 'string', required: true },
              { name: 'fullName', in: 'body', type: 'string', required: true },
              { name: 'phone', in: 'body', type: 'string', required: false },
              { name: 'metadata.channel', in: 'body', type: 'string', required: false },
            ],
          },
          'x-scenarios': [
            {
              group: 'Success',
              name: 'valid payload',
              status: 201,
              headers: { authorization: 'Bearer eyJhbGciOi…', 'content-type': 'application/json' },
              pathParams: {},
              query: {},
              reqBody: {
                email: 'ada@example.com',
                fullName: 'Ada Lovelace',
                phone: '+905551112233',
                metadata: { channel: 'mobile' },
              },
              resBody: { id: 'cus_01HXYZ', status: 'ACTIVE' },
            },
            {
              group: 'Validation',
              name: 'missing email',
              status: 400,
              headers: { authorization: 'Bearer eyJhbGciOi…', 'content-type': 'application/json' },
              pathParams: {},
              query: {},
              reqBody: { fullName: 'Ada Lovelace' },
              resBody: { message: ['email must be an email'], error: 'Bad Request', statusCode: 400 },
            },
            {
              group: 'Auth',
              name: 'missing authorization',
              status: 401,
              headers: {},
              pathParams: {},
              query: {},
              reqBody: { email: 'ada@example.com', fullName: 'Ada Lovelace' },
              resBody: { message: 'Unauthorized', statusCode: 401 },
            },
          ],
        },
      },
      '/v1/customers/{customerId}': {
        get: {
          tags: ['customers'],
          summary: 'Get customer',
          security: [{ authorization: [] }],
          responses: { '200': { description: 'OK' }, '404': { description: 'Not Found' } },
          'x-tree-segments': ['v1', 'customers', '{customerId}'],
          'x-docs': {
            title: 'Get customer',
            fields: [
              { name: 'authorization', in: 'header', type: 'string', required: true },
              { name: 'customerId', in: 'path', type: 'string', required: true },
            ],
          },
          'x-scenarios': [
            {
              group: 'Success',
              name: 'existing customer',
              status: 200,
              headers: { authorization: 'Bearer eyJhbGciOi…' },
              pathParams: { customerId: 'cus_01HXYZ' },
              query: {},
              resBody: { id: 'cus_01HXYZ', email: 'ada@example.com', status: 'ACTIVE' },
            },
          ],
        },
      },
      '/v1/kyc/sessions': {
        post: {
          tags: ['kyc'],
          summary: 'Start KYC session',
          security: [{ authorization: [] }],
          responses: { '201': { description: 'Created' } },
          'x-tree-segments': ['v1', 'kyc', 'sessions'],
          'x-docs': {
            title: 'Start KYC session',
            fields: [
              { name: 'authorization', in: 'header', type: 'string', required: true },
              { name: 'customerId', in: 'body', type: 'string', required: true },
              { name: 'provider', in: 'body', type: 'string', required: true },
            ],
          },
          'x-scenarios': [
            {
              group: 'Success',
              name: 'jumio session',
              status: 201,
              headers: { authorization: 'Bearer eyJhbGciOi…', 'content-type': 'application/json' },
              pathParams: {},
              query: {},
              reqBody: { customerId: 'cus_01HXYZ', provider: 'jumio' },
              resBody: { sessionId: 'kyc_9f2a', redirectUrl: 'https://example.com/kyc/start' },
            },
          ],
        },
      },
    },
    components: {
      securitySchemes: {
        authorization: { type: 'apiKey', in: 'header', name: 'authorization' },
      },
    },
  };

  let html = fs.readFileSync(path.join(root, 'assets', 'viewer.html'), 'utf8');
  html = html
    .replace('__SPEC_JSON__', JSON.stringify(spec).replace(/</g, '\\u003c'))
    .replaceAll('__FAVICON_DATA_URI__', faviconUri)
    .replaceAll('__FAVICON_LIGHT_DATA_URI__', faviconLightUri);
  const demoPath = path.join(outDir, 'demo.html');
  fs.writeFileSync(demoPath, html);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('file://' + demoPath, { waitUntil: 'networkidle' });
  await page.waitForSelector('.title');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'docs-overview.png') });

  const fields = page.locator('section.fields');
  if (await fields.count()) {
    await fields.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await fields.screenshot({ path: path.join(outDir, 'docs-fields.png') });
  }

  const toggle = page.locator('#scenario-toggle');
  if (await toggle.count()) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await toggle.click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outDir, 'docs-scenarios.png') });
  }

  const term = await browser.newPage({ viewport: { width: 980, height: 420 }, deviceScaleFactor: 2 });
  await term.setContent(`<!doctype html><html><head><style>
    body{margin:0;background:#111;color:#e8e8e8;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;padding:28px 32px}
    .dim{color:#888}.cyan{color:#5cc8ff}.green{color:#3dd68c}.bold{font-weight:700;color:#fff}
    .line{white-space:pre}
  </style></head><body>
    <div class="line"><span class="dim"> PASS </span> src/customers/customers.e2e-spec.ts</div>
    <div class="line"><span class="dim"> PASS </span> src/kyc/kyc.e2e-spec.ts</div>
    <div class="line" style="margin:14px 0 8px"><span class="dim">Test Suites:</span> <span class="green">2 passed</span><span class="dim">, 2 total</span></div>
    <div class="line" style="margin-top:22px"><span class="bold">API docs ready</span></div>
    <div class="line">  <span class="dim">│</span> <span class="green">✔</span> <span class="cyan">http://localhost:3000/api-docs</span> <span class="dim">(48 hits · 12 ops)</span></div>
    <div class="line">  <span class="dim">│</span> <span class="dim">served when NODE_ENV is dev/test/staging</span></div>
    <div class="line" style="margin-top:16px"><span class="bold">Next</span></div>
    <div class="line">  <span class="cyan">$</span> <span class="bold">pnpm start:dev</span></div>
    <div class="line">    <span class="dim">open http://localhost:3000/api-docs</span></div>
  </body></html>`);
  await term.screenshot({ path: path.join(outDir, 'terminal-docs-ready.png') });
  await browser.close();
  console.log('updated assets/readme/*.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
