const getConnection = require("../database/config");
const logger = require("../../helpers/logger");
const { resolveCompanyContext } = require("../helpers/companyContext");

/**
 * Helper to process sub-location data (Find or Create) within a transaction
 * @param {Object} connection - Database connection
 * @param {Object} data - Sub-location data
 * @returns {Object} - { sub_location_id, name }
 */
const processSubLocation = async (connection, data) => {
  const { location_id, name, parent_id, active, company_id } = data;

  if (!location_id || !name) {
    throw new Error(
      "Missing required fields for sub-location: location_id, name"
    );
  }

  // Check if sub-location exists
  let query =
    "SELECT sub_location_id, name FROM sub_locations WHERE location_id = ? AND name = ?";
  const params = [location_id, name];

  if (parent_id) {
    query += " AND parent_id = ?";
    params.push(parent_id);
  } else {
    query += " AND parent_id IS NULL";
  }

  const [existing] = await connection.execute(query, params);

  if (existing.length > 0) {
    return existing[0];
  }

  // Create new sub-location
  const insertQuery = `
    INSERT INTO sub_locations (location_id, name, parent_id, active, company_id)
    VALUES (?, ?, ?, ?, ?)
  `;
  const [result] = await connection.execute(insertQuery, [
    location_id,
    name,
    parent_id || null,
    active !== undefined ? active : 1,
    company_id || null,
  ]);

  return {
    sub_location_id: result.insertId,
    name: name,
  };
};

/**
 * PURA. Camina un path de nombres (raíz→hoja) sobre un conjunto de filas de
 * sub_locations, siguiendo la cadena parent_id. Devuelve el nodo más profundo
 * que matchee (deepest match), consistente con cómo getCompanyLocationTree
 * cuenta items: avanza mientras los nombres matcheen, corta al primer segmento
 * null/vacío o que no exista como hijo del nodo actual.
 *
 * IMPORTANTE: `rows` debe estar scopeado a UNA locación (los nombres se repiten
 * entre locaciones; la cadena parent_id solo desambigua dentro de la misma).
 *
 * @returns {{ leafId: number|null, matchedDepth: number }}
 */
const walkSubLocationPath = (rows, segments) => {
  let parentId = null;
  let leafId = null;
  let matchedDepth = 0;

  for (const rawName of segments || []) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) break;
    const node = rows.find(
      (r) => r.name === name && (r.parent_id ?? null) === parentId
    );
    if (!node) break;
    leafId = node.sub_location_id;
    parentId = node.sub_location_id;
    matchedDepth++;
  }

  return { leafId, matchedDepth };
};

/**
 * PURA. Devuelve el id de `rootId` más el de todos sus descendientes (subárbol).
 * Se usa para preservar la semántica de "prefijo" del filtro JSON viejo: buscar
 * por [Building A, Floor 3] debe devolver los items en Floor 3 y en cualquier
 * nodo por debajo (Room 35, Shell A-1, ...).
 */
const collectSubtreeIds = (rows, rootId) => {
  const ids = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    ids.push(id);
    for (const r of rows) {
      if ((r.parent_id ?? null) === id) stack.push(r.sub_location_id);
    }
  }
  return ids;
};

/**
 * Find-or-create de la cadena completa de sub-locaciones de un path multinivel,
 * encadenando parent_id nivel por nivel (reutiliza processSubLocation por nodo).
 * Corta al primer segmento null/vacío. Devuelve el sub_location_id de la HOJA
 * (o null si no se creó/encontró ningún nodo — ej. path [null,null,null]).
 */
const processSubLocationPath = async (connection, location_id, segments, company_id) => {
  let parentId = null;
  let leafId = null;

  for (const rawName of segments || []) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) break;
    const node = await processSubLocation(connection, {
      location_id,
      name,
      parent_id: parentId,
      active: 1,
      company_id,
    });
    leafId = node.sub_location_id;
    parentId = node.sub_location_id;
  }

  return leafId;
};

/**
 * Read-only. Dado location_id + un path de nombres de búsqueda, resuelve el
 * subárbol de sub_location_id a filtrar. Devuelve { ids } si el path resuelve
 * COMPLETO contra la tabla sub_locations, o null si algún segmento no está
 * registrado (señal para que el caller caiga al filtro JSON legacy y no pierda
 * resultados).
 */
const resolveSubLocationFilter = async (connection, location_id, segments) => {
  const meaningful = (segments || []).filter(
    (s) => typeof s === "string" && s.trim()
  ).length;
  if (!meaningful) return null;

  const [rows] = await connection.execute(
    `SELECT sub_location_id, name, parent_id
     FROM sub_locations WHERE location_id = ? AND active = 1`,
    [location_id]
  );

  const { leafId, matchedDepth } = walkSubLocationPath(rows, segments);
  if (leafId === null || matchedDepth < meaningful) return null; // fallback

  return { ids: collectSubtreeIds(rows, leafId) };
};

