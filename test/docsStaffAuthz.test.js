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
  calls = { updates: [], s3Deletes: [], docDeletes: [], redisDel: [], logs: [], folderCreates: [], folderDeletes: [], companyUpdates: [] };
  folders = { [FOLDER_A]: makeFolder(FOLDER_A, CO_A), [FOLDER_B]: makeFolder(FOLDER_B, CO_B) };
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
AdminUserStub.exists = async ({ email, _id }) =>
  Object.values(users).some((u) => u.email === email && String(u.id) !== String(_id?.$ne));
// Solo las dos formas de consulta que usa checkEmailChange (controller/admin.js).
const isMemberOf = (company, { userId, user }) =>
  company.employees.some((e) => (userId != null && String(e.userId) === String(userId)) || e.user === user);
const CompanyStub = {
  findOne: ({ _id }) => ({ lean: async () => companies[_id] ?? null }),
  findById: async (id) => companies[id] ?? null,
  exists: async (query) => {
    if (query.employees?.$elemMatch) {
      const { user, userId } = query.employees.$elemMatch;
      return Object.values(companies).some((c) =>
        c.employees.some((e) => e.user === user && String(e.userId) !== String(userId.$ne)));
    }
    const [{ 'employees.userId': userId }, { 'employees.user': user }] = query.$or;
    return Object.entries(companies).some(([id, c]) => id !== query._id?.$ne && isMemberOf(c, { userId, user }));
  },
  updateMany: async (filter, update) => { calls.companyUpdates.push({ filter, update }); },
};
let folders;
const FOLDER_A = 'fffffffffffffffffffffff1';
const FOLDER_B = 'fffffffffffffffffffffff2';
function makeFolder(id, company_id) {
  const f = { _id: id, company_id, folder_name: 'F', folder_description: 'd', documents: [], trigger_action: 't', saved: false };
  f.save = async () => { f.saved = true; return f; };
  return f;
}
function FolderStub(data) {
  Object.assign(this, data);
  this.save = async () => { calls.folderCreates.push(data); return this; };
}
FolderStub.findById = async (id) => folders[id] ?? null;
FolderStub.find = async ({ company_id }) => Object.values(folders).filter((f) => f.company_id === company_id);
FolderStub.findByIdAndDelete = async (id) => { calls.folderDeletes.push(id); };

