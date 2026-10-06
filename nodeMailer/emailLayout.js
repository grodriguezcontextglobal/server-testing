'use strict';

/**
 * The one email chassis every Devitrak notification renders through.
 *
 * Before this file each of the ~45 templates in returningDeviceMessage.js
 * carried its own copy of the same 120-line <style> block, its own hardcoded
 * "Power by → Devitrak logo" header and its own footer. That is why Fredrik's
 * returned-device receipt could not be branded for Bridges PCS without also
 * editing forty-four other places, and why no two emails quite agreed on their
 * typography. The templates now describe only their *content* — a title, some
 * copy, a table, maybe a button — and this module renders the chrome.
 *
 * Rendering rules here are deliberately old-fashioned, because the people
 * reading these are on Outlook (Fredrik's forward is an Outlook print):
 *
 *   - layout is <table role="presentation">, never flexbox. Word-rendered
 *     Outlook ignores display:flex entirely, which is what collapsed the old
 *     header into the bare "Power by" line visible in the forwarded PDF.
 *   - every style is inline. <style> blocks survive only for the responsive
 *     media query, which Outlook ignores and everyone else honours.
 *   - 600px content width, the width every major client is tuned for. The old
 *     templates used 768px and clipped on mobile Gmail.
 *
 * All interpolated values pass through escapeHtml. The old templates dropped
 * raw payload strings into markup; branding is now client-editable, so an
 * apostrophe in a school's name — let alone a </td> — would otherwise rewrite
 * the message.
 */

const { DEVITRAK_BRANDING, readableTextOn } = require("./branding");

const CONTENT_WIDTH = 600;

const FONT_STACK =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const COLOR = {
  pageBackground: "#f7f7f4",
  cardBackground: "#ffffff",
  border: "#e4e7ec",
  heading: "#101828",
  body: "#475467",
  muted: "#98a2b3",
  tableHeaderBackground: "#f9fafb",
};

/**
 * The five characters that can break out of either an attribute value or a
 * text node. Ampersand goes first or it would double-escape the entities the
 * other replacements just introduced.
 */
const escapeHtml = (value) => {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

/**
 * Href sanitiser. A branding record or a payload can carry any string, and
 * `javascript:` in an <a href> is live in a few desktop clients and in every
 * "open in browser" webmail view. Anything that is not clearly http(s) or
 * mailto is dropped rather than rendered as a dead link.
 */
const safeUrl = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^(https?:|mailto:)/i.test(raw)) return escapeHtml(raw);
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return "";
  return escapeHtml(`https://${raw}`);
};

const isBlank = (value) => value === null || value === undefined || String(value).trim() === "";

/* ------------------------------------------------------------------ *
 * Content blocks
 *
 * Each helper returns a self-contained <tr> (or a run of them) for the
 * content table. Templates compose them in `blocks`.
 * ------------------------------------------------------------------ */

/** Body copy. Pass `html: true` only for strings this codebase built itself. */
const paragraph = (text, { html = false, muted = false } = {}) => {
  if (isBlank(text) && !html) return "";
  const content = html ? String(text ?? "") : escapeHtml(text);
  return `
        <tr>
          <td style="padding: 0 0 16px 0; font-family: ${FONT_STACK}; font-size: 15px; line-height: 24px; color: ${
    muted ? COLOR.muted : COLOR.body
  };">
            ${content}
          </td>
        </tr>`;
};

/**
 * The device/transaction grid. `columns` is [{ header, key, align, html }] and
 * `rows` is an array of plain objects — the shape every one of these templates
 * was already hand-rolling, minus the per-template <style>.
 *
 * Cell values are escaped. A column may set `html: true` to opt out, which the
 * contract templates need for their "View" links; the template is then
 * responsible for having built that markup out of escaped parts.
 */
