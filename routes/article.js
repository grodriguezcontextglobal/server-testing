/**
 * Auth Route
 * host + /api/article
 */

 const { Router } = require("express");
 const router = Router();
 
 const {

   articleSetup,
   displayArticles,
 } = require("../controller/admin");
 const validateFields = require("../middlewares/validate-field");
 const { validateJWT } = require("../middlewares/validate-jwt");

 
 //create article
 router.post("/article-creation", validateJWT, articleSetup);
 
 //display all articles
 router.get("/articles", displayArticles)
 
 module.exports = router;
 