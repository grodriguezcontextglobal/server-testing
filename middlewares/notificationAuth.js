'use strict';

/**
 * Access control for `/api/nodemailer/*`.
 *
 * The whole namespace has always been open: anyone who can reach the host can
 * POST to it and Devitrak will send the email. Per-company branding raised the
 * stakes, because `x-company-id` is a client-supplied header — an unauthenticated
 * caller could have had their message wear a customer's logo and sender name.
 *
 * Three things happen here, in increasing order of how much they can break:
 *
 * 1. `attachVerifiedCompany` — always on, never rejects. When a valid session
 *    token is present, it confirms the caller really belongs to the company
 *    they claim and records that on the request. branding.js trusts *only* this,
 *    never the raw header, so brand spoofing is closed regardless of the mode
 *    below. Callers with no token get Devitrak's own branding, which is exactly
 *    what they get today — so this costs no compatibility.
 *
 * 2. `notificationRateLimit` — always on. Generous for signed-in staff (an event
 *    check-in legitimately fires a burst of device emails), strict on the
 *    handful of routes that must stay reachable before login, since those are
 *    the spam and account-enumeration surface.
 *
 * 3. `requireNotificationAuth` — the actual lock. `enforce` answers 401 to a
 *    caller with no valid session, except on the four routes that run before a
 *    token can exist.
 *
 *    It defaults to `warn` instead, which logs those calls and blocks nothing.
 *    Not because warn is the goal — enforce is, and .env.example ships it — but
 *    because this is what an environment gets when nobody configured anything,
 *    and that environment should not start refusing traffic on its own. Two
 *    origins call this API: admin.devitrak.net (this repo, always authenticated)
 *    and app.devitrak.net, a consumer app whose source is not in this workspace,
 *    so which routes it uses is not knowable from here. If it sends anything
 *    outside PUBLIC_ROUTES, enforce stops that mail, and the failure is silent
 *    from its side — a 401 on a fire-and-forget notification looks like nothing
 *    at all. A day of warn logs is what tells you enforce is safe; set it
 *    deliberately once that list is clean. `off` disables the check entirely.
 */

const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { clientIpKey } = require("../helpers/rateLimitKey");
const AdminUser = require("../models/AdminUser");
const Company = require("../models/Company");
const logger = require("../helpers/logger");

/** off | warn | enforce — see the header comment. */
const MODE = String(process.env.NODEMAILER_AUTH_MODE || "warn").toLowerCase();

/**
 * Routes that must answer without a session token, and why. Each one runs
 * before the caller could possibly hold a token.
 */
const PUBLIC_ROUTES = new Map([
  ["/reset-admin-password", "forgot-password modal on the login page"],
  ["/forcing-revoking-active-session", "the user cannot sign in — that is the point"],
  ["/confirmation-account", "new consumer has no account yet"],
  ["/login-existing-consumer", "passwordless login link for consumers"],
  // app.devitrak.net nunca manda token: el consumidor firma los términos del
  // evento (devitrak/src/pages/documents/MainDocument.jsx) y este correo es el
  // comprobante. En enforce respondía 401 y el correo no salía, sin error visible.
  ["/terms-and-conditions-acceptance", "consumer app (app.devitrak.net) never sends a token"],
]);

/**
 * The public routes an ATTENDEE hits, as opposed to a staff member at a
 * keyboard. They cannot be limited per IP: at a venue every attendee is behind
 * the same wifi, so one public address covers the whole room, and a 10-per-15-
 * minutes budget locks out the eleventh person to walk in. The room is the
 * normal case, not the attack.
 *
 * They are limited per TARGET EMAIL instead, which is the thing the abuse
 * actually needs to repeat: the reason these routes are sensitive is that
 * hammering one address reveals whether it is registered, and that stays
 * blocked. Total volume from a single address is still capped by the app-wide
 * limiter in index.js (300 / 15 min per IP), so keying by email here does not
 * leave the routes open to a flood across many addresses.
 */
const CONSUMER_PUBLIC_ROUTES = new Set([
  "/confirmation-account",
  "/login-existing-consumer",
  "/terms-and-conditions-acceptance",
]);

const OBJECT_ID = /^[0-9a-f]{24}$/i;

const routePath = (request) => {
  // request.path inside a mounted router is relative to the mount point.
  const path = request.path || request.url || "";
  return path.split("?")[0].replace(/\/+$/, "") || "/";
};

const isPublicRoute = (request) => PUBLIC_ROUTES.has(routePath(request));

const isConsumerPublicRoute = (request) => CONSUMER_PUBLIC_ROUTES.has(routePath(request));

/**
 * Rate-limit key for the attendee routes: the address the mail would go to.
 * Both handlers read it from `body.consumer.email` (see
 * buildConfirmationLinkNewConsumerMessage / buildLoginLinkExistingConsumerMessage).
 *
 * Falls back to the IP when there is no usable address, so a malformed body
 * cannot buy an unlimited route — it just lands in the shared IP bucket.
 * express.json() runs in index.js before any router is mounted, so `body` is
 * already parsed by the time this runs.
 */
const consumerRateLimitKey = (request) => {
  const email = request.body?.consumer?.email;
  return typeof email === "string" && email.trim()
    ? `email:${email.trim().toLowerCase()}`
    : `ip:${clientIpKey(request)}`;
};

/**
 * Decode the session token without rejecting. Returns null for absent,
 * malformed, or expired tokens — deciding what to do about that is
 * requireNotificationAuth's job, not this one's.
 */
