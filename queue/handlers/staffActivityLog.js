'use strict';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/**
 * Handler de `log:staff-activity`. Es el genérico de dbWrite.js más un paso:
 * normalizar `company_id` a un ObjectId de Mongo antes de insertar.
 *
 * POR QUÉ HACE FALTA: los call-sites de inventario solo tienen el NOMBRE de la
 * compañía — `models/Inventory.js` no guarda ningún id— así que el campo
 * `company_id` del audit trail terminó guardando nombres. El reporte
 * (`createGetStaffActivityLogs`) scopea por id, de modo que esos registros
 * quedaban fuera de su propia compañía.
 *
 * POR QUÉ AQUÍ Y NO EN logStaffActivity: los 12 call-sites hacen
 * `await logStaffActivity(...)` dentro del request. Una traducción que necesita
 * ir a Mongo ahí le agrega latencia a la operación auditada, y con Mongo caído
 * son los 10s del buffering de Mongoose antes de rendirse. En el worker el
 * costo no lo paga el usuario y el job ya trae reintentos y dead-letter.
 *
 * Si la traducción no resuelve, se guarda el valor original en vez de perderlo:
 * un registro bajo el nombre viejo sigue siendo legible (el reporte consulta
 * ambas claves), uno vacío no aparece en ningún lado.
 */
function createStaffActivityLogHandler(createFn, { findCompaniesByName } = {}) {
  // Cache por proceso. La clave es el nombre: si la compañía se renombra
  // después, el _id al que apunta esa entrada sigue siendo el correcto.
  const idByName = new Map();

  const resolveCompanyId = async (name) => {
    if (idByName.has(name)) return idByName.get(name);

    // Se piden 2: con más de un match el nombre es ambiguo y no se puede
    // atribuir sin adivinar. Un registro de auditoría mal atribuido es peor
    // que uno sin compañía.
    const matches = await findCompaniesByName(name, 2);
    const id = matches?.length === 1 ? String(matches[0]._id) : null;

    if (id) idByName.set(name, id);
    return id;
  };

  const normalize = async (value) => {
    if (!value) return value ?? null;
    if (OBJECT_ID.test(String(value))) return String(value);
    if (!findCompaniesByName) return value;

    return (await resolveCompanyId(value)) || value;
  };

  return async function staffActivityLogHandler(payload) {
    const doc = await createFn({
      ...payload,
      company_id: await normalize(payload?.company_id),
    });
    return { id: doc.id };
  };
}

module.exports = { createStaffActivityLogHandler };
