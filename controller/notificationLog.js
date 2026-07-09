const express = require("express");
const NotificationLog = require("../models/NotificationLog");
const logger = require("../helpers/logger");
const { createQueuedJobController } = require("../helpers/queuedController");

// Se encola en vez de guardar inline: sobrevive una caída de Mongo/servidor en
// vez de perder el log. Responde 202 {ok:true, jobId} en lugar del documento
// guardado síncronamente. Ver DESIGN_task_queue.md § Fase 1.
const feedNotificationLog = createQueuedJobController("log:notification", (body) => body);

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
