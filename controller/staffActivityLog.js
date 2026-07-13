const StaffActivityLog = require("../models/StaffActivityLog");
const AdminUser = require("../models/AdminUser");
const logger = require("../helpers/logger");

/**
 * Logs a staff member's activity.
 * @param {Object} data - The activity data.
 * @param {string} data.staff_member_id - ID of the staff member.
 * @param {string} data.company_id - ID of the company.
 * @param {string} data.action - The action performed (e.g., 'LOGIN', 'CREATE').
 * @param {string} data.target_model - The model affected (e.g., 'User', 'Inventory').
 * @param {string} [data.target_id] - ID of the affected object.
 * @param {Object} [data.details] - Additional details about the action.
 * @param {string} [data.ip_address] - IP address of the user.
 * @param {string} [data.device_info] - Device/User Agent info.
 */
const logStaffActivity = async (data) => {
  try {
    const {
      staff_member_id,
      company_id,
      action,
      target_model,
      target_id,
      details,
      ip_address,
      device_info,
    } = data;

    const log = new StaffActivityLog({
      staff_member_id,
      company_id,
      action,
      target_model,
      target_id,
      details,
      ip_address,
      device_info,
    });

    await log.save();
  } catch (error) {
    logger.error("Error saving staff activity log:", error);
  }
};

/**
 * Retrieves staff activity logs based on filters and permissions.
 */
const getStaffActivityLogs = async (req, res) => {
  try {
    const { uid } = req;
    const requester = await AdminUser.findById(uid);

    if (!requester) {
      return res.status(404).json({ ok: false, msg: "User not found" });
    }

    const {
      company_id,
      staff_member_id,
      action,
      target_model,
      start_date,
      end_date,
      limit = 50,
      page = 1,
    } = req.query;

    let query = {};

    // Permission Check
    const isRootAdmin = requester.super_user;

    if (isRootAdmin) {
      // Root admin can filter by any company_id if provided
      if (company_id) query.company_id = company_id;
    } else {
      // Check if user has multiple companies
      if (
        requester.multipleCompanies &&
        requester.companiesAssigned &&
        requester.companiesAssigned.length > 0
      ) {
        const assignedCompanyIds = requester.companiesAssigned
          .filter((c) => c.active) // Only active companies
          .map((c) => c.company);

        if (company_id) {
          // If user requests a specific company, verify they have access
          if (assignedCompanyIds.includes(company_id)) {
            query.company_id = company_id;
          } else {
            return res
              .status(403)
              .json({
                ok: false,
                msg: "Unauthorized access to this company's logs",
              });
          }
        } else {
          // If no specific company requested, show logs for all assigned companies
          query.company_id = { $in: assignedCompanyIds };
        }
      } else if (requester.company) {
        // Single company mode
        // If user tries to query a different company, block it (unless it matches their own)
        if (company_id && company_id !== requester.company) {
          return res
            .status(403)
            .json({
              ok: false,
              msg: "Unauthorized access to this company's logs",
            });
        }
        query.company_id = requester.company;
      } else {
        // No company assigned
        return res
          .status(403)
          .json({ ok: false, msg: "No company assigned to user" });
      }
    }

    // Apply Filters
    if (staff_member_id) query.staff_member_id = staff_member_id;
    if (action) query.action = action;
    if (target_model) query.target_model = target_model;

    if (start_date || end_date) {
      query.timestamp = {};
      if (start_date) query.timestamp.$gte = new Date(start_date);
      if (end_date) query.timestamp.$lte = new Date(end_date);
    }

    const logs = await StaffActivityLog.find(query)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate("staff_member_id", "name lastName email role");

    const total = await StaffActivityLog.countDocuments(query);

    res.json({
      ok: true,
      logs,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ ok: false, msg: "Error fetching logs" });
  }
};

module.exports = {
  logStaffActivity,
  getStaffActivityLogs,
};
