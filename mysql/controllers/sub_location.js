const getConnection = require("../database/config");
const logger = require("../../helpers/logger");

const createSubLocation = async (req, res) => {
  const connection = getConnection();
  const { location_id, name, parent_id } = req.body;

  if (!location_id || !name) {
    return res.status(400).json({
      ok: false,
      msg: "Missing required fields: location_id, name",
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
        return res.status(400).json({ ok: false, msg: "Parent sub-location not found" });
      }
      if (parents[0].location_id !== location_id) {
        return res.status(400).json({ ok: false, msg: "Parent sub-location belongs to a different location" });
      }
    }

    const query = `
      INSERT INTO sub_locations (location_id, name, parent_id)
      VALUES (?, ?, ?)
    `;
    const [result] = await connection.execute(query, [location_id, name, parent_id || null]);

    return res.status(201).json({
      ok: true,
      msg: "Sub-location created successfully",
      sub_location_id: result.insertId,
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

    rows.forEach(row => {
      map[row.sub_location_id] = { ...row, children: [] };
    });

    rows.forEach(row => {
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

const updateSubLocation = async (req, res) => {
    const connection = getConnection();
    const { id } = req.params;
    const { name, active, parent_id } = req.body;

    try {
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
        const query = `UPDATE sub_locations SET ${fields.join(", ")} WHERE sub_location_id = ?`;

        const [result] = await connection.execute(query, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ ok: false, msg: "Sub-location not found" });
        }

        return res.status(200).json({ ok: true, msg: "Sub-location updated successfully" });

    } catch (error) {
        logger.error("updateSubLocation error:", error);
        return res.status(500).json({ ok: false, msg: error.message });
    }
}

const checkSubLocation = async (req, res) => {
    const connection = getConnection();
    const { location_id, name, parent_id } = req.body;

    try {
        let query = "SELECT sub_location_id FROM sub_locations WHERE location_id = ? AND name = ?";
        const params = [location_id, name];

        if (parent_id) {
            query += " AND parent_id = ?";
            params.push(parent_id);
        } else {
            query += " AND parent_id IS NULL";
        }

        const [rows] = await connection.execute(query, params);

        if (rows.length > 0) {
            return res.status(200).json({ ok: true, exists: true, sub_location_id: rows[0].sub_location_id });
        } else {
            return res.status(200).json({ ok: true, exists: false });
        }

    } catch (error) {
        logger.error("checkSubLocation error:", error);
        return res.status(500).json({ ok: false, msg: error.message });
    }
}


module.exports = {
  createSubLocation,
  getSubLocationsHierarchy,
  updateSubLocation,
  checkSubLocation
};
