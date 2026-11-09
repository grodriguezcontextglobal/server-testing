const { Schema, model } = require("mongoose");

const AdminUserSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  phone: {
    type: String,
    required: false,
    unique: false,
  },
  // Oculta por defecto: el hash salía en toda respuesta que devolviera un
  // AdminUser, incluida GET /api/staff/__staff-search, que es anónima. Quien lo
  // necesite (login, verify-password) lo pide con `.select("+password")`.
  password: {
    type: String,
    required: true,
    unique: true,
    select: false,
  },
  // `question` / `answer` (pregunta secreta) se eliminaron: ningún flujo las
  // leía — no hay recuperación de contraseña por pregunta secreta — y eran
  // `required: true`, así que solo obligaban al alta a mandar datos inertes.
  //
  // LEGACY / SOLO PRESENTACIÓN. `role` y `role_type` NO son fuente de verdad:
  // la autorización resuelve el rol por-compañía desde `Company.employees`
  // (ver middlewares/authorizeMongoPermission.js). Se mantienen porque
  // documentos existentes los traen y el frontend todavía los muestra; ningún
  // path del backend los escribe ya. Pendiente de eliminar — ver
  // FRONTEND_admin_user_schema_cleanup.md.
  role: {
    type: String,
    default: "Editor",
  },
  role_type: {
    type: String,
    enum: [
      'root_admin', 'admin', 'sale_manager', 'event_manager',
      'inventory_manager', 'assistant',
      'inventory_location_manager', 'inventory_location_assistant',
      null,
    ],
    default: null,
  },
  // false = la cuenta no puede entrar (el login responde 403 accountDisabled).
  active: {
    type: Boolean,
    default: true,
  },
  // Uso de la cuenta (2026-11-09; helpers/accountActivity.js). lastLoginAt es
  // la fecha de la desactivación por inactividad (AC-2(3),
  // scheduler/staffInactivity.js). IP y navegador ocultos por defecto: el
  // modelo se devuelve entero en varias respuestas y otro admin no tiene por qué
  // ver desde dónde entra alguien. Se leen con .select("+lastLoginIp ...").
  lastLoginAt: { type: Date, default: null },
  lastLoginIp: { type: String, default: null, select: false },
  lastLoginUserAgent: { type: String, default: null, select: false },
  loginCount: { type: Number, default: 0 },
  // Último login fallido de esta cuenta (contraseña o MFA incorrectas), AC-7.
  lastFailedLoginAt: { type: Date, default: null },
  // Lo pone el hook de abajo en cualquier escritura de `password` (IA-5).
  passwordChangedAt: { type: Date, default: null },
  deactivatedAt: { type: Date, default: null },
  deactivatedReason: { type: String, default: null },
  reactivatedAt: { type: Date, default: null },
  // `company` se eliminó: un AdminUser pertenece a N compañías, así que un
  // único campo no podía representar el contexto. La compañía la elige el
  // cliente al loguearse y viaja por request (header `x-company-id`, ver
  // helpers/companyContext.js); la membresía vive en `Company.employees`.
  imageProfile: {
    type: String,
    default: "",
  },
  mfaEnabled: {
    type: Boolean,
    default: false,
  },
  // FedRAMP A5 (2026-11-03): un administrador restableció la MFA. Mientras siga
  // en true, el login no entrega mfaSetupToken: la persona vuelve a enrolarse
  // solo desde el enlace de reset de contraseña que le llega por correo. Lo
  // limpia un update-password correcto (controller/admin.js).
  mfaResetPending: {
    type: Boolean,
    default: false,
  },
  mfaSecret: {
    type: Object, // Stores ASCII, hex, base32, otpauth_url
    select: false, // Do not return by default
  },
  // Hashes de los códigos de recuperación de MFA (helpers/mfaRecoveryCodes.js).
  // Cada uno se borra del array al usarse.
  mfaRecoveryCodes: {
    type: [String],
    select: false,
    default: undefined,
  },
  emailNotifications: {
    type: Object,
    default: {
      newsAndUpdates: false,
      tipsAndTutorials: false,
      userResearch: false,
    },
  },
  dailySummaries: {
    type: String,
    default: "do not notify me",
  },
  eventReminder: {
    type: String,
    default: "do not notify me",
  },
  subscriptionRenewals: {
    type: String,
    default: "do not notify me",
  },
  online: {
    type: Boolean,
    default: false,
  },
  super_user: {
    type: Boolean,
    default: false,
  },
  // Lectura de observabilidad de plataforma (/api/metrics, /api/jobs/stats) SIN
  // el poder de escritura de `super_user`, que es bypass total de
  // authorizeMongoPermission. Ver middlewares/requirePlatformRead.js.
  platform_observer: {
    type: Boolean,
    default: false,
  },
  multipleCompanies: {
    type: Boolean,
    default: false,
  },
  // Mantenido por el frontend (PATCH /api/admin/profile/:id), no por el
  // registro ni por la aceptación de invitaciones. Sirve como lista de
  // compañías del usuario para el selector de login; el `role`/`role_type` de
  // cada entrada es informativo — la autorización real sigue saliendo de
  // `Company.employees`.
  companiesAssigned: [
    {
      company: {
        type: String,
        required: true,
      },
      active: {
        type: Boolean,
        default: true,
      },
      super_user: {
        type: Boolean,
        default: false,
      },
      role: {
        type: String,
        default: "Editor",
      },
      role_type: {
        type: String,
        enum: [
          'root_admin', 'admin', 'sale_manager', 'event_manager',
          'inventory_manager', 'assistant',
          'inventory_location_manager', 'inventory_location_assistant',
          null,
        ],
        default: null,
      },
    },
  ],
  tokenVersion: { type: Number, default: 0 },
  agreedPlatformConditions:{
    type: Boolean,
    default: false
  }
});

// passwordChangedAt (IA-5): en el modelo y no en cada controlador, para que
// ningún camino que escriba la contraseña (alta, registro, invitación, reset)
// se lo salte. Cubre save() y los update por query.
AdminUserSchema.pre("save", function (next) {
  if (this.isModified("password")) this.passwordChangedAt = new Date();
  next();
});
function stampPasswordChange(next) {
  const update = this.getUpdate() || {};
  const writesPassword =
    Object.prototype.hasOwnProperty.call(update, "password") ||
    Object.prototype.hasOwnProperty.call(update.$set || {}, "password");
  if (writesPassword) this.set({ passwordChangedAt: new Date() });
  next();
}
AdminUserSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], stampPasswordChange);

AdminUserSchema.method("toJSON", function () {
  // password/mfaSecret/mfaRecoveryCodes nunca se serializan, aunque se hayan
  // cargado con `.select("+...")` (el login lo hace y responde `entire: adminUser`).
  const { _id, __v, password, mfaSecret, mfaRecoveryCodes, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("AdminUser", AdminUserSchema);