const dataTable = ({ columns = [], rows = [] } = {}) => {
  if (columns.length === 0) return "";

  const headerCells = columns
    .map(
      (column) => `
                  <th align="${column.align || "left"}" style="padding: 10px 12px; border-bottom: 1px solid ${
        COLOR.border
      }; font-family: ${FONT_STACK}; font-size: 12px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; color: ${
        COLOR.muted
      };">${escapeHtml(column.header)}</th>`
    )
    .join("");

  const bodyRows = rows
    .map(
      (row) => `
                <tr>${columns
                  .map(
                    (column) => `
                  <td align="${column.align || "left"}" style="padding: 12px; border-bottom: 1px solid ${
                      COLOR.border
                    }; font-family: ${FONT_STACK}; font-size: 14px; line-height: 20px; color: ${
                      COLOR.heading
                    };">${column.html ? String(row?.[column.key] ?? "") : escapeHtml(row?.[column.key])}</td>`
                  )
                  .join("")}
                </tr>`
    )
    .join("");

  return `
        <tr>
          <td style="padding: 4px 0 20px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; border: 1px solid ${COLOR.border}; border-radius: 8px;">
              <thead>
                <tr style="background-color: ${COLOR.tableHeaderBackground};">${headerCells}
                </tr>
              </thead>
              <tbody>${bodyRows}
              </tbody>
            </table>
          </td>
        </tr>`;
};

/**
 * A section title inside the body — "Assigned device information", "What's
 * next". The originals used <h2>/<h3> for these; rendering them as plain
 * paragraphs flattened the hierarchy and made a summary table look like it
 * belonged to the sentence above it.
 */
const sectionHeading = (text) => {
  if (isBlank(text)) return "";
  return `
        <tr>
          <td style="padding: 4px 0 10px 0; font-family: ${FONT_STACK}; font-size: 16px; font-weight: 600; line-height: 24px; color: ${COLOR.heading};">${escapeHtml(
    text
  )}</td>
        </tr>`;
};

/** Label/value pairs — receipts, fee breakdowns, account details. */
const summaryList = (items = []) => {
  const rows = items.filter(Boolean).filter((item) => !isBlank(item.value));
  if (rows.length === 0) return "";
  return `
        <tr>
          <td style="padding: 4px 0 20px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
              ${rows
                .map(
                  (item) => `
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid ${COLOR.border}; font-family: ${FONT_STACK}; font-size: 14px; line-height: 20px; color: ${COLOR.body};">${escapeHtml(
                    item.label
                  )}</td>
                <td align="right" style="padding: 8px 0; border-bottom: 1px solid ${COLOR.border}; font-family: ${FONT_STACK}; font-size: 14px; line-height: 20px; font-weight: 600; color: ${COLOR.heading};">${escapeHtml(
                    item.value
                  )}</td>
              </tr>`
                )
                .join("")}
            </table>
          </td>
        </tr>`;
};

/**
 * The call to action, painted in the client's brand colour.
 *
 * Buttons are a table with a background colour rather than a styled <a>: the
 * old templates used `display:block` on the anchor, which Outlook renders as a
 * full-width text link with no button at all.
 */
const button = ({ label, href, branding = DEVITRAK_BRANDING } = {}) => {
  const url = safeUrl(href);
  if (!url || isBlank(label)) return "";
  const background = branding.brandColor || DEVITRAK_BRANDING.brandColor;
  return `
        <tr>
          <td style="padding: 4px 0 24px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${escapeHtml(background)}" style="border-radius: 8px;">
                  <a href="${url}" target="_blank" style="display: inline-block; padding: 11px 20px; font-family: ${FONT_STACK}; font-size: 15px; font-weight: 600; line-height: 20px; color: ${escapeHtml(
    readableTextOn(background)
  )}; text-decoration: none; border-radius: 8px;">${escapeHtml(label)}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
};

/**
 * A boxed aside — a fee that is owed, a deadline, a warning that a device was
 * declared lost. `tone` only picks colours; it never changes the wording.
 */
