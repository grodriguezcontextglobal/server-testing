/**
 * Tests for POST /api/registration/accept-invitation
 *
 * Cubre:
 *  - 400 sin invitationToken firmado (antes bastaba saber el email invitado)
 *  - 409 si la invitación ya se aceptó; companiesAssigned lo escribe el servidor
 *  - new_invitation: el enlace lo firma el servidor (attachInvitationLink)
 *  - 404 cuando la empresa no existe en MongoDB
 *  - 404 cuando no hay invitación pendiente para ese email
 *  - 201 usuario nuevo: crea AdminUser + staff_member + company_staff
 *  - 200 usuario existente: reutiliza AdminUser + inserta company_staff
 *  - company_staff usa sqlCompanyId INT, no Mongo ObjectId
 *  - el rol sale de la invitación (Company.employees), NUNCA del body
 *  - roleType desconocido en la invitación queda como "assistant"
 *  - fallo en SQL es no bloqueante (responde ok igual)
 */

"use strict";

const { describe, it, before, afterEach } = require("node:test");
const assert = require("node:assert/strict");

// ── stubs configurables ───────────────────────────────────────────────────────

const sqlBehavior = {
  failStaffInsert:    false,
  failCompanyLookup:  false,
  failStaffSync:      false,
  existingStaffId:    null,   // null → INSERT path; number → SELECT retorna ese id
  companyId:          77,
};

const capturedSQL = { companyStaffRows: [], staffMemberRows: [], roleLookups: [] };

function makeSqlConn() {
  return {
    execute: async (sql, params) => {
      const q = sql.trim().toUpperCase();

      if (q.startsWith("INSERT INTO STAFF_MEMBER")) {
        if (sqlBehavior.failStaffInsert) throw new Error("staff_member insert error");
        capturedSQL.staffMemberRows.push(params);
        return [{ insertId: 42 }];
      }

      if (q.startsWith("SELECT STAFF_ID FROM STAFF_MEMBER")) {
        if (sqlBehavior.existingStaffId !== null) {
          return [[{ staff_id: sqlBehavior.existingStaffId }]];
        }
        return [[]];
      }

      if (q.startsWith("SELECT COMPANY_ID FROM COMPANY_INFO")) {
        if (sqlBehavior.failCompanyLookup) throw new Error("company_info lookup error");
        return [[{ company_id: sqlBehavior.companyId }]];
      }

      return [[]];
    },
    query: async (sql, params) => {
      const q = sql.trim().toUpperCase();

      if (q.startsWith("SELECT ID FROM ROLES")) {
        capturedSQL.roleLookups.push(params[0]);
        return [[{ id: 5 }]];
      }

      if (q.startsWith("INSERT IGNORE INTO COMPANY_STAFF")) {
        if (sqlBehavior.failStaffSync) throw new Error("company_staff insert error");
        capturedSQL.companyStaffRows.push(params);
        return [{ affectedRows: 1 }];
      }

      return [[]];
    },
  };
}

// ── stubs de modelos y helpers ────────────────────────────────────────────────

const adminUserDocs = {};
const companyDocs   = {};

// AdminUser debe funcionar como constructor Y tener findOne estático
function AdminUserStub(data) {
  Object.assign(this, data);
  this.id = "new-mongo-uid-" + data.email;
  this._id = this.id;
  this.saved = false;
  this.save = async () => { this.saved = true; };
  adminUserDocs[data.email] = this; // registrar para findOne posterior
}
AdminUserStub.findOne = async ({ email } = {}) => {
  if (email) return adminUserDocs[email] ?? null;
  return null;
};

const CompanyStub = {
  findOne: async ({ _id }) => Object.values(companyDocs).find((c) => c._id === _id) ?? null,
};
const assignmentUpdates = [];
AdminUserStub.updateOne = async (filter, update) => { assignmentUpdates.push({ filter, update }); return {}; };

const loggerStub = { warn: () => {}, error: () => {}, info: () => {} };

// ── inyección de módulos antes de importar el controlador ─────────────────────

