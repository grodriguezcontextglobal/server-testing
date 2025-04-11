/**
 * Auth Route
 * host + /api/post
 */

const { Router } = require("express");
const {
  createPost,
  postList,
  deletePost,
  updatePost,
} = require("../controller/post");
const router = Router();

//create new report
router.post("/new-post", createPost);

//list cash report
router.get("/posts", postList);

//list cash report with params
router.post("/posts", postList);

//remove cash report
router.delete("/post-delete/:id", deletePost);

//update cash report
router.patch("/post-update/:id", updatePost);

module.exports = router;
