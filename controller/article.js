const express = require("express");
const Article = require("../models/Article");

const articleSetup = async (request, response) => {
  const { img, title, body } = request.body;
  const newArticle = new Article({
    img,
    title,
    body,
  });

  try {
    newArticle.adminUser = request.uid;
    console.log(request.uid);
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
module.exports = {
  articleSetup,
  displayArticles,
};