const callout = ({ tone = "info", title, body, html = false } = {}) => {
  const tones = {
    info: { background: "#f9fafb", border: "#e4e7ec", heading: COLOR.heading },
    success: { background: "#f0fdf4", border: "#bbf7d0", heading: "#166534" },
    warning: { background: "#fffbeb", border: "#fde68a", heading: "#92400e" },
    danger: { background: "#fef3f2", border: "#fecdca", heading: "#b42318" },
  };
  const palette = tones[tone] || tones.info;
  const bodyContent = html ? String(body ?? "") : escapeHtml(body);
  return `
        <tr>
          <td style="padding: 0 0 20px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: separate; background-color: ${
              palette.background
            }; border: 1px solid ${palette.border}; border-radius: 8px;">
              <tr>
                <td style="padding: 14px 16px; font-family: ${FONT_STACK}; font-size: 14px; line-height: 21px; color: ${
    COLOR.body
  };">
                  ${
                    isBlank(title)
                      ? ""
                      : `<div style="font-weight: 600; color: ${palette.heading}; margin-bottom: 4px;">${escapeHtml(
                          title
                        )}</div>`
                  }
                  ${bodyContent}
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
};

const divider = () => `
        <tr>
          <td style="padding: 4px 0 20px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top: 1px solid ${COLOR.border}; font-size: 0; line-height: 0;">&nbsp;</td></tr></table>
          </td>
        </tr>`;

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

/**
 * Devitrak's own header: the icon and the wordmark side by side, as the
 * pre-chassis templates showed them. A two-cell table rather than two inline
 * images so Outlook cannot wrap or stack them.
 *
 * Drawn at the SVGs' own 47x22 and 105x22; the PNGs behind them are 3x.
 */
const renderDevitrakMark = (name, site) => {
  // The link goes inside each cell: an <a> wrapping a <table> is dropped or
  // mangled by several clients.
  const img = (src, alt, width) => {
    const tag = `<img src="${safeUrl(src)}" alt="${alt}" width="${width}" height="22" style="display: block; width: ${width}px; height: 22px; border: 0; outline: none; text-decoration: none;" />`;
    return site ? `<a href="${site}" target="_blank" style="text-decoration: none;">${tag}</a>` : tag;
  };
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding: 0 8px 0 0;">${img(
    DEVITRAK_BRANDING.iconUrl,
    "",
    47
  )}</td><td>${img(DEVITRAK_BRANDING.logoUrl, name, 105)}</td></tr></table>`;
};

/**
 * Header: the client's logo, or their name set as a wordmark when they have
 * not uploaded one. Devitrak's own mark moves to the footer for branded mail —
 * the sender the family recognises is their school, not our platform.
 *
 * Unbranded mail (no email_branding, or not enabled) gets Devitrak's icon plus
 * wordmark. The test is the logo itself, not `isDefault`: a branded object
 * passed without that flag still inherits isDefault: true from the spread in
 * renderBrandedEmail, and must not grow a Devitrak icon next to a school logo.
 */
const renderHeader = (branding) => {
  const logo = safeUrl(branding.logoUrl);
  const name = escapeHtml(branding.displayName || DEVITRAK_BRANDING.displayName);
  const site = safeUrl(branding.websiteUrl);
  const isDevitrakMark = String(branding.logoUrl ?? "").trim() === DEVITRAK_BRANDING.logoUrl;

  if (isDevitrakMark) {
    return `
        <tr>
          <td style="padding: 0 0 28px 0;">${renderDevitrakMark(name, site)}</td>
        </tr>`;
  }

  const mark = logo
    ? `<img src="${logo}" alt="${name}" height="40" style="display: block; max-height: 40px; max-width: 220px; width: auto; border: 0; outline: none; text-decoration: none;" />`
    : `<span style="font-family: ${FONT_STACK}; font-size: 19px; font-weight: 600; line-height: 28px; color: ${escapeHtml(
        branding.brandColor || COLOR.heading
      )};">${name}</span>`;

  const wrapped = site
    ? `<a href="${site}" target="_blank" style="text-decoration: none;">${mark}</a>`
    : mark;

  return `
        <tr>
          <td style="padding: 0 0 28px 0;">${wrapped}</td>
        </tr>`;
};

/**
 * Footer: the client's own contact block, then the do-not-reply notice, then
 * the Devitrak attribution. `showPoweredBy` is on by default and a client can
 * switch it off, which is the whole point of white-labelling.
 */
