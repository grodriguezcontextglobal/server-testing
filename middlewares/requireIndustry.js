const getConnection = require("../mysql/database/config");

/**
 * Case-insensitive membership test of a company's industry against an allowlist.
 * PURE + exported so the gate logic is unit-testable without a DB.
 */
const industryMatches = (industry, allowed = []) => {
  if (!industry) return false;
  const norm = String(industry).trim().toLowerCase();
  return allowed.some((a) => String(a).trim().toLowerCase() === norm);
};

/**
 * Gate a route to companies of a given industry, e.g. requireIndustry('Education').
 *
 * The vertical is derived from the AUTHENTICATED company's own `industry` column
 * (company_info.industry) — never from a request keyword — so it cannot be
 * spoofed by a non-Education tenant. Run AFTER validateJWT (needs the resolved
 * company_id; same precedence as authorizePermission: params → body → query).
 */
const requireIndustry = (...allowed) => async (req, res, next) => {
  try {
    const companyId = req.params?.company_id || req.body?.company_id || req.query?.company_id;
    if (!companyId) {
      return res.status(401).json({ ok: false, msg: "Unauthorized: missing company_id" });
    }

    const connection = getConnection();
    const [rows] = await connection.query(
      "SELECT industry FROM company_info WHERE company_id = ? LIMIT 1",
      [companyId]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, msg: "Company not found" });
    }
    if (!industryMatches(rows[0].industry, allowed)) {
      return res.status(403).json({
        ok: false,
        msg: `Forbidden: this feature is only available to ${allowed.join("/")} companies`,
      });
    }
    next();
  } catch (error) {
    return res.status(500).json({ ok: false, msg: "Industry check failed" });
  }
};

module.exports = { requireIndustry, industryMatches };
