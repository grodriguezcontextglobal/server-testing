const express = require("express");
const jwt = require("jsonwebtoken");
// bcrypt NATIVO (no bcryptjs): su API async corre en el threadpool de libuv, así
// que un hash de ~150ms no bloquea el event loop. Con `bcryptjs` (JS puro) tanto
// la versión sync como la async retienen el hilo principal — medido: 156ms de
// lag por compareSync, y 131ms con solo 2 de 13 ticks libres en la async.
// Los hashes son compatibles en ambos sentidos ($2a$/$2b$): no hay que rehashear.
const bcrypt = require("bcrypt");
const AdminUser = require("../models/AdminUser");
const Company = require("../models/Company");
const { generateJWT, SESSION_MAX_SECONDS } = require("../helpers/jwt");
const getConnection = require("../mysql/database/config");
const StripeTransaction = require("../models/StripeTransaction");
const { clientRedis } = require("../database/cacheMemoryConfig");
const { loginActivityNotification } = require("../nodeMailer/notifications");
const logger = require("../helpers/logger");
const crypto = require("crypto");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { generateMfaSetupToken, isMfaRequired } = require("../helpers/mfaSetupToken");
const { newSessionId, touchIdle, openStaffSession } = require("../helpers/staffSession");
const {
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
} = require("../helpers/mfaRecoveryCodes");
const {
  getLockoutRemaining,
  recordLoginFailure,
  clearLoginFailures,
  maxAttempts,
} = require("../helpers/loginAttempts");
const { isAcceptablePassword, passwordPolicyMessage } = require("../helpers/passwordPolicy");
const {
  generatePasswordResetToken,
  readPasswordResetUid,
  isValidPasswordResetToken,
} = require("../helpers/passwordResetToken");
const { logStaffActivity } = require("./staffActivityLog");
const { resolveCompanyContext } = require("../helpers/companyContext");
const { findCompanyMembership } = require("../helpers/companyMembership");
const { hasPermission } = require("../constants/rolePermissions");
const { isValidObjectId } = require("mongoose");

const createAdminUser = async (request, response = express.response) => {
  const { email, password } = request.body;

  try {
    let adminUser = await AdminUser.findOne({ email });
    if (adminUser) {
      return response.status(400).json({
        ok: false,
        msg: `${email} is already in our record. Please use a different email address to create a new account.`,
      });
    }

    // Lista blanca explícita en vez de `new AdminUser(request.body)`: esta ruta
    // es anónima (no lleva validateJWT), así que un body arbitrario permitía
    // sembrar `super_user: true` — bypass total de authorizeMongoPermission —
    // además de `companiesAssigned`, `active` y `tokenVersion`. Ni el rol ni la
    // compañía se aceptan aquí: la membresía se crea en `Company.employees`
    // (ver controller/registration.js § acceptInvitation).
    adminUser = new AdminUser({
      name: request.body.name,
      lastName: request.body.lastName,
      email: request.body.email,
      phone: request.body.phone || "",
      imageProfile: request.body.imageProfile || "",
    });

    //encrypt password
    const salt = await bcrypt.genSalt();
    adminUser.password = await bcrypt.hash(password, salt);

    await adminUser.save();

    // Una cuenta recién creada no tiene MFA, y MFA es obligatoria: en vez de
    // sesión recibe el token de enrolamiento (ver loginUser).
    const auth = isMfaRequired()
      ? { mfaSetupRequired: true, mfaSetupToken: await generateMfaSetupToken(adminUser.id) }
      : {
          token: await generateJWT(adminUser.id, adminUser.name, adminUser.tokenVersion, undefined, {
            sid: await openStaffSession(clientRedis, adminUser.id),
          }),
        };

    if (auth.token) {
      // Store JWT in a cookie
      response.cookie("token", auth.token, {
        httpOnly: true, // Prevent client-side JavaScript from accessing the cookie
        secure: process.env.NODE_ENV === "production", // Ensure cookies are only sent over HTTPS in production
        sameSite: "strict", // Prevent CSRF attacks
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
      });
    }

    return response.status(201).json({
      ok: true,
      message: "registered",
      entire: adminUser,
      uid: adminUser.id,
      name: adminUser.name,
      lastName: adminUser.lastName,
      email: adminUser.email,
      phone: adminUser.phone,
      // role: adminUser.role,
      // company: adminUser.company,
      ...auth,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: error.message || error,
    });
  }
};

