'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Per-company branding for notification emails — Fredrik's 2026-08-28 ask that
// the returned-device receipt (and every other client-facing notification)
// carry the client's brand instead of Devitrak's.
const {
  DEVITRAK_BRANDING,
  normalizeBranding,
  extractCompanyRef,
  resolveBranding,
  applyBrandedEnvelope,
  invalidateBrandingCache,
  formatSender,
  readableTextOn,
  normalizeColor,
} = require('../nodeMailer/branding');

const { renderBrandedEmail, escapeHtml, safeUrl, dataTable } = require('../nodeMailer/emailLayout');

const {
  returnConfirmationLeaseMemberMessageHtml,
  returnConfirmationMessageHtml,
  liabilityContractConsumerNotificationMessageHtml,
} = require('../nodeMailer/returningDeviceMessage');

const BRIDGES = {
  _id: '68d0000000000000000b0002',
  company_name: 'Bridges Public Charter School',
  company_logo: 'https://res.cloudinary.com/x/bridges.png',
  main_email: 'office@bridgespcs.org',
  website: 'https://bridgespcs.org',
  email_branding: {
    enabled: true,
    brand_color: '#0b6b3a',
    footer_note: 'Bridges PCS, 1250 Taylor St NE, Washington, DC 20017',
  },
};

/* ---------------------------------------------------------------- *
 * normalizeBranding
 * ---------------------------------------------------------------- */

// Nombre del asset del wordmark de Devitrak en Cloudinary (ver nodeMailer/branding.js).
const DEVITRAK_NAME_ID = 'devitrak_name_wls6qd';

test('normalizeBranding: a company that never opted in keeps Devitrak branding', () => {
  assert.equal(normalizeBranding({ company_name: 'Acme', company_logo: 'x' }), DEVITRAK_BRANDING);
  assert.equal(normalizeBranding({ email_branding: { enabled: false } }), DEVITRAK_BRANDING);
  assert.equal(normalizeBranding(null), DEVITRAK_BRANDING);
});

test('normalizeBranding: enabled company falls back to the fields it already has', () => {
  const branding = normalizeBranding(BRIDGES);
  assert.equal(branding.isDefault, false);
  // No display_name / logo_url / reply_to set, so these come from the company record.
  assert.equal(branding.displayName, 'Bridges Public Charter School');
  assert.equal(branding.logoUrl, 'https://res.cloudinary.com/x/bridges.png');
  assert.equal(branding.replyTo, 'office@bridgespcs.org');
  assert.equal(branding.brandColor, '#0b6b3a');
  assert.equal(branding.showPoweredBy, true);
});

test('normalizeBranding: explicit settings win over the company defaults', () => {
  const branding = normalizeBranding({
    ...BRIDGES,
    email_branding: {
      ...BRIDGES.email_branding,
      display_name: 'Bridges PCS',
      logo_url: 'https://cdn/override.png',
      reply_to: 'devices@bridgespcs.org',
      show_powered_by: false,
    },
  });
  assert.equal(branding.displayName, 'Bridges PCS');
  assert.equal(branding.logoUrl, 'https://cdn/override.png');
  assert.equal(branding.replyTo, 'devices@bridgespcs.org');
  assert.equal(branding.showPoweredBy, false);
});

test('normalizeBranding: a junk brand colour degrades to Devitrak blue, not to broken CSS', () => {
  const branding = normalizeBranding({
    ...BRIDGES,
    email_branding: { ...BRIDGES.email_branding, brand_color: 'red; background:url(x)' },
  });
  assert.equal(branding.brandColor, DEVITRAK_BRANDING.brandColor);
  assert.equal(normalizeColor('#abc'), '#abc');
  assert.equal(normalizeColor('rgb(0,0,0)'), '');
});

test('normalizeBranding: "unknown" website placeholder does not become a link', () => {
  assert.equal(normalizeBranding({ ...BRIDGES, website: 'unknown' }).websiteUrl, '');
});

/* ---------------------------------------------------------------- *
 * extractCompanyRef — the payloads disagree about how to name a company
 * ---------------------------------------------------------------- */

test('extractCompanyRef: reads every spelling the existing payloads use', () => {
  const id = '68d0000000000000000b0002';
  assert.deepEqual(extractCompanyRef({ company_id: id }), { id });
  assert.deepEqual(extractCompanyRef({ companyId: id }), { id });
  assert.deepEqual(extractCompanyRef({ companyData: { id } }), { id });
  assert.deepEqual(extractCompanyRef({ company: { _id: id } }), { id });
  assert.deepEqual(extractCompanyRef({ company: 'Bridges PCS' }), { name: 'Bridges PCS' });
  assert.deepEqual(extractCompanyRef({ company_name: 'Bridges PCS' }), { name: 'Bridges PCS' });
});

