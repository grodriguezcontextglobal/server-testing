/* eslint-disable no-console */
/**
 * Provision the Bridges Public Charter School demo environment end to end.
 *
 *   1. connect using the SAME env vars the app uses, so the demo can never be
 *      pointed somewhere the app itself couldn't reach
 *   2. refuse to run against anything that looks like a shared/production
 *      database (see the guard below — this is the important part)
 *   3. apply the school migrations idempotently
 *   4. check the reference data the seed depends on
 *   5. run seed-bridges-demo.js
 *   6. verify the result, including the consent states the demo is built on
 *
 * Idempotent: safe to re-run to restore the demo before a pitch.
 *
 *   DEMO_CONFIRM_DATABASE=<db name> node seed/provision-bridges-demo.js
 *
 * Local example:
 *   PLANETSCALE_DATABASE_HOST=127.0.0.1 PLANETSCALE_DATABASE_USERNAME=root \
 *   PLANETSCALE_DATABASE_PASSWORD= PLANETSCALE_DATABASE_NAME=devitrak_bridges \
 *   PLANETSCALE_DATABASE_SSL=false MONGO_DB=devitrak_bridges \
 *   DEMO_CONFIRM_DATABASE=devitrak_bridges node seed/provision-bridges-demo.js
 */
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");
const { MongoClient } = require("mongodb");
const { execFileSync } = require("child_process");

const SCHOOL_NAME = "Bridges Public Charter School";

/* ------------------------------------------------------------ connection */

// Mirrors mysql/database/config.js so the demo target is defined exactly the
// way the running app defines its own — no second, drifting convention.
const SQL = {
  host: process.env.PLANETSCALE_DATABASE_HOST || process.env.MYSQL_HOST || "127.0.0.1",
  user: process.env.PLANETSCALE_DATABASE_USERNAME || process.env.MYSQL_USER || "root",
  password: process.env.PLANETSCALE_DATABASE_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "",
  database: process.env.PLANETSCALE_DATABASE_NAME || process.env.MYSQL_DB || "devitrak_bridges",
  ...(String(process.env.PLANETSCALE_DATABASE_SSL) === "false"
    ? {}
    : { ssl: { rejectUnauthorized: true } }),
  multipleStatements: true,
};
const MONGO_URI = process.env.DB_CNN || process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const MONGO_DB = process.env.MONGO_DB || "devitrak_bridges";

const say = (m) => console.log(m);
const step = (m) => console.log(`\n── ${m} ${"─".repeat(Math.max(0, 58 - m.length))}`);

/* ----------------------------------------------------------------- guard */

/**
 * Refuse to touch a database that isn't a dedicated demo target.
 *
 * The demo writes ~370 fabricated students, their guardians and their consent
 * records. Those must never land in a database that also holds real customers:
 * the point of a separate environment is that fake minors and forged-looking
 * consent trails can't be confused with real ones, and can be dropped wholesale
 * afterwards.
 *
 * Two independent checks, because a stale .env is the likeliest way this goes
 * wrong and one guard is not enough:
 *
 *   1. the operator must name the target database explicitly, and it must match
 *      what the connection actually resolved to
 *   2. the database must not already contain tenants other than this demo
 *
 * Set DEMO_ALLOW_SHARED=1 only if you have genuinely decided to seed alongside
 * other tenants; it is deliberately not the default.
 */
const assertSafeTarget = async (conn) => {
  const confirm = process.env.DEMO_CONFIRM_DATABASE;
  if (!confirm) {
    throw new Error(
      "Refusing to run: set DEMO_CONFIRM_DATABASE to the database you intend to " +
      `provision. This connection resolved to "${SQL.database}" on ${SQL.host}.`
    );
  }
  const [[{ db }]] = await conn.query("SELECT DATABASE() AS db");
  if (confirm !== db) {
    throw new Error(
      `Refusing to run: DEMO_CONFIRM_DATABASE="${confirm}" but the connection is ` +
      `on "${db}" (${SQL.host}). Fix the env before continuing.`
    );
  }

  const [companies] = await conn.query(
    "SELECT company_name FROM company_info WHERE company_name <> ?", [SCHOOL_NAME]);
  if (companies.length && process.env.DEMO_ALLOW_SHARED !== "1") {
    throw new Error(
      `Refusing to run: "${db}" already holds ${companies.length} other tenant(s) — ` +
      `${companies.slice(0, 3).map((c) => c.company_name).join(", ")}` +
      `${companies.length > 3 ? ", …" : ""}. This looks like a shared or production ` +
      "database. Provision a dedicated one, or set DEMO_ALLOW_SHARED=1 if seeding " +
      "alongside real tenants is genuinely what you want."
    );
  }
  say(`  target: ${db} @ ${SQL.host}  ·  mongo: ${MONGO_DB}`);
  say(`  other tenants present: ${companies.length}${companies.length ? " (DEMO_ALLOW_SHARED=1)" : ""}`);
};

