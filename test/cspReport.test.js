'use strict';

/**
 * POST /api/csp-report (2026-11-04, SI-4 / CM-7).
 *
 *   - Lee los dos formatos (report-uri y Reporting API) y guarda solo campos fijos.
 *   - Responde 204 siempre: cuerpo roto, demasiado grande, sin informes,
 *     Mongo caído o límite por IP superado.
 *   - Se monta antes del middleware global (limitador de 300/15 min y
 *     auditTrail), como routes/health.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.CSP_REPORT_RATE_MAX = '5';

const inserted = [];
let failInsert = false;
const modelPath = path.resolve(__dirname, '../models/CspReport.js');
require.cache[modelPath] = {
  id: modelPath, filename: modelPath, loaded: true,
  exports: {
    insertMany: async (docs) => {
      if (failInsert) throw new Error('mongo down');
      inserted.push(...docs);
      return docs;
    },
  },
};

const express = require('express');
const router = require('../routes/cspReport');
const { normalizeCspReports, MAX_REPORTS_PER_REQUEST } = require('../helpers/cspReport');
const { summarize } = require('../scripts/summarize-csp-reports');

const REPORT_URI = {
  'csp-report': {
    'document-uri': 'https://admin.devitrak.net/inventory',
    'violated-directive': 'script-src-elem',
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://evil.example/x.js',
    'source-file': 'https://admin.devitrak.net/assets/index.js',
    'line-number': 12,
    disposition: 'report',
    'original-policy': "default-src 'self'",
  },
};
const REPORTING_API = [
  {
    type: 'csp-violation', age: 10, url: 'https://admin.devitrak.net/', user_agent: 'UA',
    body: { documentURL: 'https://admin.devitrak.net/', effectiveDirective: 'img-src', blockedURL: 'https://cdn.example/a.png', disposition: 'report', lineNumber: 3 },
  },
  { type: 'deprecation', body: { id: 'x' } },
];

async function withServer(fn) {
  const app = express();
  app.use(router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/csp-report`;
  try { return await fn(base); } finally { server.close(); }
}
const post = (url, body, type = 'application/csp-report') =>
  fetch(url, { method: 'POST', headers: { 'content-type': type, 'user-agent': 'TestUA' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('normaliza report-uri: solo los campos fijos', () => {
  const [d] = normalizeCspReports(REPORT_URI, 'UA');
  assert.deepEqual(d, {
    userAgent: 'UA',
    documentUri: 'https://admin.devitrak.net/inventory',
    violatedDirective: 'script-src-elem',
    effectiveDirective: 'script-src-elem',
    blockedUri: 'https://evil.example/x.js',
    sourceFile: 'https://admin.devitrak.net/assets/index.js',
    lineNumber: 12,
    disposition: 'report',
  });
});

test('normaliza la Reporting API y descarta lo que no es csp-violation', () => {
  const docs = normalizeCspReports(REPORTING_API, 'UA');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].effectiveDirective, 'img-src');
  assert.equal(docs[0].blockedUri, 'https://cdn.example/a.png');
});

test('cuerpos sin informe, campos enormes y lotes largos', () => {
  assert.deepEqual(normalizeCspReports({ foo: 1 }), []);
  assert.deepEqual(normalizeCspReports(null), []);
  assert.deepEqual(normalizeCspReports({ 'csp-report': {} }), []);
  const [big] = normalizeCspReports({ 'csp-report': { 'document-uri': 'x'.repeat(5000) } });
  assert.equal(big.documentUri.length, 2048);
  const many = Array.from({ length: 50 }, () => REPORTING_API[0]);
  assert.equal(normalizeCspReports(many).length, MAX_REPORTS_PER_REQUEST);
});

test('HTTP: los dos content types se guardan y responden 204', async () => {
  inserted.length = 0;
  await withServer(async (url) => {
    assert.equal((await post(url, REPORT_URI)).status, 204);
    assert.equal((await post(url, REPORTING_API, 'application/reports+json')).status, 204);
  });
  assert.equal(inserted.length, 2);
  assert.equal(inserted[0].userAgent, 'TestUA');
});

test('HTTP: cuerpo roto, demasiado grande o Mongo caído siguen siendo 204', async () => {
  inserted.length = 0;
  await withServer(async (url) => {
    assert.equal((await post(url, '{not json')).status, 204);
    assert.equal((await post(url, { 'csp-report': { 'document-uri': 'x'.repeat(20_000) } })).status, 204);
    failInsert = true;
    assert.equal((await post(url, REPORT_URI)).status, 204);
    failInsert = false;
  });
  assert.equal(inserted.length, 0);
});

test('HTTP: pasado el límite por IP se descarta en silencio (204, sin guardar)', async () => {
  inserted.length = 0;
  await withServer(async (url) => {
    for (let i = 0; i < 8; i++) assert.equal((await post(url, REPORT_URI)).status, 204);
  });
  assert.ok(inserted.length <= 5, `guardó ${inserted.length}`);
});

test('index.js lo monta antes de configureMiddleware (fuera del limitador global y del audit trail)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
  const init = source.slice(source.indexOf('const initializeApp'));
  const mount = init.indexOf('app.use(require("./routes/cspReport"))');
  assert.notEqual(mount, -1);
  assert.ok(mount < init.indexOf('configureMiddleware(app)'));
});

test('el resumen agrupa por directiva, recurso y página', () => {
  const t = (d) => new Date(`2026-11-0${d}T00:00:00Z`);
  const s = summarize([
    { effectiveDirective: 'img-src', blockedUri: 'a', documentUri: 'p', createdAt: t(1) },
    { effectiveDirective: 'img-src', blockedUri: 'a', documentUri: 'p', createdAt: t(3), disposition: 'enforce' },
    { effectiveDirective: 'script-src', blockedUri: 'b', documentUri: 'p', createdAt: t(2) },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.distinct, 2);
  assert.equal(s.top[0].count, 2);
  assert.equal(s.top[0].enforced, 1);
  assert.deepEqual([s.top[0].first, s.top[0].last], [t(1), t(3)]);
});