test('extractCompanyRef: id wins over name when a payload carries both', () => {
  const id = '68d0000000000000000b0002';
  assert.deepEqual(extractCompanyRef({ company_id: id, company: 'Bridges PCS' }), { id });
});

test('extractCompanyRef: a company_id that is not an ObjectId is not treated as one', () => {
  // Several payloads carry the MySQL integer company id under the same key.
  assert.deepEqual(extractCompanyRef({ company_id: 4 }), {});
  assert.deepEqual(extractCompanyRef({ company_id: 4, company: 'Bridges PCS' }), { name: 'Bridges PCS' });
});

test('extractCompanyRef: the literal string "Devitrak" is not a client company', () => {
  assert.deepEqual(extractCompanyRef({ company: 'Devitrak' }), {});
  assert.deepEqual(extractCompanyRef({}), {});
});

/* ---------------------------------------------------------------- *
 * resolveBranding
 * ---------------------------------------------------------------- */

test('resolveBranding: no company reference resolves to Devitrak without touching the DB', async () => {
  invalidateBrandingCache();
  let queried = false;
  const branding = await resolveBranding({}, {
    findById: async () => { queried = true; },
    findByName: async () => { queried = true; },
  });
  assert.equal(branding, DEVITRAK_BRANDING);
  assert.equal(queried, false);
});

test('resolveBranding: looks the company up by id and by name', async () => {
  invalidateBrandingCache();
  const byId = await resolveBranding(
    { company_id: BRIDGES._id },
    { findById: async () => BRIDGES, findByName: async () => null }
  );
  assert.equal(byId.displayName, 'Bridges Public Charter School');

  invalidateBrandingCache();
  const byName = await resolveBranding(
    { company: 'Bridges Public Charter School' },
    { findById: async () => null, findByName: async () => BRIDGES }
  );
  assert.equal(byName.displayName, 'Bridges Public Charter School');
});

test('resolveBranding: caches, and invalidateBrandingCache drops the entry', async () => {
  invalidateBrandingCache();
  let calls = 0;
  const deps = { findById: async () => { calls += 1; return BRIDGES; } };

  await resolveBranding({ company_id: BRIDGES._id }, deps);
  await resolveBranding({ company_id: BRIDGES._id }, deps);
  assert.equal(calls, 1, 'second resolve should be served from cache');

  invalidateBrandingCache(BRIDGES._id);
  await resolveBranding({ company_id: BRIDGES._id }, deps);
  assert.equal(calls, 2, 'invalidation should force a fresh read');
});

test('resolveBranding: a database failure degrades to Devitrak instead of losing the email', async () => {
  invalidateBrandingCache();
  const branding = await resolveBranding(
    { company_id: BRIDGES._id },
    { findById: async () => { throw new Error('mongo down'); } }
  );
  assert.equal(branding, DEVITRAK_BRANDING);
});

test('resolveBranding: an explicit branding object short-circuits the lookup (settings preview)', async () => {
  invalidateBrandingCache();
  let queried = false;
  const branding = await resolveBranding(
    { company_id: BRIDGES._id, branding: { displayName: 'Draft Name' } },
    { findById: async () => { queried = true; return BRIDGES; } }
  );
  assert.equal(branding.displayName, 'Draft Name');
  assert.equal(branding.isDefault, false);
  assert.equal(queried, false);
});

/* ---------------------------------------------------------------- *
 * The From header
 * ---------------------------------------------------------------- */

test('formatSender: quotes the display name and keeps the verified address', () => {
  assert.equal(
    formatSender('Bridges PCS'),
    '"Bridges PCS" <noreply@devitrak.com>'
  );
});

test('formatSender: a company name cannot inject a second header', () => {
  const sender = formatSender('Evil\r\nBcc: attacker@example.com');
  assert.ok(!sender.includes('\r'), 'CR must not survive');
  assert.ok(!sender.includes('\n'), 'LF must not survive');
  assert.ok(sender.endsWith('<noreply@devitrak.com>'));
});

test('formatSender: quotes and backslashes in a name are escaped, not passed through', () => {
  assert.equal(formatSender('He said "hi"'), '"He said \\"hi\\"" <noreply@devitrak.com>');
  assert.equal(formatSender('a\\b'), '"a\\\\b" <noreply@devitrak.com>');
});

test('formatSender: an empty name falls back to the bare address', () => {
  assert.equal(formatSender('   '), 'noreply@devitrak.com');
});

