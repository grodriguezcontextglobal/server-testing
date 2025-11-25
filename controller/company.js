const express = require("express");
const Company = require("../models/Company");
const { clientRedis } = require("../database/cacheMemoryConfig");
const logger = require("../helpers/logger");

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
          },
        ],
        location: location,
        company_logo: company_logo,
      });

      await companyInfo.save();

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

module.exports = {
  createCompany,
  searchingCompany,
  getCompanyList,
  updatingCompany,
  searchingGetCompanyInfo,
};
