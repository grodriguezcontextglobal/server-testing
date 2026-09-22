// bcrypt NATIVO: hashea en el threadpool de libuv en vez de bloquear el event
// loop ~150ms por alta. Ver el comentario en controller/admin.js.
const bcrypt = require("bcrypt");
const { randomUUID: uuid } = require("crypto");
const AdminUser = require("../models/AdminUser");
const Company = require("../models/Company");
const getConnection = require("../mysql/database/config");
const { generateJWT } = require("../helpers/jwt");
const logger = require("../helpers/logger");

const { VALID_ROLE_TYPES } = require('../mysql/constants/roles');

// ----- shared SQL helpers -----

/**
 * Devuelve el `staff_id` de ese email, creando la fila solo si no existía.
 *
 * `staff_member.email` tiene UNIQUE (`uq_staff_member_email`, aplicado
 * 2026-08-18 junto con la limpieza de duplicados — ver
 * mysql/migrations/dedupe_staff_member_by_email.sql), así que un INSERT plano
 * ahora falla con 1062 en vez de duplicar en silencio. Antes de ese índice el
 * mismo email llegó a tener 9 filas y la resolución de `staff_id` quedaba
 * ambigua: un login con rol scopeado terminó resolviendo al rol equivocado.
 *
 * El 1062 se atrapa en vez de prevenirse solo con el SELECT previo porque dos
 * requests concurrentes con el mismo email (invitación aceptada dos veces,
 * doble click) pasan ambos el SELECT y solo uno gana el INSERT. El que pierde
 * relee y se queda con la fila del ganador.
 */
async function upsertStaffMemberSQL(sqlConn, { first_name, last_name, email, phone_number }) {
  const findByEmail = async () => {
    const [[row]] = await sqlConn.execute(
      "SELECT staff_id FROM staff_member WHERE email = ? LIMIT 1",
      [email]
    );
    return row ? row.staff_id : null;
  };

  const existing = await findByEmail();
  if (existing) return existing;

  try {
    const [result] = await sqlConn.execute(
      "INSERT INTO staff_member (first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?)",
      [first_name, last_name, email, phone_number || null]
    );
    return result.insertId;
  } catch (error) {
    if (error?.errno === 1062 || error?.code === "ER_DUP_ENTRY") return await findByEmail();
    throw error;
  }
}

