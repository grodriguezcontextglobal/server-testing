'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// massiveEventCustomerNotification y devitrakFeedbackEmailNotification dependen
// de User.find() (DB) para armar la lista de destinatarios y usan
// sgMail.sendMultiple (fan-out por personalización — NO intercambiable con
// .send()). Se resuelven con: (1) un builder async parametrizado por la
// función de búsqueda (DI, igual patrón que el resto de la cola), que devuelve
// null si no hay destinatarios (usa el soporte de "payload nulo = skip" de
// createQueuedJobController), y (2) un nuevo type 'send-email-multiple' que
// reusa createEmailHandler apuntando a sgMail.sendMultiple. Ver
// DESIGN_task_queue.md § Fase 1 (cierre).
const {
  createBuildMassiveEventCustomerMessage,
  createBuildDevitrakFeedbackMessage,
} = require('../nodeMailer/notifications');

// ─── massiveEventCustomerNotification ────────────────────────────────────────

test('createBuildMassiveEventCustomerMessage: sin destinatarios, devuelve null (no se encola nada)', async () => {
  const buildPayload = createBuildMassiveEventCustomerMessage(async () => []);
  const payload = await buildPayload({ eventID: 'E1', eventSelected: 'Expo', subject: 'Aviso' });
  assert.equal(payload, null);
});

test('createBuildMassiveEventCustomerMessage: con destinatarios, arma el mensaje con to=lista y subject compuesto', async () => {
  const buildPayload = createBuildMassiveEventCustomerMessage(async (eventID) => {
    assert.equal(eventID, 'E1');
    return [{ email: 'a@b.com' }, { email: 'c@d.com' }];
  });
  const payload = await buildPayload({ eventID: 'E1', eventSelected: 'Expo', subject: 'Aviso' });
  assert.deepEqual(payload.to, [{ email: 'a@b.com' }, { email: 'c@d.com' }]);
  assert.equal(payload.subject, 'Event Expo - Aviso');
  assert.equal(typeof payload.html, 'string');
});

// ─── devitrakFeedbackEmailNotification ───────────────────────────────────────

test('createBuildDevitrakFeedbackMessage: sin destinatarios, devuelve null', async () => {
  const buildPayload = createBuildDevitrakFeedbackMessage(async () => []);
  const payload = await buildPayload({ eventID: 'E1' });
  assert.equal(payload, null);
});

test('createBuildDevitrakFeedbackMessage: con destinatarios, arma el mensaje (subject fijo, no depende de body.subject)', async () => {
  const buildPayload = createBuildDevitrakFeedbackMessage(async (eventID) => {
    assert.equal(eventID, 'E1');
    return [{ email: 'a@b.com', name: 'A' }];
  });
  const payload = await buildPayload({ eventID: 'E1' });
  assert.deepEqual(payload.to, [{ email: 'a@b.com', name: 'A' }]);
  assert.match(payload.subject, /Feedback/);
});
