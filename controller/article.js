const express = require("express");
const Article = require("../models/Article");

const articleSetup = async (request, response) => {
  const newArticle = new Article(request.body);
  try {
    newArticle.adminUser = request.uid;
    await newArticle.save();

    return response.status(201).json({
      ok: true,
      message: "article created",
      newArticle,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const displayArticles = async (request, response) => {
  try {
    const articles = await Article.find();
    response.status(201).json({
      ok: true,
      articles,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error.response.data,
    });
  }
};
const deleteArticle = async(request, response) => {
  try {
    const { id } = request.body
    const articleToDelete = await Article.findByIdAndDelete(id)
    response.status(201).json({
      ok: true,
      articleToDelete
    })
  } catch (error) {
    console.log("🚀 ~ file: article.js:43 ~ deleteArticle ~ error:", error)
    response.status(500).json({
      ok: false,
      msg:"There was an error in the request. Please try it later"
    })
  }
}
module.exports = {
  articleSetup,
  displayArticles,
  deleteArticle
};
