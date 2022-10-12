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
    const { uid, name } = jwt.verify(token, process.env.SECRET_JWT_SEED);

    request.uid = uid;
    request.name = name;
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
