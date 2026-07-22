const getConnection = require("../database/config");
const logger = require("../../helpers/logger");

const createSubLocationPath = async (req, res) => {
  const { company_id, location_id, sub_location_path, created_by } = req.body;

  if (!company_id) {
    return res.status(400).json({ ok: false, msg: "company_id is required" });
  }
  if (!location_id) {
    return res.status(400).json({ ok: false, msg: "location_id is required" });
  }
  if (!Array.isArray(sub_location_path) || sub_location_path.length === 0) {
    return res.status(400).json({ ok: false, msg: "sub_location_path must be a non-empty array" });
  }
  if (sub_location_path.some((s) => typeof s !== "string" || !s.trim())) {
    return res.status(400).json({ ok: false, msg: "every path segment must be a non-empty string" });
  }

  const connection = getConnection();

  try {
    const [locations] = await connection.execute(
      "SELECT location_id FROM locations WHERE location_id = ? AND company_id = ?",
      [location_id, company_id]
    );

    if (locations.length === 0) {
      return res.status(404).json({ ok: false, msg: "location not found for this company" });
    }

    const pathKey = sub_location_path.join(" > ");

    const [result] = await connection.execute(
      `INSERT INTO company_sub_location_paths
         (company_id, location_id, path_json, path_key, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [company_id, location_id, JSON.stringify(sub_location_path), pathKey, created_by || null]
    );

    return res.status(201).json({
      ok: true,
      path_id: result.insertId,
      path_key: pathKey,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        msg: "This ordered path already exists for this location",
      });
    }
    logger.error("createSubLocationPath error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

const getLocationPathsTree = async (req, res) => {
  const company_id = req.params.id;

  if (!company_id) {
    return res.status(400).json({ ok: false, msg: "company_id is required" });
  }

  const connection = getConnection();

  try {
    // 1. Read all active company locations
    const [locations] = await connection.execute(
      `SELECT location_id, location_name
       FROM locations
       WHERE company_id = ? AND status = 'active'
       ORDER BY location_name ASC`,
      [company_id]
    );

    if (locations.length === 0) {
      return res.status(200).json({ ok: true, locations: {} });
    }

    const locationIds = locations.map((l) => l.location_id);
    const locationMap = {};
    const data = {};

    locations.forEach((loc) => {
      locationMap[loc.location_id] = loc.location_name;
      data[loc.location_name] = {
        location_id: loc.location_id,
        total: 0,
        available: 0,
        existing: 0,
        children: {},
      };
    });

    const placeholders = locationIds.map(() => "?").join(",");

    // 2. Read all registered sub-location paths for this company
    const [paths] = await connection.execute(
      `SELECT location_id, path_json, path_key
       FROM company_sub_location_paths
       WHERE company_id = ? AND location_id IN (${placeholders})
       ORDER BY location_id, path_key`,
      [company_id, ...locationIds]
    );

    // Build the tree skeleton and track which (locationId, pathKey) pairs are registered
    const registeredKeys = new Set();

    paths.forEach((path) => {
      const locName = locationMap[path.location_id];
      if (!locName || !data[locName]) return;

      let segments;
      try {
        segments = typeof path.path_json === "string"
          ? JSON.parse(path.path_json)
          : path.path_json;
      } catch {
        return;
      }

      if (!Array.isArray(segments)) return;

      registeredKeys.add(`${path.location_id}:${path.path_key}`);

      let currentNode = data[locName];
      for (const seg of segments) {
        if (!currentNode.children[seg]) {
          currentNode.children[seg] = {
            total: 0,
            available: 0,
            existing: 0,
            children: {},
          };
        }
        currentNode = currentNode.children[seg];
      }
    });

    // 3. Aggregate inventory counts from item_inv grouped by full sub_location path
    const [inventoryRows] = await connection.execute(
      `SELECT
         i.location_id,
         JSON_UNQUOTE(i.sub_location) AS sub_location_json,
         COUNT(*) AS existing_count,
         SUM(
           CASE
             WHEN i.warehouse = 1
              AND i.status = 'Operational'
              AND i.logistic_status = 'in-stock'
             THEN 1
             ELSE 0
           END
         ) AS available_count
       FROM item_inv i
       WHERE i.company_id = ? AND i.location_id IN (${placeholders})
       GROUP BY i.location_id, JSON_UNQUOTE(i.sub_location)`,
      [company_id, ...locationIds]
    );

    // 4. Match inventory to registered paths and accumulate counts at each level
    inventoryRows.forEach((row) => {
      const locName = locationMap[row.location_id];
      if (!locName || !data[locName]) return;

      let segments;
      try {
        const parsed = JSON.parse(row.sub_location_json);
        segments = Array.isArray(parsed) ? parsed.map((s) => String(s).trim()).filter(Boolean) : [];
      } catch {
        segments = [];
      }

      const pathKey = segments.join(" > ");
      if (!registeredKeys.has(`${row.location_id}:${pathKey}`)) return;

      const existingCount = Number(row.existing_count || 0);
      const availableCount = Number(row.available_count || 0);

      // Accumulate at the location root
      const locNode = data[locName];
      locNode.total += existingCount;
      locNode.available += availableCount;
      locNode.existing += existingCount;

      // Walk down the path and accumulate at each segment node
      let currentNode = locNode;
      for (const seg of segments) {
        if (!currentNode.children[seg]) break;
        currentNode = currentNode.children[seg];
        currentNode.total += existingCount;
        currentNode.available += availableCount;
        currentNode.existing += existingCount;
      }
    });

    return res.status(200).json({ ok: true, locations: data });
  } catch (error) {
    logger.error("getLocationPathsTree error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

/**
 * Delete a registered sub-location path (and any of its descendant paths) for
 * a company/location. Identity is the composite (company_id, location_id,
 * path_key) — sub-location paths have no standalone id in the tree responses.
 *
 * Refuses (409) if any inventory item still lives in the target path or a
 * descendant, so an accidental non-empty delete can't orphan devices. The
 * frontend already only offers this on empty nodes; this is defense-in-depth.
 */
const deleteSubLocationPath = async (req, res) => {
  const { company_id, location_id, sub_location_path } = req.body;

  if (!company_id) {
    return res.status(400).json({ ok: false, msg: "company_id is required" });
  }
  if (!location_id) {
    return res.status(400).json({ ok: false, msg: "location_id is required" });
  }
  if (!Array.isArray(sub_location_path) || sub_location_path.length === 0) {
    return res
      .status(400)
      .json({ ok: false, msg: "sub_location_path must be a non-empty array" });
  }

  const segments = sub_location_path
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return res.status(400).json({
      ok: false,
      msg: "sub_location_path must contain at least one non-empty segment",
    });
  }

  const pathKey = segments.join(" > ");
  // Escape LIKE wildcards in the prefix so a segment containing % or _ can't
  // widen the match. Uses '|' as the ESCAPE char (no backslash quoting needed).
  const escapeLike = (s) => s.replace(/[|%_]/g, (c) => `|${c}`);
  const descendantPattern = `${escapeLike(pathKey)} > %`;

  const connection = getConnection();

  try {
    // Guard: refuse if any item lives in this sub-location or a descendant.
    const [inventoryRows] = await connection.execute(
      `SELECT JSON_UNQUOTE(sub_location) AS sub_location_json
         FROM item_inv
        WHERE company_id = ? AND location_id = ?`,
      [company_id, location_id]
    );

    const hasInventory = inventoryRows.some((row) => {
      let parsed;
      try {
        parsed = JSON.parse(row.sub_location_json);
      } catch {
        return false;
      }
      if (!Array.isArray(parsed)) return false;
      const rowKey = parsed
        .map((s) => String(s).trim())
        .filter(Boolean)
        .join(" > ");
      return rowKey === pathKey || rowKey.startsWith(`${pathKey} > `);
    });

    if (hasInventory) {
      return res.status(409).json({
        ok: false,
        msg: "Cannot delete a sub-location that still contains inventory. Move or remove the items first.",
      });
    }

    // Delete the path itself and every descendant path (the whole subtree).
    const [result] = await connection.execute(
      `DELETE FROM company_sub_location_paths
        WHERE company_id = ?
          AND location_id = ?
          AND (path_key = ? OR path_key LIKE ? ESCAPE '|')`,
      [company_id, location_id, pathKey, descendantPattern]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ ok: false, msg: "Sub-location path not found" });
    }

    logger.info(
      `Sub-location path deleted: company=${company_id} location=${location_id} path="${pathKey}" (${result.affectedRows} row(s))`
    );

    return res.status(200).json({
      ok: true,
      msg: "Sub-location deleted successfully",
      deleted: result.affectedRows,
    });
  } catch (error) {
    logger.error("deleteSubLocationPath error:", error);
    return res.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  createSubLocationPath,
  getLocationPathsTree,
  deleteSubLocationPath,
};
