const express = require("express");
const NotificationLog = require("../models/NotificationLog");
const logger = require("../helpers/logger");
const { fromSecondary } = require("../helpers/mongoRead");
const { createQueuedJobController } = require("../helpers/queuedController");

// Se encola en vez de guardar inline: sobrevive una caída de Mongo/servidor en
// vez de perder el log. Responde 202 {ok:true, jobId} en lugar del documento
// guardado síncronamente. Ver DESIGN_task_queue.md § Fase 1.
const feedNotificationLog = createQueuedJobController("log:notification", (body) => body);

const notificationLogList = async (request, response) => {
  try {
    // Listado de diagnostico: a nadie le afecta que una notificacion tarde
    // unos segundos en aparecer aqui, asi que puede servirla una secundaria.
    // OJO, deuda conocida y aparte de esto: el find() no lleva filtro ni
    // limite, o sea que devuelve la coleccion ENTERA. Mandar un escaneo
    // completo a una secundaria no lo arregla, solo lo mueve de nodo.
    const logList = await fromSecondary(NotificationLog.find());
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
