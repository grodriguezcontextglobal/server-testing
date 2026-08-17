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
  password: {
    type: String,
    required: true,
    unique: true,
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
  active: {
    type: Boolean,
    default: true,
  },
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
  mfaSecret: {
    type: Object, // Stores ASCII, hex, base32, otpauth_url
    select: false, // Do not return by default
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

AdminUserSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("AdminUser", AdminUserSchema);
