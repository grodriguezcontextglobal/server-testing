/**
 * Auth Route
 * host + /api/db_member
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
const router = Router();

//check member info
router.post("/consulting-member", retrieveMemberInfo);

//insert new member
router.post("/new-member", insertNewMember);

//insert bulk members
router.post("/bulk-members", insertBulkMembers);

//update member info
router.post("/update-member-info", updateMemberInfo);

//delete member info
router.post("/delete-member-info", deleteMember);

//insert new row in member_assigned_device_lease table for lease tracking
router.post(
  "/new-member-assigned-device-lease",
  insertNewRowINMemberAssignedDeviceTableForLeaseTracking
);

//update member_assigned_device_lease table for lease tracking
router.post(
  "/update-member-assigned-device-lease",
  updateMemberAssignedDeviceLeaseRow
);

//delete row in member_assigned_device_lease table for lease tracking
router.post(
  "/delete-member-assigned-device-lease",
  deleteMemberAssignedDeviceLeaseRows
);

//retrieve members assigned devices
router.post(
  "/retrieve-members-assigned-devices",
  retrieveMembersAssignedDevices
);

//remove row in member_assigned_device_lease table for lease tracking
router.post("/remove-row-lease-member", removeRowAssignedDeviceLeaseMember);

module.exports = router;