before(() => {
  const Module = require("node:module");
  const path   = require("node:path");

  const root = path.resolve(__dirname, "..");
  const resolve = (rel) => path.join(root, rel);

  const bcryptStub = { genSalt: async () => "salt", hash: async (pw) => `hashed:${pw}` };

  require.cache[resolve("models/AdminUser.js")] = { id: resolve("models/AdminUser.js"), filename: resolve("models/AdminUser.js"), loaded: true, exports: AdminUserStub };
  require.cache[resolve("models/Company.js")]   = { id: resolve("models/Company.js"),   filename: resolve("models/Company.js"),   loaded: true, exports: CompanyStub   };
  require.cache[resolve("mysql/database/config.js")] = { id: resolve("mysql/database/config.js"), filename: resolve("mysql/database/config.js"), loaded: true, exports: () => makeSqlConn() };
  require.cache[resolve("helpers/logger.js")]   = { id: resolve("helpers/logger.js"),   filename: resolve("helpers/logger.js"),   loaded: true, exports: loggerStub    };
  require.cache[resolve("helpers/jwt.js")]      = { id: resolve("helpers/jwt.js"),       filename: resolve("helpers/jwt.js"),       loaded: true, exports: { generateJWT: async () => "tok.test.jwt" } };
  // bcrypt se importa directamente en el controlador — stubbear el paquete
  require.cache[require.resolve("bcrypt")]      = { id: require.resolve("bcrypt"),       filename: require.resolve("bcrypt"),       loaded: true, exports: bcryptStub    };
});

afterEach(() => {
  capturedSQL.companyStaffRows = [];
  capturedSQL.staffMemberRows  = [];
  capturedSQL.roleLookups      = [];
  sqlBehavior.failStaffInsert   = false;
  sqlBehavior.failCompanyLookup = false;
  sqlBehavior.failStaffSync     = false;
  sqlBehavior.existingStaffId   = null;
  sqlBehavior.companyId         = 77;

  assignmentUpdates.length = 0;
  for (const k of Object.keys(adminUserDocs)) delete adminUserDocs[k];
  for (const k of Object.keys(companyDocs))     delete companyDocs[k];
});

// ── helpers de test ───────────────────────────────────────────────────────────

function mockRes() {
  const res = {};
  res.status = (code) => { res._code = code; return res; };
  res.json   = (body)  => { res._body = body; return res; };
  return res;
}

// `employees` refleja la invitación que ya creó quien invita: el email y el
// roleType asignado. El controlador exige que exista y toma el rol de ahí.
function makeCompanyDoc(name = "Acme Corp", employees = null) {
  return {
    _id: "mongo-company-id",
    id:  "mongo-company-id",
    company_name: name,
    employees: employees ?? [
      { user: "invited@test.com", status: "Pending", userId: null, roleType: "assistant" },
    ],
    saved: false,
    save: async function () { this.saved = true; },
  };
}

function invitationFor(email, roleType = "assistant") {
  return [{ user: email, status: "Pending", userId: null, roleType }];
}

function makeAdminUserDoc(email = "invited@test.com") {
  return {
    id: "existing-mongo-uid",
    _id: "existing-mongo-uid",
    name: "Juan",
    lastName: "Perez",
    email,
    phone: "",
    imageProfile: "",
    role: 0,
    save: async function () {},
  };
}

// ── importación tardía del controlador ───────────────────────────────────────

let acceptInvitation, attachInvitationLink, generateInvitationToken;
before(() => {
  process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || "test-seed";
  ({ acceptInvitation, attachInvitationLink } = require("../controller/registration"));
  ({ generateInvitationToken } = require("../helpers/invitationToken"));
});

