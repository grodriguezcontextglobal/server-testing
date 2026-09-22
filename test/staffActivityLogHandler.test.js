/**
 * queue/handlers/staffActivityLog.js — normalización de `company_id`
 *
 * El audit trail guardaba en `company_id` el NOMBRE de la compañía cuando la
 * actividad venía de inventario (models/Inventory.js no guarda ningún id),
 * mientras el reporte scopea por ObjectId: esos registros quedaban fuera de su
 * propia compañía. Se traduce en el handler de la cola, no en el request.
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createStaffActivityLogHandler } = require("../queue/handlers/staffActivityLog");

const OID = "665f1c2ab3d4e5f6a7b8c9d0";

// Captura el documento que se habría insertado.
function makeCreateFn(captured) {
  return async (doc) => {
    captured.doc = doc;
    return { id: "log-1" };
  };
}

describe("createStaffActivityLogHandler", () => {

  it("traduce el nombre de la compañía a su _id antes de insertar", async () => {
    const captured = {};
    const handler = createStaffActivityLogHandler(makeCreateFn(captured), {
      findCompaniesByName: async (name) =>
        name === "Acme Corp" ? [{ _id: OID }] : [],
    });

    const result = await handler({
      staff_member_id: "S1",
      company_id: "Acme Corp",
      action: "CREATE",
      target_model: "Inventory",
    });

    assert.equal(captured.doc.company_id, OID);
    assert.equal(captured.doc.action, "CREATE"); // el resto del payload intacto
    assert.equal(captured.doc.target_model, "Inventory");
    assert.deepEqual(result, { id: "log-1" });
  });

  it("no consulta nada cuando company_id ya es un ObjectId", async () => {
    const captured = {};
    let consulted = false;
    const handler = createStaffActivityLogHandler(makeCreateFn(captured), {
      findCompaniesByName: async () => { consulted = true; return []; },
    });

    await handler({ staff_member_id: "S1", company_id: OID, action: "LOGIN", target_model: "AdminUser" });

    assert.equal(consulted, false);
    assert.equal(captured.doc.company_id, OID);
  });

  // El LOGIN ocurre antes de que el usuario elija compañía; el schema lo
  // permite null a propósito (ver models/StaffActivityLog.js).
  it("deja pasar null sin consultar", async () => {
    const captured = {};
    const handler = createStaffActivityLogHandler(makeCreateFn(captured), {
      findCompaniesByName: async () => { throw new Error("no debería consultarse"); },
    });

    await handler({ staff_member_id: "S1", company_id: null, action: "LOGIN", target_model: "AdminUser" });

    assert.equal(captured.doc.company_id, null);
  });

  // Guardar la clave vieja es peor que nada solo en apariencia: el reporte
  // consulta id Y nombre, así que el registro sigue siendo visible. Perderlo no.
  it("conserva el nombre original cuando no hay match", async () => {
    const captured = {};
    const handler = createStaffActivityLogHandler(makeCreateFn(captured), {
      findCompaniesByName: async () => [],
    });

    await handler({ staff_member_id: "S1", company_id: "Compañía Fantasma", action: "DELETE", target_model: "Inventory" });

    assert.equal(captured.doc.company_id, "Compañía Fantasma");
  });

  // Atribuir mal un registro de auditoría es peor que dejarlo sin traducir.
  it("no adivina cuando el nombre es ambiguo", async () => {
    const captured = {};
    const handler = createStaffActivityLogHandler(makeCreateFn(captured), {
      findCompaniesByName: async () => [{ _id: "a" }, { _id: "b" }],
    });

    await handler({ staff_member_id: "S1", company_id: "Duplicada", action: "UPDATE", target_model: "Inventory" });

    assert.equal(captured.doc.company_id, "Duplicada");
  });

  it("cachea la traducción: el segundo log de la misma compañía no vuelve a consultar", async () => {
    const captured = {};
    let calls = 0;
    const handler = createStaffActivityLogHandler(makeCreateFn(captured), {
      findCompaniesByName: async () => { calls++; return [{ _id: OID }]; },
    });

    await handler({ staff_member_id: "S1", company_id: "Acme Corp", action: "CREATE", target_model: "Inventory" });
    await handler({ staff_member_id: "S2", company_id: "Acme Corp", action: "DELETE", target_model: "Inventory" });

    assert.equal(calls, 1);
    assert.equal(captured.doc.company_id, OID);
  });

  // Un fallo de Mongo en la traducción debe propagarse: el job reintenta con
  // backoff y termina en dead-letter, que es justo lo que la cola aporta. Lo
  // que no puede es insertar el registro con la compañía a medio resolver.
  it("propaga el error de la consulta para que el job reintente", async () => {
    const handler = createStaffActivityLogHandler(makeCreateFn({}), {
      findCompaniesByName: async () => { throw new Error("mongo down"); },
    });

    await assert.rejects(
      () => handler({ staff_member_id: "S1", company_id: "Acme Corp", action: "CREATE", target_model: "Inventory" }),
      /mongo down/
    );
  });
});
