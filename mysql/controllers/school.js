require("dotenv").config();
const crypto = require("crypto");
const getConnection = require("../database/config");
const connection = getConnection();

/**
 * School namespace — guardian consent lifecycle for Education companies.
 *
 * Covers the ten endpoints the admin dashboard actually calls. Gustavo's
 * FRONTEND_server_updates_2026-07.md §3 also specifies /school/dashboard,
 * /school/roster, /school/consent/record and /school/consent/status; nothing
 * in the frontend calls those, so they are deliberately not implemented here
 * rather than shipped untested.
 *
 * Consent is a one-time-code (OTC) flow: staff request consent, the guardian
 * receives a link carrying a random token, and the public respond endpoint
 * records the decision. Only the SHA-256 of the token is stored, so a database
 * leak can't be replayed into forged consents.
 */

const CONSENT_TTL_DAYS = Number(process.env.SCHOOL_CONSENT_TTL_DAYS || 14);
const DEFAULT_POLICY_TYPE = "AUP";
const DEFAULT_POLICY_VERSION = "1";

// Real mail is opt-in. The demo district's ~1,000 seeded guardians carry
// fabricated @example.com addresses, so sending for real by default would
// generate a thousand bounces against the sending domain's reputation.
const EMAIL_ENABLED = process.env.SCHOOL_CONSENT_EMAIL === "true";
const CONSENT_BASE_URL =
  process.env.SCHOOL_CONSENT_BASE_URL || "http://localhost:5522";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/* ------------------------------------------------------------------ pure */

/** Random, URL-safe one-time code handed to the guardian. */
const generateOtc = () => crypto.randomBytes(24).toString("hex");

/** Only the hash is persisted; the raw code lives in the emailed link. */
const hashOtc = (otc) =>
  crypto.createHash("sha256").update(String(otc)).digest("hex");

const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();

const buildConsentLink = (otc, baseUrl = CONSENT_BASE_URL) =>
  `${String(baseUrl).replace(/\/$/, "")}/school/consent/respond?otc=${otc}`;

/**
 * A stored row's effective status.
 *
 * Expiry is derived rather than swept by a cron: a pending request whose
 * expires_at has passed reads as "expired" the moment anyone looks at it.
 */
const deriveConsentStatus = (row, now = new Date()) => {
  if (!row) return "missing";
  if (row.status && row.status !== "pending") return row.status;
  if (row.expires_at && new Date(row.expires_at).getTime() < now.getTime()) {
    return "expired";
  }
  return "pending";
};

/** A guardian may still respond only while the request is live. */
const isMutable = (row, now = new Date()) =>
  deriveConsentStatus(row, now) === "pending";

const consentTextFor = (policyType, policyVersion, companyName) =>
  `${companyName} requests your consent for the ${policyType} policy ` +
  `(version ${policyVersion}). By agreeing you confirm you are the parent or ` +
  `legal guardian authorized to accept this policy on the student's behalf, ` +
  `and that you accept responsibility for district equipment issued to them.`;

/* ------------------------------------------------------------------ setup */

let tablesReady = null;

const ensureSchoolTables = () => {
  if (tablesReady) return tablesReady;

  tablesReady = (async () => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS school_guardians (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id VARCHAR(255) NOT NULL,
        first_name VARCHAR(255) NULL,
        last_name VARCHAR(255) NULL,
        email VARCHAR(255) NULL,
        phone_number VARCHAR(64) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_company_email (company_id, email),
        KEY idx_company (company_id)
      )`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS school_member_guardians (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id VARCHAR(255) NOT NULL,
        member_id BIGINT NOT NULL,
        guardian_id INT NOT NULL,
        relationship VARCHAR(64) NOT NULL DEFAULT 'guardian',
        is_primary TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_link (member_id, guardian_id),
        KEY idx_member (member_id)
      )`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS school_consents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id VARCHAR(255) NOT NULL,
        member_id BIGINT NOT NULL,
        guardian_id INT NULL,
        policy_type VARCHAR(64) NOT NULL DEFAULT 'AUP',
        policy_version VARCHAR(32) NOT NULL DEFAULT '1',
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        otc_hash CHAR(64) NULL,
        expires_at DATETIME NULL,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        responded_at DATETIME NULL,
        signer_name VARCHAR(255) NULL,
        signer_email VARCHAR(255) NULL,
        method VARCHAR(64) NOT NULL DEFAULT 'e-signature',
        consent_text TEXT NULL,
        KEY idx_member_policy (company_id, member_id, policy_type),
        KEY idx_otc (otc_hash)
      )`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS school_settings (
        company_id VARCHAR(255) NOT NULL PRIMARY KEY,
        enforce_member_consent TINYINT(1) NOT NULL DEFAULT 0,
        enforce_under_13 TINYINT(1) NOT NULL DEFAULT 0,
        required_consent_policy_version VARCHAR(32) NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`);
  })().catch((error) => {
    // Don't cache a failed bootstrap — the next request should retry.
    tablesReady = null;
    throw error;
  });

  return tablesReady;
};