const loginUser = async (request, response) => {
  const { email, password, forceLogin, mfaCode, recoveryCode } = request.body;
  try {
    // Contador de intentos fallidos (AC-7). Sin Redis no se bloquea: ver
    // helpers/loginAttempts.js.
    let attemptsStore = null;
    try {
      attemptsStore = await clientRedis();
    } catch {}

    const lockedFor = await getLockoutRemaining(attemptsStore, email);
    if (lockedFor > 0) {
      response.set?.("Retry-After", String(lockedFor));
      return response.status(429).json({
        ok: false,
        msg: "Too many failed sign-in attempts. Try again later.",
        accountLocked: true,
        retryAfter: lockedFor,
      });
    }

    // Todo login fallido se registra (AU-2) y suma al contador. Si con este
    // fallo la cuenta queda bloqueada, la respuesta ya es la del bloqueo.
    const failLogin = async (reason, user, status, body) => {
      const { attempts, locked, retryAfter } = await recordLoginFailure(attemptsStore, email);
      logger.warn("Admin login failed", { email, reason, ip: request.ip, locked });
      await logStaffActivity({
        staff_member_id: user?.id ?? null,
        actor_type: user ? "staff" : "anonymous",
        action: "LOGIN_FAILED",
        target_model: "AdminUser",
        target_id: user?.id,
        details: { email, reason, locked },
        ip_address: request.ip,
        device_info: request.headers["user-agent"],
      });
      if (locked) {
        response.set?.("Retry-After", String(retryAfter));
        return response.status(429).json({
          ok: false,
          msg: "Too many failed sign-in attempts. Try again later.",
          accountLocked: true,
          retryAfter,
        });
      }
      // Sin contador (Redis caído) no se anuncia nada.
      const attemptsRemaining = attempts > 0 ? Math.max(maxAttempts() - attempts, 0) : undefined;
      return response.status(status).json({ ...body, attemptsRemaining });
    };

    let adminUser = await AdminUser.findOne({ email }).select("+password");
    if (!adminUser) {
      // Mismo mensaje que la contraseña incorrecta, y cuenta igual para el
      // bloqueo: la respuesta no dice qué emails tienen cuenta.
      return failLogin("unknown_user", null, 400, {
        ok: false,
        msg: "You have entered an invalid username or password",
      });
    }
    //confirm password
    const validPassword = await bcrypt.compare(password, adminUser.password);
    if (!validPassword) {
      return failLogin("invalid_password", adminUser, 400, {
        ok: false,
        msg: "You have entered an invalid username or password",
      });
    }

    // MFA obligatoria: sin MFA no se emite token de sesión ni se abre sesión.
    // Se devuelve un token de enrolamiento que solo sirve para /mfa/generate y
    // /mfa/verify; al terminar, el usuario vuelve a loguearse con su código.
    // Va DESPUÉS de la contraseña: el token de enrolamiento también es prueba
    // de que se conocía.
    const userWithSecret = adminUser.mfaEnabled
      ? await AdminUser.findById(adminUser.id).select("+mfaSecret")
      : null;
    const mfaReady = Boolean(userWithSecret?.mfaSecret?.base32);
    if (!mfaReady && isMfaRequired()) {
      const mfaSetupToken = await generateMfaSetupToken(adminUser.id);
      return response.status(403).json({
        ok: false,
        msg: "MFA setup required. Set up an authenticator app to continue.",
        mfaSetupRequired: true,
        mfaSetupToken,
      });
    }

    // MFA Check. `recoveryCode` sustituye a `mfaCode` cuando se perdió el
    // dispositivo; cuenta para el bloqueo igual que un código TOTP fallido.
    let recoveryCodesRemaining;
    if (mfaReady) {
      if (!mfaCode && !recoveryCode) {
        return response.status(403).json({
          ok: false,
          msg: "MFA code required",
          mfaRequired: true,
        });
      }

      if (mfaCode) {
        const verified = speakeasy.totp.verify({
          secret: userWithSecret.mfaSecret.base32,
          encoding: "base32",
          token: mfaCode,
        });

        if (!verified) {
          return failLogin("invalid_mfa_code", adminUser, 400, {
            ok: false,
            msg: "Invalid MFA code",
          });
        }
      } else {
        recoveryCodesRemaining = await consumeRecoveryCode(adminUser.id, recoveryCode);
        if (recoveryCodesRemaining === null) {
          return failLogin("invalid_recovery_code", adminUser, 400, {
            ok: false,
            msg: "Invalid recovery code",
          });
        }
        await logStaffActivity({
          staff_member_id: adminUser.id,
          action: "MFA_RECOVERY_CODE_USED",
          target_model: "AdminUser",
          target_id: adminUser.id,
          details: { recoveryCodesRemaining },
          ip_address: request.ip,
          device_info: request.headers["user-agent"],
        });
      }
    }

    await clearLoginFailures(attemptsStore, email);

    // Enforce single active session using Redis, with reclaim/force-login
    const redis = await clientRedis();
    const sessionKey = `staff_session:${adminUser.id ?? adminUser.uid}`;
    const ownerKey = `${sessionKey}:owner`;
    // Igual que el token: 12 h desde el login, sin opción de 30 días (AC-12).
    const ttlSeconds = SESSION_MAX_SECONDS;

    // Build a simple fingerprint (UA + IP + user ID)
    const userAgent = request.headers["user-agent"] || "Unknown";
    const ipAddress =
      request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      request.headers["x-real-ip"] ||
      request.headers["x-client-ip"] ||
      request.ip ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      "Unknown";
    const fingerprint = crypto
      .createHash("sha256")
      .update(`${userAgent}|${ipAddress}|${adminUser.id ?? adminUser.uid}`)
      .digest("hex");

    // Single-active-session guard. Disabled for local/demo use (multiple people
    // may share one demo account) via DISABLE_SESSION_GUARD=true.
    if (process.env.DISABLE_SESSION_GUARD !== "true") {
      // Try to claim; if it exists, allow reclaim for same owner or forceLogin
      const claimed = await redis.set(sessionKey, "active", {
        EX: ttlSeconds,
        NX: true,
      });

      if (!claimed) {
        const currentOwner = await redis.get(ownerKey);
        const isSameOwner = currentOwner && currentOwner === fingerprint;

        if (isSameOwner || Boolean(forceLogin)) {
          // Reclaim or force takeover: clear the existing session before proceeding
          try {
            await redis.del(sessionKey);
            await redis.del(ownerKey);
          } catch {}
        } else {
          return response.status(409).json({
            ok: false,
            msg:
              "Active session already exists for this account. " +
              "If this is you, please use 'Force Login' to end the previous session.",
          });
        }
      }
    }

    // Resolve SQL staff_id for JWT enrichment
    let sqlStaffId = null;
    try {
      const sqlConn = getConnection();
      const [[staffRow]] = await sqlConn.execute(
        "SELECT staff_id FROM staff_member WHERE email = ? LIMIT 1",
        [adminUser.email]
      );
      if (staffRow) sqlStaffId = staffRow.staff_id;
    } catch (sqlErr) {
      logger.warn("staff_member lookup failed during login — sqlStaffId will be null", { email: adminUser.email, err: sqlErr.message });
    }

    //generate jwt (json web token)
    // Cada login abre una sesión nueva: el sid anterior deja de valer.
    const sid = newSessionId();
    let token;
    try {
      token = await generateJWT(
        adminUser.id,
        adminUser.name,
        adminUser.tokenVersion,
        sqlStaffId,
        { sid }
      );
    } catch (e) {
      // Rollback the claim if token generation fails
      try {
        await redis.del(sessionKey);
        await redis.del(ownerKey);
      } catch {}
      throw e;
    }

    // Sesión vigente (su sid) y huella del dueño, con TTL. Hasta A6 aquí se
    // guardaba el token entero, que nadie leía.
    try {
      await redis.set(sessionKey, sid, { EX: ttlSeconds });
      await redis.set(ownerKey, fingerprint, { EX: ttlSeconds });
      await touchIdle(redis, adminUser.id);
    } catch {}

    // Prepare login information for email notification with better header extraction
    const loginInfo = {
      timestamp: new Date().toLocaleString("en-US", {
        timeZone:
          request.headers["x-timezone"] || request.headers["timezone"] || "UTC",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      }),
      ipAddress:
        request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        request.headers["x-real-ip"] ||
        request.headers["x-client-ip"] ||
        request.ip ||
        request.connection?.remoteAddress ||
        request.socket?.remoteAddress ||
        "Unknown",
      userAgent: request.headers["user-agent"] || "Unknown Browser",
      browser: request.headers["user-agent"]
        ? request.headers["user-agent"].split(" ")[0]
        : "Unknown",
      location:
        request.headers["x-location"] ||
        request.headers["cf-ipcountry"] ||
        request.headers["accept-language"]?.split(",")[0] ||
        "Unknown",
      timezone:
        request.headers["x-timezone"] || request.headers["timezone"] || "UTC",
      requestId:
        request.headers["x-request-id"] ||
        request.headers["x-request-timestamp"] ||
        Date.now().toString(),
    };

    // Send login activity notification (async)
    try {
      setImmediate(async () => {
        try {
          const result = await loginActivityNotification(adminUser, loginInfo);
          if (result.success) {
            logger.info("Login activity email sent successfully", {
              userId: adminUser.id,
              email: adminUser.email,
              requestId: loginInfo.requestId,
            });
          } else {
            logger.error("Failed to send login activity email", {
              userId: adminUser.id,
              email: adminUser.email,
              error: result.error,
              requestId: loginInfo.requestId,
            });
          }
        } catch (emailError) {
          logger.error("Error sending login activity email", {
            userId: adminUser.id,
            email: adminUser.email,
            error: emailError,
            requestId: loginInfo.requestId,
          });
        }
      });
    } catch (emailError) {
      logger.error("Error preparing login activity email", {
        userId: adminUser.id,
        email: adminUser.email,
        error: emailError,
        requestId: loginInfo.requestId,
      });
    }

    // Log successful login
    logger.info("Admin user login successful", {
      userId: adminUser.id,
      email: adminUser.email,
      loginInfo,
      requestId: loginInfo.requestId,
    });

    // Sin compañía: el login es previo a que el usuario elija con cuál trabajar.
    // Si el cliente ya la manda (x-company-id), se aprovecha; si no, queda null.
    await logStaffActivity({
      staff_member_id: adminUser.id,
      company_id: resolveCompanyContext(request),
      action: "LOGIN",
      target_model: "AdminUser",
      target_id: adminUser.id,
      details: { email: adminUser.email },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.status(200).json({
      ok: true,
      entire: adminUser,
      uid: adminUser.id,
      name: adminUser.name,
      lastName: adminUser.lastName,
      email: adminUser.email,
      phone: adminUser.phone,
      role: adminUser.role,
      token,
      // Solo al entrar con un código de recuperación: el cliente avisa de
      // cuántos quedan y ofrece regenerarlos.
      ...(recoveryCodesRemaining !== undefined
        ? { recoveryCodeUsed: true, recoveryCodesRemaining }
        : {}),
    });
  } catch (error) {
    logger.error("Admin login error", {
      email,
      error: error,
      stack: error.stack,
      requestId: request.headers["x-request-id"],
    });

    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: error.message || error,
    });
  }
};

