const express = require("express");
const TransactionAuditLog = require("../models/TransactionAuditLog");

const createAuditLog = async (request, response) => {
    try {
        let transactionAuitLog = new TransactionAuditLog(request.body);

        await transactionAuitLog.save();

        return response.status(201).json({
            ok: true,
            transactionAuitLog
        });
    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: "Please contact Administrater",
        });
    }
};

const displayTransactionAuditLog = async(request, response) => {
    try {
        const transactionAuditLog = await TransactionAuditLog.find()
        response.status(201).json({
            ok:true,
            transactionAuditLog
        })
    } catch (error) {
        console.log("🚀 ~ file: transactionAuditLog.js:27 ~ displayTransactionAuditLog ~ error:", error)
        response.status(500).json({
            ok:false,
            msg:"Please contact Administrator."
        })
    }
}
module.exports = {
    createAuditLog,
    displayTransactionAuditLog
};