test('applyBrandedEnvelope: Devitrak default leaves the message untouched', () => {
  const message = { to: 'a@b.com', from: 'Devitrak Notifications <noreply@devitrak.com>', subject: 's', html: 'h' };
  assert.equal(applyBrandedEnvelope(message, DEVITRAK_BRANDING), message);
});

test('applyBrandedEnvelope: branded mail gets the client from-name and a live Reply-To', () => {
  const branded = applyBrandedEnvelope(
    { to: 'a@b.com', from: 'Devitrak Notifications <noreply@devitrak.com>', subject: 's', html: 'h' },
    normalizeBranding(BRIDGES)
  );
  assert.equal(branded.from, '"Bridges Public Charter School" <noreply@devitrak.com>');
  assert.equal(branded.replyTo, 'office@bridgespcs.org');
  assert.equal(branded.to, 'a@b.com');
});

test('applyBrandedEnvelope: brands every message when a builder returns several', () => {
  const branded = applyBrandedEnvelope(
    [{ to: 'a@b.com', from: 'x' }, { to: 'c@d.com', from: 'x' }],
    normalizeBranding(BRIDGES)
  );
  assert.equal(branded.length, 2);
  assert.ok(branded.every((m) => m.from === '"Bridges Public Charter School" <noreply@devitrak.com>'));
});

/* ---------------------------------------------------------------- *
 * Layout
 * ---------------------------------------------------------------- */

test('readableTextOn: picks text that stays legible on the chosen brand colour', () => {
  assert.equal(readableTextOn('#0b6b3a'), '#ffffff');
  assert.equal(readableTextOn('#155eef'), '#ffffff');
  assert.equal(readableTextOn('#ffe066'), '#101828');
  assert.equal(readableTextOn('#fff'), '#101828');
});

test('escapeHtml: closes every hole a client-editable field could open', () => {
  assert.equal(escapeHtml('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;');
  assert.equal(escapeHtml(null), '');
});

test('safeUrl: refuses script URLs and assumes https for bare hosts', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,x'), '');
  assert.equal(safeUrl('https://bridgespcs.org'), 'https://bridgespcs.org');
  assert.equal(safeUrl('bridgespcs.org'), 'https://bridgespcs.org');
  assert.equal(safeUrl('mailto:a@b.com'), 'mailto:a@b.com');
});

test('renderBrandedEmail: the layout is table-based, since Outlook ignores flexbox', () => {
  const html = renderBrandedEmail({ title: 'Hello', intro: 'Body copy.' });
  assert.ok(!/display:\s*flex/.test(html), 'no flexbox may survive in the chassis');
  assert.ok(html.includes('role="presentation"'));
  assert.ok(html.startsWith('<!DOCTYPE html>'));
});

test('renderBrandedEmail: a client logo replaces the Devitrak mark in the header', () => {
  const branding = normalizeBranding(BRIDGES);
  const html = renderBrandedEmail({ branding, title: 'Hello' });
  assert.ok(html.includes('https://res.cloudinary.com/x/bridges.png'));
  assert.ok(!html.includes(DEVITRAK_NAME_ID), 'Devitrak logo must not appear in branded mail');
  assert.ok(html.includes('Powered by'), 'attribution stays unless the client turns it off');
});

test('renderBrandedEmail: a client with no logo gets their name as a wordmark', () => {
  const branding = normalizeBranding({ ...BRIDGES, company_logo: '' });
  const html = renderBrandedEmail({ branding, title: 'Hello' });
  assert.ok(html.includes('Bridges Public Charter School'));
  assert.ok(!html.includes('<img'), 'nothing to show is better than a broken image');
});

test('renderBrandedEmail: white-label drops the Devitrak attribution entirely', () => {
  const branding = normalizeBranding({
    ...BRIDGES,
    email_branding: { ...BRIDGES.email_branding, show_powered_by: false },
  });
  const html = renderBrandedEmail({ branding, title: 'Hello' });
  assert.ok(!html.includes('Powered by'));
});

test('renderBrandedEmail: the footer routes replies to the client, not to a dead mailbox', () => {
  const html = renderBrandedEmail({ branding: normalizeBranding(BRIDGES), title: 'Hello' });
  assert.ok(html.includes('mailto:office@bridgespcs.org'));
  assert.ok(html.includes('Bridges PCS, 1250 Taylor St NE, Washington, DC 20017'));
});

test('dataTable: escapes cell values but honours an explicit html column', () => {
  const html = dataTable({
    columns: [{ header: 'A', key: 'a' }, { header: 'B', key: 'b', html: true }],
    rows: [{ a: '<b>x</b>', b: '<a href="https://x">View</a>' }],
  });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('<a href="https://x">View</a>'));
});

