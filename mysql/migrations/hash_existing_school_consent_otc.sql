-- Backfill: replace plaintext OTCs in school_consent with their SHA-256 hash.
--
-- Context: the OTC is a bearer credential. Whoever holds it can read a
-- student's name, grade, date of birth and guardian contact details, and can
-- submit a consent decision as that guardian. It was being stored in plaintext,
-- so read access to this one table was enough to impersonate every pending
-- guardian. The application now stores only the hash and emails the plaintext.
--
-- WHY THIS DOES NOT BREAK LINKS ALREADY IN GUARDIANS' INBOXES:
-- the email contains the plaintext code. After this runs, the row holds
-- SHA256(plaintext). When the guardian clicks, the app hashes what it received
-- and matches the stored value. Same code, same row — the link keeps working.
--
-- IDEMPOTENT: generateOtc() emits 43-char base64url; SHA-256 hex is always 64.
-- The length guard means re-running this cannot double-hash a row (which WOULD
-- break the link, since SHA256(SHA256(x)) matches nothing the guardian holds).
--
-- ORDERING: safe to run before or after the code deploy. The read paths accept
-- both the hash and the plaintext during the transition precisely so this is
-- not a coordinated release. Run it, confirm no "legacy plaintext OTC matched"
-- warnings appear in the logs for a full expiry window (7 days), then the
-- plaintext fallback in publicRetrieveConsent / publicRespondConsent can go.

-- COLUMN NAME: the column was RENAMED `otc` -> `otc_hash` alongside this change.
-- Because it was a rename and not a new column, the existing plaintext values
-- moved with it — they are sitting in `otc_hash` right now, unhashed. That is
-- what this backfill converts in place.

-- Check what will change before changing it.
-- SELECT COUNT(*) AS to_hash FROM school_consent
--  WHERE otc_hash IS NOT NULL AND CHAR_LENGTH(otc_hash) <> 64;

UPDATE school_consent
   SET otc_hash = SHA2(otc_hash, 256)
 WHERE otc_hash IS NOT NULL
   AND CHAR_LENGTH(otc_hash) <> 64;

-- Verify: this must return 0 rows afterwards.
-- SELECT COUNT(*) AS still_plaintext FROM school_consent
--  WHERE otc_hash IS NOT NULL AND CHAR_LENGTH(otc_hash) <> 64;

-- NOTE for Vitess/PlanetScale: an unqualified UPDATE may be rejected depending
-- on the keyspace's settings. If it is, scope it by primary key in batches, e.g.
--   UPDATE school_consent SET otc_hash = SHA2(otc_hash, 256)
--    WHERE id IN (...) AND CHAR_LENGTH(otc_hash) <> 64;
-- The length guard keeps each batch idempotent on its own.
