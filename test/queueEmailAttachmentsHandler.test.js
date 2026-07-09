'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Handler para adjuntos grandes (Opción A del plan de cierre de Fase 1): en vez
// de guardar el base64 del adjunto en el documento del job (riesgo de superar
// el límite de 16MB por documento de Mongo), el controller sube el adjunto a
// S3 ANTES de encolar y el job solo guarda `attachmentRefs: [{key, filename}]`.
// Este handler resuelve esas referencias a base64 justo antes de enviar, y
// limpia el objeto de S3 después de un envío exitoso (best-effort). Ver
// DESIGN_task_queue.md § Fase 1 (cierre).
const { createEmailWithS3AttachmentsHandler } = require('../queue/handlers/emailWithAttachments');

test('createEmailWithS3AttachmentsHandler: resuelve attachmentRefs a base64 antes de enviar', async () => {
  const sent = [];
  const fetched = [];
  const handler = createEmailWithS3AttachmentsHandler(
    async (msg) => { sent.push(msg); return { ok: true }; },
    { fetchAttachment: async (key) => { fetched.push(key); return 'QkFTRTY0'; }, deleteAttachment: async () => {} },
  );

  await handler({
    to: ['a@b.com'], subject: 'S', html: '<p>hi</p>',
    attachmentRefs: [{ key: 'k1', filename: 'f.pdf', type: 'application/pdf' }],
  });

  assert.deepEqual(fetched, ['k1']);
  assert.deepEqual(sent[0].attachments, [
    { content: 'QkFTRTY0', filename: 'f.pdf', type: 'application/pdf', disposition: 'attachment' },
  ]);
  // attachmentRefs no debe llegar a SendGrid — ya se resolvió a `attachments`.
  assert.equal(sent[0].attachmentRefs, undefined);
});

test('createEmailWithS3AttachmentsHandler: sin attachmentRefs, envía el mensaje tal cual', async () => {
  const sent = [];
  const handler = createEmailWithS3AttachmentsHandler(
    async (msg) => { sent.push(msg); return {}; },
    { fetchAttachment: async () => '', deleteAttachment: async () => {} },
  );

  await handler({ to: ['a@b.com'], subject: 'S', html: '<p>hi</p>' });

  assert.equal(sent[0].attachments, undefined);
});

test('createEmailWithS3AttachmentsHandler: tras un envío exitoso, borra los adjuntos de S3 (best-effort)', async () => {
  const deleted = [];
  const handler = createEmailWithS3AttachmentsHandler(
    async () => ({ ok: true }),
    { fetchAttachment: async () => 'QkFTRTY0', deleteAttachment: async (key) => { deleted.push(key); } },
  );

  await handler({ to: [], subject: '', html: '', attachmentRefs: [{ key: 'k1', filename: 'f' }] });

  assert.deepEqual(deleted, ['k1']);
});

test('createEmailWithS3AttachmentsHandler: si el envío falla, NO borra los adjuntos (deben sobrevivir para el reintento)', async () => {
  const deleted = [];
  const handler = createEmailWithS3AttachmentsHandler(
    async () => { throw new Error('SendGrid down'); },
    { fetchAttachment: async () => 'QkFTRTY0', deleteAttachment: async (key) => { deleted.push(key); } },
  );

  await assert.rejects(() => handler({ to: [], subject: '', html: '', attachmentRefs: [{ key: 'k1', filename: 'f' }] }));
  assert.deepEqual(deleted, []);
});

test('createEmailWithS3AttachmentsHandler: la limpieza de S3 es best-effort (un fallo al borrar no rompe el job)', async () => {
  const handler = createEmailWithS3AttachmentsHandler(
    async () => ({ ok: true }),
    { fetchAttachment: async () => 'QkFTRTY0', deleteAttachment: async () => { throw new Error('S3 delete failed'); } },
  );

  await assert.doesNotReject(() => handler({ to: [], subject: '', html: '', attachmentRefs: [{ key: 'k1', filename: 'f' }] }));
});
