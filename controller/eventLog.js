const express = require("express");
const EventLog = require("../models/EventLog");

const feedEventLog = async (request, response) => {
    try {
        let feedEvent = new EventLog(request.body);
        await feedEvent.save();
        return response.status(201).json({
            ok: true,
            feedEvent
        });
    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: "Please contact Administrater",
        });
    }
};

module.exports = {
feedEventLog
};
