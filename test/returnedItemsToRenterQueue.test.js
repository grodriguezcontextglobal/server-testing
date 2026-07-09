'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

// returnedItemsToRenterNotification tenía adjuntos en base64 embebidos en el
// mensaje — riesgo de superar el límite de 16MB por documento de Mongo si se
// guardaran tal cual en un job. Se resuelve subiendo cada adjunto a S3 ANTES
// de encolar (síncrono en el controller, igual que hoy) y el job solo guarda
// `attachmentRefs: [{key, filename, type}]`. El worker los resuelve de vuelta
// a base64 justo antes de enviar (ver queue/handlers/emailWithAttachments.js).
// La validación (subject, staffEmails, formato de email, forma del adjunto)
// se mantiene IDÉNTICA a la original — mismos mensajes, mismos status 400.
// Ver DESIGN_task_queue.md § Fase 1 (cierre).
const {
  validateReturnedItemsToRenter,
  createBuildReturnedItemsToRenterMessage,
} = require('../nodeMailer/notifications');

// ─── validateReturnedItemsToRenter: mismos 400 que el original ───────────────

test('validateReturnedItemsToRenter: rechaza sin subject', () => {
  const r = validateReturnedItemsToRenter({ staffEmails: ['a@b.com'] });
  assert.equal(r.status, 400);
  assert.match(r.body.msg, /Subject is required/);
});

test('validateReturnedItemsToRenter: rechaza staffEmails vacío o ausente', () => {
  assert.equal(validateReturnedItemsToRenter({ subject: 'S' }).status, 400);
  assert.equal(validateReturnedItemsToRenter({ subject: 'S', staffEmails: [] }).status, 400);
});

test('validateReturnedItemsToRenter: rechaza formato de email inválido, lista los inválidos', () => {
  const r = validateReturnedItemsToRenter({ subject: 'S', staffEmails: ['ok@b.com', 'bad-email'] });
  assert.equal(r.status, 400);
  assert.match(r.body.msg, /bad-email/);
});

test('validateReturnedItemsToRenter: rechaza si attachments no es array', () => {
  const r = validateReturnedItemsToRenter({ subject: 'S', staffEmails: ['a@b.com'], attachments: 'nope' });
  assert.equal(r.status, 400);
  assert.match(r.body.msg, /Attachments must be an array/);
});

test('validateReturnedItemsToRenter: rechaza attachment sin content/path ni filename', () => {
  const r = validateReturnedItemsToRenter({ subject: 'S', staffEmails: ['a@b.com'], attachments: [{}] });
  assert.equal(r.status, 400);
  assert.match(r.body.msg, /Invalid attachment object/);
});

test('validateReturnedItemsToRenter: rechaza attachment con path que no existe en disco', () => {
  const r = validateReturnedItemsToRenter({
    subject: 'S', staffEmails: ['a@b.com'],
    attachments: [{ path: '/no/existe/archivo.pdf', filename: 'f.pdf' }],
  });
  assert.equal(r.status, 400);
  assert.match(r.body.msg, /not found/);
});

test('validateReturnedItemsToRenter: aprueba con attachment de content base64', () => {
  const r = validateReturnedItemsToRenter({
    subject: 'S', staffEmails: ['a@b.com'],
    attachments: [{ content: 'QkFTRTY0', filename: 'f.pdf' }],
  });
  assert.equal(r, null);
});

test('validateReturnedItemsToRenter: aprueba sin attachments', () => {
  assert.equal(validateReturnedItemsToRenter({ subject: 'S', staffEmails: ['a@b.com'] }), null);
});

// ─── createBuildReturnedItemsToRenterMessage: sube a S3, guarda solo refs ────

test('createBuildReturnedItemsToRenterMessage: sin adjuntos, arma el mensaje sin attachmentRefs', async () => {
  const buildPayload = createBuildReturnedItemsToRenterMessage(async () => { throw new Error('no debería subir nada'); });
  const payload = await buildPayload({
    subject: 'S', staffEmails: ['a@b.com'],
    supplierInfo: {
      companyName: 'Acme', industry: 'Events', services: [],
      address: { street: '123 Main St', city: 'City', state: 'ST', postalCode: '00000', country: 'US' },
      contactInfo: { email: 'supplier@b.com', phone: '555-0000' },
    },
  });

  assert.deepEqual(payload.to, ['a@b.com']);
  assert.equal(payload.subject, 'S');
  assert.equal(payload.attachmentRefs, undefined);
});

test('createBuildReturnedItemsToRenterMessage: adjunto con content, lo sube a S3 y guarda solo la key (nunca el base64)', async () => {
  const uploaded = [];
  const uploadAttachment = async ({ content, filename, contentType }) => {
    uploaded.push({ content, filename, contentType });
    return { key: `notification-attachments/123-${filename}` };
  };
  const buildPayload = createBuildReturnedItemsToRenterMessage(uploadAttachment);

  const payload = await buildPayload({
    subject: 'S', staffEmails: ['a@b.com'],
    attachments: [{ content: 'QkFTRTY0', filename: 'f.pdf', type: 'application/pdf' }],
  });

  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].content, 'QkFTRTY0');
  assert.equal(payload.attachmentRefs.length, 1);
  assert.equal(payload.attachmentRefs[0].key, 'notification-attachments/123-f.pdf');
  assert.equal(payload.attachmentRefs[0].filename, 'f.pdf');
  // El base64 NO debe quedar en el payload del job — solo la referencia.
  assert.equal(JSON.stringify(payload).includes('QkFTRTY0'), false);
});

test('createBuildReturnedItemsToRenterMessage: adjunto con path, lee el archivo real de disco y lo sube', async () => {
  const tmpFile = path.join(os.tmpdir(), `devitrak-test-attachment-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, 'contenido de prueba');

  try {
    const uploaded = [];
    const uploadAttachment = async ({ content, filename }) => {
      uploaded.push({ content, filename });
      return { key: `notification-attachments/456-${filename}` };
    };
    const buildPayload = createBuildReturnedItemsToRenterMessage(uploadAttachment);

    const payload = await buildPayload({
      subject: 'S', staffEmails: ['a@b.com'],
      attachments: [{ path: tmpFile, filename: 'desde-disco.txt' }],
    });

    assert.equal(uploaded[0].content, Buffer.from('contenido de prueba').toString('base64'));
    assert.equal(payload.attachmentRefs[0].filename, 'desde-disco.txt');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});
