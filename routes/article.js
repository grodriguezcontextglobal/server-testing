/**
 * Auth Route
 * host + /api/article
 */

const { Router } = require("express");

const { articleSetup, displayArticles, deleteArticle, editArticle } = require("../controller/article");

const router = Router();

const { validateJWT } = require("../middlewares/validate-jwt");

//create article
router.post("/article-creation", validateJWT, articleSetup);

//display all articles
router.get("/articles", displayArticles);

//delete article
router.delete("/article-delete/:id", deleteArticle)

//edit article
router.patch("/article-edit/:id", editArticle)

module.exports = router;
