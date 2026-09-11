const express = require("express");
const TransactionAuditLog = require("../models/TransactionAuditLog");
const logger = require("../helpers/logger");
const { fromSecondary } = require("../helpers/mongoRead");

const createAuditLog = async (request, response) => {
  try {
    let transactionAuitLog = new TransactionAuditLog(request.body);

    await transactionAuitLog.save();

    return response.status(201).json({
      ok: true,
      transactionAuitLog,
    });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrater",
    });
  }
};

const displayTransactionAuditLog = async (request, response) => {
  try {
    // Auditoria de solo lectura: tolera perfectamente unos segundos de
    // retraso de replicacion, asi que puede servirla una secundaria.
    // Misma deuda que en notificationLog: el find() no tiene filtro ni limite.
    const transactionAuditLog = await fromSecondary(TransactionAuditLog.find());
    response.status(201).json({
      ok: true,
      transactionAuditLog,
    });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrator.",
    });
  }
};
module.exports = {
  createAuditLog,
  displayTransactionAuditLog,
};