/* ---------------------------------------------------------------- *
 * The templates themselves
 * ---------------------------------------------------------------- */

const MEMBER_RETURN_PROPS = {
  member: { firstName: 'Carl-Filip', lastName: 'Starmark', email: 'cf@example.com' },
  devices: [{ device: { deviceType: 'Laptops', serialNumber: '123456789Z' } }],
};

test('returnConfirmationLeaseMemberMessageHtml: unbranded output still reads as Devitrak', () => {
  const html = returnConfirmationLeaseMemberMessageHtml(MEMBER_RETURN_PROPS);
  assert.ok(html.includes('Devices Returned Receipt'));
  assert.ok(html.includes('Carl-Filip Starmark'));
  assert.ok(html.includes('devitrak'));
});

test('returnConfirmationLeaseMemberMessageHtml: branded output is the client, end to end', () => {
  const html = returnConfirmationLeaseMemberMessageHtml(MEMBER_RETURN_PROPS, normalizeBranding(BRIDGES));
  assert.ok(html.includes('Bridges Public Charter School') || html.includes('bridges.png'));
  assert.ok(!html.includes(DEVITRAK_NAME_ID));
  // The content Fredrik's forward showed must all survive the restyle.
  assert.ok(html.includes('Carl-Filip Starmark'));
  assert.ok(html.includes('Laptops'));
  assert.ok(html.includes('123456789Z'));
  assert.ok(html.includes('have been returned successfully'));
});

test('templates: a hostile name is escaped rather than rendered as markup', () => {
  const html = returnConfirmationMessageHtml({
    consumer: { firstName: '<img src=x onerror=alert(1)>', lastName: 'Doe' },
    devices: [],
    link: 'https://admin.devitrak.net',
  });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
});

test('templates: a missing devices array renders an empty table instead of throwing', () => {
  assert.doesNotThrow(() => returnConfirmationLeaseMemberMessageHtml({
    member: { firstName: 'A', lastName: 'B' },
  }));
});

test('liabilityContractConsumerNotificationMessageHtml: contract links keep their query tuple', () => {
  const html = liabilityContractConsumerNotificationMessageHtml({
    company_name: 'Bridges PCS',
    email_admin: 'office@bridgespcs.org',
    consumer: { name: 'Carl-Filip', email: 'cf@example.com', consumer_member_id: 'cm-1' },
    contract_list: [{ title: 'Device liability', view_url: 'https://files.example.com/c.pdf' }],
    items: [{ serial_number: '123456789Z', type: 'Laptop', item_id: 'i1' }],
    subject: 'Sign your device contract',
    company_id: '4',
    date_reference: '2026-08-28',
    verification_id: 'v1',
  }, normalizeBranding(BRIDGES));

  assert.ok(html.includes('https://admin.devitrak.net/display-contracts?'));
  assert.ok(html.includes('company_id=4'));
  assert.ok(html.includes('consumer_member_id=cm-1'));
  assert.ok(html.includes('ver_id=v1') || html.includes('verification_id=v1'));
  assert.ok(html.includes(encodeURIComponent('https://files.example.com/c.pdf')));
  assert.ok(html.includes('item_ids=i1'));
});

/* ---------------------------------------------------------------- *
 * Where branding comes from over HTTP
 *
 * Both `x-company-id` and any company named in the payload are client-supplied.
 * Trusting either would let a caller send mail dressed as somebody else's
 * school, so over HTTP only the verified session counts —
 * middlewares/notificationAuth.js confirms the caller has an employee record in
 * the company they claim and leaves the id on the request.
 * ---------------------------------------------------------------- */

test('resolveBranding: a verified session brands the email', async () => {
  invalidateBrandingCache();
  const branding = await resolveBranding(
    { member: { firstName: 'Carl-Filip' } },
    { request: { verifiedCompanyId: BRIDGES._id }, findById: async () => BRIDGES }
  );
  assert.equal(branding.displayName, 'Bridges Public Charter School');
});

test('resolveBranding: an unverified x-company-id header is ignored', async () => {
  invalidateBrandingCache();
  let queried = false;
  const branding = await resolveBranding(
    {},
    {
      // A header the middleware did not vouch for — the spoof this closes.
      request: { headers: { 'x-company-id': BRIDGES._id } },
      findById: async () => { queried = true; return BRIDGES; },
    }
  );
  assert.equal(branding, DEVITRAK_BRANDING);
  assert.equal(queried, false, 'an unverified claim should not even be looked up');
});