/* ------------------------------------------------------------ migrations */

const columnExists = async (conn, table, column) => {
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]);
  return n > 0;
};
const tableExists = async (conn, table) => {
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
  return n > 0;
};

const runMigration = async (conn, file) => {
  const full = path.join(__dirname, "..", "mysql", "migrations", file);
  if (!fs.existsSync(full)) throw new Error(`migration not found: ${file}`);
  await conn.query(fs.readFileSync(full, "utf8"));
};

/**
 * The repo has no migration runner — migrations are applied by hand — so each
 * step is gated on the state it would create. That keeps this re-runnable and
 * lets it bring a partially-migrated database the rest of the way.
 */
const applySchoolMigrations = async (conn) => {
  const plan = [
    { file: "add_school_consent.sql", done: () => tableExists(conn, "school_consent") },
    { file: "add_school_guardians.sql", done: () => tableExists(conn, "guardians") },
    { file: "add_company_school_settings.sql", done: () => tableExists(conn, "company_school_settings") },
    { file: "add_school_consent_otc.sql", done: () => columnExists(conn, "school_consent", "status") },
    { file: "add_consent_document_id_to_school_settings.sql", done: () => columnExists(conn, "company_school_settings", "consent_document_id") },
    { file: "add_school_consent_otc_hash.sql", done: () => columnExists(conn, "school_consent", "otc_hash") },
  ];
  for (const m of plan) {
    if (await m.done()) { say(`  • ${m.file} already applied`); continue; }
    await runMigration(conn, m.file);
    say(`  ✓ ${m.file}`);
  }

  // add_dob_and_coppa_settings.sql bundles a members_info ALTER with the
  // settings columns, so it can't be applied wholesale against a database where
  // date_of_birth already exists. Apply each half on its own terms.
  if (!(await columnExists(conn, "members_info", "date_of_birth"))) {
    await conn.query("ALTER TABLE members_info ADD COLUMN date_of_birth DATE DEFAULT NULL");
    say("  ✓ members_info.date_of_birth");
  } else say("  • members_info.date_of_birth already present");

  if (!(await columnExists(conn, "company_school_settings", "enforce_under_13_consent"))) {
    await conn.query(
      `ALTER TABLE company_school_settings
         ADD COLUMN enforce_under_13_consent TINYINT(1) NOT NULL DEFAULT 0,
         ADD COLUMN required_consent_policy_version VARCHAR(32) DEFAULT NULL`);
    say("  ✓ company_school_settings COPPA columns");
  } else say("  • company_school_settings COPPA columns already present");
};

/* ------------------------------------------------------------ main flow */