// El enlace del correo: token firmado con el email invitado y la compañía.
const tokenFor = (email, companyId = "mongo-company-id") => generateInvitationToken({ email, companyId });

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/registration/accept-invitation", () => {

  it("400 invitationLinkInvalid sin token, con token falso o con un objeto", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc("Acme Corp");
    for (const invitationToken of [undefined, "basura", { $ne: null }]) {
      const res = mockRes();
      await acceptInvitation({ body: {
        invitationToken,
        user: { email: "invited@test.com", password: "Abc123!@" },
        company: { company_name: "Acme Corp" },
      } }, res);
      assert.equal(res._code, 400);
      assert.equal(res._body.invitationLinkInvalid, true);
    }
    assert.equal(capturedSQL.companyStaffRows.length, 0);
  });

  it("404 si la empresa del token no existe en MongoDB", async () => {
    const res = mockRes();
    await acceptInvitation({ body: {
      invitationToken: await tokenFor("x@x.com", "otra-company"),
      user: { name: "X", lastName: "Y", password: "Abc123!@" },
    } }, res);
    assert.equal(res._code, 404);
    assert.equal(res._body.ok, false);
  });

  it("404 si no hay invitación pendiente para el email del token", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc("Acme Corp"); // invita a invited@test.com

    const res = mockRes();
    await acceptInvitation({ body: {
      invitationToken: await tokenFor("nadie@test.com"),
      user: { name: "Intruso", lastName: "X", password: "Abc123!@" },
    } }, res);

    assert.equal(res._code, 404);
    // Y sobre todo: no se le dio acceso en SQL
    assert.equal(capturedSQL.companyStaffRows.length, 0);
    assert.equal(capturedSQL.staffMemberRows.length, 0);
  });

  it("el email sale del token: el user.email del body se ignora", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc("Acme Corp", invitationFor("maria@test.com"));

    const res = mockRes();
    await acceptInvitation({ body: {
      invitationToken: await tokenFor("maria@test.com"),
      user: { name: "M", lastName: "L", email: "atacante@test.com", password: "Secure1!X" },
    } }, res);

    assert.equal(res._code, 201);
    assert.equal(res._body.user.email, "maria@test.com");
    assert.equal(adminUserDocs["atacante@test.com"], undefined);
  });

  it("409 si la invitación ya se aceptó (el enlace es de un solo uso)", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc("Acme Corp", [
      { user: "maria@test.com", status: "Confirmed", userId: "u", roleType: "assistant" },
    ]);
    const res = mockRes();
    await acceptInvitation({ body: {
      invitationToken: await tokenFor("maria@test.com"),
      user: { password: "Secure1!X" },
    } }, res);
    assert.equal(res._code, 409);
    assert.equal(res._body.invitationAlreadyAccepted, true);
    assert.equal(capturedSQL.companyStaffRows.length, 0);
  });

  it("el rol sale de la invitación, no del body", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc(
      "Acme Corp",
      invitationFor("maria@test.com", "assistant")
    );

    const res = mockRes();
    await acceptInvitation({ body: {
      invitationToken: await tokenFor("maria@test.com"),
      user: { name: "Maria", lastName: "Lopez", password: "Secure1!X" },
      roleType: "root_admin", // intento de escalada — debe ignorarse
    } }, res);

    assert.equal(res._code, 201);
    assert.deepEqual(capturedSQL.roleLookups, ["assistant"]);
    assert.equal(res._body.company.roleType, "assistant");
  });

  it("201 usuario nuevo: crea AdminUser, staff_member, company_staff y companiesAssigned", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc(
      "Acme Corp",
      [{ user: "maria@test.com", status: "Pending", userId: null, roleType: "admin", role: "1" }]
    );

    const res = mockRes();
    await acceptInvitation({ body: {
      invitationToken: await tokenFor("maria@test.com"),
      user: { name: "Maria", lastName: "Lopez", password: "Secure1!X" },
    } }, res);

    assert.equal(res._code, 201);
    assert.equal(res._body.user.email, "maria@test.com");
    assert.equal(res._body.user.isNewUser, true);

    assert.equal(capturedSQL.staffMemberRows.length, 1);
    assert.equal(capturedSQL.staffMemberRows[0][2], "maria@test.com");

    // company_staff insertado con INT, no Mongo ObjectId
    assert.equal(capturedSQL.companyStaffRows.length, 1);
    const [, companyIdArg] = capturedSQL.companyStaffRows[0];
    assert.equal(companyIdArg, 77);

    assert.equal(assignmentUpdates.length, 1);
    assert.deepEqual(assignmentUpdates[0].update.$push.companiesAssigned, {
      company: "Acme Corp", active: true, super_user: false, role_type: "admin", role: "1",
    });
    assert.equal(assignmentUpdates[0].update.$set, undefined, "primera compañía: multipleCompanies no cambia");
  });

  it("200 usuario existente: reutiliza user, company_staff y añade la compañía a companiesAssigned", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc(
      "Acme Corp",
      invitationFor("existing@test.com", "assistant")
    );
    adminUserDocs["existing@test.com"] = {
      ...makeAdminUserDoc("existing@test.com"),
      companiesAssigned: [{ company: "Otra" }],
    };
    sqlBehavior.existingStaffId = 99;

    const res = mockRes();
    await acceptInvitation({ body: {
      invitationToken: await tokenFor("existing@test.com"),
    } }, res);

    assert.equal(res._code, 200);
    assert.equal(res._body.user.isNewUser, false);
    assert.equal(capturedSQL.staffMemberRows.length, 0);
    assert.equal(capturedSQL.companyStaffRows.length, 1);
    const [, , staffIdArg] = capturedSQL.companyStaffRows[0];
    assert.equal(staffIdArg, 99);

    assert.equal(assignmentUpdates.length, 1);
    assert.deepEqual(assignmentUpdates[0].filter, {
      _id: "existing-mongo-uid", "companiesAssigned.company": { $ne: "Acme Corp" },
    });
    assert.deepEqual(assignmentUpdates[0].update.$set, { multipleCompanies: true });
  });

  it("no duplica la compañía si ya estaba en companiesAssigned", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc("Acme Corp", invitationFor("existing@test.com"));
    adminUserDocs["existing@test.com"] = {
      ...makeAdminUserDoc("existing@test.com"),
      companiesAssigned: [{ company: "Acme Corp" }],
    };
    const res = mockRes();
    await acceptInvitation({ body: { invitationToken: await tokenFor("existing@test.com") } }, res);
    assert.equal(res._code, 200);
    assert.equal(assignmentUpdates.length, 0);
  });

  it("roleType desconocido en la invitación normaliza a 'assistant'", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc(
      "Acme Corp",
      invitationFor("z@test.com", "god_mode")
    );

    const res = mockRes();
    await acceptInvitation({ body: {
      invitationToken: await tokenFor("z@test.com"),
      user: { name: "Z", lastName: "Z", password: "Abc123!@" },
    } }, res);

    assert.equal(res._code, 201);
    assert.deepEqual(capturedSQL.roleLookups, ["assistant"]);
    assert.equal(capturedSQL.companyStaffRows.length, 1);
  });

  it("fallo SQL en staff_member no bloquea la respuesta", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc(
      "Acme Corp",
      invitationFor("fail@test.com", "assistant")
    );
    sqlBehavior.failStaffInsert = true;

    const res = mockRes();
    await acceptInvitation({ body: {
      invitationToken: await tokenFor("fail@test.com"),
      user: { name: "A", lastName: "B", password: "Abc123!@" },
    } }, res);

    assert.equal(res._code, 201);
    assert.equal(res._body.ok, true);
    assert.equal(capturedSQL.companyStaffRows.length, 0);
  });

  it("MongoDB company employees marca status 'Confirmed' para el usuario invitado", async () => {
    const doc = makeCompanyDoc("Acme Corp");
    companyDocs["Acme Corp"] = doc;

    const res = mockRes();
    await acceptInvitation({ body: {
      invitationToken: await tokenFor("invited@test.com"),
      user: { name: "C", lastName: "D", password: "Abc123!@" },
    } }, res);

    assert.equal(doc.saved, true);
    const emp = doc.employees.find(e => e.user === "invited@test.com");
    assert.equal(emp.status, "Confirmed");
  });
});

