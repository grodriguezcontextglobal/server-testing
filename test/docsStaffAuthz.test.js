'use strict';

/**
 * Autorización por compañía en cuatro rutas que no la tenían:
 *   - PATCH  /api/document/:id      (nueva)
 *   - DELETE /api/document/:id      (borraba documentos de cualquier compañía)
 *   - POST   /api/staff/force-logout (anónima: con un email se cerraba la sesión de cualquiera)
 *   - PATCH  /api/admin/profile/:id  (asignación masiva: cualquiera ponía super_user a otro)
 *
 * Los modelos se sustituyen por stubs en memoria; la lógica de membresía
 * (helpers/companyMembership.js) y el catálogo de permisos son los reales.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ── ids (ObjectId válidos: los handlers rechazan los mal formados) ──────────
const CO_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CO_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const U_SUPER_A = '111111111111111111111111'; // super_user de la compañía A
const U_ADMIN_A = '222222222222222222222222'; // roleType admin (staff:update) en A
const U_PLAIN_A = '333333333333333333333333'; // assistant en A, sin staff:update
const U_MEMBER_B = '444444444444444444444444'; // solo en B
const U_PLATFORM = '555555555555555555555555'; // super_user de plataforma, en ninguna compañía
const DOC_A = 'dddddddddddddddddddddda1';
const DOC_B = 'dddddddddddddddddddddda2';

// ── estado de los stubs ─────────────────────────────────────────────────────
let users, companies, docs, calls;

function reset() {
  users = {
    [U_SUPER_A]: { id: U_SUPER_A, email: 'super@a.com', active: true },
    [U_ADMIN_A]: { id: U_ADMIN_A, email: 'admin@a.com', active: true },
    [U_PLAIN_A]: { id: U_PLAIN_A, email: 'plain@a.com', active: true },
    [U_MEMBER_B]: { id: U_MEMBER_B, email: 'member@b.com', active: true },
    [U_PLATFORM]: { id: U_PLATFORM, email: 'ops@devitrak.com', active: true, super_user: true },
  };
  companies = {
    [CO_A]: {
      employees: [
        { userId: U_SUPER_A, user: 'super@a.com', roleType: 'admin', super_user: true },
        { userId: U_ADMIN_A, user: 'admin@a.com', roleType: 'admin' },
        // sin userId: el match tiene que caer al email
        { user: 'plain@a.com', roleType: 'assistant' },
      ],
    },
    [CO_B]: { employees: [{ userId: U_MEMBER_B, user: 'member@b.com', roleType: 'admin' }] },
  };
  docs = {
    [DOC_A]: makeDoc(DOC_A, CO_A),
    [DOC_B]: makeDoc(DOC_B, CO_B),
  };
  calls = { updates: [], s3Deletes: [], docDeletes: [], redisDel: [], logs: [] };
}

function makeDoc(id, company_id) {
  const doc = { _id: id, company_id, title: 'Contrato', document_url: `https://s3/${id}.pdf`, saved: false };
  doc.set = (u) => Object.assign(doc, u);
  doc.save = async () => { doc.saved = true; return doc; };
  return doc;
}

const lookup = (id) => {
  const p = Promise.resolve(users[id] ?? null);
  p.select = () => Promise.resolve(users[id] ?? null);
  return p;
};

const AdminUserStub = {
  findById: (id) => lookup(id),
  findOne: async ({ email }) => Object.values(users).find((u) => u.email === email) ?? null,
  findByIdAndUpdate: async (id, update) => {
    calls.updates.push({ id, update });
    return { ...users[id], ...update, id };
  },
};
const CompanyStub = {
  findOne: ({ _id }) => ({ lean: async () => companies[_id] ?? null }),
  findById: async (id) => companies[id] ?? null,
};
const DocumentStub = {
  findById: async (id) => docs[id] ?? null,
  findByIdAndDelete: async (id) => { calls.docDeletes.push(id); },
};

// ── carga de los controllers con los stubs ──────────────────────────────────
const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const noop = () => {};

stub('models/AdminUser.js', AdminUserStub);
stub('models/Company.js', CompanyStub);
stub('models/Document.js', DocumentStub);
for (const m of ['Signatures', 'Folder', 'EventSignature', 'Verification',
  'VerificationConsumersLeaseContracts', 'SignatureConsumer', 'User',
  'VerificationMemberLeaseContracts', 'StripeTransaction']) {
  stub(`models/${m}.js`, {});
}
stub('helpers/s3Upload.js', {
  deleteDocumentFromS3: async (url) => { calls.s3Deletes.push(url); return true; },
});
stub('helpers/queue.js', { enqueue: async () => ({ id: 'J' }), extractJobContext: () => ({}) });
stub('helpers/jwt.js', { generateJWT: async () => 'tok' });
stub('helpers/logger.js', { warn: noop, error: noop, info: noop });
stub('mysql/database/config.js', () => ({ execute: async () => [[]] }));
stub('nodeMailer/notifications.js', {
  loginActivityNotification: async () => ({}),
  documentSigningCompletionNotification: async () => ({}),
  consumerDocumentSigningCompletionNotification: async () => ({}),
});
stub('database/cacheMemoryConfig.js', {
  clientRedis: async () => ({ del: async (k) => { calls.redisDel.push(k); return 1; } }),
});
stub('controller/staffActivityLog.js', {
  logStaffActivity: async (entry) => { calls.logs.push(entry); },
});

const { updateDocument, deleteDocument } = require('../controller/document');
const { forceEndSession, editAdminUser } = require('../controller/admin');

beforeEach(reset);

function req({ uid, company, params = {}, body = {} }) {
  const headers = company ? { 'x-company-id': company } : {};
  return {
    uid, params, body, headers, ip: '127.0.0.1',
    header: (name) => headers[name.toLowerCase()],
  };
}
function res() {
  const r = { cookies: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; if (r.code === undefined) r.code = 200; return r; };
  r.cookie = (n, v) => { r.cookies[n] = v; return r; };
  return r;
}

// ═══ PATCH /api/document/:id ════════════════════════════════════════════════

test('updateDocument: un miembro edita un documento de su compañía', async () => {
  const r = res();
  await updateDocument(req({ uid: U_PLAIN_A, company: CO_A, params: { id: DOC_A }, body: { title: 'Nuevo' } }), r);
  assert.equal(r.code, 200);
  assert.equal(docs[DOC_A].title, 'Nuevo');
  assert.equal(docs[DOC_A].updated_by, U_PLAIN_A);
  assert.equal(docs[DOC_A].saved, true);
});

test('updateDocument: el documento de otra compañía da 404 y no se toca', async () => {
  const r = res();
  await updateDocument(req({ uid: U_ADMIN_A, company: CO_A, params: { id: DOC_B }, body: { title: 'X' } }), r);
  assert.equal(r.code, 404);
  assert.equal(docs[DOC_B].saved, false);
});

test('updateDocument: quien no es miembro de la compañía del contexto recibe 403', async () => {
  const r = res();
  await updateDocument(req({ uid: U_MEMBER_B, company: CO_A, params: { id: DOC_A }, body: { title: 'X' } }), r);
  assert.equal(r.code, 403);
  assert.equal(docs[DOC_A].saved, false);
});

test('updateDocument: sin contexto de compañía responde 400', async () => {
  const r = res();
  await updateDocument(req({ uid: U_ADMIN_A, params: { id: DOC_A }, body: { title: 'X' } }), r);
  assert.equal(r.code, 400);
});

test('updateDocument: campos no editables dan 400; company_id en el body es solo el selector', async () => {
  const r = res();
  await updateDocument(req({
    uid: U_ADMIN_A, company: CO_A, params: { id: DOC_A },
    body: { company_id: CO_A, document_url: 'https://evil', version: 9 },
  }), r);
  assert.equal(r.code, 400);
  assert.deepEqual(r.body.invalid_fields, ['document_url', 'version']);
  assert.equal(docs[DOC_A].document_url, `https://s3/${DOC_A}.pdf`);
});

test('updateDocument: status solo admite active/archived', async () => {
  const r = res();
  await updateDocument(req({ uid: U_ADMIN_A, company: CO_A, params: { id: DOC_A }, body: { status: 'replaced' } }), r);
  assert.equal(r.code, 400);
});

// ═══ DELETE /api/document/:id ═══════════════════════════════════════════════

test('deleteDocument: borra el documento de la propia compañía (S3 + registro)', async () => {
  const r = res();
  await deleteDocument(req({ uid: U_ADMIN_A, company: CO_A, params: { id: DOC_A } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.docDeletes, [DOC_A]);
  assert.equal(calls.s3Deletes.length, 1);
});

test('deleteDocument: el documento de otra compañía da 404 y no borra nada, ni en S3', async () => {
  const r = res();
  await deleteDocument(req({ uid: U_ADMIN_A, company: CO_A, params: { id: DOC_B } }), r);
  assert.equal(r.code, 404);
  assert.deepEqual(calls.docDeletes, []);
  assert.deepEqual(calls.s3Deletes, []);
});

test('deleteDocument: el super_user de plataforma borra con el contexto de la compañía dueña', async () => {
  const r = res();
  await deleteDocument(req({ uid: U_PLATFORM, company: CO_B, params: { id: DOC_B } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.docDeletes, [DOC_B]);
});

// ═══ POST /api/staff/force-logout ═══════════════════════════════════════════

test('forceEndSession: cerrar la propia sesión siempre se permite y borra la cookie', async () => {
  const r = res();
  await forceEndSession(req({ uid: U_PLAIN_A, company: CO_A, body: { email: 'plain@a.com' } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.redisDel, [`staff_session:${U_PLAIN_A}`, `staff_session:${U_PLAIN_A}:owner`]);
  assert.ok('token' in r.cookies);
});

test('forceEndSession: sin staff:update no se cierra la sesión de otro', async () => {
  const r = res();
  await forceEndSession(req({ uid: U_PLAIN_A, company: CO_A, body: { email: 'admin@a.com' } }), r);
  assert.equal(r.code, 403);
  assert.deepEqual(calls.redisDel, []);
});

test('forceEndSession: un admin de la compañía echa a un miembro de la misma, sin perder su cookie', async () => {
  const r = res();
  await forceEndSession(req({ uid: U_ADMIN_A, company: CO_A, body: { email: 'plain@a.com' } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.redisDel, [`staff_session:${U_PLAIN_A}`, `staff_session:${U_PLAIN_A}:owner`]);
  assert.equal('token' in r.cookies, false);
  assert.equal(calls.logs[0].staff_member_id, U_ADMIN_A);
  assert.equal(calls.logs[0].target_id, U_PLAIN_A);
});

test('forceEndSession: un admin de A no puede echar a un usuario que solo está en B', async () => {
  const r = res();
  await forceEndSession(req({ uid: U_ADMIN_A, company: CO_A, body: { email: 'member@b.com' } }), r);
  assert.equal(r.code, 403);
  assert.deepEqual(calls.redisDel, []);
});

test('forceEndSession: el super_user de plataforma puede echar a cualquiera', async () => {
  const r = res();
  await forceEndSession(req({ uid: U_PLATFORM, body: { email: 'member@b.com' } }), r);
  assert.equal(r.code, 200);
});

// ═══ PATCH /api/admin/profile/:id ═══════════════════════════════════════════

test('editAdminUser: el propio usuario cambia sus campos personales', async () => {
  const r = res();
  await editAdminUser(req({ uid: U_PLAIN_A, company: CO_A, params: { id: U_PLAIN_A }, body: { name: 'Ana', phone: '555' } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.updates[0].update, { name: 'Ana', phone: '555' });
  assert.deepEqual(r.body.ignored_fields, []);
});

test('editAdminUser: el propio usuario NO puede darse super_user ni tocar companiesAssigned', async () => {
  const r = res();
  await editAdminUser(req({
    uid: U_PLAIN_A, company: CO_A, params: { id: U_PLAIN_A },
    body: { name: 'Ana', super_user: true, companiesAssigned: [] },
  }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.updates[0].update, { name: 'Ana' });
  assert.deepEqual(r.body.ignored_fields.sort(), ['companiesAssigned', 'super_user']);
});

test('editAdminUser: si solo manda campos que no puede tocar, 403 y no escribe', async () => {
  const r = res();
  await editAdminUser(req({ uid: U_PLAIN_A, company: CO_A, params: { id: U_PLAIN_A }, body: { super_user: true } }), r);
  assert.equal(r.code, 403);
  assert.equal(calls.updates.length, 0);
});

test('editAdminUser: editar a otro sin ser super_user de la compañía da 403 (un admin tampoco)', async () => {
  const r = res();
  await editAdminUser(req({ uid: U_ADMIN_A, company: CO_A, params: { id: U_PLAIN_A }, body: { name: 'X' } }), r);
  assert.equal(r.code, 403);
  assert.equal(calls.updates.length, 0);
});

test('editAdminUser: el super_user de la compañía edita a un miembro, pero nunca los campos protegidos', async () => {
  const r = res();
  await editAdminUser(req({
    uid: U_SUPER_A, company: CO_A, params: { id: U_PLAIN_A },
    body: { companiesAssigned: [{ company: 'A' }], active: false, super_user: true, password: 'x', email: 'h@x.com' },
  }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.updates[0].update, { companiesAssigned: [{ company: 'A' }], active: false });
  assert.deepEqual(r.body.ignored_fields.sort(), ['email', 'password', 'super_user']);
});

test('editAdminUser: el super_user de A no edita a un usuario que solo está en B', async () => {
  const r = res();
  await editAdminUser(req({ uid: U_SUPER_A, company: CO_A, params: { id: U_MEMBER_B }, body: { name: 'X' } }), r);
  assert.equal(r.code, 403);
  assert.equal(calls.updates.length, 0);
});

test('editAdminUser: el super_user de A no gana nada mandando x-company-id de B', async () => {
  const r = res();
  await editAdminUser(req({ uid: U_SUPER_A, company: CO_B, params: { id: U_MEMBER_B }, body: { name: 'X' } }), r);
  assert.equal(r.code, 403);
});

test('editAdminUser: el super_user de plataforma edita a cualquiera', async () => {
  const r = res();
  await editAdminUser(req({ uid: U_PLATFORM, params: { id: U_MEMBER_B }, body: { name: 'X' } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.updates[0].update, { name: 'X' });
});

test('editAdminUser: un id mal formado da 404, no 500', async () => {
  const r = res();
  await editAdminUser(req({ uid: U_PLATFORM, params: { id: 'nope' }, body: { name: 'X' } }), r);
  assert.equal(r.code, 404);
});
