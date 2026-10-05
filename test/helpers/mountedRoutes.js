'use strict';

/**
 * Todas las rutas montadas por index.js (configureRoutes), como
 * `MÉTODO /ruta/completa`. Lo usan los tests del audit trail para comprobar
 * que ninguna ruta de escritura queda sin clasificar.
 *
 * Copia el montaje de index.js: los routers de Mongo van en /api/<nombre en
 * minúsculas>, los de MySQL en /api/db_<nombre>. Si se monta un router nuevo
 * allí, hay que añadirlo aquí; si no, sus rutas no se comprueban.
 */

const MOUNTS = {
  // MongoDB (index.js § mongoRoutes; la clave se monta en minúsculas)
  '/api/admin': '../../routes/admin',
  '/api/article': '../../routes/article',
  '/api/auth': '../../routes/auth',
  '/api/registration': '../../routes/registration',
  '/api/cash-report': '../../routes/cashReport',
  '/api/company': '../../routes/company',
  '/api/devitrak': '../../routes/devitrakApp',
  '/api/document': '../../routes/document',
  '/api/error_log': '../../routes/errorLog',
  '/api/event': '../../routes/event',
  '/api/event-log': '../../routes/eventLog',
  '/api/feedback': '../../routes/feedback',
  '/api/heavy-task': '../../routes/heavyTask',
  '/api/image': '../../routes/image',
  '/api/inventory': '../../routes/inventory',
  '/api/item': '../../routes/item',
  '/api/jobs': '../../routes/jobs',
  '/api/lease': '../../routes/lease',
  '/api/nodemailer': '../../routes/nodeMailer',
  '/api/notificationlog': '../../routes/notificationLog',
  '/api/post': '../../routes/post',
  '/api/receiver': '../../routes/receivers',
  '/api/search': '../../routes/search',
  '/api/staff': '../../routes/staff',
  '/api/staff-activity-log': '../../routes/staffActivityLog',
  '/api/stripe': '../../routes/stripe',
  '/api/subscription': '../../routes/subscription',
  '/api/transaction': '../../routes/transaction',
  '/api/transaction-audit-log': '../../routes/transactionAuditLog',
  // MySQL (index.js § mysqlRoutes)
  '/api/db_company': '../../mysql/routes/company',
  '/api/db_consumer_attending_event_record': '../../mysql/routes/consumerAttendingEvent',
  '/api/db_consumer': '../../mysql/routes/consumers',
  '/api/db_event': '../../mysql/routes/events',
  '/api/db_item': '../../mysql/routes/item',
  '/api/db_identifier': '../../mysql/routes/identifier',
  '/api/db_record': '../../mysql/routes/recordEvent',
  '/api/db_staff': '../../mysql/routes/staff',
  '/api/db_stripe': '../../mysql/routes/stripe',
  '/api/db_lease': '../../mysql/routes/lease',
  '/api/db_inventory': '../../mysql/routes/inventory',
  '/api/db_member': '../../mysql/routes/members',
  '/api/db_location': '../../mysql/routes/location',
  '/api/db_sub_location': '../../mysql/routes/sub_location',
  '/api/db_shipment': '../../mysql/routes/shipment',
  // Utilidades y espacios propios (index.js, montados a mano)
  '/api/cache_update': '../../routes/cache_route',
  '/api/cloudinary': '../../cloudinary/connection',
  '/api/consumer': '../../routes/consumer',
  '/api/school': '../../mysql/routes/school',
  '/api': '../../routes/status',
};

function routeKeys(base, router) {
  const keys = [];
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const p of paths) {
      const full = p === '/' ? base : `${base}${p}`;
      for (const m of Object.keys(layer.route.methods)) {
        if (m === '_all') continue;
        keys.push(`${m.toUpperCase()} ${full}`);
      }
    }
  }
  return keys;
}

/** Set de todas las rutas montadas. */
function allMountedRoutes() {
  const out = new Set();
  for (const [base, mod] of Object.entries(MOUNTS)) {
    for (const k of routeKeys(base, require(mod))) out.add(k);
  }
  return out;
}

/** Solo las de escritura (todo lo que no es GET/HEAD/OPTIONS). */
function writeRoutes() {
  return [...allMountedRoutes()].filter((k) => !/^(GET|HEAD|OPTIONS) /.test(k)).sort();
}

module.exports = { MOUNTS, allMountedRoutes, writeRoutes };