const logoutUser = async (request, response) => {
  try {
    const redis = await clientRedis();
    // Safely read token from cookies or fall back to header
    const token = request.cookies?.token || request.headers["x-token"];
    const staffID = request.body.uid;
    let decoded = {};
    if (token) {
      // Firma verificada (FedRAMP A2, 2026-10-27): con jwt.decode un token
      // inventado cerraba la sesión de quien dijera. Caducado sí vale: cerrar
      // una sesión vencida no debe fallar.
      try {
        decoded = jwt.verify(token, process.env.SECRET_JWT_SEED, { ignoreExpiration: true });
      } catch (_error) {
        return response.status(401).json({ ok: false, msg: "Token is not valid" });
      }
      const sessionKey = `staff_session:${decoded.id ?? decoded.uid}`;
      // Solo cierra la sesión del token. Si ya la sustituyó otro login
      // (forceLogin en otro navegador), el logout del viejo no debe echar al
      // nuevo. Los tokens anteriores a A6 no traen sid: se borra como antes.
      const current = decoded.sid ? await redis.get(sessionKey) : null;
      if (!decoded.sid || current === decoded.sid) redis.del(sessionKey);
      // Clear cookie if it existed (name is required)
      response.clearCookie("token", {
        httpOnly: true,
        sameSite: "none",
        secure: true,
      });

      return response.status(201).json({
        ok: true,
        msg: "user logged out",
      });
    }
    if (staffID) {
      const sessionKey = `staff_session:${staffID}`;
      redis.del(sessionKey);
      // Clear cookie if it existed (name is required)
      response.clearCookie("token", {
        httpOnly: true,
        sameSite: "none",
        secure: true,
      });

      return response.status(201).json({
        ok: true,
        msg: "user logged out",
      });
    }
    response.status(401).json({
      ok: false,
      msg: "No token/Staff Member UID provided",
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      err: error,
    });
  }
};

const manuallyLogoutUser = async (request, response) => {
  try {
    const redis = await clientRedis();
    logger.info("request", request.body);
    // Safely read token from cookies or fall back to header
    const sessionKey = `staff_session:${request.body.uid}`;
    redis.del(sessionKey);

    // Clear cookie if it existed (name is required)
    response.clearCookie("token", {
      httpOnly: true,
      sameSite: "none",
      secure: true,
    });

    return response.status(201).json({
      ok: true,
      msg: "user logged out",
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      err: error,
    });
  }
};

// Lo que cada usuario puede cambiar de SU PROPIO perfil sin ningún rol.
const PROFILE_SELF_FIELDS = new Set([
  "name",
  "lastName",
  "phone",
  "imageProfile",
  "emailNotifications",
  "online",
  "agreedPlatformConditions",
]);
// Lo que esta ruta no cambia NUNCA, ni siquiera un super_user: identidad
// (email, que es también la clave de Company.employees), credenciales, MFA, la
// versión del token y los flags de plataforma. Antes el body entero iba a
// findByIdAndUpdate y cualquier autenticado podía ponerle super_user a otro.
const PROFILE_PROTECTED_FIELDS = new Set([
  "_id",
  "id",
  "__v",
  "email",
  "password",
  "super_user",
  "platform_observer",
  "tokenVersion",
  "mfaEnabled",
  "mfaSecret",
]);

