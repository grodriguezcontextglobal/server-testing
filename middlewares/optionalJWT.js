let jwt = null;
try {
  jwt = require("jsonwebtoken");
} catch (_err) {}
const { paymentsPolicy } = require("../config/paymentsPolicy");

let logger = { info: () => {}, warn: () => {} };
try {
  // Optional in test-only environments without installed deps.
  logger = require("../helpers/logger");
} catch (_err) {}


const optionalJWT = (req, _res, next) => {
  const token = req.header("x-token");

  req.authContext = {
    isAuthenticated: false,
    lane: "public",
  };

  if (!token) {
    return next();
  }

  if (!jwt) {
    req.authContext = {
      isAuthenticated: false,
      lane: "public",
      tokenError: "jwt_module_unavailable",
    };
    return next();
  }

  try {
    const { uid, name, tokenVersion } = jwt.verify(token, process.env.SECRET_JWT_SEED);
    req.uid = uid;
    req.name = name;
    req.tokenVersion = tokenVersion;
    req.authContext = {
      isAuthenticated: paymentsPolicy.dualLaneEnabled,
      lane: paymentsPolicy.dualLaneEnabled ? "authenticated" : "public",
      uid,
      name,
      tokenVersion,
    };

    if (paymentsPolicy.monitorMode) {
      logger.info("payments_optional_jwt_detected", {
        type: "payments_optional_jwt_detected",
        route: req.originalUrl,
        lane: req.authContext.lane,
      });
    }

    return next();
  } catch (error) {
    req.authContext = {
      isAuthenticated: false,
      lane: "public",
      tokenError: "invalid",
    };

    if (paymentsPolicy.monitorMode) {
      logger.warn("payments_optional_jwt_invalid", {
        type: "payments_optional_jwt_invalid",
        route: req.originalUrl,
      });
    }

    return next();
  }
};

module.exports = {
  optionalJWT,
};
