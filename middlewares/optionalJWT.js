const jwt = require("jsonwebtoken");

const optionalJWT = (req, _res, next) => {
  const token = req.header("x-token");

  req.authContext = {
    isAuthenticated: false,
    lane: "public",
  };

  if (!token) {
    return next();
  }

  try {
    const { uid, name, tokenVersion } = jwt.verify(token, process.env.SECRET_JWT_SEED);
    req.uid = uid;
    req.name = name;
    req.tokenVersion = tokenVersion;
    req.authContext = {
      isAuthenticated: true,
      lane: "authenticated",
      uid,
      name,
      tokenVersion,
    };
    return next();
  } catch (error) {
    // Backward-compatible: if an invalid token is supplied on a public route,
    // continue as public traffic instead of hard-failing the request.
    req.authContext = {
      isAuthenticated: false,
      lane: "public",
      tokenError: "invalid",
    };
    return next();
  }
};

module.exports = {
  optionalJWT,
};