const readSession = (request) => {
  const token = request.header ? request.header("x-token") : request.headers?.["x-token"];
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.SECRET_JWT_SEED);
  } catch {
    return null;
  }
};

// uid -> email, and `${uid}:${companyId}` -> boolean. Both are stable for the
// life of a session and this runs on every outbound email, so the alternative
// is two Mongo reads per notification.
const MEMBERSHIP_TTL_MS = 5 * 60 * 1000;
const membershipCache = new Map();

const cached = async (key, produce) => {
  const hit = membershipCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await produce();
  membershipCache.set(key, { value, expiresAt: Date.now() + MEMBERSHIP_TTL_MS });
  return value;
};

const clearMembershipCache = () => membershipCache.clear();

/**
 * Confirm the caller belongs to the company named in `x-company-id`.
 *
 * Membership is the same question login asks — `Company.find({"employees.user":
 * email})` — so the two cannot disagree about who works where. A user who
 * belongs to several companies keeps switching between them; what they cannot
 * do is name a company they have no employee record in.
 */
const verifyCompanyMembership = async (
  uid,
  companyId,
  { findUser = (id) => AdminUser.findById(id).select("email").lean(),
    findCompany = (filter) => Company.exists(filter) } = {}
) => {
  if (!uid || !OBJECT_ID.test(String(companyId || ""))) return false;

  const email = await cached(`uid:${uid}`, async () => {
    const user = await findUser(uid);
    return user?.email ?? null;
  });
  if (!email) return false;

  return cached(`member:${uid}:${companyId}`, async () => {
    const exists = await findCompany({ _id: companyId, "employees.user": email });
    return Boolean(exists);
  });
};

/**
 * Records `request.notificationSession` and, when the claim checks out,
 * `request.verifiedCompanyId`. Never rejects: a Mongo failure here must not
 * cost somebody their return receipt, it should only cost the branding.
 */
const attachVerifiedCompany = (deps = {}) => async (request, _response, next) => {
  try {
    const session = readSession(request);
    request.notificationSession = session;
    if (!session) return next();

    const claimed = request.header
      ? request.header("x-company-id")
      : request.headers?.["x-company-id"];
    if (!claimed) return next();

    const belongs = await verifyCompanyMembership(session.uid, String(claimed).trim(), deps);
    if (belongs) {
      request.verifiedCompanyId = String(claimed).trim();
    } else {
      logger.warn("nodemailer: company claim rejected", {
        uid: session.uid,
        claimed: String(claimed).trim(),
        route: routePath(request),
      });
    }
  } catch (error) {
    logger.error("nodemailer: could not verify the company claim", { error: error.message });
  }
  return next();
};

/**
 * The lock. `warn` observes and lets everything through; `enforce` answers 401.
 * Public routes are exempt in both.
 */
const requireNotificationAuth = (request, response, next) => {
  if (MODE === "off" || isPublicRoute(request)) return next();
  if (request.notificationSession) return next();

  const detail = {
    route: routePath(request),
    origin: request.header ? request.header("origin") : undefined,
    ip: request.ip,
    userAgent: request.header ? request.header("user-agent") : undefined,
  };

  if (MODE === "enforce") {
    logger.warn("nodemailer: refused an unauthenticated notification", detail);
    return response.status(401).json({
      ok: false,
      msg: "Authentication is required to send this notification.",
    });
  }

  // warn: this is the list to read before switching to enforce.
  logger.warn("nodemailer: unauthenticated notification allowed (mode=warn)", detail);
  return next();
};

/**
 * Signed-in staff are counted per user, so one busy office does not share a
 * budget behind a single NAT address. Everyone else is counted per IP.
 */
const notificationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) =>
    request.notificationSession?.uid ? `uid:${request.notificationSession.uid}` : `ip:${clientIpKey(request)}`,
  message: { ok: false, msg: "Too many notification requests. Please try again shortly." },
});

/**
 * The pre-login routes a STAFF member reaches, one person at one keyboard, so
 * per-IP is the right key and ten in fifteen minutes is generous.
 */
const publicNotificationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => `ip:${clientIpKey(request)}`,
  message: { ok: false, msg: "Too many requests. Please try again shortly." },
});

/**
 * The attendee routes, keyed per target address — see CONSUMER_PUBLIC_ROUTES.
 * Five is tighter than the ten above because the budget is no longer shared:
 * one person asking for their own login link more than five times in fifteen
 * minutes is already past the point where another email helps them.
 */
const consumerNotificationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: consumerRateLimitKey,
  message: { ok: false, msg: "Too many requests for this email. Please try again shortly." },
});

/** Applies the strict limiter only to the routes that answer without a token. */
const publicRouteRateLimit = (request, response, next) => {
  if (isConsumerPublicRoute(request)) {
    return consumerNotificationRateLimit(request, response, next);
  }
  return isPublicRoute(request)
    ? publicNotificationRateLimit(request, response, next)
    : next();
};

module.exports = {
  MODE,
  PUBLIC_ROUTES,
  CONSUMER_PUBLIC_ROUTES,
  attachVerifiedCompany,
  requireNotificationAuth,
  notificationRateLimit,
  publicRouteRateLimit,
  verifyCompanyMembership,
  clearMembershipCache,
  isPublicRoute,
  isConsumerPublicRoute,
  consumerRateLimitKey,
  readSession,
};
