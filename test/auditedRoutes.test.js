'use strict';

/**
 * Cada clave de constants/auditedRoutes.js tiene que ser una ruta que exista de
 * verdad. Si alguien renombra una ruta y no actualiza la lista, la acción deja
 * de registrarse en silencio; este test lo convierte en un fallo.
 *
 * Los prefijos copian el montaje de index.js (configureRoutes). Si se monta un
 * router nuevo, hay que añadirlo aquí también.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { AUDITED_ROUTES } = require('../constants/auditedRoutes');
const { ACTIVITY_ACTIONS, ACTIVITY_TARGET_MODELS } = require('../constants/activityVocabulary');

const MOUNTS = {
  '/api/admin': '../routes/admin',
  '/api/auth': '../routes/auth',
  '/api/cash-report': '../routes/cashReport',
  '/api/company': '../routes/company',
  '/api/document': '../routes/document',
  '/api/event': '../routes/event',
  '/api/item': '../routes/item',
  '/api/lease': '../routes/lease',
  '/api/receiver': '../routes/receivers',
  '/api/staff': '../routes/staff',
  '/api/stripe': '../routes/stripe',
  '/api/subscription': '../routes/subscription',
  '/api/transaction': '../routes/transaction',
  '/api/db_company': '../mysql/routes/company',
  '/api/db_consumer_attending_event_record': '../mysql/routes/consumerAttendingEvent',
  '/api/db_consumer': '../mysql/routes/consumers',
  '/api/db_event': '../mysql/routes/events',
  '/api/db_item': '../mysql/routes/item',
  '/api/db_record': '../mysql/routes/recordEvent',
  '/api/db_staff': '../mysql/routes/staff',
  '/api/db_stripe': '../mysql/routes/stripe',
  '/api/db_lease': '../mysql/routes/lease',
  '/api/db_inventory': '../mysql/routes/inventory',
  '/api/db_member': '../mysql/routes/members',
  '/api/db_location': '../mysql/routes/location',
  '/api/db_sub_location': '../mysql/routes/sub_location',
  '/api/db_shipment': '../mysql/routes/shipment',
  '/api/school': '../mysql/routes/school',
};

function routeKeys(base, router) {
  const keys = new Set();
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const p of paths) {
      const full = p === '/' ? base : `${base}${p}`;
      for (const m of Object.keys(layer.route.methods)) keys.add(`${m.toUpperCase()} ${full}`);
    }
  }
  return keys;
}

test('cada ruta auditada existe en los routers montados', () => {
  const existing = new Set();
  for (const [base, mod] of Object.entries(MOUNTS)) {
    for (const k of routeKeys(base, require(mod))) existing.add(k);
  }
  const missing = Object.keys(AUDITED_ROUTES).filter((k) => !existing.has(k));
  assert.deepEqual(missing, [], `rutas auditadas que no existen: ${missing.join(', ')}`);
});

test('ninguna ruta auditada es un GET', () => {
  const gets = Object.keys(AUDITED_ROUTES).filter((k) => k.startsWith('GET '));
  assert.deepEqual(gets, []);
});

test('verbos y modelos de la lista están en el vocabulario publicado', () => {
  const badActions = new Set();
  const badModels = new Set();
  for (const { action, target_model } of Object.values(AUDITED_ROUTES)) {
    if (!ACTIVITY_ACTIONS.includes(action)) badActions.add(action);
    if (!ACTIVITY_TARGET_MODELS.includes(target_model)) badModels.add(target_model);
  }
  assert.deepEqual([...badActions], []);
  assert.deepEqual([...badModels], []);
});

test('no se audita aquí lo que ya registra su controlador (duplicaría)', () => {
  const explicit = [
    'POST /api/admin/login',
    'POST /api/staff/force-logout',
    'PATCH /api/admin/profile/:id',
    'DELETE /api/admin/:id',
    'POST /api/event/create-event',
    'DELETE /api/event/delete-event/:id',
    'PATCH /api/event/edit-event/:id',
    'PUT /api/event/edit-event/:id',
    'PATCH /api/event/edit-staff-event/:id',
    'POST /api/inventory/create-inventory',
    'PATCH /api/inventory/edit-inventory/:id',
    'DELETE /api/inventory/delete-inventory/:id',
    'POST /api/admin/activity-logs',
  ];
  assert.deepEqual(explicit.filter((k) => k in AUDITED_ROUTES), []);
});