test('resolveBranding: a company named in the payload cannot brand an HTTP send', async () => {
  invalidateBrandingCache();
  const branding = await resolveBranding(
    { company: 'Bridges Public Charter School', company_id: BRIDGES._id },
    { request: {}, findById: async () => BRIDGES, findByName: async () => BRIDGES }
  );
  assert.equal(branding, DEVITRAK_BRANDING);
});

test('resolveBranding: the verified session wins over a conflicting payload claim', async () => {
  invalidateBrandingCache();
  const seen = [];
  await resolveBranding(
    { company: 'Acme Rentals' },
    {
      request: { verifiedCompanyId: BRIDGES._id },
      findById: async (id) => { seen.push(['id', id]); return BRIDGES; },
      findByName: async (name) => { seen.push(['name', name]); return null; },
    }
  );
  assert.deepEqual(seen, [['id', BRIDGES._id]]);
});

test('resolveBranding: with no request at all, the payload still resolves', async () => {
  // In-process callers have no session to consult and no attacker either.
  invalidateBrandingCache();
  const branding = await resolveBranding(
    { company_id: BRIDGES._id },
    { findById: async () => BRIDGES }
  );
  assert.equal(branding.displayName, 'Bridges Public Charter School');
});

test('resolveBranding: an unauthenticated send is unbranded, exactly as it was before', async () => {
  invalidateBrandingCache();
  const branding = await resolveBranding({ company: 'Bridges PCS' }, { request: {} });
  assert.equal(branding, DEVITRAK_BRANDING);
  assert.equal(branding.isDefault, true);
});

/* ---------------------------------------------------------------- *
 * Staff and internal templates
 *
 * "Staff" here means the *client's* own people — a school's device manager,
 * a rental company's admin team. Those carry the client's brand. Devitrak's
 * platform mail (auth, security, its own feedback surveys) does not, and the
 * split is load-bearing: a password reset dressed as the recipient's school
 * is harder to tell apart from phishing, not easier.
 * ---------------------------------------------------------------- */

const {
  staffNotificationMessageHtml,
  staffInternalNotificationMessageHtml,
  eventBeginsReminderHtmlMessage,
  itemInfoStaffNotificationMessageHtml,
  liabilityContractStaffNotificationMessageHtml,
  returnedItemsToRenterNotificationMessageHtml,
  documentSigningCompletionMessageHtml,
  documentSigningCompletionConsumerLeaseMessageHtml,
  linkToResetUserPassword,
  reportBugMessageHtml,
  devitrakFeedbackEmailMessageHtml,
  nrffInterpretationFeedbackEmailMessageHtml,
  loginActivityNotificationMessageHtml,
  forceLogoutNotificationHtmlTemplate,
  editingDeviceAdminMessageHtml,
  returnReminderMessageHtml,
} = require('../nodeMailer/returningDeviceMessage');

const BRANDING = normalizeBranding(BRIDGES);

const STAFF_CASES = [
  ['staffNotificationMessageHtml', staffNotificationMessageHtml,
    { company: 'Bridges PCS', message: 'A device was removed from the record.' }],
  ['staffInternalNotificationMessageHtml', staffInternalNotificationMessageHtml,
    { subject: 'Staff assignment', company: 'Bridges PCS', staffMember: 'Ana Diaz',
      eventInfo: { eventName: 'Fall term', dateBegin: '2026-09-01', address: 'Washington, DC' },
      contactInfo: { name: 'Ana', email: 'ana@bridgespcs.org' } }],
  ['eventBeginsReminderHtmlMessage', eventBeginsReminderHtmlMessage,
    { event: 'Fall term', daysToEvent: 3, message: 'Please arrive early.' }],
  ['itemInfoStaffNotificationMessageHtml', itemInfoStaffNotificationMessageHtml,
    { subject: 'Leased equipment', company: 'Bridges PCS', message: 'Details below.',
      contactInfo: { staff: 'Ana', email: 'ana@bridgespcs.org' } }],
  ['returnedItemsToRenterNotificationMessageHtml', returnedItemsToRenterNotificationMessageHtml,
    { supplierInfo: { companyName: 'Acme Rentals', industry: 'AV', services: ['Laptops'],
      address: { street: '1 Main', city: 'DC', state: 'DC', postalCode: '20017', country: 'USA' },
      contactInfo: { email: 's@acme.com', phone: '202-555-0100', website: 'acme.com' } } }],
  ['documentSigningCompletionMessageHtml', documentSigningCompletionMessageHtml,
    { recipientType: 'staff', staff: { name: 'Ana Diaz', email: 'ana@bridgespcs.org' },
      contract_list: [{ document_name: 'Device liability', date: '8/28/2026' }] }],
];

