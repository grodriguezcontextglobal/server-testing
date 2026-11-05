const StaffActivityLog = require("../models/StaffActivityLog");
const AdminUser = require("../models/AdminUser");
const Company = require("../models/Company");
const logger = require("../helpers/logger");
const { enqueue } = require("../helpers/queue");
const { resolveCompanyContext } = require("../helpers/companyContext");
const {
  ACTIVITY_ACTIONS,
  ACTIVITY_TARGET_MODELS,
} = require("../constants/activityVocabulary");

/**
 * Logs a staff member's activity.
 *
 * Encolado en vez de guardado inline (ver DESIGN_task_queue.md § Fase 1): antes,
 * si el `save()` fallaba, el error se tragaba en el catch y el log se perdía
 * para siempre en silencio. Ahora el job sobrevive esa falla y reintenta con
 * backoff / dead-letter. El contrato para los 12 call-sites existentes
 * (admin.js, event.js, inventory.js) no cambia: nunca lanza, no devuelve nada.
 *
 * No lleva `context` (identidad de quién audita) porque el propio payload YA
 * es el registro de auditoría — `staff_member_id`/`company_id` son el sujeto
 * del log, no metadata de quién lo encoló.
 *
 * @param {Object} data - The activity data.
 * @param {string} data.staff_member_id - ID of the staff member.
 * @param {string} data.company_id - ID of the company.
 * @param {string} data.action - The action performed (e.g., 'LOGIN', 'CREATE').
 * @param {string} data.target_model - The model affected (e.g., 'User', 'Inventory').
 * @param {string} [data.target_id] - ID of the affected object.
 * @param {Object} [data.details] - Additional details about the action.
 * @param {string} [data.ip_address] - IP address of the user.
 * @param {string} [data.device_info] - Device/User Agent info.
 * @param {object} [opts] - Inyectable en tests (enqueueFn); en producción usa el enqueue real.
 */
const logStaffActivity = async (data, { enqueueFn = enqueue } = {}) => {
  try {
    await enqueueFn("log:staff-activity", data);
  } catch (error) {
    logger.error("Error enqueuing staff activity log:", error);
  }
};

/**
 * Compañías donde el requester es empleado ACTIVO.
 *
 * Fuente de verdad `Company.employees`, igual que authorizeMongoPermission, y
 * con el mismo criterio de match: por `userId` o por email (`user`), porque los
 * employees preexistentes no tienen userId — ver scripts/backfillMongoRoles.js.
 */
const findMemberships = async (requester, { CompanyModel = Company } = {}) => {
  const requesterId = requester.id ?? requester._id;
  const or = [];
  if (requesterId != null) or.push({ "employees.userId": requesterId });
  if (requester.email) or.push({ "employees.user": requester.email });
  if (or.length === 0) return [];

  const companies = await CompanyModel.find(
    { $or: or },
    { company_name: 1, employees: 1 }
  ).lean();

  const isActiveMember = (e) =>
    ((e.userId != null && String(e.userId) === String(requesterId)) ||
      (requester.email != null && e.user === requester.email)) &&
    e.active !== false;

  return companies.filter((c) => c.employees?.some(isActiveMember));
};

/**
 * Retrieves staff activity logs based on filters and permissions.
 */
