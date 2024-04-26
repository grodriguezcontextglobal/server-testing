/**
 * Auth Route
 * host + /api/lease
 */

const { Router } = require("express");
const { createLease, editLease, deleteLease, leaseList } = require("../controller/lease");
const router = Router();


// create an event
router.post("/create-lease", createLease);

//edit/update a specific value of an event
router.patch("/edit-lease/:id", editLease)

//edit staff event
router.delete("/delete-lease/:id", deleteLease)

//display event list
router.get(
  "/lease-list",
  leaseList
);

//display event by parameters
router.post(
    "/lease-list",
    leaseList
  );
  
module.exports = router;