/* ---------------------------------------------------------------- helpers */

const badRequest = (response, msg) => response.status(400).json({ ok: false, msg });

const settingsRowFor = async (companyId) => {
  const [rows] = await connection.query(
    "SELECT * FROM school_settings WHERE company_id = ?",
    [String(companyId)]
  );
  const row = rows[0];
  return {
    enforce_member_consent: Boolean(row?.enforce_member_consent),
    enforce: Boolean(row?.enforce_member_consent),
    enforce_under_13: Boolean(row?.enforce_under_13),
    required_consent_policy_version:
      row?.required_consent_policy_version ?? null,
  };
};

const memberInCompany = async (companyId, memberId) => {
  const [rows] = await connection.query(
    `SELECT member_id, first_name, last_name, grade, homeroom, minor,
            parent_guardian_first_name, parent_guardian_last_name,
            parent_guardian_email, parent_guardian_phone_number
       FROM members_info WHERE member_id = ? AND company_id = ?`,
    [memberId, String(companyId)]
  );
  return rows[0] || null;
};

const companyName = async (companyId) => {
  const [rows] = await connection.query(
    "SELECT company_name FROM company_info WHERE company_id = ?",
    [companyId]
  );
  return rows[0]?.company_name || "the school";
};

/**
 * Deliver the consent link. Falls back to logging so the flow is fully
 * exercisable without a mail server — the returned link is what the demo uses.
 */
const deliverConsentEmail = async ({ to, studentName, school, link }) => {
  if (!EMAIL_ENABLED) {
    console.log(
      `[school/consent] email disabled — link for ${to} (${studentName}): ${link}`
    );
    return { delivered: false, reason: "email_disabled" };
  }
  try {
    // Required lazily so a missing/renamed mailer can't take the route down.
    const mailer = require("../../helpers/nodeMailer/notifications");
    const send = mailer?.sendEmail || mailer?.default || mailer;
    if (typeof send !== "function") throw new Error("no mailer export");
    await send({
      to,
      subject: `${school}: consent needed for ${studentName}`,
      html: `<p>${school} needs your consent for <strong>${studentName}</strong>.</p>
             <p><a href="${link}">Review and respond</a></p>`,
    });
    return { delivered: true };
  } catch (error) {
    console.error("[school/consent] email send failed:", error.message);
    return { delivered: false, reason: error.message };
  }
};

/** The raw link is only ever exposed outside production. */
const withDebugLink = (payload, link) =>
  IS_PRODUCTION ? payload : { ...payload, consent_url: link };

/* --------------------------------------------------------------- settings */

