/**
 * Auth Route
 * host + /api/db_member
 *
 * Members are the "school track" (students/staff receiving devices) and
 * include data on minors and their guardians — every route requires an
 * authenticated staff session plus the matching member:* permission for the
 * company_id in the request body.
 */

const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const {
  insertNewMember,
  updateMemberInfo,
  deleteMember,
  retrieveMemberInfo,
  insertBulkMembers,
  insertNewRowINMemberAssignedDeviceTableForLeaseTracking,
  updateMemberAssignedDeviceLeaseRow,
  settleMemberFee,
  retrieveMemberFees,
  deleteMemberAssignedDeviceLeaseRows,
  retrieveMembersAssignedDevices,
  removeRowAssignedDeviceLeaseMember,
  retrieveOverdueLeases,
  bulkReturnMemberLeases,
  retrieveMyDevices,
} = require("../controllers/members");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");

const router = Router();

const canRead = [validateJWT, checkTokenVersion, authorizePermission("member", "read")];
const canCreate = [validateJWT, checkTokenVersion, authorizePermission("member", "create")];
const canUpdate = [validateJWT, checkTokenVersion, authorizePermission("member", "update")];
const canDelete = [validateJWT, checkTokenVersion, authorizePermission("member", "delete")];

//check member info
router.post("/consulting-member", canRead, retrieveMemberInfo);

//insert new member
router.post("/new-member", canCreate, insertNewMember);

//insert bulk members
router.post("/bulk-members", canCreate, insertBulkMembers);

//update member info
router.patch("/update-member-info", canUpdate, updateMemberInfo);

//delete member info
router.post("/delete-member-info", canDelete, deleteMember);

//insert new row in member_assigned_device_lease table for lease tracking
router.post(
  "/new-member-assigned-device-lease",
  canCreate,
  insertNewRowINMemberAssignedDeviceTableForLeaseTracking
);

//update member_assigned_device_lease table for lease tracking
router.post(
  "/update-member-assigned-device-lease",
  canUpdate,
  updateMemberAssignedDeviceLeaseRow
);

//fees for lost/damaged devices — one student, or the whole company
router.post("/member-fees", canRead, retrieveMemberFees);

//settle a fee for a lost/damaged device once the card has been charged
router.post("/settle-member-fee", canUpdate, settleMemberFee);

//delete row in member_assigned_device_lease table for lease tracking
router.post(
  "/delete-member-assigned-device-lease",
  canDelete,
  deleteMemberAssignedDeviceLeaseRows
);

//retrieve members assigned devices
router.post(
  "/retrieve-members-assigned-devices",
  canRead,
  retrieveMembersAssignedDevices
);

//remove row in member_assigned_device_lease table for lease tracking
router.post("/remove-row-lease-member", canDelete, removeRowAssignedDeviceLeaseMember);

//outstanding leases past their expected return date (overdue dashboard)
router.post("/overdue-leases", canRead, retrieveOverdueLeases);

//end-of-term bulk return (all outstanding / by grade / by member_ids)
router.post("/bulk-return", canUpdate, bulkReturnMemberLeases);

// PUBLIC family portal lookup — intentionally unauthenticated; verified by
// student ID + the responsible party's email (guardian for minors). Its own,
// tight limit: the two values are a guessable credential, so attempts are
// what has to be scarce (per process, like every in-memory limiter here).
const myDevicesRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, msg: "Too many attempts. Please try again later." },
});
router.post("/my-devices", myDevicesRateLimit, retrieveMyDevices);

module.exports = router;