// PATCH /api/admin/profile/:id
//  - El propio usuario: solo PROFILE_SELF_FIELDS.
//  - Otro usuario (o campos que no son personales): super_user de plataforma, o
//    super_user dentro de la compañía del contexto (x-company-id) y el editado
//    debe pertenecer a esa misma compañía.
// Los campos que no se pueden tocar se descartan y se devuelven en
// `ignored_fields`; si no queda nada que aplicar, 403.
const editAdminUser = async (request, response = response) => {
  const adminUserId = request.params.id;
  try {
    const adminUser = isValidObjectId(adminUserId)
      ? await AdminUser.findById(adminUserId)
      : null;
    if (!adminUser) {
      return response.status(404).json({
        ok: false,
        msg: "Admin user/id do not match",
      });
    }

    const isSelf = String(adminUser.id) === String(request.uid);
    const caller = isSelf
      ? adminUser
      : await AdminUser.findById(request.uid).select("super_user active email");
    if (!caller || caller.active === false) {
      return response.status(403).json({ ok: false, msg: "Forbidden" });
    }

    let canManage = Boolean(caller.super_user);
    if (!canManage) {
      const companyId = resolveCompanyContext(request);
      const callerEmp = await findCompanyMembership(companyId, caller);
      if (callerEmp?.super_user) {
        canManage = isSelf || Boolean(await findCompanyMembership(companyId, adminUser));
      }
    }

    if (!isSelf && !canManage) {
      return response.status(403).json({
        ok: false,
        msg: "Forbidden: editing another user's profile requires super_user in this company.",
      });
    }

    const body = request.body || {};
    const update = {};
    const ignored_fields = [];
    for (const key of Object.keys(body)) {
      const allowed =
        !PROFILE_PROTECTED_FIELDS.has(key) &&
        (canManage || PROFILE_SELF_FIELDS.has(key));
      if (allowed) update[key] = body[key];
      else ignored_fields.push(key);
    }

    if (Object.keys(update).length === 0) {
      return response.status(ignored_fields.length ? 403 : 400).json({
        ok: false,
        msg: ignored_fields.length
          ? "None of the provided fields can be changed by this user."
          : "No fields to update.",
        ignored_fields,
      });
    }

    const adminUserUpdated = await AdminUser.findByIdAndUpdate(
      adminUserId,
      update,
      {
        new: true,
        runValidators: true,
      }
    );

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: resolveCompanyContext(request),
      action: "UPDATE",
      target_model: "AdminUser",
      target_id: adminUserUpdated.id,
      details: { updates: update, self_update: isSelf, ignored_fields },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.json({
      msg: "admin user updated",
      ok: true,
      entire: adminUserUpdated,
      uid: adminUserUpdated.id,
      name: adminUserUpdated.name,
      lastName: adminUserUpdated.lastName,
      email: adminUserUpdated.email,
      phone: adminUserUpdated.phone,
      role: adminUserUpdated.role,
      ignored_fields,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
      err: error,
    });
  }
};

// PATCH /api/staff/edit-admin/:id y /api/admin/admin-user/:id (staff:update, o el
// propio usuario con campos personales: routes/staff.js selfOrStaffUpdate).
// Hasta el 2026-10-19 el body entero iba a findByIdAndUpdate: con staff:update en
// UNA compañía se le podía poner super_user (bypass total de plataforma) a
// cualquier usuario de CUALQUIER compañía. Ahora:
//   - solo STAFF_EDITABLE_FIELDS (lo que manda el dashboard); el resto se
//     descarta y vuelve en `ignored_fields`;
//   - a otro usuario solo si pertenece a la compañía del contexto (x-company-id),
//     salvo super_user de plataforma. Si no, 404.
// El email se sigue aceptando: el dashboard lo edita desde la ficha del staff.
// Pero pasa por checkEmailChange (FedRAMP A3, 2026-10-27).
const STAFF_EDITABLE_FIELDS = new Set([
  ...PROFILE_SELF_FIELDS,
  "email",
  "dailySummaries",
  "subscriptionRenewals",
  "eventReminder",
]);

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Las membresías sin userId (antiguas, e invitaciones pendientes) se casan por
// email (helpers/companyMembership.js). Así que cambiar un email cambiaba de
// quién eran: un admin que se ponía el email de una invitación pendiente de
// otra compañía entraba en ella con ese rol, y el editado perdía las suyas.
// Ahora: el email nuevo no puede ser de otra cuenta ni de ninguna membresía, y
// el de alguien que también está en otras compañías solo lo cambia un
// super_user de plataforma (o él mismo).
const idOf = (doc) => doc._id ?? doc.id;
const membershipsOf = (target) => ({
  $or: [{ "employees.userId": idOf(target) }, { "employees.user": target.email }],
});

async function checkEmailChange({ target, newEmail, isSelf, callerIsPlatform, companyId }) {
  if (newEmail === undefined) return { changed: false };
  const email = typeof newEmail === "string" ? newEmail.trim() : "";
  if (!EMAIL_FORMAT.test(email)) return { status: 400, error: "Invalid email." };
  if (email === target.email) return { changed: false };

  if (!isSelf && !callerIsPlatform) {
    const inOtherCompanies = await Company.exists({
      ...membershipsOf(target),
      ...(isValidObjectId(companyId) ? { _id: { $ne: companyId } } : {}),
    });
    if (inOtherCompanies) {
      return {
        status: 403,
        error: "This user also belongs to other companies; only a platform administrator can change their email.",
      };
    }
  }

  const [accountTaken, membershipTaken] = await Promise.all([
    AdminUser.exists({ email, _id: { $ne: idOf(target) } }),
    Company.exists({ employees: { $elemMatch: { user: email, userId: { $ne: idOf(target) } } } }),
  ]);
  if (accountTaken || membershipTaken) return { status: 409, error: "That email is already in use." };
  return { changed: true, email };
}

// Las membresías del editado siguen siendo suyas: pasan al email nuevo y quedan
// atadas por userId. Antes que el AdminUser: si este falla, el userId ya casa.
const moveMembershipsToEmail = (target, email) =>
  Company.updateMany(
    membershipsOf(target),
    {
      $set: {
        "employees.$[e].user": email,
        "employees.$[e].email": email,
        "employees.$[e].userId": idOf(target),
      },
    },
    { arrayFilters: [{ $or: [{ "e.userId": idOf(target) }, { "e.user": target.email }] }] }
  );

const editOtherAdminUser = async (request, response = response) => {
  const adminUserId = request.params.id;

  try {
    const target = isValidObjectId(adminUserId)
      ? await AdminUser.findById(adminUserId).select("email active")
      : null;
    if (!target) {
      return response.status(404).json({ ok: false, msg: "Admin user/id do not match" });
    }

    const isSelf = String(target.id) === String(request.uid);
    let callerIsPlatform = false;
    if (!isSelf) {
      const caller = await AdminUser.findById(request.uid).select("super_user active email");
      if (!caller || caller.active === false) {
        return response.status(403).json({ ok: false, msg: "Forbidden" });
      }
      callerIsPlatform = Boolean(caller.super_user);
      if (!caller.super_user) {
        const companyId = resolveCompanyContext(request);
        if (!companyId || !(await findCompanyMembership(companyId, target))) {
          return response.status(404).json({ ok: false, msg: "Admin user/id do not match" });
        }
      }
    }

    const adminUserEdited = {};
    const ignored_fields = [];
    for (const [key, value] of Object.entries(request.body ?? {})) {
      if (STAFF_EDITABLE_FIELDS.has(key)) adminUserEdited[key] = value;
      else ignored_fields.push(key);
    }
    if (Object.keys(adminUserEdited).length === 0) {
      return response.status(400).json({ ok: false, msg: "No editable fields in the request.", ignored_fields });
    }

    const emailChange = await checkEmailChange({
      target,
      newEmail: adminUserEdited.email,
      isSelf,
      callerIsPlatform,
      companyId: resolveCompanyContext(request),
    });
    if (emailChange.error) {
      return response.status(emailChange.status).json({ ok: false, msg: emailChange.error });
    }
    if (emailChange.changed) {
      adminUserEdited.email = emailChange.email;
      await moveMembershipsToEmail(target, emailChange.email);
    } else {
      // el formulario manda el email aunque no cambie
      delete adminUserEdited.email;
    }

    const adminUserUpdated = await AdminUser.findByIdAndUpdate(
      adminUserId,
      adminUserEdited,
      {
        new: true,
      }
    );

    // if (request.uid) {
    //   await logStaffActivity({
    //     staff_member_id: request.uid,
    //     company_id: adminUserUpdated.company,
    //     action: "UPDATE",
    //     target_model: "AdminUser",
    //     target_id: adminUserUpdated.id,
    //     details: { updates: request.body, self_update: false },
    //     ip_address: request.ip,
    //     device_info: request.headers["user-agent"],
    //   });
    // }

    return response.json({
      msg: "admin user updated",
      ok: true,
      adminUpdated: adminUserUpdated,
      ...(ignored_fields.length ? { ignored_fields } : {}),
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
      err: error,
    });
  }
};