describe("POST /api/nodemailer/new_invitation (attachInvitationLink)", () => {
  const attach = async (req) => {
    const res = mockRes();
    let nexted = false;
    await attachInvitationLink(req, res, () => { nexted = true; });
    return { res, req, nexted };
  };

  it("arma el enlace firmado y descarta el link del cliente", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc("Acme Corp", [
      { user: "maria@test.com", firstName: "Maria", lastName: "Lopez", status: "Pending" },
    ]);
    const { req, nexted } = await attach({
      notificationSession: { uid: "inviter" },
      verifiedCompanyId: "mongo-company-id",
      body: { consumer: " maria@test.com ", link: "https://evil.example/x" },
    });
    assert.equal(nexted, true);
    const url = new URL(req.body.link);
    assert.equal(url.pathname, "/invitation");
    assert.equal(url.searchParams.get("email"), "maria@test.com");
    assert.equal(url.searchParams.get("company"), "mongo-company-id");
    assert.equal(url.searchParams.get("company_name"), "Acme Corp");

    // Y ese token es el que acepta la invitación
    const res = mockRes();
    await acceptInvitation({ body: {
      invitationToken: url.searchParams.get("token"),
      user: { name: "Maria", lastName: "Lopez", password: "Secure1!X" },
    } }, res);
    assert.equal(res._code, 201);
  });

  it("401 sin sesión o sin compañía verificada", async () => {
    for (const req of [
      { body: { consumer: "maria@test.com" } },
      { notificationSession: { uid: "u" }, body: { consumer: "maria@test.com" } },
    ]) {
      const { res, nexted } = await attach(req);
      assert.equal(res._code, 401);
      assert.equal(nexted, false);
    }
  });

  it("404 si el email no tiene invitación pendiente en la compañía de la sesión", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc("Acme Corp", [
      { user: "ya@test.com", status: "Confirmed" },
    ]);
    for (const consumer of ["otro@test.com", "ya@test.com"]) {
      const { res, nexted } = await attach({
        notificationSession: { uid: "u" },
        verifiedCompanyId: "mongo-company-id",
        body: { consumer },
      });
      assert.equal(res._code, 404, consumer);
      assert.equal(nexted, false);
    }
  });
});
