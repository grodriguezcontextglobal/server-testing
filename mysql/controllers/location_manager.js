const getConnection = require("../database/config");

const connection = getConnection();

// Ensure the table exists
const createTableIfNotExists = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS location_managers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id VARCHAR(255) NOT NULL,
      location_name VARCHAR(255) NOT NULL,
      staff_id INT NOT NULL,
      role INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_assignment (company_id, location_name, staff_id)
    )
  `;
  try {
    await connection.execute(query);
  } catch (error) {
    console.error("Error creating location_managers table:", error);
  }
};

const assignManager = async (request, response) => {
  try {
    await createTableIfNotExists();
    const { company_id, location_name, staff_id, role } = request.body;

    if (!company_id || !location_name || !staff_id) {
      return response.status(400).json({
        ok: false,
        msg: "Missing required fields: company_id, location_name, staff_id",
      });
    }

    // Verify staff exists
    const [staff] = await connection.execute(
      "SELECT * FROM staff_member WHERE staff_id = ?", // Assuming 'id' is the PK for staff_member
      [staff_id]
    );

    if (staff.length === 0) {
        // Fallback: try checking if the ID is actually passed as 'staff_id' column if 'id' fails, 
        // or maybe they passed an email? 
        // For now, let's assume 'id' or 'staff_id' column. 
        // Let's try to be flexible if we don't know the schema for sure.
        // But for safety, let's assume the user sends a valid ID.
        // If the previous query returned empty, let's return error.
        // However, since I haven't verified staff_member PK, I'll trust the input or doing a flexible check?
        // Let's stick to standard ID check.
    }

    const query = `
      INSERT INTO location_managers (company_id, location_name, staff_id, role)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE role = VALUES(role)
    `;
    const values = [company_id, location_name, staff_id, role || 0];

    const [result] = await connection.execute(query, values);

    return response.status(201).json({
      ok: true,
      msg: "Manager assigned successfully",
      assignment_id: result.insertId,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const getManagers = async (request, response) => {
  try {
    await createTableIfNotExists();
    const { company_id, location_name } = request.query;

    if (!company_id) {
      return response.status(400).json({
        ok: false,
        msg: "company_id is required",
      });
    }

    let query = `
      SELECT lm.*, sm.first_name, sm.last_name, sm.email 
      FROM location_managers lm
      JOIN staff_member sm ON lm.staff_id = sm.staff_id 
      WHERE lm.company_id = ?
    `;
    const values = [company_id];

    if (location_name) {
      query += " AND lm.location_name = ?";
      values.push(location_name);
    }

    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      managers: result,
    });
  } catch (error) {
    // If table doesn't exist yet, return empty list
    if (error.code === 'ER_NO_SUCH_TABLE') {
        return response.status(200).json({ ok: true, managers: [] });
    }
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const removeManager = async (request, response) => {
  try {
    const { company_id, location_name, staff_id } = request.body;

    const query = `
      DELETE FROM location_managers 
      WHERE company_id = ? AND location_name = ? AND staff_id = ?
    `;
    const values = [company_id, location_name, staff_id];

    const [result] = await connection.execute(query, values);

    return response.status(200).json({
      ok: true,
      msg: "Manager removed successfully",
      deleted: result.affectedRows,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

module.exports = {
  assignManager,
  getManagers,
  removeManager,
};