for (const [name, render, props] of STAFF_CASES) {
  test(`${name}: wears the client's brand, not Devitrak's`, () => {
    const html = render(props, BRANDING);
    assert.ok(html.includes('bridges.png') || html.includes('Bridges Public Charter School'));
    assert.ok(!html.includes(DEVITRAK_NAME_ID), 'Devitrak logo must be gone');
  });

  test(`${name}: unbranded output keeps the Devitrak identity it has today`, () => {
    const html = render(props);
    assert.ok(html.includes(DEVITRAK_NAME_ID));
  });
}

const PLATFORM_CASES = [
  ['linkToResetUserPassword', () => linkToResetUserPassword({ link: 'https://admin.devitrak.net/reset' })],
  ['reportBugMessageHtml', () => reportBugMessageHtml({ message: 'Stack trace' })],
  ['devitrakFeedbackEmailMessageHtml', () => devitrakFeedbackEmailMessageHtml({ props: { link: 'https://f' } })],
  ['nrffInterpretationFeedbackEmailMessageHtml', () => nrffInterpretationFeedbackEmailMessageHtml()],
  ['loginActivityNotificationMessageHtml', () => loginActivityNotificationMessageHtml({
    adminUser: { name: 'Ana', lastName: 'Diaz', email: 'ana@bridgespcs.org' },
    loginInfo: { timestamp: 'Aug 28 2026', ipAddress: '1.2.3.4', location: 'DC', userAgent: 'Chrome', timezone: 'EST' },
  })],
  ['forceLogoutNotificationHtmlTemplate', () => forceLogoutNotificationHtmlTemplate('ana@bridgespcs.org')],
];

for (const [name, render] of PLATFORM_CASES) {
  test(`${name}: is Devitrak's own mail and stays Devitrak-branded`, () => {
    const html = render();
    assert.ok(html.includes(DEVITRAK_NAME_ID), 'platform mail keeps the Devitrak mark');
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'but it is on the shared chassis');
    assert.ok(!/display:\s*flex/.test(html));
  });
}

test('loginActivityNotificationMessageHtml: keeps every field a reader needs to judge the login', () => {
  const html = loginActivityNotificationMessageHtml({
    adminUser: { name: 'Ana', lastName: 'Diaz', email: 'ana@bridgespcs.org' },
    loginInfo: { timestamp: 'Aug 28 2026, 2:17 PM', ipAddress: '203.0.113.7', location: 'Washington, DC', userAgent: 'Chrome 140', timezone: 'America/New_York' },
  });
  for (const value of ['ana@bridgespcs.org', 'Aug 28 2026, 2:17 PM', '203.0.113.7', 'Washington, DC', 'Chrome 140', 'America/New_York']) {
    assert.ok(html.includes(value), `missing ${value}`);
  }
  assert.ok(html.includes('mailto:support@devitrak.com'));
});

test('nrffInterpretationFeedbackEmailMessageHtml: stays bilingual and keeps the survey link', () => {
  const html = nrffInterpretationFeedbackEmailMessageHtml();
  assert.ok(html.includes('Prezado usuário'), 'Portuguese first');
  assert.ok(html.includes('Dear NRFF and Interpretation Services user'), 'English after');
  assert.equal((html.match(/forms\.office\.com\/r\/1L8bZ4XW6T/g) || []).length, 4, 'both links, href + text');
});

test('forceLogoutNotificationHtmlTemplate: no password ever leaves in the email', () => {
  // This template used to embed <form method="GET"> with a password field, so
  // the plaintext password ended up in the URL — and therefore in browser
  // history, access logs and any Referer. The password is now typed on the
  // /force-logout page and POSTed. These assertions keep it that way.
  const html = forceLogoutNotificationHtmlTemplate('ana@bridgespcs.org');
  assert.ok(!html.includes('<form'), 'no form may be embedded in the email');
  assert.ok(!html.includes('type="password"'), 'no password field in an email');
  assert.ok(!html.includes('method="GET"'));
  assert.ok(!/[?&](cred|x_cred|password)=/.test(html), 'no credential in any URL');
});

