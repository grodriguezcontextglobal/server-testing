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
    // TRANSITIONAL, SAFE TO DELETE AFTER 2026-08-20.
    //
    // Tokens have carried sqlStaffId since 60ce586 (2026-06-29, in prod by
    // 2026-07-21 at the latest). Only tokens issued BEFORE that lack it and
    // reach this fallback, and the longest-lived ones (remember-me) expire 30
    // days after issue — so no such token can still be valid past the date
    // above.
    //
    // Why it matters that this goes: the value comes from a client-supplied
    // header, while `sqlStaffId` is now the identity that company/RBAC checks
    // hang on (see mysql/helpers/companyContext.js). Until this branch is
    // removed, any future token that omits sqlStaffId silently makes that
    // identity self-declared again.
    //
    // Decision 2026-08-10: let the legacy tokens expire rather than breaking
    // them early. Remove the two lines below once the date has passed.
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