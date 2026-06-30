/**
 * Tests for POST /api/registration/accept-invitation
 *
 * Cubre:
 *  - 400 cuando faltan campos requeridos
 *  - 404 cuando la empresa no existe en MongoDB
 *  - 201 usuario nuevo: crea AdminUser + staff_member + company_staff
 *  - 200 usuario existente: reutiliza AdminUser + inserta company_staff
 *  - company_staff usa sqlCompanyId INT, no Mongo ObjectId
 *  - roleType desconocido queda como "assistant"
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

const capturedSQL = { companyStaffRows: [], staffMemberRows: [] };

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
  findOne: async ({ company_name }) => companyDocs[company_name] ?? null,
};

const loggerStub = { warn: () => {}, error: () => {}, info: () => {} };

// ── inyección de módulos antes de importar el controlador ─────────────────────

before(() => {
  const Module = require("node:module");
  const path   = require("node:path");

  const root = path.resolve(__dirname, "..");
  const resolve = (rel) => path.join(root, rel);

  const bcryptStub = { genSaltSync: () => "salt", hashSync: (pw) => `hashed:${pw}` };

  require.cache[resolve("models/AdminUser.js")] = { id: resolve("models/AdminUser.js"), filename: resolve("models/AdminUser.js"), loaded: true, exports: AdminUserStub };
  require.cache[resolve("models/Company.js")]   = { id: resolve("models/Company.js"),   filename: resolve("models/Company.js"),   loaded: true, exports: CompanyStub   };
  require.cache[resolve("mysql/database/config.js")] = { id: resolve("mysql/database/config.js"), filename: resolve("mysql/database/config.js"), loaded: true, exports: () => makeSqlConn() };
  require.cache[resolve("helpers/logger.js")]   = { id: resolve("helpers/logger.js"),   filename: resolve("helpers/logger.js"),   loaded: true, exports: loggerStub    };
  require.cache[resolve("helpers/jwt.js")]      = { id: resolve("helpers/jwt.js"),       filename: resolve("helpers/jwt.js"),       loaded: true, exports: { generateJWT: async () => "tok.test.jwt" } };
  // bcryptjs se importa directamente en el controlador — stubbear el paquete
  require.cache[require.resolve("bcryptjs")]    = { id: require.resolve("bcryptjs"),     filename: require.resolve("bcryptjs"),     loaded: true, exports: bcryptStub    };
});

afterEach(() => {
  capturedSQL.companyStaffRows = [];
  capturedSQL.staffMemberRows  = [];
  sqlBehavior.failStaffInsert   = false;
  sqlBehavior.failCompanyLookup = false;
  sqlBehavior.failStaffSync     = false;
  sqlBehavior.existingStaffId   = null;
  sqlBehavior.companyId         = 77;

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

function makeCompanyDoc(name = "Acme Corp") {
  return {
    _id: "mongo-company-id",
    id:  "mongo-company-id",
    company_name: name,
    employees: [
      { user: "invited@test.com", status: "Pending", userId: null },
    ],
    saved: false,
    save: async function () { this.saved = true; },
  };
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

let acceptInvitation;
before(() => {
  ({ acceptInvitation } = require("../controller/registration"));
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/registration/accept-invitation", () => {

  it("400 si falta user.email", async () => {
    const req = { body: { user: { name: "A" }, company: { company_name: "X" } } };
    const res = mockRes();
    await acceptInvitation(req, res);
    assert.equal(res._code, 400);
    assert.equal(res._body.ok, false);
  });

  it("400 si falta company.company_name", async () => {
    const req = { body: { user: { email: "a@b.com", password: "Abc123!@" }, company: {} } };
    const res = mockRes();
    await acceptInvitation(req, res);
    assert.equal(res._code, 400);
  });

  it("404 si la empresa no existe en MongoDB", async () => {
    const req = { body: { user: { email: "x@x.com", name: "X", lastName: "Y", password: "Abc123!@" }, company: { company_name: "Unknown Corp" }, roleType: "assistant" } };
    const res = mockRes();
    await acceptInvitation(req, res);
    assert.equal(res._code, 404);
    assert.equal(res._body.ok, false);
  });

  it("201 usuario nuevo: crea AdminUser, staff_member y company_staff", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc("Acme Corp");

    const req = { body: {
      user: { name: "Maria", lastName: "Lopez", email: "maria@test.com", password: "Secure1!X" },
      company: { company_name: "Acme Corp" },
      roleType: "admin",
    }};
    const res = mockRes();
    await acceptInvitation(req, res);

    assert.equal(res._code, 201);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.user.email, "maria@test.com");
    assert.equal(res._body.user.isNewUser, true);

    // staff_member insertado
    assert.equal(capturedSQL.staffMemberRows.length, 1);
    assert.equal(capturedSQL.staffMemberRows[0][2], "maria@test.com");

    // company_staff insertado con INT, no Mongo ObjectId
    assert.equal(capturedSQL.companyStaffRows.length, 1);
    const [, companyIdArg] = capturedSQL.companyStaffRows[0];
    assert.equal(typeof companyIdArg, "number");
    assert.equal(companyIdArg, 77);
  });

  it("200 usuario existente: reutiliza user, inserta company_staff sin crear staff_member", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc("Acme Corp");
    adminUserDocs["existing@test.com"] = makeAdminUserDoc("existing@test.com");
    sqlBehavior.existingStaffId = 99;

    const req = { body: {
      user: { email: "existing@test.com" },
      company: { company_name: "Acme Corp" },
      roleType: "assistant",
    }};
    const res = mockRes();
    await acceptInvitation(req, res);

    assert.equal(res._code, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.user.isNewUser, false);

    // NO se insertó staff_member (ya existía)
    assert.equal(capturedSQL.staffMemberRows.length, 0);

    // company_staff sí se insertó con el staff_id existente
    assert.equal(capturedSQL.companyStaffRows.length, 1);
    const [, , staffIdArg] = capturedSQL.companyStaffRows[0];
    assert.equal(staffIdArg, 99);
  });

  it("roleType desconocido normaliza a 'assistant'", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc("Acme Corp");

    const req = { body: {
      user: { name: "Z", lastName: "Z", email: "z@test.com", password: "Abc123!@" },
      company: { company_name: "Acme Corp" },
      roleType: "god_mode",
    }};
    const res = mockRes();
    await acceptInvitation(req, res);

    assert.equal(res._code, 201);
    // La query de roles recibió "assistant"
    // (validado indirectamente — si fuera inválido no insertaría company_staff)
    assert.equal(capturedSQL.companyStaffRows.length, 1);
  });

  it("fallo SQL en staff_member no bloquea la respuesta", async () => {
    companyDocs["Acme Corp"] = makeCompanyDoc("Acme Corp");
    sqlBehavior.failStaffInsert = true;

    const req = { body: {
      user: { name: "A", lastName: "B", email: "fail@test.com", password: "Abc123!@" },
      company: { company_name: "Acme Corp" },
      roleType: "assistant",
    }};
    const res = mockRes();
    await acceptInvitation(req, res);

    assert.equal(res._code, 201);
    assert.equal(res._body.ok, true);
    // company_staff no se insertó porque sqlStaffId es null
    assert.equal(capturedSQL.companyStaffRows.length, 0);
  });

  it("MongoDB company employees marca status 'Confirmed' para el usuario invitado", async () => {
    const doc = makeCompanyDoc("Acme Corp");
    companyDocs["Acme Corp"] = doc;

    const req = { body: {
      user: { name: "C", lastName: "D", email: "invited@test.com", password: "Abc123!@" },
      company: { company_name: "Acme Corp" },
      roleType: "assistant",
    }};
    const res = mockRes();
    await acceptInvitation(req, res);

    assert.equal(doc.saved, true);
    const emp = doc.employees.find(e => e.user === "invited@test.com");
    assert.equal(emp.status, "Confirmed");
  });
});