const createSubLocation = async (req, res) => {
  const connection = getConnection();
  const { location_id, name, parent_id, company_id } = req.body;

  if (!location_id || !name || !company_id) {
    return res.status(400).json({
      ok: false,
      msg: "Missing required fields: location_id, name, company_id",
    });
  }

  try {
    // Check if parent exists and belongs to the same location if parent_id is provided
    if (parent_id) {
      const [parents] = await connection.execute(
        "SELECT location_id FROM sub_locations WHERE sub_location_id = ?",
        [parent_id]
      );
      if (parents.length === 0) {
        return res
          .status(400)
          .json({ ok: false, msg: "Parent sub-location not found" });
      }
      if (parents[0].location_id !== location_id) {
        return res.status(400).json({
          ok: false,
          msg: "Parent sub-location belongs to a different location",
        });
      }
    }

    const result = await processSubLocation(connection, req.body);

    return res.status(201).json({
      ok: true,
      msg: "Sub-location created successfully",
      sub_location_id: result.sub_location_id,
    });
  } catch (error) {
    logger.error("createSubLocation error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

const getSubLocationsHierarchy = async (req, res) => {
  const connection = getConnection();
  const { location_id } = req.params;

  try {
    const [rows] = await connection.execute(
      "SELECT * FROM sub_locations WHERE location_id = ? AND active = 1 ORDER BY parent_id, name",
      [location_id]
    );

    // Build hierarchy
    const map = {};
    const roots = [];

    rows.forEach((row) => {
      map[row.sub_location_id] = { ...row, children: [] };
    });

    rows.forEach((row) => {
      if (row.parent_id) {
        if (map[row.parent_id]) {
          map[row.parent_id].children.push(map[row.sub_location_id]);
        }
      } else {
        roots.push(map[row.sub_location_id]);
      }
    });

    return res.status(200).json({
      ok: true,
      hierarchy: roots,
    });
  } catch (error) {
    logger.error("getSubLocationsHierarchy error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

/**
 * Comprueba que una sub-locación pertenece a la compañía verificada del
 * llamante. `sub_locations` no guarda `company_id`: cuelga de `locations`, que
 * sí lo tiene, así que la pertenencia se resuelve con el JOIN.
 *
 * Devuelve 404 —no 403— cuando la fila existe pero es de otra compañía: un 403
 * confirmaría que ese id existe, que es información de otro inquilino.
 */
const belongsToCompany = async (connection, subLocationId, companyId) => {
  const [[row]] = await connection.execute(
    `SELECT sl.sub_location_id
       FROM sub_locations sl
       JOIN locations l ON l.location_id = sl.location_id
      WHERE sl.sub_location_id = ? AND l.company_id = ?
      LIMIT 1`,
    [subLocationId, companyId]
  );
  return Boolean(row);
};

const updateSubLocation = async (req, res) => {
  const connection = getConnection();
  const { id } = req.params;
  const { name, active, parent_id } = req.body;

  try {
    // El id de la sub-locación viene de la URL y no dice de quién es. Sin esta
    // comprobación, cualquier usuario autenticado podía renombrar la estructura
    // de locaciones de OTRA compañía probando ids.
    const context = await resolveCompanyContext(req);
    if (!context.ok) {
      return res.status(context.status).json({ ok: false, msg: context.msg });
    }
    if (!(await belongsToCompany(connection, id, context.companyId))) {
      return res.status(404).json({ ok: false, msg: "Sub-location not found" });
    }

    // Build dynamic update query
    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (active !== undefined) {
      fields.push("active = ?");
      values.push(active);
    }
    if (parent_id !== undefined) {
      fields.push("parent_id = ?");
      values.push(parent_id);
    }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, msg: "No fields to update" });
    }

    values.push(id);
    const query = `UPDATE sub_locations SET ${fields.join(
      ", "
    )} WHERE sub_location_id = ?`;

    const [result] = await connection.execute(query, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, msg: "Sub-location not found" });
    }

    return res
      .status(200)
      .json({ ok: true, msg: "Sub-location updated successfully" });
  } catch (error) {
    logger.error("updateSubLocation error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

const deleteSubLocation = async (req, res) => {
  const connection = getConnection();
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ ok: false, msg: "Sub-location ID is required" });
  }

  try {
    // Mismo motivo que en `updateSubLocation`: el id viene de la URL y no dice
    // de quién es. Sin esto, cualquier usuario autenticado podía borrar la
    // estructura de locaciones de OTRA compañía probando ids — y aquí el daño
    // no se deshace: `sub_locations` tiene ON DELETE CASCADE sobre sí misma,
    // así que se lleva por delante toda la rama de hijos.
    const context = await resolveCompanyContext(req);
    if (!context.ok) {
      return res.status(context.status).json({ ok: false, msg: context.msg });
    }
    if (!(await belongsToCompany(connection, id, context.companyId))) {
      return res.status(404).json({ ok: false, msg: "Sub-location not found" });
    }

    const [children] = await connection.execute(
      "SELECT sub_location_id FROM sub_locations WHERE parent_id = ? AND active = 1",
      [id]
    );

    if (children.length > 0) {
      return res.status(409).json({
        ok: false,
        msg: "Cannot delete sub-location with active children. Remove or reassign children first.",
      });
    }

    const [result] = await connection.execute(
      "DELETE FROM sub_locations WHERE sub_location_id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, msg: "Sub-location not found" });
    }

    return res.status(200).json({ ok: true, msg: "Sub-location deleted successfully" });
  } catch (error) {
    logger.error("deleteSubLocation error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

const checkSubLocation = async (req, res) => {
  const connection = getConnection();
  const { location_id, name, parent_id } = req.body;

  try {
    let query =
      "SELECT sub_location_id FROM sub_locations WHERE location_id = ? AND name = ?";
    const params = [location_id, name];

    if (parent_id) {
      query += " AND parent_id = ?";
      params.push(parent_id);
    } else {
      query += " AND parent_id IS NULL";
    }

    const [rows] = await connection.execute(query, params);

    if (rows.length > 0) {
      return res.status(200).json({
        ok: true,
        exists: true,
        sub_location_id: rows[0].sub_location_id,
      });
    } else {
      return res.status(200).json({ ok: true, exists: false });
    }
  } catch (error) {
    logger.error("checkSubLocation error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  createSubLocation,
  getSubLocationsHierarchy,
  updateSubLocation,
  checkSubLocation,
  deleteSubLocation,
  processSubLocation,
  walkSubLocationPath,
  collectSubtreeIds,
  processSubLocationPath,
  resolveSubLocationFilter,
};
