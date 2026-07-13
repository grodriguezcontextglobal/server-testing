const express = require("express");
const Company = require("../models/Company");
const AdminUser = require("../models/AdminUser");
const { clientRedis } = require("../database/cacheMemoryConfig");
const logger = require("../helpers/logger");
const getConnection = require("../mysql/database/config");
const { v4: uuid } = require("uuid");

const { VALID_ROLE_TYPES } = require('../mysql/constants/roles');

const createCompany = async (request, response = express.response) => {
  try {
    const {
      company_name,
      address,
      phone,
      owner,
      website,
      main_email,
      industry,
      stripe_customer_id,
      employees,
      location,
      company_logo,
    } = request.body;
    let companyInfo = await Company.findOne({ company_name });
    if (!companyInfo) {
      companyInfo = new Company({
        company_name: company_name,
        address: {
          street: address.street,
          city: address.city,
          state: address.state,
          postal_code: address.postal_code,
        },
        phone: {
          main: phone.main,
          alternative: phone.alternative,
        },
        owner: {
          first_name: owner.first_name,
          last_name: owner.last_name,
          email: owner.email,
        },
        website,
        main_email,
        industry,
        stripe_customer_id,
        employees: [
          {
            user: employees.at(-1).user,
            firstName: employees.at(-1).firstName,
            lastName: employees.at(-1).lastName,
            status: employees.at(-1).status,
            super_user: employees.at(-1).super_user,
            role: employees.at(-1).role,
            roleType: VALID_ROLE_TYPES.has(employees.at(-1).roleType)
              ? employees.at(-1).roleType
              : undefined,
            userId: employees.at(-1).userId || undefined,
          },
        ],
        location: location,
        company_logo: company_logo,
      });

      await companyInfo.save();

      // Sync founder employee to company_staff SQL
      try {
        const emp = employees.at(-1);
        const roleType = VALID_ROLE_TYPES.has(emp.roleType) ? emp.roleType : null;
        if (roleType) {
          const sqlConn = getConnection();

          // Resolve the email: prefer emp.userId owner email, fall back to emp.user
          const staffEmail = emp.userId
            ? (await AdminUser.findOne({ email: emp.user }).select("email").lean())?.email ?? emp.user
            : emp.user;

          const [[staffRows], [roleRows]] = await Promise.all([
            sqlConn.execute("SELECT staff_id FROM staff_member WHERE email = ? LIMIT 1", [staffEmail]),
            sqlConn.query("SELECT id FROM roles WHERE role_type = ?", [roleType]),
          ]);
          const staffRow = staffRows?.[0];

          if (staffRow && roleRows.length) {
            await sqlConn.query(
              "INSERT IGNORE INTO company_staff (id, company_id, staff_id, role_id, is_active) VALUES (?,?,?,?,1)",
              [uuid(), companyInfo._id.toString(), staffRow.staff_id, roleRows[0].id]
            );
          }
        }
      } catch (sqlErr) {
        logger.error("company_staff sync failed:", sqlErr.message);
      }

      return response.status(201).json({
        ok: true,
        message: "registered",
        company: companyInfo,
      });
    }
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: error.message || error,
    });
  }
};

const updatingCompany = async (request, response = express.response) => {
  try {
    // const cache_connection = await clientRedis();
    // await cache_connection.del(`company_id=${request.params.id}`);
    const paramsId = request.params.id;
    let companyInfo = await Company.findById(paramsId);
    if (!companyInfo) {
      return response.status(500).json({
        ok: false,
        msg: "No company in record.",
      });
    }
    let newData = {
      ...request.body,
    };
    const companyInfoUpdated = await Company.findByIdAndUpdate(
      paramsId,
      newData,
      {
        new: true,
      }
    );
    return response.status(201).json({
      ok: true,
      company: companyInfoUpdated,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: JSON.stringify(error),
    });
  }
};

const searchingCompany = async (request, response = express.response) => {
  try {
    let companyInfo = await Company.find(request.body);
    if (!companyInfo) {
      return response.status(500).json({
        ok: false,
        msg: "No company in record.",
      });
    }
    return response.status(201).json({
      ok: true,
      company: companyInfo,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: error.message || error,
    });
  }
};

const searchingGetCompanyInfo = async (
  request,
  response = express.response
) => {
  try {
    const cache_connection = await clientRedis();
    const params = request._parsedUrl.query;
    const companyID = new URLSearchParams(params).get("_id");
    if (companyID) {
      const companyInMemory = await cache_connection.get(
        `company_id=${companyID}`
      );
      return response.status(201).json({
        cached: true,
        ok: true,
        company: JSON.parse(companyInMemory),
      });
    } else {
      let companyInfo = await Company.findById(companyID);
      if (!companyInfo) {
        return response.status(500).json({
          cached: false,
          ok: false,
          msg: "No company in record.",
        });
      }
      cache_connection.set(
        `company_id=${companyID}`,
        JSON.stringify(companyInfo)
      );
      cache_connection.expire(`company_id=${companyID}`, 180);
      return response.status(201).json({
        cached: false,
        ok: true,
        company: companyInfo,
      });
    }
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const getCompanyList = async (request, response = express.response) => {
  try {
    let companyInfo = await Company.find();
    if (!companyInfo) {
      return response.status(500).json({
        ok: false,
        msg: "No company in record.",
      });
    }

    return response.status(201).json({
      ok: true,
      company: companyInfo,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const assignLocationToUser = async (request, response = express.response) => {
  try {
    const { company_id, user_email, location_name } = request.body;
    
    const company = await Company.findById(company_id);
    if (!company) {
      return response.status(404).json({
        ok: false,
        msg: "Company not found",
      });
    }

    const employeeIndex = company.employees.findIndex(
      (emp) => emp.user === user_email
    );

    if (employeeIndex === -1) {
      return response.status(404).json({
        ok: false,
        msg: "User not found in company employees",
      });
    }

    // Update the employee's preference
    company.employees[employeeIndex].preference.inventory_location = [location_name];
    
    // Save the changes
    await company.save();

    return response.status(200).json({
      ok: true,
      msg: "Location assigned successfully",
      company: company,
    });

  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: error.message || error,
    });
  }
};

module.exports = {
  createCompany,
  updatingCompany,
  searchingCompany,
  getCompanyList,
  searchingGetCompanyInfo,
  assignLocationToUser,
};
