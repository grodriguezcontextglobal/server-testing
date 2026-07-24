/**
 * School-track schema audit (READ-ONLY). Verifies which school/member migrations
 * are actually applied in the connected DB — grounds the "close first" tasks.
 * Runs only information_schema reads. Safe against production.
 *   node mysql/scripts/audit-school-schema.js
 */
const getConnection = require("../database/config");

async function main() {
  const cn = getConnection();
  const [[id]] = await cn.execute("SELECT DATABASE() AS db, @@hostname AS host");
  console.log(`DB: ${id.db} @ ${id.host}\n`);

  const wantCols = {
    members_info: ["grade", "homeroom", "minor", "parent_guardian_first_name",
      "parent_guardian_last_name", "parent_guardian_email", "parent_guardian_phone_number"],
    member_assigned_device_lease: ["returned", "return_status", "condition_note",
      "returned_date", "expected_return_date", "assigned_date"],
  };

  for (const [table, cols] of Object.entries(wantCols)) {
    const [rows] = await cn.execute(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?`, [table]);
    const present = new Set(rows.map((r) => r.column_name || r.COLUMN_NAME));
    if (present.size === 0) { console.log(`TABLE ${table}: ❌ does not exist\n`); continue; }
    console.log(`TABLE ${table}:`);
    cols.forEach((c) => console.log(`   ${present.has(c) ? "✅" : "❌ MISSING"}  ${c}`));
    console.log("");
  }

  // View all_device_leases?
  const [[v]] = await cn.execute(
    `SELECT COUNT(*) AS n FROM information_schema.views
      WHERE table_schema = DATABASE() AND table_name = 'all_device_leases'`);
  console.log(`VIEW all_device_leases: ${v.n ? "✅ exists" : "❌ missing"}`);

  // member permissions seeded?
  const [perms] = await cn.execute(
    `SELECT action FROM permissions WHERE resource = 'member' ORDER BY action`);
  console.log(`permissions(resource=member): ${perms.length ? perms.map((p)=>p.action).join(", ") : "❌ none"}`);

  await cn.end();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
