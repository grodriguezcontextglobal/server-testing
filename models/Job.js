const { Schema, model } = require("mongoose");

// Cola de tareas durable (store-and-forward). Ver DESIGN_task_queue.md.
const JobSchema = Schema(
  {
    type: { type: String, required: true, index: true }, // 'send-email:invoice', 'go-worker:insert-item-event', ...
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "done", "failed", "dead"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    nextAttemptAt: { type: Date, default: Date.now, index: true }, // para el backoff
    lockedBy: { type: String, default: null }, // id del worker que lo tomó
    lockedAt: { type: Date, default: null },
    // Dedup. SIN `default: null` a propósito: con default null, Mongoose
    // inyectaría null y el índice unique+sparse NO ignora los null presentes
    // (sparse solo omite el campo ausente) → solo un job sin clave podría
    // existir (E11000 en el 2do). Dejando el campo ausente cuando no hay clave
    // (ver buildNewJob en queue/core.js), el índice sparse lo ignora y coexisten
    // infinitos jobs sin clave.
    idempotencyKey: { type: String, unique: true, sparse: true },
    lastError: { type: String, default: null },
    result: { type: Schema.Types.Mixed, default: null },
    doneAt: { type: Date, default: null }, // TTL borra los 'done' viejos

    // Snapshot de auditoría/identidad de quién encoló la tarea, capturado desde
    // el req original en el momento del enqueue (el req ya no existe cuando el
    // worker ejecuta el job). NUNCA credenciales crudas (x-token, s-token-lq) —
    // solo identidad ya verificada por el middleware de auth. Ver buildContext
    // en queue/core.js y DESIGN_task_queue.md § "Contexto de auditoría en jobs".
    context: {
      uid: { type: String, default: null },
      companyId: { type: String, default: null },
      sqlStaffId: { type: Number, default: null },
    },
  },
  { timestamps: true } // createdAt / updatedAt
);

// Claim eficiente: pending ordenados por nextAttemptAt
JobSchema.index({ status: 1, nextAttemptAt: 1 });
// Auditoría/soporte: listar jobs por compañía (ej. "qué se encoló para C1")
JobSchema.index({ "context.companyId": 1, createdAt: -1 });
// TTL: borra jobs 'done' 7 días después de doneAt
JobSchema.index({ doneAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

JobSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();
  object.id = _id;
  return object;
});

module.exports = model("Job", JobSchema);
