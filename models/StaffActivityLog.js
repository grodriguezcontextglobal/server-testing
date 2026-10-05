const { Schema, model } = require("mongoose");

const StaffActivityLogSchema = new Schema({
  // Opcional desde el audit trail del servidor (middlewares/auditTrail.js):
  // hay rutas de escritura sin auth, y una acción sin autor identificable se
  // registra igual, con actor_type 'anonymous', en vez de perderse.
  staff_member_id: {
    type: Schema.Types.ObjectId,
    ref: "AdminUser",
    required: false,
    default: null,
  },
  actor_type: {
    type: String,
    enum: ["staff", "anonymous"],
    default: "staff",
  },
  // Opcional a propósito: hay eventos que legítimamente no tienen compañía.
  // El LOGIN ocurre ANTES de que el usuario elija con qué compañía trabajar
  // (ver helpers/companyContext.js), y un audit trail no puede descartar un
  // registro por no poder atribuirlo — con `required: true` el job terminaba
  // en dead-letter y el evento se perdía.
  company_id: {
    type: String,
    required: false,
    default: null,
  },
  // id SQL de la compañía (header s-company-lq de las rutas /api/db_*). El
  // worker lo traduce a company_id; se conserva por si la traducción falla.
  company_sql_id: {
    type: String,
    required: false,
    default: null,
  },
  action: {
    type: String,
    required: true,
    // Suggestions: 'LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'ASSIGN', 'UNASSIGN', 'IMPORT', 'EXPORT'
  },
  target_model: {
    type: String,
    required: true,
    // Suggestions: 'AdminUser', 'User', 'Event', 'Inventory', 'Lease', 'Verification'
  },
  target_id: {
    type: String, // ID of the affected object
    required: false,
  },
  details: {
    type: Object, // Flexible field for details like "Added 5 items", "Assigned iPad to John", etc.
    default: {},
  },
  // Lo que permite filtrar el trail por evento o por dispositivo. Lo rellena el
  // audit trail del servidor a partir de la petición.
  context: {
    event_id: { type: String },
    event_name: { type: String },
    member_id: { type: String },
    consumer: { type: String },
    serial_numbers: { type: [String], default: undefined },
    item_ids: { type: [String], default: undefined },
    // Destinatarios de un correo (acciones SEND Email).
    recipients: { type: [String], default: undefined },
    count: { type: Number },
  },
  // 'server' = middlewares/auditTrail.js; 'client' = POST /api/admin/activity-logs;
  // sin valor = los registros explícitos de los controladores.
  source: {
    type: String,
    required: false,
  },
  ip_address: {
    type: String,
    default: "",
  },
  device_info: {
    type: String, // User Agent
    default: "",
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

StaffActivityLogSchema.index({ company_id: 1, timestamp: -1 });
StaffActivityLogSchema.index({ "context.event_id": 1, timestamp: -1 });
StaffActivityLogSchema.index({ "context.serial_numbers": 1, timestamp: -1 });
StaffActivityLogSchema.index({ "context.item_ids": 1, timestamp: -1 });
StaffActivityLogSchema.index({ "context.member_id": 1, timestamp: -1 });

StaffActivityLogSchema.method("toJSON", function () {
  const { __v, _id, ...object } = this.toObject();
  object.id = _id;
  return object;
});

module.exports = model("StaffActivityLog", StaffActivityLogSchema);
