const { validateJWT } = require("./validate-jwt");
const { checkTokenVersion } = require("./checkValidateToken");

// Token opcional, pero no ignorable: sin x-token la petición sigue como
// anónima; con x-token se valida entero (firma + tokenVersion) y uno inválido
// es 401, no "sin token". Para rutas que el dashboard llama antes y después del
// login, donde el controlador responde menos a quien no trae sesión.
const tokenIfPresent = (req, res, next) =>
  req.header("x-token")
    ? validateJWT(req, res, () => checkTokenVersion(req, res, next))
    : next();

module.exports = { tokenIfPresent };