const DocumentStub = {
  findById: async (id) => docs[id] ?? null,
  find: async () => [],
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
stub('models/Folder.js', FolderStub);
// Verificación de contratos de consumidor para el 409 de "ya firmado".
const VER_SIGNED = 'eeeeeeeeeeeeeeeeeeeeeee1';
const signedVerification = () => ({
  _id: VER_SIGNED,
  contract_list: [{ document_url: 'https://s3/a.pdf', signature: true }],
});
const verificationQuery = (id) => {
  const value = id === VER_SIGNED ? signedVerification() : null;
  const p = Promise.resolve(value);
  p.select = () => ({ lean: async () => value });
  return p;
};
stub('models/VerificationConsumersLeaseContracts.js', {
  findById: verificationQuery,
  findByIdAndUpdate: async () => { calls.verificationUpdates = (calls.verificationUpdates ?? 0) + 1; return signedVerification(); },
});
function SignatureConsumerStub(data) { this.data = data; }
SignatureConsumerStub.prototype.save = async function save() { calls.signatureSaves = (calls.signatureSaves ?? 0) + 1; };
stub('models/SignatureConsumer.js', SignatureConsumerStub);
for (const m of ['Signatures', 'EventSignature', 'Verification', 'User',
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

const {
  updateDocument,
  deleteDocument,
  createNewFolder,
  getFolders,
  getFolderByID,
  updateFolder,
  deleteFolder,
  collectingSignaturesForConsumerMember,
  addSignatureToConsumerDocument,
} = require('../controller/document');
const { forceEndSession, editAdminUser, editOtherAdminUser } = require('../controller/admin');

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

test('updateDocument: quien no es miembro de la compañía dueña recibe 404 (no confirma que exista)', async () => {
  const r = res();
  await updateDocument(req({ uid: U_MEMBER_B, company: CO_A, params: { id: DOC_A }, body: { title: 'X' } }), r);
  assert.equal(r.code, 404);
  assert.equal(docs[DOC_A].saved, false);
});

// El dashboard NO manda x-company-id a /api/document: la compañía sale del
// propio documento.
test('updateDocument: sin cabecera de compañía, un miembro de la dueña edita', async () => {
  const r = res();
  await updateDocument(req({ uid: U_ADMIN_A, params: { id: DOC_A }, body: { title: 'Sin cabecera' } }), r);
  assert.equal(r.code, 200);
  assert.equal(docs[DOC_A].title, 'Sin cabecera');
});

test('updateDocument: sin cabecera, alguien de otra compañía recibe 404', async () => {
  const r = res();
  await updateDocument(req({ uid: U_MEMBER_B, params: { id: DOC_A }, body: { title: 'X' } }), r);
  assert.equal(r.code, 404);
  assert.equal(docs[DOC_A].saved, false);
});

test('updateDocument: el payload real de EditDocument.jsx (public_document se acepta y se ignora)', async () => {
  const r = res();
  await updateDocument(req({
    uid: U_ADMIN_A,
    params: { id: DOC_A },
    body: {
      title: 'Contrato 2027',
      document_type: 'document',
      trigger_action: 'lease',
      public_document: false,
      expiration_date: '2027-12-31T23:59:59.999Z',
    },
  }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.ignored_fields, ['public_document']);
  assert.equal(docs[DOC_A].expiration_date, '2027-12-31T23:59:59.999Z');
  assert.equal('public_document' in docs[DOC_A], false);
});

test('updateDocument: expiration_date null borra la fecha (reactiva un vencido sin fecha)', async () => {
  docs[DOC_A].expiration_date = '2020-01-01T00:00:00.000Z';
  const r = res();
  await updateDocument(req({ uid: U_ADMIN_A, params: { id: DOC_A }, body: { expiration_date: null } }), r);
  assert.equal(r.code, 200);
  assert.equal(docs[DOC_A].expiration_date, null);
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

test('deleteDocument: sin cabecera de compañía (como lo llama ViewDocument.jsx) borra si es de la suya', async () => {
  const r = res();
  await deleteDocument(req({ uid: U_ADMIN_A, params: { id: DOC_A } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.docDeletes, [DOC_A]);
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

// Sin token (desde la pantalla de login): borra la sesión del email sin pedir
// contraseña — volver a entrar sigue exigiendo contraseña + MFA.
test('forceEndSession sin token: solo con el email cierra la sesión y lo atribuye al dueño', async () => {
  const r = res();
  await forceEndSession(req({ body: { email: 'plain@a.com' } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.redisDel, [`staff_session:${U_PLAIN_A}`, `staff_session:${U_PLAIN_A}:owner`]);
  assert.equal(calls.logs[0].staff_member_id, U_PLAIN_A);
  assert.equal(calls.logs[0].details.anonymous, true);
});

test('forceEndSession sin token: email desconocido da 404 y no borra nada', async () => {
  const r = res();
  await forceEndSession(req({ body: { email: 'nadie@x.com' } }), r);
  assert.equal(r.code, 404);
  assert.deepEqual(calls.redisDel, []);
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

// ═══ Carpetas de documentos (/api/document/new_folder, folders, folder/:id) ═
// Eran anónimas: cualquiera listaba, editaba o borraba carpetas de cualquier
// compañía. Ahora solo el staff de la compañía dueña.

const folderBody = { folder_name: 'N', folder_description: 'd', documents: [], trigger_action: 't' };

test('createNewFolder: un miembro crea en su compañía', async () => {
  const r = res();
  await createNewFolder(req({ uid: U_PLAIN_A, body: { ...folderBody, company_id: CO_A } }), r);
  assert.equal(r.code, 201);
  assert.equal(calls.folderCreates.length, 1);
});

test('createNewFolder: en una compañía ajena da 403 y no crea nada', async () => {
  const r = res();
  await createNewFolder(req({ uid: U_MEMBER_B, body: { ...folderBody, company_id: CO_A } }), r);
  assert.equal(r.code, 403);
  assert.equal(calls.folderCreates.length, 0);
});

test('getFolders: un miembro lista las de su compañía', async () => {
  const r = res();
  await getFolders(req({ uid: U_ADMIN_A, body: { company_id: CO_A } }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.folders.length, 1);
});

test('getFolders: las de otra compañía dan 403', async () => {
  const r = res();
  await getFolders(req({ uid: U_ADMIN_A, body: { company_id: CO_B } }), r);
  assert.equal(r.code, 403);
});

test('getFolders: la cabecera de compañía no puede contradecir al body', async () => {
  const r = res();
  await getFolders(req({ uid: U_ADMIN_A, company: CO_A, body: { company_id: CO_B } }), r);
  assert.equal(r.code, 403);
});

test('getFolderByID: la carpeta de otra compañía da 404', async () => {
  const r = res();
  await getFolderByID(req({ uid: U_ADMIN_A, params: { id: FOLDER_B } }), r);
  assert.equal(r.code, 404);
});

test('getFolderByID: un miembro de la dueña la ve', async () => {
  const r = res();
  await getFolderByID(req({ uid: U_ADMIN_A, params: { id: FOLDER_A } }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.folder._id, FOLDER_A);
});

test('updateFolder: la carpeta de otra compañía da 404 y no se toca', async () => {
  const r = res();
  await updateFolder(req({ uid: U_ADMIN_A, params: { id: FOLDER_B }, body: folderBody }), r);
  assert.equal(r.code, 404);
  assert.equal(folders[FOLDER_B].saved, false);
});

test('updateFolder: un miembro edita la suya', async () => {
  const r = res();
  await updateFolder(req({ uid: U_PLAIN_A, params: { id: FOLDER_A }, body: { ...folderBody, folder_name: 'Nueva' } }), r);
  assert.equal(r.code, 200);
  assert.equal(folders[FOLDER_A].folder_name, 'Nueva');
});

test('deleteFolder: la carpeta de otra compañía da 404 y no se borra', async () => {
  const r = res();
  await deleteFolder(req({ uid: U_ADMIN_A, params: { id: FOLDER_B } }), r);
  assert.equal(r.code, 404);
  assert.deepEqual(calls.folderDeletes, []);
});

test('deleteFolder: el super_user de plataforma borra aunque no sea miembro', async () => {
  const r = res();
  await deleteFolder(req({ uid: U_PLATFORM, params: { id: FOLDER_B } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.folderDeletes, [FOLDER_B]);
});

test('deleteFolder: un id mal formado da 404, no 500', async () => {
  const r = res();
  await deleteFolder(req({ uid: U_ADMIN_A, params: { id: 'nope' } }), r);
  assert.equal(r.code, 404);
});

// ═══ Firma por enlace del correo: una sola vez (respaldo del token) ═════════

test('firma por enlace: un contrato ya firmado no se vuelve a firmar (409, nada se guarda)', async () => {
  const body = { verification_id: VER_SIGNED, contract_url: 'https://s3/a.pdf', signature: 'Ana' };
  const r1 = res();
  await collectingSignaturesForConsumerMember({ ...req({ body }), contractLink: { jti: 'x' } }, r1);
  assert.equal(r1.code, 409);
  assert.equal(calls.signatureSaves, undefined);

  const r2 = res();
  await addSignatureToConsumerDocument({ ...req({ body }), contractLink: { jti: 'x' } }, r2);
  assert.equal(r2.code, 409);
  assert.equal(calls.verificationUpdates, undefined);
});

// ═══ PATCH /api/staff/edit-admin/:id · /api/admin/admin-user/:id (2026-10-19) ══
// Hasta el 2026-10-19 el body entero iba a findByIdAndUpdate: con staff:update en
// una compañía se le podía poner super_user a cualquier usuario de cualquier otra.

test('editOtherAdminUser: los campos que manda el dashboard se aplican', async () => {
  const r = res();
  const body = {
    name: 'Ana', lastName: 'Diaz', email: 'plain@a.com', phone: '555', imageProfile: 'data:x',
    online: false, emailNotifications: { newsAndUpdates: true }, dailySummaries: true,
    subscriptionRenewals: false, eventReminder: true,
  };
  await editOtherAdminUser(req({ uid: U_ADMIN_A, company: CO_A, params: { id: U_PLAIN_A }, body }), r);
  assert.equal(r.code, 200);
  // el email no cambia: no se reescribe ni se tocan membresías
  const { email: _unchanged, ...applied } = body;
  assert.deepEqual(calls.updates[0].update, applied);
  assert.equal(calls.companyUpdates.length, 0);
  assert.equal(r.body.ignored_fields, undefined);
});

// ═══ A3 (2026-10-27): cambio de email ═══════════════════════════════════════
// Las membresías sin userId se casan por email: cambiar uno cambiaba de quién
// eran.

test('email: un admin cambia el de alguien que solo está en su compañía, y las membresías lo siguen', async () => {
  const r = res();
  await editOtherAdminUser(req({ uid: U_ADMIN_A, company: CO_A, params: { id: U_PLAIN_A }, body: { email: ' nuevo@a.com ' } }), r);
  assert.equal(r.code, 200);
  assert.equal(calls.updates[0].update.email, 'nuevo@a.com');
  assert.equal(calls.companyUpdates.length, 1);
  assert.deepEqual(calls.companyUpdates[0].update.$set, {
    'employees.$[e].user': 'nuevo@a.com',
    'employees.$[e].email': 'nuevo@a.com',
    'employees.$[e].userId': U_PLAIN_A,
  });
});

test('email: no se puede tomar el de una invitación o membresía de otra compañía (409)', async () => {
  companies[CO_B].employees.push({ user: 'invitado@b.com', roleType: 'admin' }); // pendiente, sin userId
  const r = res();
  await editOtherAdminUser(req({ uid: U_ADMIN_A, params: { id: U_ADMIN_A }, body: { email: 'invitado@b.com' } }), r);
  assert.equal(r.code, 409);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.companyUpdates.length, 0);
});

test('email: no se puede tomar el de otra cuenta (409)', async () => {
  const r = res();
  await editOtherAdminUser(req({ uid: U_ADMIN_A, company: CO_A, params: { id: U_PLAIN_A }, body: { email: 'member@b.com' } }), r);
  assert.equal(r.code, 409);
  assert.equal(calls.updates.length, 0);
});

test('email: el de alguien que también está en otra compañía solo lo cambia la plataforma', async () => {
  companies[CO_B].employees.push({ userId: U_PLAIN_A, user: 'plain@a.com', roleType: 'assistant' });
  const admin = res();
  await editOtherAdminUser(req({ uid: U_ADMIN_A, company: CO_A, params: { id: U_PLAIN_A }, body: { email: 'x@a.com' } }), admin);
  assert.equal(admin.code, 403);
  assert.equal(calls.updates.length, 0);
  const platform = res();
  await editOtherAdminUser(req({ uid: U_PLATFORM, params: { id: U_PLAIN_A }, body: { email: 'x@a.com' } }), platform);
  assert.equal(platform.code, 200);
});

test('email: formato inválido → 400', async () => {
  const r = res();
  await editOtherAdminUser(req({ uid: U_ADMIN_A, company: CO_A, params: { id: U_PLAIN_A }, body: { email: 'no-es-email' } }), r);
  assert.equal(r.code, 400);
  assert.equal(calls.updates.length, 0);
});

test('editOtherAdminUser: super_user, platform_observer, tokenVersion, MFA y contraseña se descartan', async () => {
  const r = res();
  await editOtherAdminUser(req({
    uid: U_ADMIN_A, company: CO_A, params: { id: U_PLAIN_A },
    body: {
      name: 'Ana', super_user: true, platform_observer: true, tokenVersion: 0,
      mfaEnabled: false, mfaSecret: 'x', password: 'p', companiesAssigned: [CO_B], active: true,
    },
  }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.updates[0].update, { name: 'Ana' });
  assert.deepEqual(r.body.ignored_fields.sort(), [
    'active', 'companiesAssigned', 'mfaEnabled', 'mfaSecret', 'password', 'platform_observer', 'super_user', 'tokenVersion',
  ]);
});

test('editOtherAdminUser: solo campos prohibidos → 400 y no escribe', async () => {
  const r = res();
  await editOtherAdminUser(req({ uid: U_ADMIN_A, company: CO_A, params: { id: U_PLAIN_A }, body: { super_user: true } }), r);
  assert.equal(r.code, 400);
  assert.equal(calls.updates.length, 0);
});

test('editOtherAdminUser: un usuario de OTRA compañía → 404 y no escribe', async () => {
  const r = res();
  await editOtherAdminUser(req({ uid: U_ADMIN_A, company: CO_A, params: { id: U_MEMBER_B }, body: { name: 'X' } }), r);
  assert.equal(r.code, 404);
  assert.equal(calls.updates.length, 0);
});

test('editOtherAdminUser: sin cabecera de compañía no se edita a otro (404)', async () => {
  const r = res();
  await editOtherAdminUser(req({ uid: U_ADMIN_A, params: { id: U_PLAIN_A }, body: { name: 'X' } }), r);
  assert.equal(r.code, 404);
});

test('editOtherAdminUser: uno mismo y el super_user de plataforma no dependen de la compañía', async () => {
  const self = res();
  await editOtherAdminUser(req({ uid: U_MEMBER_B, params: { id: U_MEMBER_B }, body: { online: false } }), self);
  assert.equal(self.code, 200);
  const platform = res();
  await editOtherAdminUser(req({ uid: U_PLATFORM, params: { id: U_MEMBER_B }, body: { name: 'Y' } }), platform);
  assert.equal(platform.code, 200);
});

test('editOtherAdminUser: id inexistente o mal formado → 404', async () => {
  for (const id of ['nope', '999999999999999999999999']) {
    const r = res();
    await editOtherAdminUser(req({ uid: U_ADMIN_A, company: CO_A, params: { id }, body: { name: 'X' } }), r);
    assert.equal(r.code, 404, id);
  }
});
