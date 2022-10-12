const express = require("express");
const bcrypt = require("bcryptjs");
const AdminUser = require("../models/AdminUser");
const Article = require("../models/Article");
const { generateJWT } = require("../helpers/jwt");
const StripeTransaction = require("../models/StripeTransaction");

const createAdminUser = async (request, response = express.response) => {
  const { email, password, role } = request.body;

  try {
    let adminUser = await AdminUser.findOne({ email });

    console.log(adminUser);

    if (adminUser) {
      return response.status(400).json({
        ok: false,
        msg: "Email is registered already",
      });
    }

    adminUser = new AdminUser(request.body);

    ///encriptar password
    const salt = bcrypt.genSaltSync();
    adminUser.password = bcrypt.hashSync(password, salt);

    await adminUser.save();

    //generate JWT
    const token = await generateJWT(adminUser.id, adminUser.name);

    return response.status(201).json({
      ok: true,
      message: "register",
      uid: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      token,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrater",
    });
  }
};

const loginUser = async (request, response = express.response) => {
  const { email, password } = request.body;
  console.log(request.body);
  try {
    let adminUser = await AdminUser.findOne({ email });
    console.log(adminUser);

    if (!adminUser) {
      return response.status(400).json({
        ok: false,
        msg: "User is not found",
      });
    }

    //confirmar password
    const validPassword = bcrypt.compareSync(password, adminUser.password);

    if (!validPassword) {
      return response.status(400).json({
        ok: false,
        msg: "Pasword incorrect",
      });
    }

    //generate jwt (json web token)
    const token = await generateJWT(adminUser.id, adminUser.name);

    return response.status(200).json({
      ok: true,
      uid: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      token,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrater",
    });
  }
};

const editAdminUser = async (request, response = response) => {
  const adminUserId = request.params.id;
  console.log("adminUserId", adminUserId);

  try {
    const adminUser = await AdminUser.findById(adminUserId);

    console.log("adminUser", adminUser);

    if (!adminUser) {
      return response.status(404).json({
        ok: false,
        msg: "Admin user/id do not match",
      });
    }

    console.log("request", request.body);

    const adminUserEdited = {
      ...request.body,
    };

    console.log("admin user edited", adminUserEdited);

    //generate JWT
    const token = await generateJWT(adminUserId, adminUser.name);

    console.log("token", token);

    const adminUserUpdated = await AdminUser.findByIdAndUpdate(
      adminUserId,
      adminUserEdited,
      {
        new: true,
      }
    ); //3 parameters user id, new user and how it will be returned as new event

    return response.json({
      msg: "admin user updated",
      ok: true,
      uid: adminUserUpdated.id,
      name: adminUserUpdated.name,
      email: adminUserUpdated.email,
      token,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

const renewToken = async (request, response = express.response) => {
  const { uid, name } = request;

  //genrate a new jwt and return it in this request
  const token = await generateJWT(uid, name);

  response.json({
    ok: true,
    name,
    uid,
    token,
  });
};

const showAllUsers = async (request, response) => {
  const stripeTransactions = await StripeTransaction.find().populate("user");

  try {
    response.status(201).json({
      ok: true,
      stripeTransactions,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};
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
  renewToken,
  loginUser,
  createAdminUser,
  editAdminUser,
  showAllUsers,
  articleSetup,
  displayArticles,
};