const renderFooter = (branding, { showUnmonitored = true } = {}) => {
  const line = (content) => `
              <tr>
                <td style="padding: 2px 0; font-family: ${FONT_STACK}; font-size: 12px; line-height: 18px; color: ${COLOR.muted};">${content}</td>
              </tr>`;

  const parts = [];

  if (!isBlank(branding.footerNote)) {
    parts.push(line(escapeHtml(branding.footerNote)));
  }

  if (showUnmonitored) {
    const replyTo = branding.replyTo;
    parts.push(
      line(
        isBlank(replyTo)
          ? "This email was sent from an unmonitored account. Do not reply to this email."
          : `This email was sent from an unmonitored account. For help, contact <a href="mailto:${escapeHtml(
              replyTo
            )}" style="color: ${COLOR.muted};">${escapeHtml(replyTo)}</a>.`
      )
    );
  }

  if (branding.showPoweredBy !== false) {
    parts.push(
      line(
        `Powered by <a href="https://devitrak.net" target="_blank" style="color: ${COLOR.muted}; text-decoration: underline;">Devitrak</a>`
      )
    );
  }

  if (parts.length === 0) return "";

  return `
        <tr>
          <td style="padding: 8px 0 0 0; border-top: 1px solid ${COLOR.border};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">${parts.join(
              ""
            )}
            </table>
          </td>
        </tr>`;
};

/**
 * Preview text — the grey line clients show next to the subject. Hidden in the
 * body itself, then padded so the client does not spill the first paragraph of
 * real copy into the preview after it.
 */
const renderPreheader = (preheader) => {
  if (isBlank(preheader)) return "";
  return `
    <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: ${
      COLOR.cardBackground
    };">${escapeHtml(preheader)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`;
};

/**
 * Render a complete branded email.
 *
 * @param {object}   options
 * @param {object}   [options.branding]  Resolved branding (see branding.js). Devitrak's own by default.
 * @param {string}   options.title       The <h1>, and the document <title>.
 * @param {string}   [options.preheader] Inbox preview line. Falls back to `greeting`.
 * @param {string}   [options.greeting]  "Dear Carl-Filip Starmark," — rendered as the first paragraph.
 * @param {string|string[]} [options.intro] Body copy following the greeting.
 * @param {string[]} [options.blocks]    Output of the block helpers, in order.
 * @param {{label: string, href: string}} [options.cta]
 * @param {boolean}  [options.showUnmonitored=true]
 * @returns {string} Full HTML document.
 */
const renderBrandedEmail = ({
  branding = DEVITRAK_BRANDING,
  title,
  preheader,
  greeting,
  intro,
  blocks = [],
  cta,
  showUnmonitored = true,
} = {}) => {
  const resolved = { ...DEVITRAK_BRANDING, ...(branding || {}) };
  const introParagraphs = (Array.isArray(intro) ? intro : [intro]).filter(
    (text) => !isBlank(text)
  );

  const body = [
    renderHeader(resolved),
    isBlank(title)
      ? ""
      : `
        <tr>
          <td style="padding: 0 0 12px 0; font-family: ${FONT_STACK}; font-size: 22px; font-weight: 600; line-height: 30px; color: ${COLOR.heading};">${escapeHtml(
          title
        )}</td>
        </tr>`,
    paragraph(greeting),
    ...introParagraphs.map((text) => paragraph(text)),
    ...blocks.filter(Boolean),
    cta ? button({ ...cta, branding: resolved }) : "",
    renderFooter(resolved, { showUnmonitored }),
  ]
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html>
<html lang="en" translate="no" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(title || resolved.displayName)}</title>
    <!--[if mso]><style>* { font-family: Arial, sans-serif !important; }</style><![endif]-->
    <style>
      @media only screen and (max-width: 620px) {
        .devitrak-card { padding: 24px 20px !important; }
        .devitrak-shell { padding: 16px 0 !important; }
      }
    </style>
  </head>
  <body style="margin: 0; padding: 0; width: 100%; background-color: ${
    COLOR.pageBackground
  }; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">${renderPreheader(
    preheader || greeting
  )}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; background-color: ${
      COLOR.pageBackground
    };">
      <tr>
        <td align="center" class="devitrak-shell" style="padding: 32px 12px;">
          <table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: ${CONTENT_WIDTH}px; background-color: ${
    COLOR.cardBackground
  }; border: 1px solid ${COLOR.border}; border-radius: 12px;">
            <tr>
              <td class="devitrak-card" style="padding: 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">${body}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

module.exports = {
  renderBrandedEmail,
  paragraph,
  sectionHeading,
  dataTable,
  summaryList,
  button,
  callout,
  divider,
  escapeHtml,
  safeUrl,
  CONTENT_WIDTH,
  FONT_STACK,
  COLOR,
};
