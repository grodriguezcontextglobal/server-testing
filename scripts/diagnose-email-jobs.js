'use strict';

/**
 * Diagnostico de SOLO LECTURA de los correos de la cola.
 *
 *   node scripts/diagnose-email-jobs.js [horas] [email]   (por defecto 24 h, todos)
 *
 * Responde "la API dijo sent:1 pero el correo no llega" sin tocar nada:
 *
 *   1. Estado de la cola: cuantos jobs de correo pendientes hay y desde cuando.
 *      Pendientes viejos = ningun worker esta tomando los correos.
 *   2. Cada job de correo de la ventana: estado, intentos, destinatario, asunto,
 *      error y la respuesta de SendGrid (202 = aceptado, NO entregado).
 *   3. Con [email]: si SendGrid lo tiene suprimido (block, bounce, spam,
 *      invalido). Un correo suprimido da 202 y no se entrega nunca.
 *
 * Los jobs `done` se borran a los 7 dias (TTL de models/Job.js).
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { dbConnection } = require("../database/config");

const hours = Number(process.argv[2]) || 24;
const emailFilter = (process.argv[3] || "").trim().toLowerCase();
const EMAIL_TYPES = /^send-email/; // send-email, send-email-multiple, ...-with-attachments

const recipients = (payload) => {
  const list = [];
  const add = (v) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(add);
    else if (typeof v === "object") add(v.email || v.to);
    else list.push(String(v).toLowerCase());
  };
  for (const msg of Array.isArray(payload) ? payload : [payload]) {
    add(msg?.to);
    (msg?.personalizations || []).forEach((p) => add(p.to));
  }
  return [...new Set(list)];
};

const subjectOf = (payload) => {
  const msg = Array.isArray(payload) ? payload[0] : payload;
  return String(msg?.subject || "").slice(0, 60);
};

const sendgridOf = (result) => {
  const first = Array.isArray(result) ? result[0] : result;
  if (!first) return "";
  const id = first.headers?.["x-message-id"] || "";
  return `${first.statusCode ?? "?"}${id ? ` ${id}` : ""}`;
};

const suppressions = async (email) => {
  const key = process.env.SENDGRID_API_KEY_PAID;
  if (!key) return console.log("  (sin SENDGRID_API_KEY_PAID: no se consulta SendGrid)");
  const kinds = ["blocks", "bounces", "spam_reports", "invalid_emails"];
  for (const kind of kinds) {
    const res = await fetch(
      `https://api.sendgrid.com/v3/suppression/${kind}/${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    const body = res.ok ? await res.json() : null;
    const hit = Array.isArray(body) && body.length > 0;
    console.log(
      `  ${kind.padEnd(15)} ${res.ok ? (hit ? `SI: ${body[0].reason || body[0].status || ""}` : "no") : `HTTP ${res.status}`}`
    );
  }
};

(async () => {
  await dbConnection();
  const jobs = mongoose.connection.db.collection("jobs");
  const since = new Date(Date.now() - hours * 3600000);

  const pending = await jobs
    .find({ type: EMAIL_TYPES, status: { $in: ["pending", "processing"] } })
    .project({ status: 1, createdAt: 1, lockedBy: 1, lockedAt: 1, attempts: 1 })
    .sort({ createdAt: 1 })
    .toArray();
  console.log(`\n== Correos sin terminar en la cola: ${pending.length} ==`);
  if (pending.length) {
    const oldest = pending[0];
    const minutes = Math.round((Date.now() - oldest.createdAt.getTime()) / 60000);
    console.log(`  el mas viejo: ${oldest.createdAt.toISOString()} (${minutes} min), estado ${oldest.status}`);
    if (minutes > 10) console.log("  <-- mas de 10 min sin procesar: ¿esta corriendo el worker de correo?");
  }

  const rows = await jobs
    .find({ type: EMAIL_TYPES, createdAt: { $gte: since } })
    .project({ type: 1, status: 1, attempts: 1, createdAt: 1, payload: 1, lastError: 1, result: 1 })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();

  const table = rows
    .map((j) => ({ j, to: recipients(j.payload) }))
    .filter(({ to }) => !emailFilter || to.includes(emailFilter))
    .slice(0, 40)
    .map(({ j, to }) => ({
      creado: j.createdAt.toISOString().slice(0, 19).replace("T", " "),
      estado: j.status,
      intentos: j.attempts,
      para: to.slice(0, 2).join(", ") + (to.length > 2 ? ` +${to.length - 2}` : ""),
      asunto: subjectOf(j.payload),
      sendgrid: sendgridOf(j.result),
      error: String(j.lastError || "").slice(0, 80),
    }));
  console.log(`\n== Jobs de correo en las ultimas ${hours} h${emailFilter ? ` para ${emailFilter}` : ""}: ${table.length} ==`);
  console.table(table);

  if (emailFilter) {
    console.log(`\n== Supresiones de SendGrid para ${emailFilter} ==`);
    await suppressions(emailFilter);
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
