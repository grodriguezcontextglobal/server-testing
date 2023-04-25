/**
 * Auth Route
 * host + /api/article
 */

const { Router } = require("express");
const { articleSetup, displayArticles } = require("../controller/article");
const router = Router();
const apicache = require('apicache')
const { validateJWT } = require("../middlewares/validate-jwt");
const cache = apicache.middleware
//create article
router.post("/article-creation", validateJWT, articleSetup);

//display all articles
router.get("/articles",cache("2 minutes"), displayArticles);

module.exports = router;
