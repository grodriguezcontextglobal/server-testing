const jwt = require("jsonwebtoken");

const generateJWT = (uid, name, tokenVersion, rememberMe = false, sqlStaffId = undefined) => {
  return new Promise((resolve, reject) => {
    const payload = { uid, name, tokenVersion };
    if (sqlStaffId !== undefined) payload.sqlStaffId = sqlStaffId ?? null;
    jwt.sign(
      payload,
      process.env.SECRET_JWT_SEED,
      {
        expiresIn: rememberMe ? "30d" : "12h",
      },
      (error, token) => {
        if (error) {
          console.log(error);
          reject("Could not generate token");
        }
        resolve(token);
      }
    );
  });
};

module.exports = {
  generateJWT,
};
