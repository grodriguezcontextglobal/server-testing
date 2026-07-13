const express = require("express");
const EventLog = require("../models/EventLog");
const logger = require("../helpers/logger");
const { createQueuedJobController } = require("../helpers/queuedController");

// Se encola en vez de guardar inline: sobrevive una caída de Mongo/servidor en
// vez de perder el log. Responde 202 {ok:true, jobId} en lugar del documento
// guardado síncronamente. Ver DESIGN_task_queue.md § Fase 1.
const feedEventLog = createQueuedJobController("log:event", (body) => body);

const renderActivity = async (request, response) => {
  try {
    const findActivity = await EventLog.find();
    response.status(201).json({
      ok: true,
      activity: findActivity,
    });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

module.exports = {
  feedEventLog,
  renderActivity,
};
