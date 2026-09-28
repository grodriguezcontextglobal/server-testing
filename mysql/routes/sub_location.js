const { Router } = require("express");
const { check } = require("express-validator");
const validateFields = require("../../middlewares/validate-field");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");
const {
  createSubLocation,
  getSubLocationsHierarchy,
  updateSubLocation,
  checkSubLocation,
  deleteSubLocation,
} = require("../controllers/sub_location");

const router = Router();

router.post(
  "/sub-locations",
  [
    check("location_id", "Location ID is required").not().isEmpty(),
    check("name", "Name is required").not().isEmpty(),
    validateFields,
  ],
  createSubLocation
);

router.get("/locations/:location_id/sub-locations", getSubLocationsHierarchy);

// Escritura sobre la estructura de locaciones: exige token y permiso de
// inventario. Antes era anónima, y el handler localiza la sub-locación por su
// id sin mirar de qué compañía es — el scope de compañía se comprueba ahora
// dentro del controlador.
router.put(
  "/sub-locations/:id",
  validateJWT,
  checkTokenVersion,
  authorizePermission("inventory", "update"),
  updateSubLocation
);

router.post("/sub-locations/check", checkSubLocation);

// Borrado de estructura: token, permiso de borrado de inventario, y el scope de
// compañía se comprueba en el controlador. El CASCADE de `sub_locations` se
// lleva la rama de hijos, así que esto no se deshace.
router.delete(
  "/sub-locations/:id",
  validateJWT,
  checkTokenVersion,
  authorizePermission("inventory", "delete"),
  deleteSubLocation
);

module.exports = router;
