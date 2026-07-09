'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// uploadDocument (PDF a S3) devolvía el `document` completo (con su URL de S3)
// de forma síncrona — el cliente sí necesita esa URL, a diferencia de los
// correos/logs de Fase 1. Se migra al contrato async completo: 202 {jobId},
// el frontend hace polling a GET /api/jobs/:jobId (ya construido, Fase
// "observabilidad") hasta 'done' y lee result.document. El archivo de Multer
// sobrevive en tmp/uploads (diskStorage, no se autoborra) hasta que el worker
// lo procese — seguro diferir la subida a S3. Ver DESIGN_task_queue.md § Fase 2.
const {
  buildDocumentUploadPayload,
  createUploadDocument,
} = require('../controller/document');
const { createDocumentUploadHandler } = require('../queue/handlers/documentUpload');

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

// ─── buildDocumentUploadPayload: parsea los campos de form-data ──────────────

test('buildDocumentUploadPayload: parsea los JSON de form-data y conserva el path del archivo', () => {
  const req = {
    file: { path: '/tmp/uploads/doc-123.pdf', originalname: 'doc.pdf', mimetype: 'application/pdf' },
    body: {
      document_type: 'policy', trigger_action: 'onCreate', at_: '2026-01-01',
      title: 'T', description: 'D', language: 'en', requires_signature: 'true',
      applicable_locations: '["L1"]', applicable_items: '["I1"]', applicable_events: '["E1"]',
      tags: '["a","b"]', metadata: '{"k":"v"}', document_config: '{"x":1}',
      created_by: 'U1',
    },
  };
  const payload = buildDocumentUploadPayload(req, { company_id: 'C1', company_name: 'Acme' });

  assert.equal(payload.file.path, '/tmp/uploads/doc-123.pdf');
  assert.equal(payload.company_id, 'C1');
  assert.equal(payload.companyName, 'Acme');
  assert.deepEqual(payload.applicable_locations, ['L1']);
  assert.deepEqual(payload.tags, ['a', 'b']);
  assert.deepEqual(payload.metadata, { k: 'v' });
  assert.equal(payload.requires_signature, 'true');
});

test('buildDocumentUploadPayload: campos JSON ausentes quedan undefined (no revienta)', () => {
  const req = { file: { path: 'x', originalname: 'x.pdf', mimetype: 'application/pdf' }, body: { document_type: 'policy' } };
  const payload = buildDocumentUploadPayload(req, { company_id: 'C1', company_name: 'Acme' });
  assert.equal(payload.applicable_locations, undefined);
  assert.equal(payload.tags, undefined);
});

// ─── createUploadDocument (controller, DI) ───────────────────────────────────

test('createUploadDocument: 400 sin archivo', async () => {
  const controller = createUploadDocument({ findCompany: async () => ({}), enqueueFn: async () => ({ id: 'J' }) });
  const res = mockRes();
  await controller({ file: undefined, body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('createUploadDocument: 404 si la compañía no existe', async () => {
  const controller = createUploadDocument({ findCompany: async () => null, enqueueFn: async () => ({ id: 'J' }) });
  const res = mockRes();
  await controller({ file: { path: 'x' }, body: { company_id: 'C1' } }, res);
  assert.equal(res.statusCode, 404);
});

test('createUploadDocument: 202 con jobId cuando encola correctamente', async () => {
  const calls = [];
  const controller = createUploadDocument({
    findCompany: async () => ({ company_id: 'C1', company_name: 'Acme' }),
    enqueueFn: async (type, payload, opts) => { calls.push({ type, payload, opts }); return { id: 'JOB1' }; },
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });
  const res = mockRes();
  await controller({ file: { path: 'x', originalname: 'x.pdf', mimetype: 'application/pdf' }, body: { company_id: 'C1', document_type: 'policy' } }, res);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'document:upload-pdf');
  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.jobId, 'JOB1');
});

test('createUploadDocument: usa el header Idempotency-Key (namespaced) para deduplicar (StrictMode / doble-click / reintento)', async () => {
  let capturedOpts;
  const controller = createUploadDocument({
    findCompany: async () => ({ company_id: 'C1', company_name: 'Acme' }),
    enqueueFn: async (type, payload, opts) => { capturedOpts = opts; return { id: 'JOB1' }; },
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });
  const res = mockRes();
  await controller(
    {
      file: { path: 'x', originalname: 'x.pdf', mimetype: 'application/pdf' },
      body: { company_id: 'C1', document_type: 'policy' },
      get: (h) => (h.toLowerCase() === 'idempotency-key' ? 'abc-123' : undefined),
    },
    res
  );

  // Namespaced por tipo para no chocar con claves iguales de otros tipos de job.
  assert.equal(capturedOpts.idempotencyKey, 'document:upload-pdf:abc-123');
});

test('createUploadDocument: sin header Idempotency-Key, no manda idempotencyKey (comportamiento actual)', async () => {
  let capturedOpts;
  const controller = createUploadDocument({
    findCompany: async () => ({ company_id: 'C1', company_name: 'Acme' }),
    enqueueFn: async (type, payload, opts) => { capturedOpts = opts; return { id: 'JOB1' }; },
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });
  const res = mockRes();
  await controller(
    { file: { path: 'x', originalname: 'x.pdf', mimetype: 'application/pdf' }, body: { company_id: 'C1', document_type: 'policy' } },
    res
  );

  assert.equal(capturedOpts.idempotencyKey, undefined);
});

test('createUploadDocument: el context del job toma created_by como dueño (para poder pollear GET /api/jobs/owned/:jobId)', async () => {
  let capturedOpts;
  const controller = createUploadDocument({
    findCompany: async () => ({ company_id: 'C1', company_name: 'Acme' }),
    enqueueFn: async (type, payload, opts) => { capturedOpts = opts; return { id: 'JOB1' }; },
    // Ruta sin validateJWT → req.uid null; el dueño debe salir de created_by.
    extractContextFn: () => ({ uid: null, companyId: null, sqlStaffId: null }),
  });
  const res = mockRes();
  await controller(
    { file: { path: 'x', originalname: 'x.pdf', mimetype: 'application/pdf' }, body: { company_id: 'C1', document_type: 'policy', created_by: 'USER-42' } },
    res
  );

  assert.equal(capturedOpts.context.uid, 'USER-42');
});

// ─── createDocumentUploadHandler (worker, DI) ────────────────────────────────

test('createDocumentUploadHandler: sube a S3 y crea el Document con la URL resultante', async () => {
  const uploadCalls = [];
  const createCalls = [];
  const handler = createDocumentUploadHandler({
    uploadPdfToS3: async (file, opts) => { uploadCalls.push({ file, opts }); return { Location: 'https://bucket.s3.us-east-2.amazonaws.com/companies/C1/doc.pdf' }; },
    createDocument: async (fields) => { createCalls.push(fields); return { id: 'DOC1', ...fields }; },
  });

  const result = await handler({
    file: { path: '/tmp/x.pdf', originalname: 'x.pdf', mimetype: 'application/pdf' },
    company_id: 'C1', companyName: 'Acme', document_type: 'policy',
    title: 'T', requires_signature: 'true',
  });

  assert.equal(uploadCalls.length, 1);
  assert.equal(createCalls.length, 1);
  assert.match(createCalls[0].document_url, /companies\/C1\/doc\.pdf/);
  assert.equal(createCalls[0].requires_signature, true);
  assert.equal(result.document.id, 'DOC1');
});