const createGetStaffActivityLogs = ({
  findAdminUserFn = (id) => AdminUser.findById(id),
  findMembershipsFn = findMemberships,
  StaffActivityLogModel = StaffActivityLog,
} = {}) => async (req, res) => {
  try {
    const { uid } = req;
    const requester = await findAdminUserFn(uid);

    if (!requester) {
      return res.status(404).json({ ok: false, msg: "User not found" });
    }

    const {
      staff_member_id,
      action,
      target_model,
      target_id,
      event_id,
      serial_number,
      item_id,
      member_id,
      consumer,
      actor_type,
      source,
      start_date,
      end_date,
      include_automatic,
      limit = 50,
      page = 1,
    } = req.query;

    // La compañía sale del MISMO helper que usa el camino de escritura, no de
    // `req.query.company_id` a secas: el cliente manda el contexto en el header
    // `x-company-id`, así que leyendo solo el query string el reporte devolvía
    // el historial entero sin filtrar por compañía.
    const company_id = resolveCompanyContext(req);

    let query = {};

    // Permission Check
    const isRootAdmin = requester.super_user;

    if (isRootAdmin) {
      // Root admin can filter by any company_id if provided
      if (company_id) query.company_id = company_id;
    } else {
      // Alcance = compañías donde el usuario es empleado ACTIVO, leído de
      // `Company.employees` (la misma fuente de verdad que
      // authorizeMongoPermission). Antes salía de AdminUser.companiesAssigned /
      // AdminUser.company: el primero solo lo mantiene el frontend y el segundo
      // ya no existe en el schema, así que un usuario con membresías reales
      // podía recibir 403 "No company assigned".
      const memberships = await findMembershipsFn(requester);

      if (memberships.length === 0) {
        return res
          .status(403)
          .json({ ok: false, msg: "No company assigned to user" });
      }

      // Los registros históricos guardaron en `company_id` el NOMBRE de la
      // compañía (venía del viejo AdminUser.company), mientras los nuevos
      // guardan el ObjectId que llega por contexto. Se aceptan ambas claves
      // para no volver invisible el historial; ver
      // FRONTEND_admin_user_schema_cleanup.md § migración opcional.
      const keysOf = (c) => [String(c._id), c.company_name].filter(Boolean);

      if (company_id) {
        const scoped = memberships.find((c) =>
          keysOf(c).includes(String(company_id))
        );

        if (!scoped) {
          return res
            .status(403)
            .json({
              ok: false,
              msg: "Unauthorized access to this company's logs",
            });
        }

        // Se filtra por AMBAS claves de esa compañía, no por la que vino en el
        // request: pedir el id y recibir solo los registros nuevos escondería
        // el historial de esa misma compañía guardado bajo su nombre.
        query.company_id = { $in: keysOf(scoped) };
      } else {
        query.company_id = { $in: memberships.flatMap(keysOf) };
      }

      // Lo propio sin compañía también se ve. Hay acciones que llegan sin
      // ninguna cabecera de compañía (/api/receiver, /api/event…) y no siempre
      // se pueden atribuir; filtrarlas por compañía las escondía hasta de quien
      // las hizo. Solo al autor: sin compañía no hay a quién más mostrárselas.
      const requesterId = requester.id ?? requester._id;
      if (requesterId) {
        query.$or = [
          { company_id: query.company_id },
          { company_id: null, staff_member_id: requesterId },
        ];
        delete query.company_id;
      }
    }

    // Apply Filters
    if (staff_member_id) query.staff_member_id = staff_member_id;
    if (action) query.action = action;
    // Los borrados de caché los dispara el dashboard solo, después de cada
    // acción (8 de cada 45 filas el 2026-10-05). Se siguen REGISTRANDO, como
    // todo, pero el reporte no los devuelve salvo que se pidan: filtrarlos en el
    // cliente dejaba páginas de 50 con menos filas y el total descuadrado.
    // Pedir target_model=Cache explícitamente también los trae.
    const wantsAutomatic = String(include_automatic).toLowerCase() === 'true';
    if (target_model) query.target_model = target_model;
    else if (!wantsAutomatic) query.target_model = { $ne: 'Cache' };
    if (target_id) query.target_id = String(target_id);
    if (actor_type) query.actor_type = String(actor_type);
    if (source) query.source = String(source);
    // Filtros del audit trail por evento y por dispositivo (ask del dashboard
    // 2026-10-05 §5.4). Un dispositivo se busca por serial o por item_id: las
    // acciones de SQL traen uno u otro según la ruta.
    if (event_id) query["context.event_id"] = String(event_id);
    if (serial_number) query["context.serial_numbers"] = String(serial_number);
    if (item_id) query["context.item_ids"] = String(item_id);
    if (member_id) query["context.member_id"] = String(member_id);
    if (consumer) query["context.consumer"] = String(consumer);

    if (start_date || end_date) {
      query.timestamp = {};
      if (start_date) query.timestamp.$gte = new Date(start_date);
      if (end_date) query.timestamp.$lte = new Date(end_date);
    }

    const logs = await StaffActivityLogModel.find(query)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate("staff_member_id", "name lastName email role");

    const total = await StaffActivityLogModel.countDocuments(query);

    res.json({
      ok: true,
      logs,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ ok: false, msg: "Error fetching logs" });
  }
};

const getStaffActivityLogs = createGetStaffActivityLogs();

/**
 * HTTP endpoint to register a staff activity record. The acting staff member
 * and their company are resolved server-side from the JWT (`req.uid`), never
 * trusted from the request body, to prevent a caller from logging activity
 * under someone else's identity or another company.
 */
const createRegisterStaffActivity = ({
  findAdminUserFn = (id) => AdminUser.findById(id),
  logStaffActivityFn = logStaffActivity,
} = {}) => async (req, res) => {
  try {
    const { uid } = req;
    const { action, target_model, target_id, details } = req.body;

    if (!action || !target_model) {
      return res
        .status(400)
        .json({ ok: false, msg: "action and target_model are required" });
    }

    const staffMember = await findAdminUserFn(uid);
    if (!staffMember) {
      return res.status(404).json({ ok: false, msg: "Staff member not found" });
    }

    await logStaffActivityFn({
      staff_member_id: staffMember.id,
      // headerOnly: en esta ruta el body ES el contenido del log que manda el
      // caller, así que no puede además decidir a qué compañía se atribuye.
      company_id: resolveCompanyContext(req, { headerOnly: true }),
      action,
      target_model,
      target_id,
      details,
      source: "client",
      ip_address: req.ip,
      device_info: req.headers["user-agent"],
    });

    return res.status(202).json({ ok: true, msg: "Activity registered" });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ ok: false, msg: "Error registering activity" });
  }
};

const registerStaffActivity = createRegisterStaffActivity();

/**
 * The vocabulary the report's filter dropdown is built from (B2.2).
 *
 * Deliberately NOT enforced on the write path: `action`/`target_model` remain
 * free text, because rejecting an unlisted verb would drop an audit entry — the
 * one thing an audit trail may never do. This endpoint publishes the intended
 * spellings so the report can offer them instead of each caller inventing one.
 */
const getActivityVocabulary = (req, res) =>
  res.json({
    ok: true,
    actions: ACTIVITY_ACTIONS,
    target_models: ACTIVITY_TARGET_MODELS,
  });

module.exports = {
  logStaffActivity,
  findMemberships,
  createGetStaffActivityLogs,
  getStaffActivityLogs,
  createRegisterStaffActivity,
  registerStaffActivity,
  getActivityVocabulary,
};
