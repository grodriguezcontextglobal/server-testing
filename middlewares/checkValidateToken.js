const jwt = require("jsonwebtoken");
const AdminUser = require("../models/AdminUser");
const { clientRedis } = require("../database/cacheMemoryConfig");
const { checkStaffSession } = require("../helpers/staffSession");

const checkTokenVersion = async (request, response, next) => {
  const token = request.header("x-token");
  if (!token) {
    return response.status(401).json({ message: "No token provided" });
  }
  // Va detrás de validateJWT, que ya verificó la firma.
  const decoded = jwt.decode(token);
  if (!decoded?.uid) {
    return response.status(401).json({ message: "Token is invalid or session has been terminated" });
  }

  const user = await AdminUser.findById(decoded.uid);

  if (!user || user.tokenVersion !== decoded.tokenVersion) {
    return response
      .status(401)
      .json({ message: "Token is invalid or session has been terminated" });
  }

  // Logout, force-logout e inactividad en el servidor (helpers/staffSession.js).
  const ended = await checkStaffSession(clientRedis, { uid: decoded.uid, sid: decoded.sid });
  if (ended) {
    return response.status(401).json({ ...ended, message: ended.msg });
  }

  next();
};
module.exports = {
  checkTokenVersion,
};
