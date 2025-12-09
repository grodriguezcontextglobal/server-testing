/**
 * Auth Route
 * host + /api/db_member
 */

const { Router } = require("express");
const { insertNewMember, updateMemberInfo, deleteMember, retrieveMemberInfo, insertBulkMembers } = require("../controllers/members");
const router = Router();

//check member info
router.post("/consulting-member", retrieveMemberInfo)

//insert new member
router.post('/new-member', insertNewMember)

//insert bulk members
router.post('/bulk-members', insertBulkMembers)

//update member info
router.post('/update-member-info', updateMemberInfo)

//delete member info
router.post('/delete-member-info', deleteMember)

module.exports = router;