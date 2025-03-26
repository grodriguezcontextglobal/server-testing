const express = require("express");
const CashReport = require("../models/CashReport");
const { clientRedis } = require("../database/cacheMemoryConfig");
const { default: mongoose } = require("mongoose");

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
    return response.status(500).json({
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
    // if (cachedReport) {
    //   return response.status(201).json({
    //     report: JSON.parse(cachedReport),
    //   });
    // } else {
    let report = await CashReport.find(request.body);
    cache_connection.set(
      `cashReport_event=${request.body.event}&cashReport_company=${request.body.company}`,
      JSON.stringify(report)
    );
    return response.status(201).json({
      report,
    });
    // }
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const removeCashReportAfterRefund = async (request, response) => {
  try {
    const { id } = request.params;
    const cashReport = await CashReport.findByIdAndDelete(id);
    return response.status(201).json({
      ok: true,
      cashReport,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      error,
    });
  }
};

const updateCashReport = async (request, response) => {
  try {
    const { id, template } = request.body;
    console.log(request.body);
    const cashReport = await CashReport.findByIdAndUpdate(id, template, {
      new: true,
    });
    return response.status(201).json({
      ok: true,
      cashReport,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      error,
    });
  }
};
module.exports = {
  createReport,
  cashReport,
  removeCashReportAfterRefund,
  updateCashReport,
};
