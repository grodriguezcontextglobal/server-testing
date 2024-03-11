const express = require("express");
const CashReport = require("../models/CashReport");

const createReport = async (request, response = express.response) => {
    try {
        let report = new CashReport(request.body);
        await report.save();
        return response.status(201).json({
            report
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
        let report = await CashReport.find(request.body);
        response.status(201).json({
            report
        })
    } catch (error) {
        console.log("🚀 ~ file: event.js:91 ~ eventList ~ error:", error)
        response.status(500).json({
            ok: false,
            msg: "Please contact Administrator"
        })
    }
}

module.exports = {
    createReport,
    cashReport
};