const deleteAdminUser = async (request, response) => {
  try {
    const adminUserId = await request.params.id;
    const adminUser = await AdminUser.findByIdAndDelete(adminUserId);
    if (!adminUser) {
      return response.status(404).json({
        ok: false,
        msg: "Admin user/id do not match",
      });
    }

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: resolveCompanyContext(request),
      action: "DELETE",
      target_model: "AdminUser",
      target_id: adminUser.id,
      details: { email: adminUser.email },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.status(201).json({
      ok: true,
      adminUser,
      msg: "admin user deleted",
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error,
      err: error,
    });
  }
};

const renewToken = async (request, response = express.response) => {
  const { uid, name, sqlStaffId: existingSqlStaffId } = request;

  // Sin esto, una sesión abierta antes de que MFA fuera obligatoria se
  // renovaría indefinidamente sin enrolarse nunca.
  if (isMfaRequired()) {
    const owner = await AdminUser.findById(uid).select("mfaEnabled").lean();
    if (!owner?.mfaEnabled) {
      return response.status(403).json({
        ok: false,
        msg: "MFA setup required. Log in again to set up an authenticator app.",
        mfaSetupRequired: true,
      });
    }
  }

  let sqlStaffId = existingSqlStaffId ?? null;
  if (!sqlStaffId) {
    try {
      const sqlConn = getConnection();
      const adminUser = await AdminUser.findById(uid).select("email").lean();
      if (adminUser?.email) {
        const [[staffRow]] = await sqlConn.execute(
          "SELECT staff_id FROM staff_member WHERE email = ? LIMIT 1",
          [adminUser.email]
        );
        if (staffRow) sqlStaffId = staffRow.staff_id;
      }
    } catch (sqlErr) {
      logger.warn("staff_member lookup failed during token renewal", { uid, err: sqlErr.message });
    }
  }

  // Conserva la hora del login: renovar no alarga la sesión más allá de 12 h.
  let token;
  try {
    token = await generateJWT(uid, name, request.tokenVersion, sqlStaffId, {
      authTime: request.authTime,
      sid: request.sid,
    });
  } catch {
    return response.status(401).json({ ok: false, msg: "Session expired. Log in again." });
  }

  return response.json({
    ok: true,
    name,
    uid,
    token,
  });
};

// PATCH /api/admin/update-password — sin token a propósito: se llama desde el
// reset de contraseña, sin sesión. Antes bastaba el email para cambiarle la
// contraseña a cualquiera; ahora la prueba de identidad es el código MFA de la
// cuenta (`mfaCode`), verificado aquí y no en el cliente. La cuenta se indica
// con `email` o con `uid` (el del enlace del reset).
//  - `resetToken` (el del enlace del correo, ver helpers/passwordResetToken.js)
//    prueba que quien pide controla el buzón. Si llega, la cuenta sale de él y
//    `uid`/`email` se ignoran; si no vale o caducó, 400.
//  - Cuenta sin MFA configurada: 403 `mfaSetupRequired` (con o sin `mfaCode`).
//    El cliente le pide activar MFA y reenviar la solicitud. Solo con un
//    `resetToken` válido la respuesta trae `mfaSetupToken` para activarla sin
//    sesión: sin él, conocer un email bastaría para registrar una app propia en
//    una cuenta ajena.
//  - Email desconocido y código inválido dan la MISMA respuesta: la ruta no
//    sirve para averiguar qué emails tienen cuenta.
//  - Al cambiarla se sube `tokenVersion` (los tokens emitidos dejan de valer) y
//    se borra la sesión activa, para que el login nuevo no choque con un 409.
//    El `resetToken` también deja de valer: su firma depende del hash anterior.
const updatePassword = async (request, response) => {
  const { email, uid, password, mfaCode, resetToken } = request.body || {};

  try {
    // `uid` es lo que trae el enlace del reset (?uid=...); `email`, el resto.
    // Solo strings: un objeto aquí sería un filtro de Mongo ({ $ne: null }).
    const withLink = resetToken !== undefined;
    const resetUid = withLink ? readPasswordResetUid(resetToken) : null;
    const byUid = typeof uid === "string" && isValidObjectId(uid);
    const byEmail = typeof email === "string" && email.length > 0;
    if ((!withLink && !byUid && !byEmail) || !isAcceptablePassword(password)) {
      return response.status(400).json({
        ok: false,
        msg: `Email (or uid) and a valid password are required. ${passwordPolicyMessage}`,
      });
    }
    const filter = withLink ? { _id: resetUid } : byUid ? { _id: uid } : { email };
    const adminUser = withLink && !isValidObjectId(resetUid)
      ? null
      : await AdminUser.findOne(filter).select("+mfaSecret +password");

    if (withLink && !isValidPasswordResetToken(resetToken, adminUser)) {
      return response.status(400).json({
        ok: false,
        msg: "This reset link is invalid or has expired. Request a new one.",
        resetLinkInvalid: true,
      });
    }
    const secret = adminUser?.mfaEnabled ? adminUser.mfaSecret?.base32 : null;

    // Se comprueba antes de pedir el código: a una cuenta sin MFA no tiene
    // sentido pedirle uno. El cliente debe indicarle que la active y que
    // vuelva a enviar la solicitud.
    if (adminUser && !secret) {
      return response.status(403).json({
        ok: false,
        msg: "MFA is not enabled on this account. Enable MFA and then send this request again.",
        mfaSetupRequired: true,
        ...(withLink && { mfaSetupToken: await generateMfaSetupToken(adminUser.id) }),
      });
    }
    if (!mfaCode) {
      return response.status(403).json({
        ok: false,
        msg: "MFA code required",
        mfaRequired: true,
      });
    }

    const verified =
      Boolean(secret) &&
      speakeasy.totp.verify({ secret, encoding: "base32", token: String(mfaCode) });
    if (!verified) {
      return response.status(400).json({
        ok: false,
        msg: "Invalid email or MFA code",
      });
    }

    const salt = await bcrypt.genSalt();
    const hashed = await bcrypt.hash(password, salt);

    const updateAdminUserPassword = await AdminUser.findByIdAndUpdate(
      adminUser.id,
      { $set: { password: hashed }, $inc: { tokenVersion: 1 } },
      { new: true }
    );

    try {
      const redis = await clientRedis();
      await redis.del(`staff_session:${adminUser.id}`);
      await redis.del(`staff_session:${adminUser.id}:owner`);
    } catch (redisErr) {
      logger.warn("update-password: no se pudo borrar la sesión activa", { err: redisErr.message });
    }
    return response.status(201).json({
      ok: true,
      message: "register",
      uid: updateAdminUserPassword.id,
      name: updateAdminUserPassword.name,
      email: updateAdminUserPassword.email,
      phone: updateAdminUserPassword.phone,
      role: updateAdminUserPassword.role,
      company: updateAdminUserPassword.company,
      // token,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error,
      err: error,
    });
  }
};

