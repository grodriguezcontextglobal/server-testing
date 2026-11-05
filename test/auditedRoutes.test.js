'use strict';

/**
 * Cobertura del audit trail: TODA ruta de escritura montada tiene que estar
 * clasificada en exactamente una de las listas de constants/auditedRoutes.js:
 *   - AUDITED_ROUTES  (se registra, con su verbo),
 *   - READ_ONLY_ROUTES (consulta por POST, no se registra),
 *   - LOGGED_ELSEWHERE (ya la registra su controlador, o es un registro).
 *
 * En ejecución, una ruta sin clasificar se registra igual con verbo inferido.
 * Este test existe para que eso sea la red, no la norma: una ruta nueva no
 * llega a producción sin que alguien decida cómo se registra.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUDITED_ROUTES,
  READ_ONLY_ROUTES,
  LOGGED_ELSEWHERE,
  inferSpec,
} = require('../constants/auditedRoutes');
const { ACTIVITY_ACTIONS, ACTIVITY_TARGET_MODELS } = require('../constants/activityVocabulary');
const { allMountedRoutes, writeRoutes } = require('./helpers/mountedRoutes');

const mounted = allMountedRoutes();
const writes = writeRoutes();
const named = Object.keys(AUDITED_ROUTES);

test('toda ruta de escritura montada está clasificada', () => {
  const unclassified = writes.filter(
    (k) => !(k in AUDITED_ROUTES) && !READ_ONLY_ROUTES.has(k) && !LOGGED_ELSEWHERE.has(k),
  );
  assert.deepEqual(
    unclassified,
    [],
    `rutas de escritura sin clasificar en constants/auditedRoutes.js:\n${unclassified.join('\n')}`,
  );
});

test('ninguna ruta está en dos listas a la vez', () => {
  const both = [
    ...named.filter((k) => READ_ONLY_ROUTES.has(k) || LOGGED_ELSEWHERE.has(k)),
    ...[...READ_ONLY_ROUTES].filter((k) => LOGGED_ELSEWHERE.has(k)),
  ];
  assert.deepEqual(both, []);
});

test('cada clave de las tres listas existe de verdad en los routers', () => {
  const all = [...named, ...READ_ONLY_ROUTES, ...LOGGED_ELSEWHERE];
  const missing = all.filter((k) => !mounted.has(k));
  assert.deepEqual(missing, [], `claves que no son rutas montadas: ${missing.join(', ')}`);
});

test('ninguna ruta de las listas es un GET', () => {
  const all = [...named, ...READ_ONLY_ROUTES, ...LOGGED_ELSEWHERE];
  assert.deepEqual(all.filter((k) => k.startsWith('GET ')), []);
});

test('verbos y modelos nombrados están en el vocabulario publicado', () => {
  const badActions = new Set();
  const badModels = new Set();
  for (const { action, target_model } of Object.values(AUDITED_ROUTES)) {
    if (!ACTIVITY_ACTIONS.includes(action)) badActions.add(action);
    if (!ACTIVITY_TARGET_MODELS.includes(target_model)) badModels.add(target_model);
  }
  assert.deepEqual([...badActions], []);
  assert.deepEqual([...badModels], []);
});

test('los casos pedidos por el dashboard están cubiertos con su verbo', () => {
  const expect = {
    'POST /api/receiver/receiver-assignation': 'ASSIGN', // dispositivo a consumidor del evento
    'POST /api/db_event/event_device': 'ASSIGN', // inventario al evento
    'POST /api/db_item/item-out-warehouse': 'CHECK_OUT', // sale del almacén
    'POST /api/db_item/edit-item': 'UPDATE', // cambia la info de un item
    'POST /api/db_company/update-items-based-on-serial-number': 'UPDATE',
    'POST /api/db_item/bulk-item-from-spreadsheet': 'IMPORT', // import desde Excel
    'POST /api/nodemailer/single-email-notification': 'SEND', // envío de correo
  };
  for (const [k, verb] of Object.entries(expect)) {
    assert.equal(AUDITED_ROUTES[k]?.action, verb, k);
  }
});

test('inferSpec: una escritura sin clasificar recibe un verbo razonable', () => {
  assert.equal(inferSpec('POST /api/nodemailer/some-new-notification').action, 'SEND');
  assert.equal(inferSpec('POST /api/db_item/bulk-something').action, 'IMPORT');
  assert.equal(inferSpec('DELETE /api/db_item/thing/:id').action, 'DELETE');
  assert.equal(inferSpec('PATCH /api/foo/bar').action, 'UPDATE');
  assert.equal(inferSpec('POST /api/db_item/whatever').target_model, 'Item');
  assert.equal(inferSpec('POST /api/db_item/whatever').inferred, true);
});
