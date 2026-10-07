'use strict';

/**
 * Per-company branding for outbound notifications.
 *
 * Devitrak sends on behalf of its clients, but every template shipped
 * Devitrak's own logo and a `noreply@devitrak.com` from-name — so a Bridges PCS
 * guardian receiving a returned-device receipt for their child got an email
 * from a vendor they have never heard of. This module resolves, per message,
 * whose brand a given email should wear.
 *
 * Resolution is deliberately forgiving about *where* the company identifier
 * comes from. The notification payloads were written over several years by
 * different callers and disagree: some carry `company_id`, some a `company`
 * name string, some a nested `companyData`. Rather than rewrite forty frontend
 * call sites at once, the resolver reads all of the spellings and falls back to
 * Devitrak's own branding when it finds none — an unbranded email is a
 * cosmetic regression, a failed send is a lost receipt.
 */

const Company = require("../models/Company");
const logger = require("../helpers/logger");

/**
 * Devitrak's own mark for mail, from the Cloudinary assets the team published
 * (devitrak_login_jeki3x = icon, devitrak_name_wls6qd = wordmark). The source
 * files are SVG and WHITE (made for dark backgrounds), so they are never linked
 * raw: Gmail and desktop Outlook do not render SVG in mail, and white on the
 * white card is invisible. Cloudinary hands them over as PNG (.png extension),
 * rasterised at h_66 = 3x the 22 px they are drawn at (no upscaling blur) and
 * recoloured for the white card in the brand blue: wordmark #155eef, icon white -> #155eef (its
 * #8A9DAD stays). Changing the colour or size is a change to these URLs.
 */
const CLOUDINARY_EMAIL_BASE = "https://res.cloudinary.com/dpdzkhh07/image/upload";
const DEVITRAK_EMAIL_ICON_URL = `${CLOUDINARY_EMAIL_BASE}/h_66,e_replace_color:155eef:15:ffffff/v1791386367/devitrak_login_jeki3x.png`;
const DEVITRAK_EMAIL_NAME_URL = `${CLOUDINARY_EMAIL_BASE}/h_66,e_colorize:100,co_rgb:155eef/v1791386367/devitrak_name_wls6qd.png`;

/** The look every email had before this feature, and the fallback for all of them. */
const DEVITRAK_BRANDING = Object.freeze({
  companyId: null,
  displayName: "Devitrak Notifications",
  logoUrl: DEVITRAK_EMAIL_NAME_URL,
  // The mark left of the wordmark. Only Devitrak's own mail shows it, and
  // emailLayout's renderHeader takes it from here, never from client branding.
  iconUrl: DEVITRAK_EMAIL_ICON_URL,
  brandColor: "#155eef",
  replyTo: "",
  websiteUrl: "https://devitrak.net",
  footerNote: "",
  showPoweredBy: false,
  isDefault: true,
});

/** SendGrid only accepts verified senders, so the address never changes — only the name. */
const SENDER_ADDRESS = "noreply@devitrak.com";

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const CACHE_TTL_MS = 5 * 60 * 1000;
const brandingCache = new Map();

const isBlank = (value) => value === null || value === undefined || String(value).trim() === "";

const trimmed = (value) => (isBlank(value) ? "" : String(value).trim());

/**
 * White or near-black, whichever stays legible on `hexColor`.
 *
 * A client is free to pick a pale yellow as their brand colour, and white
 * button text on it is unreadable. Uses the WCAG relative-luminance threshold
 * rather than a naive average so mid-tone greens and reds land correctly.
 */
const readableTextOn = (hexColor) => {
  const hex = trimmed(hexColor).replace("#", "");
  if (hex.length !== 3 && hex.length !== 6) return "#ffffff";
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((character) => character + character)
          .join("")
      : hex;
  const channel = (offset) => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.55 ? "#101828" : "#ffffff";
};

const normalizeColor = (value) => {
  const candidate = trimmed(value);
  return HEX_COLOR.test(candidate) ? candidate : "";
};

/**
 * RFC 5322 display-name for the From header.
 *
 * Company names are client-editable free text and reach here unfiltered. A
 * newline would let a name inject a second header outright; a comma or angle
 * bracket would merely corrupt the address list. Control characters are
 * stripped, then the whole name is quoted with `"` and `\` escaped.
 */