const getSchoolSettings = async (request, response) => {
  try {
    await ensureSchoolTables();
    const { company_id } = request.body || {};
    if (!company_id) return badRequest(response, "company_id is required.");
    return response.status(200).json({
      ok: true,
      settings: await settingsRowFor(company_id),
    });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const updateConsentEnforcement = async (request, response) => {
  try {
    await ensureSchoolTables();
    const {
      company_id,
      enforce,
      enforce_under_13,
      required_consent_policy_version,
    } = request.body || {};
    if (!company_id) return badRequest(response, "company_id is required.");

    await connection.query(
      `INSERT INTO school_settings
         (company_id, enforce_member_consent, enforce_under_13, required_consent_policy_version)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enforce_member_consent = VALUES(enforce_member_consent),
         enforce_under_13 = VALUES(enforce_under_13),
         required_consent_policy_version = VALUES(required_consent_policy_version)`,
      [
        String(company_id),
        enforce ? 1 : 0,
        enforce_under_13 ? 1 : 0,
        required_consent_policy_version || null,
      ]
    );

    return response.status(200).json({
      ok: true,
      settings: await settingsRowFor(company_id),
    });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

/* -------------------------------------------------------------- guardians */

const listGuardians = async (request, response) => {
  try {
    await ensureSchoolTables();
    const { company_id, member_id } = request.body || {};
    if (!company_id || !member_id) {
      return badRequest(response, "company_id and member_id are required.");
    }

    const member = await memberInCompany(company_id, member_id);
    if (!member) {
      return response
        .status(404)
        .json({ ok: false, msg: "Member not found in this company." });
    }

    const [linked] = await connection.query(
      `SELECT g.id, g.first_name, g.last_name, g.email, g.phone_number,
              l.relationship, l.is_primary
         FROM school_member_guardians l
         JOIN school_guardians g ON g.id = l.guardian_id
        WHERE l.member_id = ? AND l.company_id = ?
        ORDER BY l.is_primary DESC, g.id ASC`,
      [member_id, String(company_id)]
    );

    const guardians = linked.map((g) => ({ ...g, source: "normalized" }));

    // The legacy primary guardian lives in columns on members_info. Surface it
    // as a synthetic row so a student who predates the normalized tables still
    // shows a guardian, but skip it when the same address is already linked.
    const embeddedEmail = normalizeEmail(member.parent_guardian_email);
    const alreadyLinked = guardians.some(
      (g) => normalizeEmail(g.email) === embeddedEmail && embeddedEmail
    );
    if (
      !alreadyLinked &&
      (member.parent_guardian_first_name || member.parent_guardian_email)
    ) {
      guardians.unshift({
        id: null,
        first_name: member.parent_guardian_first_name,
        last_name: member.parent_guardian_last_name,
        email: member.parent_guardian_email,
        phone_number: member.parent_guardian_phone_number,
        relationship: "guardian",
        is_primary: 1,
        source: "embedded",
      });
    }

    return response
      .status(200)
      .json({ ok: true, count: guardians.length, guardians });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const addGuardian = async (request, response) => {
  try {
    await ensureSchoolTables();
    const {
      company_id,
      member_id,
      guardian_id,
      first_name,
      last_name,
      email,
      phone_number,
      relationship = "guardian",
      is_primary = 1,
    } = request.body || {};

    if (!company_id || !member_id) {
      return badRequest(response, "company_id and member_id are required.");
    }
    if (!guardian_id && !first_name && !last_name && !email) {
      return badRequest(response, "A guardian name or email is required.");
    }

    const member = await memberInCompany(company_id, member_id);
    if (!member) {
      return response
        .status(404)
        .json({ ok: false, msg: "Member not found in this company." });
    }

    let resolvedGuardianId = guardian_id ? Number(guardian_id) : null;
    const normalizedEmail = email ? normalizeEmail(email) : null;

    if (!resolvedGuardianId) {
      // Guardians are shared per company: siblings resolve to one record, and
      // re-saving the same address updates rather than duplicating.
      const [existing] = normalizedEmail
        ? await connection.query(
            "SELECT id FROM school_guardians WHERE company_id = ? AND email = ?",
            [String(company_id), normalizedEmail]
          )
        : [[]];

      if (existing[0]) {
        resolvedGuardianId = existing[0].id;
        await connection.query(
          `UPDATE school_guardians
              SET first_name = COALESCE(?, first_name),
                  last_name = COALESCE(?, last_name),
                  phone_number = COALESCE(?, phone_number)
            WHERE id = ?`,
          [first_name || null, last_name || null, phone_number || null, resolvedGuardianId]
        );
      } else {
        const [inserted] = await connection.query(
          `INSERT INTO school_guardians
             (company_id, first_name, last_name, email, phone_number)
           VALUES (?, ?, ?, ?, ?)`,
          [
            String(company_id),
            first_name || null,
            last_name || null,
            normalizedEmail,
            phone_number || null,
          ]
        );
        resolvedGuardianId = inserted.insertId;
      }
    }

    await connection.query(
      `INSERT INTO school_member_guardians
         (company_id, member_id, guardian_id, relationship, is_primary)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         relationship = VALUES(relationship),
         is_primary = VALUES(is_primary)`,
      [String(company_id), member_id, resolvedGuardianId, relationship, is_primary ? 1 : 0]
    );

    // Keep the legacy embedded columns in step so the profile header, the
    // exports and the old queries don't disagree with the normalized tables.
    if (is_primary) {
      await connection.query(
        `UPDATE members_info
            SET parent_guardian_first_name = COALESCE(?, parent_guardian_first_name),
                parent_guardian_last_name = COALESCE(?, parent_guardian_last_name),
                parent_guardian_email = COALESCE(?, parent_guardian_email),
                parent_guardian_phone_number = COALESCE(?, parent_guardian_phone_number)
          WHERE member_id = ? AND company_id = ?`,
        [
          first_name || null,
          last_name || null,
          normalizedEmail,
          phone_number || null,
          member_id,
          String(company_id),
        ]
      );
    }

    return response
      .status(201)
      .json({ ok: true, guardian_id: resolvedGuardianId });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const searchGuardians = async (request, response) => {
  try {
    await ensureSchoolTables();
    const { company_id, email } = request.body || {};
    if (!company_id) return badRequest(response, "company_id is required.");

    const normalized = normalizeEmail(email);
    if (!normalized) {
      return response.status(200).json({ ok: true, count: 0, guardians: [] });
    }

    const [guardians] = await connection.query(
      `SELECT id, first_name, last_name, email, phone_number
         FROM school_guardians
        WHERE company_id = ? AND email LIKE ?
        LIMIT 25`,
      [String(company_id), `%${normalized}%`]
    );

    return response
      .status(200)
      .json({ ok: true, count: guardians.length, guardians });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

/* ---------------------------------------------------------------- consent */

const latestConsentRow = async (companyId, memberId, policyType) => {
  const [rows] = await connection.query(
    `SELECT * FROM school_consents
      WHERE company_id = ? AND member_id = ? AND policy_type = ?
      ORDER BY id DESC LIMIT 1`,
    [String(companyId), memberId, policyType]
  );
  return rows[0] || null;
};

const publicConsentShape = (row) => ({
  id: row.id,
  status: deriveConsentStatus(row),
  policy_type: row.policy_type,
  policy_version: row.policy_version,
  expires_at: row.expires_at,
  requested_at: row.requested_at,
  responded_at: row.responded_at,
  signer_name: row.signer_name,
  signer_email: row.signer_email,
  method: row.method,
  mutable: isMutable(row),
});

const getMemberConsent = async (request, response) => {
  try {
    await ensureSchoolTables();
    const {
      company_id,
      member_id,
      policy_type = DEFAULT_POLICY_TYPE,
    } = request.body || {};
    if (!company_id || !member_id) {
      return badRequest(response, "company_id and member_id are required.");
    }

    const row = await latestConsentRow(company_id, member_id, policy_type);

    // Deliberately terse when there is no record. The frontend's
    // resolveConsentRecord() falls back to the whole response body when
    // `consent` is null, so echoing required_consent_policy_version here would
    // make isPolicyStale() compare it against an absent policy_version and
    // report "stale" for a student who simply has no consent yet.
    if (!row) {
      return response.status(200).json({ ok: true, count: 0, consent: null });
    }

    const settings = await settingsRowFor(company_id);
    return response.status(200).json({
      ok: true,
      count: 1,
      consent: publicConsentShape(row),
      required_consent_policy_version:
        settings.required_consent_policy_version,
    });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

/**
 * Whether a stored consent satisfies the company's required policy version.
 * Mirrors the frontend's isPolicyStale so both sides agree on "stale".
 */
const isPolicyStale = (row, requiredVersion) => {
  if (!row || !requiredVersion) return false;
  return String(row.policy_version) !== String(requiredVersion);
};

/**
 * District-wide consent posture in one request.
 *
 * The readiness dashboard needs a status for every minor on the roster. Asking
 * /school/consent per student meant ~961 requests against the demo district —
 * enough to trip a production rate limiter, and all of it fired the moment
 * consent enforcement is switched on. This collapses it to a single query.
 *
 * Returns the fields Gustavo's §3.3 documents (total / consented /
 * missing_count / missing[]) plus a `statuses` map keyed by member_id, which is
 * what the dashboard renders chips from.
 */
const getConsentStatusSummary = async (request, response) => {
  try {
    await ensureSchoolTables();
    const {
      company_id,
      policy_type = DEFAULT_POLICY_TYPE,
      policy_version,
    } = request.body || {};
    if (!company_id) return badRequest(response, "company_id is required.");

    const settings = await settingsRowFor(company_id);
    const requiredVersion =
      policy_version ?? settings.required_consent_policy_version ?? null;

    // Same minor rule the profile and the dashboard use: derive from
    // date_of_birth, fall back to the legacy flag when there's no birthdate.
    const [rows] = await connection.query(
      `SELECT m.member_id, m.first_name, m.last_name, m.grade, m.date_of_birth,
              (m.date_of_birth IS NOT NULL
               AND TIMESTAMPDIFF(YEAR, m.date_of_birth, CURDATE()) < 13) AS under_13,
              c.status AS consent_status, c.policy_version, c.expires_at
         FROM members_info m
         LEFT JOIN (
           SELECT s.* FROM school_consents s
           JOIN (SELECT member_id, MAX(id) AS max_id
                   FROM school_consents
                  WHERE company_id = ? AND policy_type = ?
                  GROUP BY member_id) latest
             ON s.id = latest.max_id
         ) c ON c.member_id = m.member_id
        WHERE m.company_id = ?
          AND ((m.date_of_birth IS NOT NULL
                AND TIMESTAMPDIFF(YEAR, m.date_of_birth, CURDATE()) < 18)
            OR (m.date_of_birth IS NULL AND m.minor = 1))`,
      [String(company_id), policy_type, String(company_id)]
    );

    const statuses = {};
    const missing = [];
    let consented = 0;

    rows.forEach((row) => {
      const hasRecord = Boolean(row.consent_status);
      let status = "missing";

      if (hasRecord) {
        const derived = deriveConsentStatus({
          status: row.consent_status,
          expires_at: row.expires_at,
        });
        status =
          derived === "agreed" && isPolicyStale(row, requiredVersion)
            ? "stale"
            : derived;
      }

      statuses[row.member_id] = status;

      if (status === "agreed") {
        consented += 1;
      } else {
        missing.push({
          member_id: row.member_id,
          first_name: row.first_name,
          last_name: row.last_name,
          grade: row.grade,
          under_13: Boolean(row.under_13),
          status,
        });
      }
    });

    return response.status(200).json({
      ok: true,
      policy_type,
      policy_version: requiredVersion,
      total: rows.length,
      consented,
      missing_count: missing.length,
      missing,
      statuses,
    });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

/** Shared by request and resend: mint a code, store its hash, deliver the link. */
const issueConsentRequest = async ({
  companyId,
  memberId,
  member,
  guardianId,
  guardianEmail,
  policyType,
  policyVersion,
  existingId,
}) => {
  const otc = generateOtc();
  const expiresAt = new Date(
    Date.now() + CONSENT_TTL_DAYS * 24 * 60 * 60 * 1000
  );
  const school = await companyName(companyId);
  const studentName = `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim();
  const text = consentTextFor(policyType, policyVersion, school);

  let consentId = existingId;
  if (existingId) {
    await connection.query(
      `UPDATE school_consents
          SET otc_hash = ?, expires_at = ?, status = 'pending', guardian_id = ?,
              signer_email = ?, requested_at = CURRENT_TIMESTAMP,
              responded_at = NULL, signer_name = NULL, consent_text = ?
        WHERE id = ?`,
      [hashOtc(otc), expiresAt, guardianId, guardianEmail, text, existingId]
    );
  } else {
    const [inserted] = await connection.query(
      `INSERT INTO school_consents
         (company_id, member_id, guardian_id, policy_type, policy_version,
          status, otc_hash, expires_at, signer_email, consent_text)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [
        String(companyId),
        memberId,
        guardianId,
        policyType,
        policyVersion,
        hashOtc(otc),
        expiresAt,
        guardianEmail,
        text,
      ]
    );
    consentId = inserted.insertId;
  }

  const link = buildConsentLink(otc);
  const delivery = await deliverConsentEmail({
    to: guardianEmail,
    studentName,
    school,
    link,
  });

  return { consentId, otc, link, expiresAt, delivery };
};

/**
 * Resolve which guardian address a consent request should go to: an explicit
 * guardian_id, else the primary normalized link, else the legacy embedded
 * columns on members_info.
 */
const resolveGuardianForMember = async (companyId, memberId, member, guardianId) => {
  if (guardianId) {
    const [rows] = await connection.query(
      "SELECT id, email FROM school_guardians WHERE id = ? AND company_id = ?",
      [guardianId, String(companyId)]
    );
    if (rows[0]) return { id: rows[0].id, email: normalizeEmail(rows[0].email) };
  }

  const [linked] = await connection.query(
    `SELECT g.id, g.email FROM school_member_guardians l
       JOIN school_guardians g ON g.id = l.guardian_id
      WHERE l.member_id = ? AND l.company_id = ?
      ORDER BY l.is_primary DESC, g.id ASC LIMIT 1`,
    [memberId, String(companyId)]
  );
  if (linked[0]?.email) {
    return { id: linked[0].id, email: normalizeEmail(linked[0].email) };
  }

  return { id: null, email: normalizeEmail(member.parent_guardian_email) };
};

const requestConsent = async (request, response) => {
  try {
    await ensureSchoolTables();
    const {
      company_id,
      member_id,
      guardian_id,
      policy_type = DEFAULT_POLICY_TYPE,
      policy_version = DEFAULT_POLICY_VERSION,
    } = request.body || {};

    if (!company_id || !member_id) {
      return badRequest(response, "company_id and member_id are required.");
    }

    const member = await memberInCompany(company_id, member_id);
    if (!member) {
      return response
        .status(404)
        .json({ ok: false, msg: "Member not found in this company." });
    }

    const guardian = await resolveGuardianForMember(
      company_id,
      member_id,
      member,
      guardian_id
    );
    if (!guardian.email) {
      return response
        .status(422)
        .json({ ok: false, msg: "No guardian email on file for this student." });
    }

    const existing = await latestConsentRow(company_id, member_id, policy_type);
    const existingStatus = deriveConsentStatus(existing);

    if (existing && existingStatus === "agreed" &&
        existing.policy_version === policy_version) {
      return response.status(200).json({
        ok: true,
        consent_id: existing.id,
        status: "agreed",
        msg: "Consent already recorded for this policy version.",
      });
    }
    if (existing && existingStatus === "pending") {
      return response.status(409).json({
        ok: false,
        msg: "A consent request is already pending. Use resend instead.",
        consent_id: existing.id,
      });
    }

    const issued = await issueConsentRequest({
      companyId: company_id,
      memberId: member_id,
      member,
      guardianId: guardian.id,
      guardianEmail: guardian.email,
      policyType: policy_type,
      policyVersion: policy_version,
      existingId: null,
    });

    return response.status(201).json(
      withDebugLink(
        {
          ok: true,
          consent_id: issued.consentId,
          status: "pending",
          expires_at: issued.expiresAt,
          guardian_email: guardian.email,
          email_delivered: issued.delivery.delivered,
        },
        issued.link
      )
    );
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const resendConsent = async (request, response) => {
  try {
    await ensureSchoolTables();
    const {
      company_id,
      member_id,
      policy_type = DEFAULT_POLICY_TYPE,
      policy_version = DEFAULT_POLICY_VERSION,
    } = request.body || {};

    if (!company_id || !member_id) {
      return badRequest(response, "company_id and member_id are required.");
    }

    const member = await memberInCompany(company_id, member_id);
    if (!member) {
      return response
        .status(404)
        .json({ ok: false, msg: "Member not found in this company." });
    }

    const existing = await latestConsentRow(company_id, member_id, policy_type);
    if (!existing) {
      // The frontend maps this to "send a new one first".
      return response
        .status(404)
        .json({ ok: false, msg: "No consent request to resend." });
    }

    const status = deriveConsentStatus(existing);
    if (status === "agreed" || status === "refused") {
      return response
        .status(409)
        .json({ ok: false, msg: `Guardian already responded (${status}).` });
    }

    const guardian = await resolveGuardianForMember(
      company_id,
      member_id,
      member,
      existing.guardian_id
    );
    if (!guardian.email) {
      return response
        .status(422)
        .json({ ok: false, msg: "No guardian email on file for this student." });
    }

    const issued = await issueConsentRequest({
      companyId: company_id,
      memberId: member_id,
      member,
      guardianId: guardian.id,
      guardianEmail: guardian.email,
      policyType: policy_type,
      policyVersion: policy_version || existing.policy_version,
      existingId: existing.id,
    });

    return response.status(200).json(
      withDebugLink(
        {
          ok: true,
          consent_id: issued.consentId,
          status: "pending",
          expires_at: issued.expiresAt,
          guardian_email: guardian.email,
          email_delivered: issued.delivery.delivered,
        },
        issued.link
      )
    );
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

/* ----------------------------------------------------------------- public */

const consentRowByOtc = async (otc) => {
  const [rows] = await connection.query(
    "SELECT * FROM school_consents WHERE otc_hash = ? ORDER BY id DESC LIMIT 1",
    [hashOtc(otc)]
  );
  return rows[0] || null;
};

const publicRetrieveConsent = async (request, response) => {
  try {
    await ensureSchoolTables();
    const { otc } = request.body || {};
    if (!otc) return badRequest(response, "otc is required.");

    const row = await consentRowByOtc(otc);
    // 404 for an unknown code — never reveal whether it merely expired, so the
    // endpoint can't be used to probe which codes were ever valid.
    if (!row) {
      return response.status(404).json({ ok: false, msg: "Invalid consent link." });
    }

    const status = deriveConsentStatus(row);
    if (status === "expired") {
      return response
        .status(410)
        .json({ ok: false, msg: "This consent link has expired." });
    }

    const member = await memberInCompany(row.company_id, row.member_id);
    const [guardians] = row.guardian_id
      ? await connection.query(
          "SELECT first_name, last_name, email FROM school_guardians WHERE id = ?",
          [row.guardian_id]
        )
      : [[]];

    const guardian = guardians[0] || {
      first_name: member?.parent_guardian_first_name,
      last_name: member?.parent_guardian_last_name,
      email: row.signer_email,
    };

    return response.status(200).json({
      ok: true,
      consent: {
        ...publicConsentShape(row),
        consent_text: row.consent_text,
      },
      company: { name: await companyName(row.company_id) },
      guardian: {
        full_name: `${guardian.first_name ?? ""} ${guardian.last_name ?? ""}`.trim(),
        email: guardian.email,
      },
      student: {
        full_name: `${member?.first_name ?? ""} ${member?.last_name ?? ""}`.trim(),
        grade: member?.grade,
        homeroom: member?.homeroom,
      },
    });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const publicRespondConsent = async (request, response) => {
  try {
    await ensureSchoolTables();
    const { otc, decision, signer_name } = request.body || {};
    if (!otc) return badRequest(response, "otc is required.");
    if (!["agreed", "refused"].includes(decision)) {
      return badRequest(response, "decision must be 'agreed' or 'refused'.");
    }
    if (!String(signer_name ?? "").trim()) {
      return badRequest(response, "signer_name is required.");
    }

    const row = await consentRowByOtc(otc);
    if (!row) {
      return response.status(404).json({ ok: false, msg: "Invalid consent link." });
    }

    const status = deriveConsentStatus(row);
    if (status === "expired") {
      return response
        .status(410)
        .json({ ok: false, msg: "This consent link has expired." });
    }
    if (status === "agreed" || status === "refused") {
      // The frontend retries transient failures, so a repeat submit has to be
      // safe: report the decision already on file rather than overwriting it.
      return response.status(409).json({
        ok: false,
        msg: `This request was already ${status}.`,
        status,
      });
    }

    // The code is deliberately left in place. The response page retries
    // transient network failures, so a retry that lands after the write
    // succeeded has to still resolve to this row and get the 409 above —
    // clearing the hash would answer 404 "invalid link" to a guardian whose
    // consent was in fact recorded. The row's status is what makes the code
    // inert: retrieve returns it read-only, respond refuses to change it.
    await connection.query(
      `UPDATE school_consents
          SET status = ?, signer_name = ?, responded_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [decision, String(signer_name).trim(), row.id]
    );

    return response
      .status(200)
      .json({ ok: true, status: decision, consent_id: row.id });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  // pure helpers, exported for tests
  generateOtc,
  hashOtc,
  normalizeEmail,
  buildConsentLink,
  deriveConsentStatus,
  isMutable,
  isPolicyStale,
  ensureSchoolTables,
  // handlers
  getSchoolSettings,
  updateConsentEnforcement,
  listGuardians,
  addGuardian,
  searchGuardians,
  getMemberConsent,
  getConsentStatusSummary,
  requestConsent,
  resendConsent,
  publicRetrieveConsent,
  publicRespondConsent,
};
