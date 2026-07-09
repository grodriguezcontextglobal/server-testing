'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// uploadExcelToS3 subía a S3 y luego llamaba SÍNCRONO a un webhook externo
// (INVENTORY_IMPORT_WEBHOOK_URL) para disparar la importación remota — si el
// webhook estaba caído, la respuesta era 502 (aunque el archivo ya estuviera
// en S3). La respuesta final NO depende del cuerpo de la respuesta del
// webhook, solo del upload a S3 (ya conocido antes de llamar al webhook) — por
// eso el disparo del webhook se encola (type 'webhook:trigger') en vez de
// bloquear la respuesta. Cambio de comportamiento deliberado: ya no hay rama
// 502 — si el webhook está caído momentáneamente, el reintento de la cola lo
// resuelve en vez de fallarle la respuesta al cliente. Ver
// DESIGN_task_queue.md § Fase 2.
const { buildInventoryImportWebhookJob } = require('../controller/document');

test('buildInventoryImportWebhookJob: arma type/payload con la url y el body del webhook', () => {
  const job = buildInventoryImportWebhookJob({
    targetUrl: 'https://example.com/import',
    signedUrl: 'https://s3/signed',
    company_id: 'C1',
    company: 'Acme',
    userEmail: 'a@b.com',
    userSqlId: 7,
  });

  assert.equal(job.type, 'webhook:trigger');
  assert.equal(job.payload.url, 'https://example.com/import');
  assert.equal(job.payload.body.fileUrl, 'https://s3/signed');
  assert.equal(job.payload.body.company_id, 'C1');
  assert.equal(job.payload.body.company, 'Acme');
  assert.equal(job.payload.body.userEmail, 'a@b.com');
  assert.equal(job.payload.body.user_sql_id, 7);
});

test('buildInventoryImportWebhookJob: sin targetUrl configurado, devuelve null (no hay nada que encolar)', () => {
  const job = buildInventoryImportWebhookJob({ targetUrl: undefined, signedUrl: 'x', company_id: 'C1' });
  assert.equal(job, null);
});
