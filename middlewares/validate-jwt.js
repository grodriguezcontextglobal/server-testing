const { response } = require("express");
const jwt = require("jsonwebtoken");

const validateJWT = (request, response = response, next) => {
  //x-token headers
  const token = request.header("x-token");

  if (!token) {
    return response.status(401).json({
      ok: false,
      msg: "There is not token",
    });
  }

  try {
    const { uid, name, tokenVersion, sqlStaffId, authTime, iat, sid } = jwt.verify(
      token,
      process.env.SECRET_JWT_SEED
    );

    request.uid = uid;
    request.name = name;
    request.tokenVersion = tokenVersion;
    // Solo del token firmado. Hasta 2026-10-21 un token sin sqlStaffId lo
    // tomaba de la cabecera `s-token-lq`, que pone el cliente: la identidad de
    // la que cuelgan los chequeos de compañía (mysql/helpers/companyContext.js)
    // quedaba auto-declarada. Esa cabecera ya no se lee.
    request.sqlStaffId = sqlStaffId ?? null;
    // Hora del login (helpers/jwt.js). Los tokens anteriores no la llevan: su
    // emisión es la mejor aproximación.
    request.authTime = authTime ?? iat;
    // Sesión del servidor (helpers/staffSession.js); la comprueba checkTokenVersion.
    request.sid = sid;

  } catch (error) {
    return response.status(401).json({
      ok: false,
      msg: "Token is not valid",
    });
  }

  next();
};

module.exports = {
  validateJWT,
};