test('forceLogoutNotificationHtmlTemplate: links to the page with the account email only', () => {
  const html = forceLogoutNotificationHtmlTemplate('ana@bridgespcs.org');
  const href = html.match(/https:\/\/admin\.devitrak\.net\/force-logout\?[^"]*/)[0];
  assert.ok(href.includes('email=ana%40bridgespcs.org'), 'email is url-encoded into the link');
  assert.ok(/timestamp=\d+/.test(href.replace('&amp;', '&')), 'timestamp is preserved for expiry checks');
  assert.ok(html.includes('confirm your password on our site'));
});

test('forceLogoutNotificationHtmlTemplate: a hostile address cannot break out of the link', () => {
  const html = forceLogoutNotificationHtmlTemplate('a"><script>alert(1)</script>@x.com');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('"><script'));
});

test('linkToResetUserPassword: the button survives the payload the dashboard actually sends', () => {
  // ForgotPassword.jsx and ResetPasswordLink.jsx post `linkToResetPassword`, not
  // `link`. The chassis migration read only `link`, so the reset email went out
  // with no button at all — the platform case above passes `link` and could not
  // see it. Built through the route's own builder, with the dashboard's payload.
  const { buildLinkToResetPasswordMessage } = require('../nodeMailer/notifications');
  const resetUrl = 'https://admin.devitrak.net/reset-password?uid=66a1f0c2e4b0&stamp-time=Mon%20Sep%2028%202026%2014:30:00';
  const { html } = buildLinkToResetPasswordMessage({
    adminUser: { firstName: 'Ana', lastName: 'Diaz' },
    linkToResetPassword: resetUrl,
    contactInfo: { email: 'ana@bridgespcs.org', company: 'Bridges PCS' },
  });
  assert.ok(html.includes(`href="${escapeHtml(resetUrl)}"`), 'the button links to the reset page');
  assert.ok(html.includes('Reset password'), 'the button label renders');
});

test('linkToResetUserPassword: still honours `link`, the key every other chassis template reads', () => {
  const html = linkToResetUserPassword({ link: 'https://admin.devitrak.net/reset' });
  assert.ok(html.includes('href="https://admin.devitrak.net/reset"'));
});

test('documentSigningCompletion: the staff and consumer twins share one renderer, differing only in the signer', () => {
  const contract_list = [{ document_name: 'Device liability', date: '8/28/2026' }];
  const staffHtml = documentSigningCompletionMessageHtml(
    { recipientType: 'assigner', staff: { name: 'Ana Diaz', email: 'ana@x.org' }, contract_list });
  const consumerHtml = documentSigningCompletionConsumerLeaseMessageHtml(
    { recipientType: 'assigner', consumer: { name: 'Carl-Filip', email: 'cf@x.org' }, contract_list });

  assert.ok(staffHtml.includes('signed by the assigned staff member'));
  assert.ok(consumerHtml.includes('signed by the assigned consumer'));
  assert.ok(staffHtml.includes('Proceed with equipment delivery to the staff member.'));
  assert.ok(consumerHtml.includes('Proceed with equipment delivery to the consumer.'));
  // Same chassis, so the chrome is byte-identical either side of the signer.
  assert.ok(staffHtml.includes('Document checking complete'));
  assert.ok(consumerHtml.includes('Document checking complete'));
});

test('documentSigningCompletion: the signer sees their own next steps, not the assigner\'s', () => {
  const props = { recipientType: 'staff', staff: { name: 'Ana' }, contract_list: [] };
  const html = documentSigningCompletionMessageHtml(props);
  assert.ok(html.includes('Await equipment delivery from the assigner.'));
  assert.ok(!html.includes('Proceed with equipment delivery'));
});

test('liabilityContractStaffNotificationMessageHtml: the View link carries staff_member_id', () => {
  const html = liabilityContractStaffNotificationMessageHtml({
    company_name: 'Bridges PCS', email_admin: 'office@bridgespcs.org',
    staff: { name: 'Ana Diaz', email: 'ana@bridgespcs.org', staff_member_id: 's-1' },
    contract_list: [{ title: 'Device liability', view_url: 'https://files.example.com/c.pdf' }],
    items: [{ serial_number: '123456789Z', type: 'Laptop', item_id: 'i1' }],
    subject: 'Sign your device contract', company_id: '4', date_reference: '2026-08-28', verification_id: 'v1',
  }, BRANDING);
  assert.ok(html.includes('staff_member_id=s-1'));
  assert.ok(!html.includes('consumer_member_id'));
  assert.ok(html.includes('Staff member information'));
});

test('returnedItemsToRenterNotificationMessageHtml: renders with no supplier on file', () => {
  // The supplier block is optional in the payload and always has been.
  const html = returnedItemsToRenterNotificationMessageHtml({}, BRANDING);
  assert.ok(html.includes('Items returned to rental company'));
  assert.ok(!/undefined/.test(html));
});

test('the two empty stubs are still stubs — no content was invented for them', () => {
  // notifications.js documents returnReminderMessageHtml as a deliberate stub;
  // editingDeviceAdminMessageHtml is the same. Migrating the file is not the
  // moment to write copy nobody has approved.
  assert.equal(editingDeviceAdminMessageHtml({}), '');
  assert.equal(returnReminderMessageHtml({}), '');
});

// ---------------------------------------------------------------------------
// Unbranded mail carries Devitrak's icon AND wordmark; branded mail neither.
// ---------------------------------------------------------------------------

const DEVITRAK_ICON = 'devitrak_login_jeki3x';
const DEVITRAK_NAME = 'devitrak_name_wls6qd';

test('unbranded email shows the Devitrak icon next to the wordmark', () => {
  const html = renderBrandedEmail({ title: 'Hello' });
  const icon = html.indexOf(DEVITRAK_ICON);
  const name = html.indexOf(DEVITRAK_NAME);
  assert.ok(icon > -1, 'icon present');
  assert.ok(name > icon, 'wordmark present, after the icon');
  assert.ok(!/display:\s*flex/.test(html), 'Outlook-safe: table cells, not flex');
});

test('a company that never enabled email_branding gets the Devitrak icon too', () => {
  const branding = normalizeBranding({ ...BRIDGES, email_branding: { enabled: false } });
  const html = renderBrandedEmail({ branding, title: 'Hello' });
  assert.ok(html.includes(DEVITRAK_ICON));
  assert.ok(html.includes(DEVITRAK_NAME));
});

test('branded email never shows the Devitrak icon', () => {
  const html = renderBrandedEmail({ branding: BRANDING, title: 'Hello' });
  assert.ok(!html.includes(DEVITRAK_ICON));
  assert.ok(!html.includes(DEVITRAK_NAME));
});

test('branded object without isDefault still gets no Devitrak icon', () => {
  // renderBrandedEmail spreads DEVITRAK_BRANDING first, so a caller that omits
  // isDefault inherits `true`. The header must key off the logo, not the flag.
  const { isDefault, ...noFlag } = BRANDING;
  const html = renderBrandedEmail({ branding: noFlag, title: 'Hello' });
  assert.ok(!html.includes(DEVITRAK_ICON));
});

test('branded company without a logo gets its name as text, no Devitrak icon', () => {
  const branding = normalizeBranding({
    ...BRIDGES,
    company_logo: '',
    email_branding: { ...BRIDGES.email_branding, logo_url: '' },
  });
  const html = renderBrandedEmail({ branding, title: 'Hello' });
  assert.ok(!html.includes(DEVITRAK_ICON));
  assert.ok(!html.includes(DEVITRAK_NAME));
});

test('the default mark is Cloudinary PNG, 3x, recoloured for the white card', () => {
  for (const url of [DEVITRAK_BRANDING.logoUrl, DEVITRAK_BRANDING.iconUrl]) {
    // PNG, never SVG: Gmail and desktop Outlook do not render SVG in mail.
    assert.match(url, /^https:\/\/res\.cloudinary\.com\/dpdzkhh07\/image\/upload\/.+\.png$/);
    // Raster at 3x the 22 px it is drawn at, or it blurs.
    assert.match(url, /\/h_66,/);
  }
  // The source SVGs are white: without the recolour they vanish on white.
  assert.match(DEVITRAK_BRANDING.logoUrl, /e_colorize:100,co_rgb:155eef/);
  assert.match(DEVITRAK_BRANDING.iconUrl, /e_replace_color:155eef:15:ffffff/);
});

test('legacy hand-written templates use the same Devitrak mark', () => {
  const { overdueReminderMessageHtml } = require('../nodeMailer/overdueReminderMessage');
  const { customizeMessageHtml } = require('../nodeMailer/returningDeviceMessage');
  for (const html of [overdueReminderMessageHtml({}), customizeMessageHtml({})]) {
    assert.ok(html.includes(DEVITRAK_BRANDING.iconUrl));
    assert.ok(html.includes(DEVITRAK_BRANDING.logoUrl));
    // Ni el wordmark viejo (60x12 estirado) ni un SVG crudo.
    assert.ok(!/devitrak_(name|logo)_layer_1/.test(html));
    assert.ok(!/devitrak_(login|name)_[a-z0-9]+\.svg/.test(html));
  }
});

// Los PNG de Devitrak estan a 3x (141x66, 315x66). Un <img> sin tamano fijo los
// pinta a ese tamano real en el correo: el triple de grande.
test('toda plantilla que usa el icono o el nombre de Devitrak fija width y height', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.resolve(__dirname, '../nodeMailer');
  const offenders = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/<img\b[^>]*DEVITRAK_EMAIL_(ICON|NAME)_URL[^>]*>/g)) {
      if (!/\bwidth="\d+"/.test(m[0]) || !/\bheight="\d+"/.test(m[0])) offenders.push(`${file}: ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