const showAllUsers = async (request, response) => {
  const stripeTransactions = await StripeTransaction.find(
    request.body
  ).populate("user");

  try {
    return response.status(201).json({
      ok: true,
      stripeTransactions,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
      err: error,
    });
  }
};

const showStaffs = async (request, response) => {
  const staff = await AdminUser.find(request.body);

  try {
    return response.status(201).json({
      ok: true,
      staff,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

// GET|POST /api/staff/__staff-search — anónima: la usan pantallas sin sesión
// (alta, invitación, olvidé mi contraseña) para saber si un email tiene cuenta.
// Antes era `AdminUser.find(request.body)`: sin body devolvía TODOS los
// usuarios, con el hash de la contraseña. Ahora exige un email exacto (string,
// no un filtro de Mongo) y devuelve solo campos públicos. Misma forma de
// respuesta (`adminUsers: []`) para no cambiar el contrato.
const STAFF_SEARCH_PUBLIC_FIELDS = "name lastName email imageProfile active companiesAssigned";
const searchStaffByEmail = async (request, response) => {
  const raw = request.body?.email ?? request.query?.email;
  const email = typeof raw === "string" ? raw.trim() : "";
  if (!email) {
    return response.status(400).json({
      ok: false,
      msg: "email is required.",
    });
  }
  try {
    const adminUsers = await AdminUser.find({ email }).select(STAFF_SEARCH_PUBLIC_FIELDS);
    return response.status(201).json({ ok: true, adminUsers });
  } catch (error) {
    logger.error("staff search error", { error: error.message });
    return response.status(500).json({ ok: false, msg: "Contact Administrator" });
  }
};

// POST /api/admin/verify-password — con token. Comprueba la contraseña del
// propio usuario en el servidor; antes el dashboard bajaba el hash y comparaba
// en el navegador ("Mi contraseña", verificación de firma de documentos).
const verifyPassword = async (request, response) => {
  const { password } = request.body || {};
  if (typeof password !== "string" || !password) {
    return response.status(400).json({ ok: false, msg: "password is required." });
  }
  try {
    const adminUser = await AdminUser.findById(request.uid).select("+password");
    const valid = Boolean(adminUser?.password) && (await bcrypt.compare(password, adminUser.password));
    return response.status(200).json({ ok: true, valid });
  } catch (error) {
    logger.error("verify-password error", { error: error.message });
    return response.status(500).json({ ok: false, msg: "Contact Administrator" });
  }
};

// Middleware de POST /api/nodemailer/reset-admin-password (sin token). El
// enlace del correo lo arma el SERVIDOR con un token firmado (ver
// helpers/passwordResetToken.js); el `linkToResetPassword` que mande el
// cliente se descarta. Antes la ruta enviaba cualquier enlace a cualquier
// email, y el enlace no probaba nada.
// Email sin cuenta: misma respuesta que con cuenta, pero no se envía nada.
const attachPasswordResetLink = async (request, response, next) => {
  const email = request.body?.contactInfo?.email;
  if (typeof email !== "string" || !email.trim()) {
    return response.status(400).json({ ok: false, msg: "contactInfo.email is required." });
  }
  try {
    const adminUser = await AdminUser.findOne({ email: email.trim() }).select("+password");
    if (!adminUser) {
      return response.status(202).json({ ok: true, notification: "Email queued" });
    }
    const params = new URLSearchParams({
      token: await generatePasswordResetToken(adminUser),
      uid: String(adminUser.id),
      email: adminUser.email,
      "stamp-time": new Date().toISOString(),
    });
    const origin = process.env.FRONTEND_URL || "https://admin.devitrak.net";
    request.body = {
      ...request.body,
      contactInfo: { ...request.body.contactInfo, email: adminUser.email },
      linkToResetPassword: `${origin}/reset-password?${params.toString()}`,
      link: undefined,
    };
    return next();
  } catch (error) {
    logger.error("reset-admin-password: no se pudo armar el enlace", { error: error.message });
    return response.status(500).json({ ok: false, msg: "Contact Administrator" });
  }
};

const displayAllAdminUser = async (request, response) => {
  try {
    const adminUsers = await AdminUser.find(request.body);

    return response.status(201).json({
      ok: true,
      adminUsers,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
      err: error,
    });
  }
};

const articleSetup = async (request, response) => {
  const { img, title, body } = request.body;
  const newArticle = new Article({
    img,
    title,
    body,
  });

  try {
    newArticle.adminUser = request.uid;
    await newArticle.save();

    return response.status(201).json({
      ok: true,
      message: "article created",
      newArticle,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
      err: error,
    });
  }
};

const displayArticles = async (request, response) => {
  try {
    const articles = await Article.find();
    return response.status(201).json({
      ok: true,
      articles,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.response.data,
      err: error,
    });
  }
};

const checkStatus = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const email = request.params.email;
    const cachedStatus = await cache_connection.get(`admin_status=${email}`);
    if (cachedStatus) {
      cache_connection.del(`admin_status=${email}`);
      return response.status(201).json({
        ok: true,
        cached: true,
        online: JSON.parse(cachedStatus),
      });
    }
    const checkOnlineStatus = await AdminUser.findOne({ email: email });
    cache_connection.set(
      `admin_status=${email}`,
      JSON.stringify(checkOnlineStatus.online)
    );
    cache_connection.expire(`admin_status=${email}`, 180);
    return response.status(201).json({
      ok: true,
      cached: false,
      online: checkOnlineStatus.online,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      err: error,
    });
  }
};

const generateMfaSecret = async (req, res) => {
  try {
    const adminUser = await AdminUser.findById(req.uid);
    if (!adminUser)
      return res.status(404).json({ ok: false, msg: "User not found" });

    // Generar sobrescribe el secreto al instante, antes de verificar nada. Con
    // MFA ya activa eso dejaba fuera al usuario si abandonaba a medias, y
    // permitía re-enrolar la MFA ajena con un token robado.
    if (adminUser.mfaEnabled) {
      return res.status(409).json({ ok: false, msg: "MFA is already enabled for this account." });
    }

    const secret = speakeasy.generateSecret({
      name: `Devitrak:${adminUser.email}`,
    });

    adminUser.mfaSecret = secret;
    await adminUser.save();

    QRCode.toDataURL(secret.otpauth_url, (err, data_url) => {
      if (err) throw err;
      res.json({
        ok: true,
        secret: secret.base32,
        qrCode: data_url,
      });
    });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ ok: false, msg: "Error generating MFA secret" });
  }
};