(async () => {
  const conn = await mysql.createConnection(SQL);

  step("Safety check");
  await assertSafeTarget(conn);

  step("Base schema");
  const base = ["company_info", "members_info", "item_inv", "locations", "roles",
    "company_staff", "staff_member", "member_assigned_device_lease", "lease_info"];
  const missingBase = [];
  for (const t of base) if (!(await tableExists(conn, t))) missingBase.push(t);
  if (missingBase.length) {
    throw new Error(
      `Missing core tables: ${missingBase.join(", ")}. This database has not been ` +
      "initialised from the application schema — import that first (a structure-only " +
      "dump of an existing environment is the quickest route).");
  }
  say(`  ✓ all ${base.length} core tables present`);

  step("School migrations");
  await applySchoolMigrations(conn);

  step("Reference data");
  const [[{ n: roleCount }]] = await conn.query("SELECT COUNT(*) AS n FROM roles");
  if (roleCount === 0) {
    throw new Error(
      "The roles table is empty. Import roles/permissions/role_permissions before " +
      "seeding — company_staff joins roles by role_level, so staff would get no " +
      "role and every permission-gated screen would render blank.");
  }
  const [[{ n: permCount }]] = await conn.query("SELECT COUNT(*) AS n FROM role_permissions");
  say(`  ✓ ${roleCount} roles · ${permCount} role_permissions`);

  await conn.end();

  step("Seeding the demo tenant");
  // Run the seed as its own process so it uses exactly the connection handling
  // it was written and tested against, rather than a second code path here.
  execFileSync(process.execPath, [path.join(__dirname, "seed-bridges-demo.js")], {
    stdio: "inherit",
    env: {
      ...process.env,
      MYSQL_HOST: SQL.host,
      MYSQL_USER: SQL.user,
      MYSQL_PASSWORD: SQL.password,
      MYSQL_DB: SQL.database,
      MONGO_URI,
      MONGO_DB,
    },
  });

  step("Verifying");
  const verify = await mysql.createConnection(SQL);
  const { deriveConsentState } = require("../mysql/controllers/school");
  const q = async (s, p = []) => (await verify.query(s, p))[0];

  const [company] = await q(
    "SELECT company_id, industry FROM company_info WHERE company_name = ?", [SCHOOL_NAME]);
  if (!company) throw new Error("Seed did not create the company row.");
  const CID = company.company_id;
  if (company.industry !== "Education") {
    throw new Error(`industry is "${company.industry}", must be exactly "Education".`);
  }

  const [{ n: students }] = await q(
    "SELECT COUNT(*) AS n FROM members_info WHERE company_id = ?", [String(CID)]);
  const [{ n: items }] = await q(
    "SELECT COUNT(*) AS n FROM item_inv WHERE company_id = ?", [String(CID)]);
  const [{ n: out }] = await q(
    "SELECT COUNT(*) AS n FROM member_assigned_device_lease WHERE company_id = ? AND returned = 0",
    [String(CID)]);
  const [{ n: u13 }] = await q(
    `SELECT COUNT(*) AS n FROM members_info
      WHERE company_id = ? AND TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) < 13`,
    [String(CID)]);

  const [settings] = await q(
    "SELECT * FROM company_school_settings WHERE company_id = ?", [CID]);
  const required = settings?.required_consent_policy_version ?? null;
  const members = await q("SELECT member_id FROM members_info WHERE company_id = ?", [String(CID)]);
  const rows = await q(
    `SELECT member_id, policy_version, status, otc_expires_at, requested_at,
            responded_at, created_at
       FROM school_consent WHERE company_id = ? AND policy_type = 'AUP'`, [CID]);
  const byMember = new Map();
  rows.forEach((r) => {
    const l = byMember.get(r.member_id);
    if (l) l.push(r); else byMember.set(r.member_id, [r]);
  });
  const counts = { agreed: 0, stale: 0, pending: 0, expired: 0, refused: 0, missing: 0 };
  const now = new Date();
  members.forEach((m) => { counts[deriveConsentState(byMember.get(m.member_id), required, now)] += 1; });
  const coverage = Math.round((counts.agreed / (students || 1)) * 100);

  const mongo = await MongoClient.connect(MONGO_URI);
  const mdb = mongo.db(MONGO_DB);
  const events = await mdb.collection("events").countDocuments({ company: SCHOOL_NAME });
  const companyDoc = await mdb.collection("companies").findOne({ company_name: SCHOOL_NAME });
  await mongo.close();

  const problems = [];
  if (students < 300) problems.push(`only ${students} students seeded`);
  if (u13 !== students) problems.push(`${students - u13} students are not under 13`);
  if (!companyDoc) problems.push("Mongo company document missing");
  if (companyDoc && companyDoc.industry !== "Education") problems.push("Mongo industry is not 'Education'");
  if (events < 10) problems.push(`only ${events} events`);
  if (coverage < 60 || coverage >= 100) problems.push(`consent coverage ${coverage}% is outside the amber band`);
  if (Object.values(counts).some((v) => v === 0)) {
    problems.push(`not every consent state is represented: ${JSON.stringify(counts)}`);
  }
  if (await columnExists(verify, "school_consent", "otc")) {
    problems.push("school_consent.otc (clear-text) still exists");
  }

  say(`  company_id ${CID} · ${students} students (${u13} under 13) · ${items} items · ${out} devices out`);
  say(`  events ${events} · staff ${companyDoc?.employees?.length ?? 0}`);
  say(`  consent ${JSON.stringify(counts)} · coverage ${coverage}%`);
  await verify.end();

  if (problems.length) {
    console.error("\n✗ PROVISIONING INCOMPLETE:");
    problems.forEach((p) => console.error(`   - ${p}`));
    process.exit(1);
  }

  say(`
──────────────────────────────────────────────
 Bridges demo environment ready
   MySQL : ${SQL.database} @ ${SQL.host}
   Mongo : ${MONGO_DB}
   login : head@bridgespcs.org / DemoPass123!
──────────────────────────────────────────────`);
})().catch((e) => {
  console.error(`\nPROVISIONING FAILED: ${e.message}`);
  process.exit(1);
});
