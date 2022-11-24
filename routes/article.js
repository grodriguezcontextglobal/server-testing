/**
 * Auth Route
 * host + /api/article
 */

const { Router } = require("express");
const { articleSetup, displayArticles } = require("../controller/article");
const router = Router();
const { validateJWT } = require("../middlewares/validate-jwt");

//create article
router.post("/article-creation", validateJWT, articleSetup);

//display all articles
router.get("/articles", validateJWT, displayArticles);

module.exports = router;
