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
    const articles = await Article.find(request.body);
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
const deleteArticle = async (request, response) => {
  try {
    const deleteArticleId = await request.params.id;
    const articleToDelete = await Article.findByIdAndDelete(deleteArticleId)

    response.status(201).json({
      ok: true,
      articleToDelete
    })
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: "There was an error in the request. Please try it later"
    })
  }
}

const editArticle = async (request, response) => {
  try {
    const articleIdToEdit = request.params.id;
    const contentToEditArticle = {
      ...request.body
    }
    const articleEdited = await Article.findByIdAndUpdate(
      articleIdToEdit,
      contentToEditArticle,
      {
        new: true
      }
    )
    response.status(201).json({
      ok: true,
      article: articleEdited
    })
  } catch (error) {
    console.log(error)
    response.status(500).json({
      ok: false,
      msg: "There was an error in the request. Please try it later"
    })
  }
}
module.exports = {
  articleSetup,
  displayArticles,
  deleteArticle,
  editArticle
};
