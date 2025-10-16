const express = require("express");
const NotificationLog = require("../models/NotificationLog");
const logger = require("../helpers/logger");

const feedNotificationLog = async (request, response) => {
  try {
    let feedNotification = new NotificationLog(request.body);
    await feedNotification.save();
    return response.status(201).json({
      ok: true,
      feedNotification,
    });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrater",
    });
  }
};

const notificationLogList = async (request, response) => {
  try {
    const logList = await NotificationLog.find();
    return response.status(201).json({
      ok: true,
      logList,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact administrator",
      error: error.body,
    });
  }
};

module.exports = {
  feedNotificationLog,
  notificationLogList,
};
