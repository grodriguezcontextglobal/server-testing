/**
 * Phase 3 — Fail-closed pre-deploy audit (READ-ONLY).
 *
 * The category-scoped-roles branch makes scoped inventory roles FAIL-CLOSED:
 *   - location-scoped: inventory_location_manager (6), inventory_location_assistant (7)
 *   - category-scoped: category_manager (8), category_assistant (9)
 * A scoped role with ZERO assignment rows now sees NO inventory. In current
 * production (fail-OPEN) those same users see ALL inventory. This script finds
 * every active staff member who would flip from "sees everything" to "sees
 * nothing" on deploy, so they can be assigned scope (or reviewed) beforehand.
 *
 * Runs ONLY SELECTs. Safe to run against production.
 *
 * Usage (from repo root, with the target .env in place):
 *   node mysql/scripts/audit-scoped-roles-failclosed.js
 *
 * To point at production explicitly without touching .env:
 *   SQL_DATABASE_URL="mysql://user:pass@prod-host/dbname" node mysql/scripts/audit-scoped-roles-failclosed.js
 */
const getConnection = require("../database/config");

const SCOPED_LEVELS = [6, 7, 8, 9];

async function main() {
  const cn = getConnection();

  // ── 0. Identify the DB we actually connected to (dev vs prod safety) ──────
  const [[ident]] = await cn.execute(
    "SELECT DATABASE() AS db, @@hostname AS host, CURRENT_USER() AS usr, VERSION() AS version"
  );
  console.log("─".repeat(72));
  console.log("CONNECTED TO");
  console.log(`  database : ${ident.db}`);
  console.log(`  host     : ${ident.host}`);
  console.log(`  user     : ${ident.usr}`);
  console.log(`  version  : ${ident.version}`);
  console.log("─".repeat(72));
  console.log("⚠  Confirm the values above are PRODUCTION before trusting this audit.\n");

  // ── 1. Do the scoped roles even exist in this DB? ─────────────────────────
  const [roles] = await cn.execute(
    `SELECT role_level, role_type, id AS role_id
       FROM roles WHERE role_level IN (${SCOPED_LEVELS.join(",")})
      ORDER BY role_level`
  );
  console.log("1) Scoped roles defined in this DB:");
  if (roles.length === 0) {
    console.log("   (none) — no scoped roles exist here; no fail-closed regression possible.\n");
  } else {
    roles.forEach((r) => console.log(`   level ${r.role_level}  ${r.role_type}`));
    console.log("");
  }

  // ── 2. Active staff per scoped role (the population at all in scope) ───────
  const [counts] = await cn.execute(
    `SELECT r.role_level, r.role_type, COUNT(*) AS active_staff
       FROM company_staff cs
       JOIN roles r ON cs.role_id = r.id
      WHERE cs.is_active = 1 AND r.role_level IN (${SCOPED_LEVELS.join(",")})
      GROUP BY r.role_level, r.role_type
      ORDER BY r.role_level`
  );
  console.log("2) Active staff holding a scoped role:");
  if (counts.length === 0) console.log("   (none)\n");
  else {
    counts.forEach((c) =>
      console.log(`   level ${c.role_level}  ${c.role_type}: ${c.active_staff}`)
    );
    console.log("");
  }

  // ── 3. THE AT-RISK LIST: scoped role + zero assignments = fail-closed ─────
  // location roles (6,7) need staff_location_access rows; category roles (8,9)
  // need staff_category_access rows. Zero of the RELEVANT dimension = blind.
  const [atRisk] = await cn.execute(
    `SELECT cs.company_id,
            cs.staff_id,
            cs.id AS company_staff_id,
            r.role_level,
            r.role_type,
            CASE WHEN r.role_level IN (6,7) THEN 'location' ELSE 'category' END AS dimension,
            COUNT(DISTINCT sla.location_id) AS location_rows,
            COUNT(DISTINCT sca.category_id) AS category_rows
       FROM company_staff cs
       JOIN roles r ON cs.role_id = r.id
       LEFT JOIN staff_location_access sla ON sla.company_staff_id = cs.id
       LEFT JOIN staff_category_access sca ON sca.company_staff_id = cs.id
      WHERE cs.is_active = 1 AND r.role_level IN (${SCOPED_LEVELS.join(",")})
      GROUP BY cs.company_id, cs.staff_id, cs.id, r.role_level, r.role_type
     HAVING (r.role_level IN (6,7) AND COUNT(DISTINCT sla.location_id) = 0)
         OR (r.role_level IN (8,9) AND COUNT(DISTINCT sca.category_id) = 0)
      ORDER BY cs.company_id, r.role_level`
  );
  console.log("3) AT-RISK — active scoped staff with ZERO assignments in their dimension");
  console.log("   (today: see ALL inventory → after deploy: see NOTHING):");
  if (atRisk.length === 0) {
    console.log("   ✅ NONE. No fail-closed regression. Safe to deploy on this axis.\n");
  } else {
    console.log(`   ⚠  ${atRisk.length} affected:\n`);
    console.table(
      atRisk.map((a) => ({
        company_id: a.company_id,
        staff_id: a.staff_id,
        role: `${a.role_level} ${a.role_type}`,
        dimension: a.dimension,
        company_staff_id: a.company_staff_id,
      }))
    );
    console.log(
      "\n   Remediation before/at deploy: assign the proper scope rows (PUT /company-staff/scope)\n" +
        "   or reassign these users to a full-access role, so they keep the visibility they have today."
    );
  }

  await cn.end();
}

main().catch((err) => {
  console.error("AUDIT FAILED:", err.message);
  process.exit(1);
});
