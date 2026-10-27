const jwt = require("jsonwebtoken");

// Duración máxima de una sesión de staff, desde el login (FedRAMP AC-12).
// Desde 2026-10-21 no hay opción de 30 días ("remember me").
const SESSION_MAX_SECONDS = 12 * 60 * 60;

/**
 * Firma un token de sesión.
 *
 * `authTime` (segundos epoch) es el momento del login. Un token renovado
 * conserva el del original y caduca a la misma hora: renovar no alarga la
 * sesión más allá de SESSION_MAX_SECONDS desde que se inició.
 *
 * `sid` ata el token a la sesión abierta en Redis: cerrarla lo anula aunque
 * no haya caducado.
 */
const generateJWT = (uid, name, tokenVersion, sqlStaffId = undefined, { authTime, sid } = {}) => {
  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);
    const start = Number.isFinite(authTime) && authTime <= now ? authTime : now;
    const remaining = start + SESSION_MAX_SECONDS - now;
    if (remaining <= 0) return reject("Session expired");

    const payload = { uid, name, tokenVersion, authTime: start };
    if (sqlStaffId !== undefined) payload.sqlStaffId = sqlStaffId ?? null;
    // Id de la sesión en el servidor (helpers/staffSession.js). Un token
    // renovado conserva el del login.
    if (sid) payload.sid = sid;
    jwt.sign(
      payload,
      process.env.SECRET_JWT_SEED,
      {
        expiresIn: remaining,
      },
      (error, token) => {
        if (error) {
          console.log(error);
          return reject("Could not generate token");
        }
        resolve(token);
      }
    );
  });
};

module.exports = {
  generateJWT,
  SESSION_MAX_SECONDS,
};
