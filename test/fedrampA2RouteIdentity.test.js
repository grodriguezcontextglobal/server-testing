'use strict';

/**
 * FedRAMP A2 / AC-3, AC-14 (2026-10-27).
 *
 * Lote 1: 66 rutas sin ningún middleware de identidad pasan a exigir sesión
 * (validateJWT + checkTokenVersion). Todas son del grupo B (el dashboard solo
 * las llama con sesión) o F (ningún cliente las llama) del informe
 * reports/FRONTEND_unauthenticated_routes_2026-10-14.md, revalidado contra el
 * dashboard y la app de consumidor de hoy.
 *
 * Además, un trinquete: toda ruta montada sin identidad tiene que estar en
 * PUBLIC_ROUTES con su motivo. Una ruta nueva anónima rompe este test; una que
 * se cierra obliga a sacarla de la lista. Es la lista que va al SSP (AC-14).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const fakeConnection = { execute: async () => [[]], query: async () => [[]] };
stub('mysql/database/config.js', () => fakeConnection);
stub('helpers/logger.js', { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} });

const { validateJWT } = require('../middlewares/validate-jwt');
const { checkTokenVersion } = require('../middlewares/checkValidateToken');
const { effectiveChain } = require('./helpers/effectiveChain');

// ── lote 1: exigen sesión ───────────────────────────────────────────────────

const SESSION_ROUTES = {
  '../routes/admin': [['get', '/check-online-status/:email'], ['post', '/manually_logout'], ['post', '/new_admin_user']],
  '../routes/article': [['get', '/articles'], ['delete', '/article-delete/:id'], ['patch', '/article-edit/:id']],
  '../routes/cache_route': [['post', '/remove-cache']],
  '../routes/cashReport': [['post', '/create-cash-report'], ['get', '/cash-report'], ['post', '/cash-reports'], ['post', '/remove-cash-report/:id'], ['patch', '/update-cash-report/:id']],
  '../routes/eventLog': [['post', '/feed-event-log'], ['get', '/activity']],
  '../routes/errorLog': [['post', '/error_log']],
  '../routes/feedback': [['post', '/new-feedback']],
  '../routes/heavyTask': [['post', '/process']],
  '../routes/item': [['post', '/create-item'], ['patch', '/edit-item/:id'], ['get', '/list-items'], ['post', '/list-items']],
  '../routes/lease': [['post', '/create-lease'], ['patch', '/edit-lease/:id'], ['delete', '/delete-lease/:id'], ['get', '/lease-list'], ['post', '/lease-list']],
  '../routes/notificationLog': [['post', '/notification-feed-log'], ['get', '/notification-log-list']],
  '../routes/post': [['post', '/new-post'], ['get', '/posts'], ['delete', '/post-delete/:id'], ['patch', '/post-update/:id']],
  '../routes/search': [['get', '/searching_'], ['get', '/searching_consumer'], ['get', '/searching_events'], ['get', '/searching_staff'], ['get', '/searching_device_transaction'], ['get', '/searching_previous_consumer'], ['get', '/advance_searching_query']],
  '../routes/staff': [['get', '/consumers/search']],
  '../routes/subscription': [['post', '/new_subscription'], ['post', '/new_subscription_no_trial'], ['post', '/search_subscription'], ['get', '/search_subscription'], ['patch', '/update-subscription/:id'], ['get', '/subscriptions/:id'], ['post', '/company-subscription'], ['get', '/searching-subscription/subscriptions/:id']],
  '../mysql/routes/consumerAttendingEvent': [['post', '/consulting-consumer-event'], ['post', '/consumer-events'], ['post', '/new_consumer_event']],
  '../mysql/routes/inventory': [['get', '/container-items/:container_item_id'], ['delete', '/container/:container_item_id']],
  '../mysql/routes/recordEvent': [['post', '/inserting-record'], ['post', '/inserting-record-refactored'], ['post', '/checking'], ['post', '/removing-row-item-event-record'], ['post', '/checking-lease-information']],
  '../mysql/routes/shipment': [['post', '/'], ['put', '/:shipment_id'], ['delete', '/:shipment_id'], ['post', '/search'], ['post', '/package-list']],
  '../mysql/routes/sub_location': [['post', '/sub-locations'], ['get', '/locations/:location_id/sub-locations'], ['post', '/sub-locations/check']],
  // lote 2
  '../routes/auth': [['post', '/']],
  '../mysql/routes/staff': [['post', '/new_member']],
};

for (const [file, routes] of Object.entries(SESSION_ROUTES)) {
  for (const [method, routePath] of routes) {
    test(`${file}: ${method.toUpperCase()} ${routePath} exige sesión (validateJWT + checkTokenVersion)`, () => {
      const handlers = effectiveChain(require(file), method, routePath);
      assert.ok(handlers, `${method.toUpperCase()} ${routePath} debe existir`);
      assert.ok(handlers.includes(validateJWT), 'validateJWT');
      assert.ok(handlers.includes(checkTokenVersion), 'checkTokenVersion');
    });
  }
}

// ── trinquete: rutas sin identidad, cada una con su motivo ──────────────────

// Middlewares que establecen quién llama (sesión, enlace firmado, token de
// consumidor, credencial de servicio). Por nombre: varios son fábricas.
const IDENTITY = new Set([
  'validateJWT', 'optionalJWT', 'checkTokenVersion', 'tokenIfPresent', 'requireSuperUser',
  'requireCompanyAuth', 'requireNotificationAuth', 'requireSessionFromDashboard', 'consumerTokenGate',
]);

// Archivos de rutas que index.js no monta: no son superficie de ataque hoy.
const UNMOUNTED = ['routes/cloudinary.js', 'routes/twilio.js', 'mysql/routes/location_manager.js'];

// public  = anónima por diseño (login, alta, monitoreo) o protegida por un
//           secreto en el propio enlace que el controlador valida.
// pending = protegida a medias: falta un cambio del cliente para cerrarla.
const PUBLIC_ROUTES = {
  'routes/admin.js POST /login': 'public: credenciales + MFA + bloqueo por intentos',
  'routes/admin.js POST /logout': 'pending: con token se verifica la firma; queda el cierre por uid del modal de varias compañías hasta que el dashboard mande el token',
  'routes/admin.js PATCH /update-password': 'public: enlace de reset firmado + MFA',
  'routes/admin.js POST /mfa/generate': 'public: mfaSetupToken (validateMfaEnrollment)',
  'routes/admin.js POST /mfa/verify': 'public: mfaSetupToken (validateMfaEnrollment)',
  'routes/auth.js POST /consumer-login-link': 'public: login sin contraseña de la app de consumidor (origen + rate limit)',
  'routes/auth.js POST /consumer-session': 'public: canje del enlace de login de consumidor',
  'routes/devitrakApp.js POST /new_acceptance': 'public: alta de términos desde la invitación; campos en lista blanca, no devuelve registros ajenos',
  'routes/devitrakApp.js PATCH /:id': 'public: solo ata si aceptación, email y cuenta coinciden, y nunca reasigna',
  'routes/health.js GET /health': 'public: monitoreo',
  'routes/health.js GET /ready': 'public: monitoreo',
  'routes/status.js GET /status': 'public: página de estado',
  'routes/status.js GET /health': 'public: monitoreo',
  'routes/registration.js POST /new': 'public: alta de compañía (validación + rate limit)',
  'routes/registration.js POST /add-company': 'public: alta de compañía (validación + rate limit)',
  'routes/registration.js POST /accept-invitation': 'public: enlace de invitación firmado',
  'routes/staff.js POST /__staff-search': 'public: email exacto, solo campos públicos (STAFF_SEARCH_PUBLIC_FIELDS)',
  'routes/staff.js GET /__staff-search': 'public: email exacto, solo campos públicos (STAFF_SEARCH_PUBLIC_FIELDS)',
  'routes/transaction.js GET /receipt': 'public: enlace de recibo firmado',
  'mysql/routes/company.js POST /industry': 'public: lista de sectores del formulario de alta',
  'mysql/routes/members.js POST /my-devices': 'public: portal de familia, ID de alumno + email del responsable, 10 intentos/15 min; pending: enlace por correo',
  'mysql/routes/school.js POST /consent/public/retrieve': 'public: token del enlace de consentimiento',
  'mysql/routes/school.js POST /consent/public/respond': 'public: token del enlace de consentimiento',
  'mysql/routes/school.js POST /event-invitations/confirm': 'public: enlace de invitación a evento de un solo uso',
  'mysql/routes/school.js POST /event-invitations/response': 'public: enlace de invitación a evento de un solo uso',
  'mysql/routes/staff.js POST /consulting-member': 'public: sin sesión válida solo da el staff_id de un email exacto (sessionIfValid)',
};

const routeFiles = () =>
  ['routes', 'mysql/routes']
    .flatMap((dir) => fs.readdirSync(path.join(root, dir)).map((f) => `${dir}/${f}`))
    .filter((f) => f.endsWith('.js') && !UNMOUNTED.includes(f));

const anonymousRoutes = () => {
  const found = [];
  for (const file of routeFiles()) {
    const router = require(path.join(root, file));
    for (const layer of router.stack.filter((l) => l.route)) {
      for (const method of Object.keys(layer.route.methods)) {
        const chain = effectiveChain(router, method, layer.route.path);
        if (!chain.some((fn) => IDENTITY.has(fn.name))) {
          found.push(`${file} ${method.toUpperCase()} ${layer.route.path}`);
        }
      }
    }
  }
  return found;
};

test('toda ruta montada sin identidad está en PUBLIC_ROUTES con su motivo', () => {
  const unexpected = anonymousRoutes().filter((r) => !(r in PUBLIC_ROUTES));
  assert.deepEqual(unexpected, [],
    'Ruta nueva sin validateJWT (u otro middleware de identidad). Protégela, o si de verdad ' +
      'es pública, añádela a PUBLIC_ROUTES con el motivo.');
});

test('PUBLIC_ROUTES no tiene entradas viejas (rutas que ya no existen o ya se cerraron)', () => {
  const current = new Set(anonymousRoutes());
  const stale = Object.keys(PUBLIC_ROUTES).filter((r) => !current.has(r));
  assert.deepEqual(stale, [], 'Saca de PUBLIC_ROUTES las rutas que ya exigen identidad o se retiraron.');
});

test('los archivos de rutas que se saltan siguen sin montarse en index.js', () => {
  const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  for (const file of UNMOUNTED) {
    const mod = file.replace(/\.js$/, '');
    assert.ok(!index.includes(`./${mod}"`) && !index.includes(`./${mod}'`), `${file} está montado: quítalo de UNMOUNTED`);
  }
});