async function insertCompanyInfoSQL(sqlConn, { company_name, address, phone, main_email, industry }) {
  const [result] = await sqlConn.execute(
    `INSERT INTO company_info
      (company_name, street_address, city_address, state_address, zip_address, phone_number, email_company, industry)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      company_name,
      address.street || null,
      address.city || null,
      address.state || null,
      address.postal_code || null,
      phone.main || null,
      main_email || null,
      industry || null,
    ]
  );
  return result.insertId;
}

// staffId opcional: si ya lo tenemos evitamos el SELECT a staff_member
async function syncCompanyStaffSQL(sqlConn, { email, sqlCompanyId, roleType, staffId = null }) {
  let resolvedStaffId = staffId;

  if (!resolvedStaffId) {
    const [[staffRow]] = await sqlConn.execute(
      "SELECT staff_id FROM staff_member WHERE email = ? LIMIT 1",
      [email]
    );
    resolvedStaffId = staffRow?.staff_id ?? null;
  }

  const [roleRows] = await sqlConn.query(
    "SELECT id FROM roles WHERE role_type = ?",
    [roleType]
  );

  if (resolvedStaffId && roleRows.length) {
    await sqlConn.query(
      "INSERT IGNORE INTO company_staff (id, company_id, staff_id, role_id, is_active) VALUES (?,?,?,?,1)",
      [uuid(), sqlCompanyId, resolvedStaffId, roleRows[0].id]
    );
  }

  return resolvedStaffId;
}

function buildCompanyDoc({ companyData, owner }) {
  return {
    company_name: companyData.company_name,
    address: {
      street: companyData.address?.street || "",
      city: companyData.address?.city || "",
      state: companyData.address?.state || "",
      postal_code: companyData.address?.postal_code || "",
    },
    phone: {
      main: companyData.phone?.main || "",
      alternative: companyData.phone?.alternative || "",
    },
    owner: {
      first_name: owner.name,
      last_name: owner.lastName,
      email: owner.email,
    },
    website: companyData.website,
    main_email: companyData.main_email || owner.email,
    industry: companyData.industry || "",
    stripe_customer_id: companyData.stripe_customer_id || "",
    employees: [
      {
        user: owner.email,
        firstName: owner.name,
        lastName: owner.lastName,
        status: "active",
        super_user: true,
        role: 0,
        roleType: "root_admin",
        userId: owner.userId,
      },
    ],
    location: companyData.location || [],
    company_logo: companyData.company_logo || "",
  };
}

// ----- POST /api/registration/new -----
// Nuevo usuario + nueva empresa. Sin autenticación requerida.
// Body: { user: { name, lastName, email, password, phone, imageProfile },
//         company: { company_name, phone, website, main_email, industry,
//                    address, location, company_logo, stripe_customer_id },
//         terms: { signature, documents, email } }
const registerNewUserAndCompany = async (request, response) => {
  const { user, company, terms } = request.body;

  try {
    // --- Validaciones básicas ---
    if (!user?.email || !user?.password || !user?.name || !user?.lastName) {
      return response.status(400).json({
        ok: false,
        msg: "user.name, user.lastName, user.email y user.password son requeridos.",
      });
    }
    if (!company?.company_name || !company?.website) {
      return response.status(400).json({
        ok: false,
        msg: "company.company_name y company.website son requeridos.",
      });
    }

    // --- Verificar unicidad de email y nombre de empresa ---
    const [existingUser, existingCompany] = await Promise.all([
      AdminUser.findOne({ email: user.email }),
      Company.findOne({ company_name: company.company_name }),
    ]);

    if (existingUser) {
      return response.status(400).json({
        ok: false,
        msg: `${user.email} ya está registrado. Usa el flujo de usuario existente para agregar una empresa.`,
      });
    }
    if (existingCompany) {
      return response.status(400).json({
        ok: false,
        msg: `Ya existe una empresa con el nombre "${company.company_name}".`,
      });
    }

    const sqlConn = getConnection();

    // --- Crear AdminUser en MongoDB ---
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(user.password, salt);
    const adminUser = new AdminUser({
      name: user.name,
      lastName: user.lastName,
      email: user.email,
      password: hashedPassword,
      phone: user.phone || "",
      imageProfile: user.imageProfile || "",
      role: 0,
      active: true,
    });
    await adminUser.save();

    // --- Insertar staff_member en MySQL ---
    let sqlStaffId = null;
    try {
      sqlStaffId = await upsertStaffMemberSQL(sqlConn, {
        first_name: user.name,
        last_name: user.lastName,
        email: user.email,
        phone_number: user.phone || null,
      });
    } catch (sqlErr) {
      logger.warn("staff_member insert falló durante registro nuevo", {
        email: user.email,
        err: sqlErr.message,
      });
    }

    // --- Crear Company en MongoDB ---
    const companyDoc = new Company(
      buildCompanyDoc({ companyData: company, owner: { ...user, userId: adminUser.id } })
    );
    await companyDoc.save();

    // --- Insertar company_info en MySQL ---
    let sqlCompanyId = null;
    try {
      sqlCompanyId = await insertCompanyInfoSQL(sqlConn, {
        company_name: company.company_name,
        address: company.address || {},
        phone: company.phone || {},
        main_email: company.main_email || user.email,
        industry: company.industry,
      });
    } catch (sqlErr) {
      logger.warn("company_info insert falló durante registro nuevo", {
        company_name: company.company_name,
        err: sqlErr.message,
      });
    }

    // --- Sincronizar company_staff en MySQL ---
    if (sqlCompanyId) {
      try {
        await syncCompanyStaffSQL(sqlConn, {
          email: user.email,
          sqlCompanyId,
          roleType: "root_admin",
          staffId: sqlStaffId, // ya lo tenemos del INSERT anterior — evita un SELECT extra
        });
      } catch (sqlErr) {
        logger.warn("company_staff sync falló durante registro nuevo", { err: sqlErr.message });
      }
    }

    // --- Generar JWT ---
    const token = await generateJWT(
      adminUser.id,
      adminUser.name,
      adminUser.tokenVersion,
      false,
      sqlStaffId
    );

    return response.status(201).json({
      ok: true,
      token,
      user: {
        uid: adminUser.id,
        name: adminUser.name,
        lastName: adminUser.lastName,
        email: adminUser.email,
        phone: adminUser.phone,
        imageProfile: adminUser.imageProfile,
        role: adminUser.role,
        sqlStaffId,
      },
      company: {
        _id: companyDoc._id,
        company_name: companyDoc.company_name,
        sql_id: sqlCompanyId,
        stripe_customer_id: companyDoc.stripe_customer_id,
        industry: companyDoc.industry,
        website: companyDoc.website,
        location: companyDoc.location,
        company_logo: companyDoc.company_logo,
      },
    });
  } catch (error) {
    logger.error("registerNewUserAndCompany error", {
      error: error.message,
      stack: error.stack,
    });
    return response.status(500).json({
      ok: false,
      msg: "El registro falló. Por favor contacta soporte.",
      err: error.message,
    });
  }
};

// ----- POST /api/registration/add-company -----
// Usuario existente + nueva empresa. Sin autenticación requerida.
// Body: { user: { userId }, company: { company_name, phone, website, main_email, industry,
//                                      address, location, company_logo, stripe_customer_id } }
const registerExistingUserNewCompany = async (request, response) => {
  const { user: userBody, company } = request.body;
  const userId = userBody?.userId;

  if (!userId) {
    return response.status(400).json({ ok: false, msg: "user.userId es requerido." });
  }

  // uid y sqlStaffId también pueden llegar por JWT si el cliente lo envía
  const jwtStaffId = request.sqlStaffId ?? null;
  const uid = request.uid ?? userId;

  try {
    if (!company?.company_name || !company?.website) {
      return response.status(400).json({
        ok: false,
        msg: "company.company_name y company.website son requeridos.",
      });
    }

    // --- Obtener usuario existente ---
    const adminUser = await AdminUser.findById(uid);
    if (!adminUser) {
      return response.status(404).json({ ok: false, msg: "Usuario no encontrado." });
    }

    // --- Verificar unicidad del nombre de empresa ---
    const existingCompany = await Company.findOne({ company_name: company.company_name });
    if (existingCompany) {
      return response.status(400).json({
        ok: false,
        msg: `Ya existe una empresa con el nombre "${company.company_name}".`,
      });
    }

    const sqlConn = getConnection();

    // --- Resolver o crear staff_member en MySQL ---
    let resolvedStaffId = jwtStaffId;
    if (!resolvedStaffId) {
      try {
        resolvedStaffId = await upsertStaffMemberSQL(sqlConn, {
          first_name: adminUser.name,
          last_name: adminUser.lastName,
          email: adminUser.email,
          phone_number: adminUser.phone || null,
        });
      } catch (sqlErr) {
        logger.warn("staff_member lookup/insert falló para usuario existente", {
          email: adminUser.email,
          err: sqlErr.message,
        });
      }
    }

    // --- Crear Company en MongoDB ---
    const companyDoc = new Company(
      buildCompanyDoc({
        companyData: company,
        owner: {
          name: adminUser.name,
          lastName: adminUser.lastName,
          email: adminUser.email,
          userId: adminUser.id,
        },
      })
    );
    await companyDoc.save();

    // --- Insertar company_info en MySQL ---
    let sqlCompanyId = null;
    try {
      sqlCompanyId = await insertCompanyInfoSQL(sqlConn, {
        company_name: company.company_name,
        address: company.address || {},
        phone: company.phone || {},
        main_email: company.main_email || adminUser.email,
        industry: company.industry,
      });
    } catch (sqlErr) {
      logger.warn("company_info insert falló para usuario existente", { err: sqlErr.message });
    }

    // --- Sincronizar company_staff en MySQL ---
    if (sqlCompanyId) {
      try {
        await syncCompanyStaffSQL(sqlConn, {
          email: adminUser.email,
          sqlCompanyId,
          roleType: "root_admin",
        });
      } catch (sqlErr) {
        logger.warn("company_staff sync falló para usuario existente", { err: sqlErr.message });
      }
    }

    return response.status(201).json({
      ok: true,
      user: {
        uid: adminUser.id,
        name: adminUser.name,
        lastName: adminUser.lastName,
        email: adminUser.email,
        imageProfile: adminUser.imageProfile,
        role: adminUser.role,
        sqlStaffId: resolvedStaffId,
      },
      company: {
        _id: companyDoc._id,
        company_name: companyDoc.company_name,
        sql_id: sqlCompanyId,
        stripe_customer_id: companyDoc.stripe_customer_id,
        industry: companyDoc.industry,
        website: companyDoc.website,
        location: companyDoc.location,
        company_logo: companyDoc.company_logo,
      },
    });
  } catch (error) {
    logger.error("registerExistingUserNewCompany error", {
      error: error.message,
      stack: error.stack,
    });
    return response.status(500).json({
      ok: false,
      msg: "El registro de empresa falló. Por favor contacta soporte.",
      err: error.message,
    });
  }
};

// ----- POST /api/registration/accept-invitation -----
// Acepta una invitación de empresa. Crea el usuario en MongoDB+SQL si es nuevo,
// o reutiliza el existente. Inserta en company_staff con el rol de la invitación.
// Body: { user: { name, lastName, email, password? }, company: { company_name } }
//
// El ROL NO se acepta del body: lo definió quien invitó y ya está guardado en
// `Company.employees[].roleType`. Aceptarlo del request permitía que el propio
// invitado pidiera `root_admin` en una ruta sin autenticación y quedara así en
// `company_staff`, que es la fuente de verdad del lado SQL (ver
// mysql/helpers/staffAccess.js).
const acceptInvitation = async (request, response) => {
  const { user, company } = request.body;

  if (!user?.email || !company?.company_name) {
    return response.status(400).json({
      ok: false,
      msg: "user.email y company.company_name son requeridos.",
    });
  }

  try {
    // ── Buscar empresa en MongoDB ──────────────────────────────────────────────
    const companyDoc = await Company.findOne({ company_name: company.company_name });
    if (!companyDoc) {
      return response.status(404).json({
        ok: false,
        msg: `La empresa "${company.company_name}" no existe.`,
      });
    }

    // ── La invitación tiene que existir ────────────────────────────────────────
    // Antes, si el email no estaba en `employees` solo se saltaba el update de
    // Mongo pero IGUAL se insertaba en company_staff: con saber el nombre de una
    // empresa alcanzaba para darse acceso.
    const empIndex = companyDoc.employees.findIndex((e) => e.user === user.email);
    if (empIndex < 0) {
      return response.status(404).json({
        ok: false,
        msg: `No hay una invitación pendiente para ${user.email} en "${company.company_name}".`,
      });
    }

    // El rol lo fijó quien invitó, no el invitado.
    const invitedRoleType = companyDoc.employees[empIndex].roleType;
    const validRoleType = VALID_ROLE_TYPES.has(invitedRoleType)
      ? invitedRoleType
      : "assistant";

    const sqlConn = getConnection();

    // ── Usuario: nuevo o existente ─────────────────────────────────────────────
    let adminUser = await AdminUser.findOne({ email: user.email });
    const isNewUser = !adminUser;

    if (isNewUser) {
      if (!user.password) {
        return response.status(400).json({
          ok: false,
          msg: "user.password es requerido para usuarios nuevos.",
        });
      }
      const salt = await bcrypt.genSalt();
      const hashedPassword = await bcrypt.hash(user.password, salt);
      adminUser = new AdminUser({
        name: user.name || "",
        lastName: user.lastName || "",
        email: user.email,
        password: hashedPassword,
        phone: user.phone || "",
        imageProfile: "",
        // role: 0,
        active: true,
      });
      await adminUser.save();
    }

    // ── Marcar empleado como Confirmed en MongoDB ──────────────────────────────
    companyDoc.employees[empIndex].status = "Confirmed";
    if (isNewUser) companyDoc.employees[empIndex].userId = adminUser._id;
    await companyDoc.save();

    // ── SQL: crear o encontrar staff_member ───────────────────────────────────
    let sqlStaffId = null;
    try {
      sqlStaffId = await upsertStaffMemberSQL(sqlConn, {
        first_name: adminUser.name,
        last_name: adminUser.lastName,
        email: adminUser.email,
        phone_number: adminUser.phone || null,
      });
    } catch (sqlErr) {
      logger.warn("staff_member insert/lookup falló para invitación", {
        email: user.email,
        err: sqlErr.message,
      });
    }

    // ── SQL: obtener company_id de company_info ───────────────────────────────
    let sqlCompanyId = null;
    try {
      const [[companyRow]] = await sqlConn.execute(
        "SELECT company_id FROM company_info WHERE company_name = ? LIMIT 1",
        [company.company_name]
      );
      sqlCompanyId = companyRow?.company_id ?? null;
    } catch (sqlErr) {
      logger.warn("company_info lookup falló para invitación", {
        company_name: company.company_name,
        err: sqlErr.message,
      });
    }

    // ── SQL: insertar company_staff ────────────────────────────────────────────
    if (sqlCompanyId && sqlStaffId) {
      try {
        await syncCompanyStaffSQL(sqlConn, {
          email: user.email,
          sqlCompanyId,
          roleType: validRoleType,
          staffId: sqlStaffId,
        });
      } catch (sqlErr) {
        logger.warn("company_staff sync falló para invitación", { err: sqlErr.message });
      }
    }

    const statusCode = isNewUser ? 201 : 200;
    return response.status(statusCode).json({
      ok: true,
      user: {
        uid: adminUser.id,
        name: adminUser.name,
        lastName: adminUser.lastName,
        email: adminUser.email,
        isNewUser,
        sqlStaffId,
      },
      company: {
        _id: companyDoc._id,
        company_name: companyDoc.company_name,
        sql_id: sqlCompanyId,
        // El rol efectivo con el que quedó la membresía. Se devuelve para que el
        // cliente no tenga que adivinarlo ni mandarlo — ya no lo acepta el body.
        roleType: validRoleType,
      },
    });
  } catch (error) {
    logger.error("acceptInvitation error", { error: error.message, stack: error.stack });
    return response.status(500).json({
      ok: false,
      msg: "La aceptación de la invitación falló.",
      err: error.message,
    });
  }
};

module.exports = {
  registerNewUserAndCompany,
  registerExistingUserNewCompany,
  acceptInvitation,
};
