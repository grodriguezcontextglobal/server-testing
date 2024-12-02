const express = require("express");
const CashReport = require("../models/CashReport");
const { clientRedis } = require("../database/cacheMemoryConfig");
const createReport = async (request, response = express.response) => {
  try {
    const cache_connection = await clientRedis();
    await cache_connection.del(
      `cashReport_event=${request.body.event}&cashReport_company=${request.body.company}`
    );
    let report = new CashReport(request.body);
    await report.save();
    return response.status(201).json({
      report,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const cashReport = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const cachedReport = await cache_connection.get(
      `cashReport_event=${request.body.event}&cashReport_company=${request.body.company}`
    );
    if (cachedReport) {
      response.status(201).json({
        report: JSON.parse(cachedReport),
      });
    } else {
      let report = await CashReport.find(request.body);
      cache_connection.set(
        `cashReport_event=${request.body.event}&cashReport_company=${request.body.company}`,
        JSON.stringify(report)
      );
      response.status(201).json({
        report,
      });
    }
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

module.exports = {
  createReport,
  cashReport,
};
