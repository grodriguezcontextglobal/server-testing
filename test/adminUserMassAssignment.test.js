/**
 * POST /api/admin/new_admin_user — createAdminUser
 *
 * La ruta es anónima (no lleva validateJWT), así que el body es dato hostil.
 * Antes hacía `new AdminUser(request.body)`: cualquiera podía sembrar
 * `super_user: true` y con eso saltarse authorizeMongoPermission por completo.
 * Estos tests fijan la lista blanca.
 */

"use strict";

const { describe, it, before, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// ── stubs ─────────────────────────────────────────────────────────────────────

const created = [];      // payloads que llegaron al constructor de AdminUser
const existingByEmail = {};

function AdminUserStub(data) {
  Object.assign(this, data);
  created.push({ ...data });
  this.id = "uid-1";
  this.save = async () => {};
}
AdminUserStub.findOne = async ({ email } = {}) => existingByEmail[email] ?? null;

const noop = () => {};
const loggerStub = { warn: noop, error: noop, info: noop };

before(() => {
  const root = path.resolve(__dirname, "..");
  const resolve = (rel) => path.join(root, rel);
  const stub = (rel, exports) => {
    const filename = resolve(rel);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };

  stub("models/AdminUser.js", AdminUserStub);
  stub("helpers/jwt.js", { generateJWT: async () => "tok.test.jwt" });
  stub("mysql/database/config.js", () => ({ execute: async () => [[]] }));
  stub("models/StripeTransaction.js", {});
  stub("database/cacheMemoryConfig.js", {
    clientRedis: async () => ({ set: async () => "OK", get: async () => null, del: async () => 1 }),
  });
  stub("nodeMailer/notifications.js", { loginActivityNotification: async () => ({ success: true }) });
  stub("helpers/logger.js", loggerStub);
  stub("controller/staffActivityLog.js", { logStaffActivity: async () => {} });

  const bcryptPath = require.resolve("bcryptjs");
  require.cache[bcryptPath] = {
    id: bcryptPath,
    filename: bcryptPath,
    loaded: true,
    exports: { genSaltSync: () => "salt", hashSync: (pw) => `hashed:${pw}` },
  };
});

afterEach(() => {
  created.length = 0;
  for (const k of Object.keys(existingByEmail)) delete existingByEmail[k];
});

function mockRes() {
  const res = { _cookies: {} };
  res.status = (code) => { res._code = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  res.cookie = (name, value) => { res._cookies[name] = value; return res; };
  return res;
}

let createAdminUser;
before(() => {
  ({ createAdminUser } = require("../controller/admin"));
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("createAdminUser: lista blanca de campos", () => {

  it("ignora super_user, role, role_type, company y companiesAssigned del body", async () => {
    const req = {
      body: {
        name: "Maria",
        lastName: "Lopez",
        email: "maria@test.com",
        password: "Secure1!X",
        phone: "555",
        // todo lo de abajo es un intento de escalada
        super_user: true,
        role: "0",
        role_type: "root_admin",
        company: "Acme Corp",
        companiesAssigned: [{ company: "Acme Corp", super_user: true, roleType: "root_admin" }],
        active: false,
        tokenVersion: 99,
        question: "secret question",
        answer: "secret answer",
      },
      headers: {},
    };
    const res = mockRes();

    await createAdminUser(req, res);

    assert.equal(res._code, 201);
    assert.equal(created.length, 1);

    assert.deepEqual(
      Object.keys(created[0]).sort(),
      ["email", "imageProfile", "lastName", "name", "phone"]
    );
    assert.equal(created[0].super_user, undefined);
    assert.equal(created[0].role, undefined);
    assert.equal(created[0].role_type, undefined);
    assert.equal(created[0].company, undefined);
    assert.equal(created[0].companiesAssigned, undefined);
    assert.equal(created[0].active, undefined);
    assert.equal(created[0].tokenVersion, undefined);
    assert.equal(created[0].question, undefined);
    assert.equal(created[0].answer, undefined);
  });

  it("conserva los campos legítimos y hashea el password", async () => {
    const req = {
      body: {
        name: "Juan",
        lastName: "Perez",
        email: "juan@test.com",
        password: "Secure1!X",
        phone: "123",
        imageProfile: "https://img/x.png",
      },
      headers: {},
    };
    const res = mockRes();

    await createAdminUser(req, res);

    assert.equal(res._code, 201);
    assert.equal(created[0].name, "Juan");
    assert.equal(created[0].lastName, "Perez");
    assert.equal(created[0].email, "juan@test.com");
    assert.equal(created[0].phone, "123");
    assert.equal(created[0].imageProfile, "https://img/x.png");
    // el password no se pasa por el constructor: se asigna hasheado después
    assert.equal(created[0].password, undefined);
    assert.equal(res._body.ok, true);
  });

  it("400 si el email ya existe", async () => {
    existingByEmail["dup@test.com"] = { id: "already" };
    const req = { body: { name: "A", lastName: "B", email: "dup@test.com", password: "Secure1!X" }, headers: {} };
    const res = mockRes();

    await createAdminUser(req, res);

    assert.equal(res._code, 400);
    assert.equal(created.length, 0);
  });

  it("no devuelve role ni company en la respuesta", async () => {
    const req = { body: { name: "A", lastName: "B", email: "n@test.com", password: "Secure1!X" }, headers: {} };
    const res = mockRes();

    await createAdminUser(req, res);

    assert.equal("role" in res._body, false);
    assert.equal("company" in res._body, false);
  });
});
