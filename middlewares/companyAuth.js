'use strict';

/**
 * Access control for `/api/company/*` (the Mongo company namespace mounted from
 * `routes/company.js` — not `/api/db_company`, which is the MySQL one).
 *
 * WHY: of the 18 routes in that file, exactly one checks anything. Line 71
 * (`PATCH /update-company/:id`) carries validateJWT + checkTokenVersion +
 * authorizeMongoPermission. The other 17 answer to anyone who can reach the
 * host, and they are not read-only:
 *
 *   - `POST /provider-upload-document/:id` uploads the posted file to S3 under
 *     `providerCompany.creator`'s folder and pushes a record into that
 *     provider's `documents` array. Anonymous write to the bucket and to Mongo,
 *     for anyone who knows a ProviderCompany id. Its handler even reads
 *     `req.user?.id || "system"`, so the auth was intended and never wired.
 *   - `POST /new` creates a company. `POST /new_provider` and
 *     `PATCH /update_provider/:id` create and mutate provider companies.
 *   - `POST /companies` and `GET /provider-companies` list them.
 *
 * HOW, and why not just validateJWT: the client apps are not in this
 * workspace, so which of these 17 run before a session exists is not knowable
 * from here. Bolting validateJWT on and deploying is how
 * `POST /api/db_company/delete-bulk-items` spent three weeks answering 403 to a
 * real user flow in July. So this follows the pattern
 * `middlewares/notificationAuth.js` already established for the same problem in
 * `/api/nodemailer/*`:
 *
 *   `warn` (the default) logs every unauthenticated call and blocks NOTHING.
 *   An environment nobody configured must not start refusing traffic on its
 *   own, and the log is the evidence that says which routes are actually
 *   reachable before login.
 *
 *   `enforce` answers 401 to a caller with no valid session, except on
 *   PUBLIC_ROUTES. Set it deliberately, once a few days of warn logs are clean.
 *
 *   `off` disables the check entirely — rollback without touching code.
 *
 * READ THE LOGS BEFORE FLIPPING IT:
 *   Select-String -Path logs\*.log -Pattern "company: unauthenticated"
 * Every line carries the route, the origin and the IP. Anything legitimate in
 * there belongs in PUBLIC_ROUTES *before* enforce, not after.
 */

const jwt = require('jsonwebtoken');
const logger = require('../helpers/logger');

const MODE = String(process.env.COMPANY_AUTH_MODE || 'warn').toLowerCase();

/**
 * Routes exempt even under `enforce`, each with the reason it is exempt.
 *
 * Entries are matched literally, or by RegExp when the route takes a param —
 * this middleware runs from `router.use`, where `request.route` does not exist
 * yet, so the only thing available is the path itself.
 *
 * This list is SEEDED, not finished. The three below are named after flows that
 * cannot have a token yet, which is evidence but not proof. The warn logs are
 * what completes it.
 */
const PUBLIC_ROUTES = [
  [
    /^\/update-company\/register-process\/[^/]+$/,
    'company registration: the admin has no session until the process finishes',
  ],
  [
    '/consumer-signatures',
    'presumed consumer app (app.devitrak.net), whose attendees never sign in — confirm in the warn logs',
  ],
  [
    '/event-consumer-signatures',
    'presumed consumer app (app.devitrak.net), same as above — confirm in the warn logs',
  ],
];

const routePath = (request) => {
  // request.path inside a mounted router is relative to the mount point.
  const path = request.path || request.url || '';
  return path.split('?')[0].replace(/\/+$/, '') || '/';
};

const isPublicRoute = (request) => {
  const path = routePath(request);
  return PUBLIC_ROUTES.some(([matcher]) =>
    matcher instanceof RegExp ? matcher.test(path) : matcher === path
  );
};

/**
 * The session, or null. Never throws: a missing, malformed or expired token all
 * come back the same way, and deciding what that means is the caller's job.
 */
const readSession = (request) => {
  const token = request.header
    ? request.header('x-token')
    : request.headers?.['x-token'];
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.SECRET_JWT_SEED);
  } catch {
    return null;
  }
};

const requireCompanyAuth = (request, response, next) => {
  if (MODE === 'off' || isPublicRoute(request)) return next();

  const session = readSession(request);
  if (session) {
    // Recorded, not imposed: `req.user` is left alone so the routes that
    // already run validateJWT keep behaving exactly as they do today.
    request.companySession = session;
    return next();
  }

  const detail = {
    route: routePath(request),
    method: request.method,
    origin: request.header ? request.header('origin') : undefined,
    ip: request.ip,
    userAgent: request.header ? request.header('user-agent') : undefined,
  };

  if (MODE === 'enforce') {
    logger.warn('company: refused an unauthenticated request', detail);
    return response.status(401).json({
      ok: false,
      msg: 'Authentication is required for this endpoint.',
    });
  }

  // warn: this is the list to read before switching to enforce.
  logger.warn('company: unauthenticated request allowed (mode=warn)', detail);
  return next();
};

module.exports = {
  requireCompanyAuth,
  isPublicRoute,
  readSession,
  PUBLIC_ROUTES,
  MODE,
};
