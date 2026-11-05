/**
 * Auth Route
 * host + /api/article
 */

const { Router } = require("express");

const { articleSetup, displayArticles, deleteArticle, editArticle } = require("../controller/article");

const router = Router();

const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");

//create article
router.post("/article-creation", validateJWT, checkTokenVersion, articleSetup);

//display all articles
router.get("/articles", validateJWT, checkTokenVersion, displayArticles);

//delete article
router.delete("/article-delete/:id", validateJWT, checkTokenVersion, deleteArticle)

//edit article
router.patch("/article-edit/:id", validateJWT, checkTokenVersion, editArticle)

module.exports = router;
