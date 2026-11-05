const jwt = require("jsonwebtoken");
const AdminUser = require("../models/AdminUser");

// Sesión si la hay, anónimo si no: deja request.uid solo con un token firmado
// y vigente (tokenVersion al día). Uno caducado, revocado o inválido NO es 401,
// es una petición anónima. Para rutas que el login llama con lo que quede en
// localStorage de una sesión anterior, donde un 401 rompería el login; el
// controlador decide cuánto responde a quien llega sin request.uid.
const sessionIfValid = async (req, _res, next) => {
  const token = req.header("x-token");
  if (!token) return next();
  try {
    const { uid, tokenVersion } = jwt.verify(token, process.env.SECRET_JWT_SEED);
    const user = await AdminUser.findById(uid).select("tokenVersion");
    if (user && user.tokenVersion === tokenVersion) {
      req.uid = uid;
      req.tokenVersion = tokenVersion;
    }
  } catch (_error) {
    // anónima
  }
  return next();
};

module.exports = { sessionIfValid };