const verifyMfaSetup = async (req, res) => {
  const { token } = req.body;
  try {
    const adminUser = await AdminUser.findById(req.uid).select("+mfaSecret");
    if (!adminUser)
      return res.status(404).json({ ok: false, msg: "User not found" });
    if (!adminUser.mfaSecret?.base32) {
      return res.status(400).json({ ok: false, msg: "Generate an MFA secret first." });
    }

    const verified = speakeasy.totp.verify({
      secret: adminUser.mfaSecret.base32,
      encoding: "base32",
      token: token,
    });

    if (verified) {
      // Los códigos de recuperación nacen con la MFA y solo se muestran ahora.
      // Repetir el verify con la MFA ya activa no los cambia (para eso está
      // /mfa/recovery-codes, que pide un código).
      const enabling = !adminUser.mfaEnabled;
      const recovery = enabling ? generateRecoveryCodes(adminUser.id) : null;
      adminUser.mfaEnabled = true;
      if (recovery) adminUser.mfaRecoveryCodes = recovery.hashes;
      await adminUser.save();
      // No se emite sesión aquí: el token solo sale del login. Quien se enroló
      // con el token de enrolamiento tiene que volver a loguearse con su código.
      res.json({
        ok: true,
        msg: "MFA enabled successfully",
        reloginRequired: Boolean(req.mfaSetup),
        ...(recovery ? { recoveryCodes: recovery.codes } : {}),
      });
    } else {
      res.status(400).json({ ok: false, msg: "Invalid token" });
    }
  } catch (error) {
    logger.error(error);
    res.status(500).json({ ok: false, msg: "Error verifying MFA" });
  }
};

const disableMfa = async (req, res) => {
  if (isMfaRequired()) {
    return res.status(403).json({ ok: false, msg: "MFA is mandatory and cannot be disabled." });
  }
  try {
    const adminUser = await AdminUser.findById(req.uid);
    adminUser.mfaEnabled = false;
    adminUser.mfaSecret = undefined;
    adminUser.mfaRecoveryCodes = undefined;
    await adminUser.save();
    res.json({ ok: true, msg: "MFA disabled successfully" });
  } catch (error) {
    res.status(500).json({ ok: false, msg: "Error disabling MFA" });
  }
};

// Gasta un código de recuperación. El $pull condicionado es atómico: dos
// logins con el mismo código no pueden usarlo los dos. Devuelve cuántos
// quedan, o null si el código no es válido.
async function consumeRecoveryCode(uid, code) {
  if (!looksLikeRecoveryCode(code)) return null;
  const hash = hashRecoveryCode(uid, code);
  const updated = await AdminUser.findOneAndUpdate(
    { _id: uid, mfaRecoveryCodes: hash },
    { $pull: { mfaRecoveryCodes: hash } },
    { new: true, projection: { mfaRecoveryCodes: 1 } }
  );
  return updated ? (updated.mfaRecoveryCodes ?? []).length : null;
}

// POST /api/admin/mfa/recovery-codes: códigos nuevos (los anteriores dejan de
// valer). Pide un código TOTP vigente además de la sesión: una sesión robada
// sola no basta para hacerse con un acceso permanente a la cuenta.
const regenerateRecoveryCodes = async (req, res) => {
  const { mfaCode } = req.body || {};
  try {
    const adminUser = await AdminUser.findById(req.uid).select("+mfaSecret");
    if (!adminUser) return res.status(404).json({ ok: false, msg: "User not found" });
    if (!adminUser.mfaEnabled || !adminUser.mfaSecret?.base32) {
      return res.status(400).json({ ok: false, msg: "MFA is not enabled for this account." });
    }
    const verified =
      Boolean(mfaCode) &&
      speakeasy.totp.verify({
        secret: adminUser.mfaSecret.base32,
        encoding: "base32",
        token: mfaCode,
      });
    if (!verified) return res.status(400).json({ ok: false, msg: "Invalid MFA code" });

    const { codes, hashes } = generateRecoveryCodes(adminUser.id);
    await AdminUser.updateOne({ _id: adminUser.id }, { $set: { mfaRecoveryCodes: hashes } });
    await logStaffActivity({
      staff_member_id: req.uid,
      action: "MFA_RECOVERY_CODES_REGENERATED",
      target_model: "AdminUser",
      target_id: adminUser.id,
      ip_address: req.ip,
      device_info: req.headers?.["user-agent"],
    });
    return res.json({ ok: true, recoveryCodes: codes });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ ok: false, msg: "Error generating recovery codes" });
  }
};

