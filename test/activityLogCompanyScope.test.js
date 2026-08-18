/**
 * GET /api/admin/activity-logs — alcance por compañía
 *
 * El scoping salía de AdminUser.companiesAssigned / AdminUser.company. El
 * primero solo lo mantiene el frontend y el segundo ya no existe en el schema,
 * así que un usuario con membresías reales en Company.employees terminaba con
 * 403 "No company assigned to user". Ahora el alcance se lee de
 * Company.employees, la misma fuente que authorizeMongoPermission.
 *
 * También cubre resolveCompanyContext, que decide de dónde sale la compañía
 * de un request.
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createGetStaffActivityLogs } = require("../controller/staffActivityLog");
const { resolveCompanyContext } = require("../helpers/companyContext");

function mockRes() {
  const res = {};
  res.status = (code) => { res._code = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// Captura el `query` con el que se consultó el modelo.
function makeLogModel(captured) {
  return {
    find: (query) => {
      captured.query = query;
      return {
        sort: () => ({
          skip: () => ({
            limit: () => ({ populate: async () => [] }),
          }),
        }),
      };
    },
    countDocuments: async () => 0,
  };
}

function makeHandler({ requester, memberships, captured }) {
  return createGetStaffActivityLogs({
    findAdminUserFn: async () => requester,
    findMembershipsFn: async () => memberships,
    StaffActivityLogModel: makeLogModel(captured),
  });
}

describe("getStaffActivityLogs: alcance por Company.employees", () => {

  it("scopea a las compañías donde es empleado activo, sin companiesAssigned ni company", async () => {
    const captured = {};
    const handler = makeHandler({
      // Exactamente el AdminUser que produce el registro actual: sin `company`,
      // sin `companiesAssigned`, sin `multipleCompanies`.
      requester: { id: "S1", email: "s1@test.com", super_user: false },
      memberships: [
        { _id: "companyA", company_name: "Acme Corp" },
        { _id: "companyB", company_name: "Beta LLC" },
      ],
      captured,
    });
    const res = mockRes();

    await handler({ uid: "S1", query: {} }, res);

    assert.equal(res._code, undefined); // 200 implícito vía res.json
    assert.equal(res._body.ok, true);
    // ObjectId (registros nuevos) y nombre (registros históricos) son válidos
    assert.deepEqual(captured.query.company_id, {
      $in: ["companyA", "Acme Corp", "companyB", "Beta LLC"],
    });
  });

  it("403 solo cuando no hay ninguna membresía activa", async () => {
    const captured = {};
    const handler = makeHandler({
      requester: { id: "S1", email: "s1@test.com", super_user: false },
      memberships: [],
      captured,
    });
    const res = mockRes();

    await handler({ uid: "S1", query: {} }, res);

    assert.equal(res._code, 403);
    assert.match(res._body.msg, /No company assigned/);
  });

  it("403 si filtra por una compañía en la que no es miembro", async () => {
    const captured = {};
    const handler = makeHandler({
      requester: { id: "S1", email: "s1@test.com", super_user: false },
      memberships: [{ _id: "companyA", company_name: "Acme Corp" }],
      captured,
    });
    const res = mockRes();

    await handler({ uid: "S1", query: { company_id: "companyZ" } }, res);

    assert.equal(res._code, 403);
    assert.match(res._body.msg, /Unauthorized access/);
  });

  it("acepta el filtro cuando la compañía sí está en sus membresías", async () => {
    const captured = {};
    const handler = makeHandler({
      requester: { id: "S1", email: "s1@test.com", super_user: false },
      memberships: [{ _id: "companyA", company_name: "Acme Corp" }],
      captured,
    });
    const res = mockRes();

    await handler({ uid: "S1", query: { company_id: "companyA" } }, res);

    assert.equal(res._body.ok, true);
    // Filtrar por el id trae también lo guardado bajo el nombre: es el
    // historial de la MISMA compañía, escrito antes de normalizar la clave.
    assert.deepEqual(captured.query.company_id, { $in: ["companyA", "Acme Corp"] });
  });

  // El bug reportado: el cliente manda la compañía en el header y el reporte
  // solo miraba req.query.company_id, así que devolvía el historial completo.
  it("scopea por el header x-company-id, no solo por el query string", async () => {
    const captured = {};
    const handler = makeHandler({
      requester: { id: "S1", email: "s1@test.com", super_user: false },
      memberships: [
        { _id: "companyA", company_name: "Acme Corp" },
        { _id: "companyB", company_name: "Beta LLC" },
      ],
      captured,
    });
    const res = mockRes();

    await handler(
      { uid: "S1", query: {}, headers: { "x-company-id": "companyB" } },
      res
    );

    assert.equal(res._body.ok, true);
    assert.deepEqual(captured.query.company_id, { $in: ["companyB", "Beta LLC"] });
  });

  it("el super_user también queda scopeado cuando hay contexto de compañía", async () => {
    const captured = {};
    const handler = createGetStaffActivityLogs({
      findAdminUserFn: async () => ({ id: "ROOT", super_user: true }),
      findMembershipsFn: async () => [],
      StaffActivityLogModel: makeLogModel(captured),
    });
    const res = mockRes();

    await handler(
      { uid: "ROOT", query: {}, headers: { "x-company-id": "companyA" } },
      res
    );

    assert.equal(res._body.ok, true);
    assert.equal(captured.query.company_id, "companyA");
  });

  it("acepta el filtro por nombre histórico de la compañía", async () => {
    const captured = {};
    const handler = makeHandler({
      requester: { id: "S1", email: "s1@test.com", super_user: false },
      memberships: [{ _id: "companyA", company_name: "Acme Corp" }],
      captured,
    });
    const res = mockRes();

    await handler({ uid: "S1", query: { company_id: "Acme Corp" } }, res);

    assert.equal(res._body.ok, true);
    assert.deepEqual(captured.query.company_id, { $in: ["companyA", "Acme Corp"] });
  });

  it("super_user ve todo y no consulta membresías", async () => {
    const captured = {};
    let membershipsCalled = false;
    const handler = createGetStaffActivityLogs({
      findAdminUserFn: async () => ({ id: "ROOT", super_user: true }),
      findMembershipsFn: async () => { membershipsCalled = true; return []; },
      StaffActivityLogModel: makeLogModel(captured),
    });
    const res = mockRes();

    await handler({ uid: "ROOT", query: {} }, res);

    assert.equal(res._body.ok, true);
    assert.equal(membershipsCalled, false);
    assert.equal(captured.query.company_id, undefined);
  });

  it("404 si el requester no existe", async () => {
    const handler = createGetStaffActivityLogs({
      findAdminUserFn: async () => null,
    });
    const res = mockRes();

    await handler({ uid: "GHOST", query: {} }, res);

    assert.equal(res._code, 404);
  });
});

describe("resolveCompanyContext", () => {

  it("lee el header x-company-id", () => {
    assert.equal(resolveCompanyContext({ headers: { "x-company-id": "C1" } }), "C1");
  });

  // El header gana sobre params/body/query: es el contexto que el cliente
  // eligió al loguearse, y lo que autorizó la operación. Si un valor del body
  // pudiera pisarlo, el log quedaría atribuido a otra compañía que la que
  // autorizó — y el reporte scopearía por una compañía que el caller eligió.
  it("el header x-company-id gana sobre params, body y query", () => {
    const req = {
      params: { company_id: "P" },
      body: { company_id: "B" },
      query: { company_id: "Q" },
      headers: { "x-company-id": "H" },
    };
    assert.equal(resolveCompanyContext(req), "H");
  });

  it("cae a params, body y query, en ese orden, cuando no hay header", () => {
    assert.equal(
      resolveCompanyContext({ params: { company_id: "P" }, body: { company_id: "B" }, query: { company_id: "Q" }, headers: {} }),
      "P"
    );
    assert.equal(
      resolveCompanyContext({ body: { company_id: "B" }, query: { company_id: "Q" }, headers: {} }),
      "B"
    );
    assert.equal(resolveCompanyContext({ query: { company_id: "Q" }, headers: {} }), "Q");
  });

  it("headerOnly ignora params/body/query", () => {
    const req = {
      params: { company_id: "P" },
      body: { company_id: "B" },
      query: { company_id: "Q" },
      headers: { "x-company-id": "H" },
    };
    assert.equal(resolveCompanyContext(req, { headerOnly: true }), "H");
  });

  it("devuelve null sin contexto (caso login)", () => {
    assert.equal(resolveCompanyContext({ headers: {} }), null);
    assert.equal(resolveCompanyContext({ headers: {} }, { headerOnly: true }), null);
    assert.equal(resolveCompanyContext(undefined), null);
  });

  it("soporta req.header() de Express", () => {
    const req = { header: (name) => (name === "x-company-id" ? "C9" : undefined), headers: {} };
    assert.equal(resolveCompanyContext(req), "C9");
  });
});
