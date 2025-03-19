const jwt = require("jsonwebtoken");
const AdminUser = require("../models/AdminUser");

const checkTokenVersion = async (request, response, next) => {
  const token = request.header("x-token");
  if (!token) {
    return response.status(401).json({ message: "No token provided" });
  }
  const decoded = jwt.decode(token); // Decode without verifying

  const user = await AdminUser.findById(decoded.uid);

  if (!user || user.tokenVersion !== decoded.tokenVersion) {
    return response
      .status(401)
      .json({ message: "Token is invalid or session has been terminated" });
  }

  next();
};
module.exports = {
  checkTokenVersion,
};
