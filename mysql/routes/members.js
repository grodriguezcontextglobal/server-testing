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
const {
  insertNewMember,
  updateMemberInfo,
  deleteMember,
  retrieveMemberInfo,
  insertBulkMembers,
  insertNewRowINMemberAssignedDeviceTableForLeaseTracking,
  updateMemberAssignedDeviceLeaseRow,
  deleteMemberAssignedDeviceLeaseRows,
  retrieveMembersAssignedDevices,
  removeRowAssignedDeviceLeaseMember,
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

module.exports = router;