// POST /api/admin/mfa/reset/:id: para quien perdió el dispositivo Y los
// códigos. Borra su MFA, cierra sus sesiones y le obliga a enrolarse otra vez
// en el próximo login (con contraseña, como una cuenta nueva).
//  - Nunca sobre uno mismo: con una sesión robada se podría quitar la MFA.
//  - super_user de plataforma: a cualquiera.
//  - Si no: super_user o staff:update en la compañía del contexto, el otro
//    miembro de ella, y que no esté en otras compañías (mismo criterio que el
//    cambio de email: un admin de una compañía no decide por las demás).
const resetUserMfa = async (request, response) => {
  const targetId = request.params.id;
  try {
    const target = isValidObjectId(targetId)
      ? await AdminUser.findById(targetId).select("email active mfaEnabled")
      : null;
    if (!target) return response.status(404).json({ ok: false, msg: "User not found." });
    if (String(target.id) === String(request.uid)) {
      return response.status(403).json({
        ok: false,
        msg: "You cannot reset your own MFA. Use a recovery code or ask an administrator.",
      });
    }

    const caller = await AdminUser.findById(request.uid).select("super_user active email");
    if (!caller || caller.active === false) {
      return response.status(403).json({ ok: false, msg: "Forbidden" });
    }
    const companyId = resolveCompanyContext(request);
    if (!caller.super_user) {
      const callerEmp = await findCompanyMembership(companyId, caller);
      const callerCan =
        callerEmp && (callerEmp.super_user || hasPermission(callerEmp.roleType, "staff", "update"));
      if (!callerCan) {
        return response.status(403).json({
          ok: false,
          msg: "Forbidden: resetting MFA requires staff management rights in this company.",
        });
      }
      if (!(await findCompanyMembership(companyId, target))) {
        return response.status(404).json({ ok: false, msg: "User not found." });
      }
      const inOtherCompanies = await Company.exists({
        ...membershipsOf(target),
        ...(isValidObjectId(companyId) ? { _id: { $ne: companyId } } : {}),
      });
      if (inOtherCompanies) {
        return response.status(403).json({
          ok: false,
          msg: "This user also belongs to other companies; only a platform administrator can reset their MFA.",
        });
      }
    }

    await AdminUser.updateOne(
      { _id: target.id },
      {
        $set: { mfaEnabled: false },
        $unset: { mfaSecret: "", mfaRecoveryCodes: "" },
        $inc: { tokenVersion: 1 },
      }
    );
    try {
      const redis = await clientRedis();
      await redis.del(`staff_session:${target.id}`);
      await redis.del(`staff_session:${target.id}:owner`);
    } catch (redisErr) {
      // tokenVersion ya invalida sus tokens; la clave de Redis solo bloquearía
      // el próximo login hasta caducar.
      logger.warn("MFA reset: could not clear the Redis session", { err: redisErr.message });
    }

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: companyId,
      action: "MFA_RESET",
      target_model: "AdminUser",
      target_id: target.id,
      details: { email: target.email, platform: Boolean(caller.super_user) },
      ip_address: request.ip,
      device_info: request.headers?.["user-agent"],
    });

    return response.json({
      ok: true,
      msg: "MFA reset. The user will set it up again on their next sign-in.",
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({ ok: false, msg: "Error resetting MFA" });
  }
};

// POST /api/staff/force-logout. Dos formas de llamarla:
//  - Sin token (pantalla de login, el usuario bloqueado por una sesión abierta
//    en otro sitio): borra la sesión activa del `email`, sin pedir nada más.
//    Es seguro porque borrar la sesión no da acceso: volver a entrar exige el
//    login completo (contraseña + MFA obligatoria). Lo que queda es que alguien
//    con el email puede cerrarle la sesión a otro (molestia, no acceso);
//    decisión del 2026-10-12.
//  - Con token:
//    - Cerrar la propia sesión: siempre.
//    - Cerrar la de otro: super_user de plataforma, o en la compañía del
//      contexto (x-company-id) ser super_user o tener staff:update, y que el
//      otro sea miembro de esa misma compañía.
const forceEndSession = async (request, response) => {
  const { email } = request.body || {};
  try {
    if (!email) {
      return response
        .status(400)
        .json({ ok: false, msg: "Email is required." });
    }

    const adminUser = await AdminUser.findOne({ email });
    if (!adminUser) {
      return response.status(404).json({ ok: false, msg: "User not found." });
    }

    // Sin token se trata como la propia sesión (el log la atribuye al dueño).
    const anonymous = !request.uid;
    if (anonymous) request.uid = adminUser.id;

    const isSelf = String(adminUser.id) === String(request.uid);
    if (!isSelf) {
      const caller = await AdminUser.findById(request.uid).select("super_user active email");
      if (!caller || caller.active === false) {
        return response.status(403).json({ ok: false, msg: "Forbidden" });
      }
      if (!caller.super_user) {
        const companyId = resolveCompanyContext(request);
        const callerEmp = await findCompanyMembership(companyId, caller);
        const callerCan =
          callerEmp &&
          (callerEmp.super_user || hasPermission(callerEmp.roleType, "staff", "update"));
        if (!callerCan || !(await findCompanyMembership(companyId, adminUser))) {
          return response.status(403).json({
            ok: false,
            msg: "Forbidden: ending another user's session requires staff management rights in a company they belong to.",
          });
        }
      }
    }

    const redis = await clientRedis();
    const sessionKey = `staff_session:${adminUser.id}`;
    const ownerKey = `${sessionKey}:owner`;

    await redis.del(sessionKey);
    await redis.del(ownerKey);

    // `target_model` es obligatorio en StaffActivityLog y faltaba acá: los 6
    // jobs FORCE_LOGOUT que había en dead-letter fallaban todos por eso.
    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: resolveCompanyContext(request),
      action: "FORCE_LOGOUT",
      target_model: "AdminUser",
      target_id: adminUser.id,
      details: {
        reason: anonymous
          ? "Session terminated from the login screen (no token)."
          : isSelf
          ? "User-initiated remote session termination."
          : "Session terminated by another staff member.",
        self: isSelf,
        anonymous,
      },
      ip_address: request.ip,
    });

    // La cookie es la de quien llama: borrarla solo si cerró su propia sesión.
    // Un admin que echa a otro no debe perder la suya.
    if (isSelf) {
      response.cookie("token", "", {
        httpOnly: true,
        expires: new Date(0),
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
      });
    }

    return response.status(200).json({
      ok: true,
      message: isSelf
        ? "Active session has been terminated. You can now start a new session."
        : "The user's active session has been terminated.",
    });
  } catch (error) {
    logger.error("Force session end error", { email, error: error.message });
    return response.status(500).json({ ok: false, msg: "Internal server error." });
  }
};

const invalidateAllSessions = async (req, res) => {
  try {
    // Antes se volcaba la petición entera a la consola: las cabeceras, con el token, acababan en los logs.
    logger.warn("invalidate-all-sessions: sesiones de todo el staff invalidadas", { by: req.uid });
    await AdminUser.updateMany({}, { $inc: { tokenVersion: 1 } });
    res.status(200).json({ ok: true, msg: "All user sessions have been invalidated." });
  } catch (error) {
    logger.error("Error invalidating all sessions:", { error: error.message });
    res.status(500).json({ ok: false, msg: "An internal error occurred." });
  }
};

module.exports = {
  renewToken,
  loginUser,
  createAdminUser,
  editAdminUser,
  editOtherAdminUser,
  deleteAdminUser,
  updatePassword,
  showAllUsers,
  showStaffs,
  displayAllAdminUser,
  articleSetup,
  displayArticles,
  checkStatus,
  logoutUser,
  manuallyLogoutUser,
  generateMfaSecret,
  verifyMfaSetup,
  disableMfa,
  regenerateRecoveryCodes,
  resetUserMfa,
  forceEndSession,
  invalidateAllSessions,
  PROFILE_SELF_FIELDS,
  searchStaffByEmail,
  verifyPassword,
  attachPasswordResetLink,
};
