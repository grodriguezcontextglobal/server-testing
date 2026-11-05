/**
 * Auth Route
 * host + /api/post
 */

const { Router } = require("express");
const { consumerTokenGate } = require("../middlewares/consumerTokenGate");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const {
  createPost,
  postList,
  deletePost,
  updatePost,
} = require("../controller/post");
const router = Router();

//create new report
router.post("/new-post", validateJWT, checkTokenVersion, createPost);

//list cash report
router.get("/posts", validateJWT, checkTokenVersion, postList);

//list cash report with params
router.post(
  "/posts",
  consumerTokenGate({
    bootstrap: true,
    subject: (req) => ({ eventId: req.body?.displayed_in, companyId: req.body?.company_id }),
  }),
  postList
);

//remove cash report
router.delete("/post-delete/:id", validateJWT, checkTokenVersion, deletePost);

//update cash report
router.patch("/post-update/:id", validateJWT, checkTokenVersion, updatePost);

module.exports = router;
