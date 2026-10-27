/**
 * Auth Route
 * host + /api/lease
 */

const { Router } = require("express");
const { createLease, editLease, deleteLease, leaseList } = require("../controller/lease");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const router = Router();


// create an event
router.post("/create-lease", validateJWT, checkTokenVersion, createLease);

//edit/update a specific value of an event
router.patch("/edit-lease/:id", validateJWT, checkTokenVersion, editLease)

//edit staff event
router.delete("/delete-lease/:id", validateJWT, checkTokenVersion, deleteLease)

//display event list
router.get(
  "/lease-list", validateJWT, checkTokenVersion,
  leaseList
);

//display event by parameters
router.post(
    "/lease-list", validateJWT, checkTokenVersion,
    leaseList
  );
  
module.exports = router;