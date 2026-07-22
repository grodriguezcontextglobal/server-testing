const { logStaffActivity } = require("../controller/staffActivityLog");

// HTTP verb -> audit action (the StaffActivityLog schema suggests CREATE/UPDATE/DELETE/READ...).
const ACTION_BY_METHOD = {
  GET: "READ",
  POST: "READ",
  PUT: "UPDATE",
  PATCH: "UPDATE",
  DELETE: "DELETE",
};

/**
 * Audit middleware factory for endpoints that touch student PII (FERPA/COPPA).
 * Records WHO accessed WHAT, WHEN, and the OUTCOME through the durable
 * staff-activity log. Fully ADDITIVE: it logs on response `finish`, never blocks
 * or fails the request. Mount so it runs in the chain BEFORE the handler; the
 * `finish` listener reads req after auth middleware has populated req.uid.
 *
 * logFn is injectable for tests; production uses the real logStaffActivity.
 */
const createAuditPiiAccess = (logFn = logStaffActivity) => (targetModel, action) => (
  req,
  res,
  next
) => {
  res.on("finish", () => {
    const companyId =
      req.params?.company_id || req.body?.company_id || req.query?.company_id || null;
    // Only record authenticated touches of a known company (real PII access).
    if (!req.uid || !companyId) return;
    logFn({
      staff_member_id: req.uid, // AdminUser._id set by validateJWT
      company_id: String(companyId),
      action: action || ACTION_BY_METHOD[req.method] || req.method,
      target_model: targetModel || "SchoolPII",
      target_id:
        req.body && req.body.member_id !== undefined && req.body.member_id !== null
          ? String(req.body.member_id)
          : undefined,
      details: { route: `${req.baseUrl || ""}${req.path || ""}`, status: res.statusCode },
      ip_address: req.ip || "",
      device_info: typeof req.get === "function" ? req.get("user-agent") || "" : "",
    });
  });
  next();
};

const auditPiiAccess = createAuditPiiAccess();

module.exports = { auditPiiAccess, createAuditPiiAccess };
