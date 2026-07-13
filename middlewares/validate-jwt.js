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
    const { uid, name, tokenVersion, sqlStaffId } = jwt.verify(token, process.env.SECRET_JWT_SEED);

    request.uid = uid;
    request.name = name;
    request.tokenVersion = tokenVersion;
    const headerStaffId = request.header("s-token-lq");
    request.sqlStaffId = sqlStaffId ?? (headerStaffId ? Number(headerStaffId) : null);

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