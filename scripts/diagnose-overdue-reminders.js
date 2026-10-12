'use strict';

/**
 * Diagnostico de SOLO LECTURA de los recordatorios de vencido.
 *
 *   node scripts/diagnose-overdue-reminders.js [dias]   (por defecto 7)
 *
 * Responde "¿por que a X le llega un correo todos los dias?" sin tocar nada:
 *
 *   1. Por prestamo vencido: dias de atraso, a quien va, si esta detenido, si
 *      hoy le toca (isReminderDay) y los proximos dias de la serie.
 *   2. Los jobs `overdue-reminder:*` de la cola en la ventana, con fecha y HORA
 *      UTC. El scheduler de produccion encola a las 12:00Z (8am Nueva York, o
 *      13:00Z en invierno); una hora distinta delata OTRO proceso encolando.
 *   3. Por destinatario y dia: cuantos correos recibio. Cada prestamo lleva su
 *      propia cadencia, asi que un tutor con varios equipos vencidos puede
 *      recibir algo casi a diario aunque ninguno de ellos lo reciba.
 *
 * Los jobs `done` se borran a los 7 dias (TTL de models/Job.js): mas atras no hay datos.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const getConnection = require("../mysql/database/config");
const { dbConnection } = require("../database/config");
const { OVERDUE_QUERY, isReminderDay, pickRecipient } = require("../scheduler/overdueReminders");

const windowDays = Number(process.argv[2]) || 7;

// La misma consulta del scheduler, pero incluyendo los detenidos para poder verlos.
const QUERY = OVERDUE_QUERY.replace("AND madl.reminders_stopped_at IS NULL", "").replace(
  "SELECT",
  "SELECT madl.reminders_stopped_at,"
);

const nextReminderDays = (from, count = 3) => {
  const out = [];
  for (let d = from + 1; out.length < count && d < from + 400; d++) if (isReminderDay(d)) out.push(d);
  return out;
};

(async () => {
  const [rows] = await getConnection().query(QUERY);

  console.log(`\n== Prestamos vencidos: ${rows.length} ==`);
  const table = rows.map((r) => {
    const to = pickRecipient(r);
    return {
      lease: `${r.company_id}:${r.member_id}:${r.device_id}`,
      serial: r.device_serial_number,
      vence: String(r.expected_return_date).slice(0, 10),
      atraso: r.days_overdue,
      para: to ? to.email : "(sin email)",
      detenido: r.reminders_stopped_at ? "SI" : "",
      hoy: r.reminders_stopped_at ? "no (detenido)" : isReminderDay(r.days_overdue) ? "SI" : "no",
      siguientes: nextReminderDays(Number(r.days_overdue)).join(","),
    };
  });
  console.table(table);

  await dbConnection();
  const since = new Date(Date.now() - windowDays * 86400000);
  const jobs = await mongoose.connection.db
    .collection("jobs")
    .find({ idempotencyKey: /^overdue-reminder:/, createdAt: { $gte: since } })
    .project({ idempotencyKey: 1, createdAt: 1, status: 1, "payload.to": 1, lastError: 1 })
    .sort({ createdAt: 1 })
    .toArray();

  console.log(`\n== Jobs overdue-reminder desde ${since.toISOString().slice(0, 10)}: ${jobs.length} ==`);
  const runs = {};
  for (const j of jobs) {
    const h = j.createdAt.toISOString().slice(0, 13) + "Z";
    runs[h] = (runs[h] || 0) + 1;
  }
  console.log("Corridas (hora UTC de encolado -> jobs):");
  for (const [h, n] of Object.entries(runs)) {
    const hour = Number(h.slice(11, 13));
    const flag = hour === 12 || hour === 13 ? "" : "   <-- hora inesperada: ¿otro proceso?";
    console.log(`  ${h}  ${n}${flag}`);
  }

  // Claves: hasta 2026-10-12 una por prestamo (overdue-reminder:cia:miembro:equipo:dia);
  // desde entonces una por destinatario (overdue-reminder:cia:to-<hash>:dia).
  console.log("\nPor clave (prestamo, o cia:to-<destinatario> desde el agrupado):");
  const byLease = {};
  for (const j of jobs) {
    const k = j.idempotencyKey.split(":").slice(1, -1).join(":");
    (byLease[k] = byLease[k] || []).push(
      `${j.createdAt.toISOString().slice(5, 10)}(${j.status}${j.lastError ? "!" : ""})`
    );
  }
  for (const [k, v] of Object.entries(byLease)) console.log(`  ${k}  ${v.join(" ")}`);

  console.log("\nPor destinatario (correos por dia):");
  const byTo = {};
  for (const j of jobs) {
    const to = (j.payload && j.payload.to) || "(?)";
    const day = j.createdAt.toISOString().slice(5, 10);
    byTo[to] = byTo[to] || {};
    byTo[to][day] = (byTo[to][day] || 0) + 1;
  }
  for (const [to, days] of Object.entries(byTo)) {
    const list = Object.entries(days).map(([d, n]) => (n > 1 ? `${d}x${n}` : d));
    console.log(`  ${to}  ${list.join(" ")}`);
  }

  await mongoose.disconnect();
  await getConnection().end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