const formatSender = (displayName, address = SENDER_ADDRESS) => {
  const name = trimmed(displayName)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 78)
    .trim();
  if (!name) return address;
  const quoted = name.replace(/([\\"])/g, "\\$1");
  return `"${quoted}" <${address}>`;
};

/**
 * Build the branding object from a Company document.
 *
 * `email_branding.enabled` is the opt-in. Companies that never open the
 * settings page keep the exact Devitrak look they have today rather than
 * having their mail silently restyled the day this deploys.
 */
const normalizeBranding = (company) => {
  if (!company) return DEVITRAK_BRANDING;
  const settings = company.email_branding || {};
  if (settings.enabled !== true) return DEVITRAK_BRANDING;

  return {
    companyId: company._id ? String(company._id) : company.id ?? null,
    displayName:
      trimmed(settings.display_name) ||
      trimmed(company.company_name) ||
      DEVITRAK_BRANDING.displayName,
    logoUrl: trimmed(settings.logo_url) || trimmed(company.company_logo),
    brandColor: normalizeColor(settings.brand_color) || DEVITRAK_BRANDING.brandColor,
    replyTo: trimmed(settings.reply_to) || trimmed(company.main_email),
    websiteUrl: trimmed(company.website) === "unknown" ? "" : trimmed(company.website),
    footerNote: trimmed(settings.footer_note),
    // Attribution stays on unless the client explicitly turns it off, so the
    // default for a newly branded company is co-branded rather than white-label.
    showPoweredBy: settings.show_powered_by !== false,
    isDefault: false,
  };
};

/**
 * Every spelling of "which company is this" that the existing payloads use.
 * Returns `{ id }` or `{ name }` — id wins when both are present.
 */
const extractCompanyRef = (body = {}) => {
  const id =
    body.company_id ??
    body.companyId ??
    body.company_mongo_id ??
    body.companyData?.id ??
    body.companyData?._id ??
    (typeof body.company === "object" ? body.company?.id ?? body.company?._id : undefined);

  if (!isBlank(id) && /^[0-9a-f]{24}$/i.test(String(id).trim())) {
    return { id: String(id).trim() };
  }

  const name =
    (typeof body.company === "string" ? body.company : undefined) ??
    body.company_name ??
    body.companyName ??
    body.companyData?.company_name;

  if (!isBlank(name) && trimmed(name) !== "Devitrak") {
    return { name: trimmed(name) };
  }

  return {};
};

const cacheGet = (key) => {
  const hit = brandingCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    brandingCache.delete(key);
    return undefined;
  }
  return hit.value;
};

const cacheSet = (key, value) => {
  brandingCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
};

/**
 * Drop cached branding for a company. Called from the company update
 * controller so a client who changes their logo sees it on the next email
 * instead of waiting out the TTL — the settings page has a preview, and a
 * preview that disagrees with the mail people receive is worse than none.
 */
const invalidateBrandingCache = (companyIdOrName) => {
  if (isBlank(companyIdOrName)) {
    brandingCache.clear();
    return;
  }
  brandingCache.delete(`id:${String(companyIdOrName).trim()}`);
  brandingCache.delete(`name:${String(companyIdOrName).trim().toLowerCase()}`);
};

/**
 * Resolve the branding for one outbound message.
 *
 * Never throws and never rejects: a Mongo hiccup degrades the email to
 * Devitrak's branding rather than dropping a return receipt on the floor.
 *
 * @param {object} body                Request payload for the notification.
 * @param {object} [deps]
 * @param {object}   [deps.request]    Express request, for the x-company-id header fallback.
 * @param {Function} [deps.findById]   Injectable for tests.
 * @param {Function} [deps.findByName] Injectable for tests.
 * @returns {Promise<object>} A branding object; `isDefault` is true for Devitrak's own.
 */
const resolveBranding = async (
  body = {},
  {
    request,
    findById = (id) => Company.findById(id).lean(),
    findByName = (name) => Company.findOne({ company_name: name }).lean(),
  } = {}
) => {
  // An explicit branding object short-circuits the lookup. Used by the
  // settings-page preview endpoint, which has to render branding that is not
  // saved yet.
  if (body && typeof body.branding === "object" && body.branding !== null) {
    return { ...DEVITRAK_BRANDING, ...body.branding, isDefault: false };
  }

  // Over HTTP, whose brand an email wears comes from the verified session and
  // from nothing else.
  //
  // `x-company-id` and any company named in the payload are both client-supplied:
  // trusting either would let a caller send mail dressed as someone else's
  // school. middlewares/notificationAuth.js confirms the caller actually has an
  // employee record in the company they claim and leaves the answer on the
  // request; only that is honoured here. A caller with no session gets Devitrak's
  // own branding — which is exactly what every caller got before this feature, so
  // nothing regresses.
  //
  // Direct calls with no request (unit tests, any future in-process caller) keep
  // reading the payload, since there is no session to consult and no attacker.
  const reference = request
    ? (request.verifiedCompanyId ? { id: String(request.verifiedCompanyId) } : {})
    : extractCompanyRef(body);

  const key = reference.id
    ? `id:${reference.id}`
    : reference.name
    ? `name:${reference.name.toLowerCase()}`
    : null;
  if (!key) return DEVITRAK_BRANDING;

  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const company = reference.id
      ? await findById(reference.id)
      : await findByName(reference.name);
    const branding = normalizeBranding(company);
    cacheSet(key, branding);
    return branding;
  } catch (error) {
    logger.error("resolveBranding: falling back to Devitrak branding", {
      error: error.message,
      reference,
    });
    return DEVITRAK_BRANDING;
  }
};

/**
 * Stamp the client's identity onto an already-built message.
 *
 * The envelope address stays `noreply@devitrak.com` — it is the sender SendGrid
 * has verified and the domain that holds the SPF/DKIM records, and swapping it
 * for a client domain would land the mail in spam. What changes is what the
 * recipient actually reads: the from-name, and a Reply-To that reaches the
 * school rather than a mailbox nobody watches.
 *
 * Accepts an array as well as a single message: the document-signing builders
 * return two messages (assigner and signer) for sgMail to send in one call.
 */
const applyBrandedEnvelope = (message, branding = DEVITRAK_BRANDING) => {
  if (!message || branding.isDefault) return message;
  if (Array.isArray(message)) {
    return message.map((entry) => applyBrandedEnvelope(entry, branding));
  }
  const branded = { ...message, from: formatSender(branding.displayName) };
  if (!isBlank(branding.replyTo)) branded.replyTo = trimmed(branding.replyTo);
  return branded;
};

module.exports = {
  DEVITRAK_BRANDING,
  DEVITRAK_EMAIL_ICON_URL,
  DEVITRAK_EMAIL_NAME_URL,
  SENDER_ADDRESS,
  resolveBranding,
  normalizeBranding,
  extractCompanyRef,
  applyBrandedEnvelope,
  invalidateBrandingCache,
  formatSender,
  readableTextOn,
  normalizeColor,
};
