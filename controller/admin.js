const express = require("express");
const bcrypt = require("bcryptjs");
const AdminUser = require("../models/AdminUser");
const { generateJWT } = require("../helpers/jwt");
const StripeTransaction = require("../models/StripeTransaction");
const { clientRedis } = require("../database/cacheMemoryConfig");

const createAdminUser = async (request, response = express.response) => {
  const { email, password } = request.body;

  try {
    let adminUser = await AdminUser.findOne({ email });
    if (adminUser) {
      return response.status(400).json({
        ok: false,
        msg: `${email} is already in our record. Please use a different email address to create a new account.`,
      });
    }
    adminUser = new AdminUser(request.body);

    //encrypt password
    const salt = bcrypt.genSaltSync();
    adminUser.password = bcrypt.hashSync(password, salt);

    await adminUser.save();

    //generate JWT
    const token = await generateJWT(adminUser.id, adminUser.name);
    return response.status(201).json({
      ok: true,
      message: "registered",
      entire: adminUser,
      uid: adminUser.id,
      name: adminUser.name,
      lastName: adminUser.lastName,
      email: adminUser.email,
      phone: adminUser.phone,
      role: adminUser.role,
      company: adminUser.company,
      token,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const loginUser = async (request, response = express.response) => {
  const { email, password } = request.body;
  try {
    let adminUser = await AdminUser.findOne({ email });
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
        msg: "You have entered an invalid username or password",
      });
    }

    //generate jwt (json web token)
    const token = await generateJWT(adminUser.id, adminUser.name);
    return response.status(200).json({
      ok: true,
      entire: adminUser,
      uid: adminUser.id,
      name: adminUser.name,
      lastName: adminUser.lastName,
      email: adminUser.email,
      phone: adminUser.phone,
      role: adminUser.role,
      company: adminUser.company,
      token,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const editAdminUser = async (request, response = response) => {
  const adminUserId = request.params.id;
  try {
    const adminUser = await AdminUser.findById(adminUserId);
    if (!adminUser) {
      return response.status(404).json({
        ok: false,
        msg: "Admin user/id do not match",
      });
    }
    const adminUserEdited = {
      ...request.body,
    };
    //generate JWT
    const token = await generateJWT(adminUserId, adminUser.name);
    const adminUserUpdated = await AdminUser.findByIdAndUpdate(
      adminUserId,
      adminUserEdited,
      {
        new: true,
      }
    );
    return response.json({
      msg: "admin user updated",
      ok: true,
      entire: adminUserUpdated,
      uid: adminUserUpdated.id,
      name: adminUserUpdated.name,
      lastName: adminUserUpdated.lastName,
      email: adminUserUpdated.email,
      phone: adminUserUpdated.phone,
      company: adminUserUpdated.company,
      role: adminUserUpdated.role,
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
//*
const editOtherAdminUser = async (request, response = response) => {
  const adminUserId = request.params.id;

  try {
    const adminUserEdited = {

      ...request.body,
    };
    const adminUserUpdated = await AdminUser.findByIdAndUpdate(
      adminUserId,
      adminUserEdited,
      {
        new: true,
      }
    );

    return response.json({
      msg: "admin user updated",
      ok: true,
      adminUpdated: adminUserUpdated
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};


const deleteAdminUser = async (request, response) => {
  try {
    const adminUserId = await request.params.id;
    const adminUser = await AdminUser.findByIdAndDelete(adminUserId);
    if (!adminUser) {
      return response.status(404).json({
        ok: false,
        msg: "Admin user/id do not match",
      });
    }
    return response.status(201).json({
      ok: true,
      adminUser,
      msg: "admin user deleted",
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const renewToken = async (request, response = express.response) => {
  const { uid, name } = request;

  //genrate a new jwt and return it in this request
  const token = await generateJWT(uid, name);

  return response.json({
    ok: true,
    name,
    uid,
    token,
  });
};

const updatePassword = async (request, response) => {
  const { email, password } = request.body;

  try {
    let adminUser = await AdminUser.findOne({ email });

    if (!adminUser) {
      return response.status(400).json({
        ok: false,
        msg: "Email/User was not found",
      });
    }

    const id = adminUser.id;
    ///encrypt password
    const salt = bcrypt.genSaltSync();
    adminUser.password = bcrypt.hashSync(password, salt);

    //generate JWT
    const token = await generateJWT(id, adminUser.name);

    //update password in adminUser object
    const updateAdminUserPassword = await AdminUser.findByIdAndUpdate(
      id,
      adminUser,
      {
        new: true,
      }
    );
    return response.status(201).json({
      ok: true,
      message: "register",
      uid: updateAdminUserPassword.id,
      name: updateAdminUserPassword.name,
      email: updateAdminUserPassword.email,
      phone: updateAdminUserPassword.phone,
      role: updateAdminUserPassword.role,
      company: updateAdminUserPassword.company,
      token,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const showAllUsers = async (request, response) => {
  const stripeTransactions = await StripeTransaction.find(request.body).populate("user");

  try {
    return response.status(201).json({
      ok: true,
      stripeTransactions,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const showStaffs = async (request, response) => {
  const staff = await AdminUser.find(request.body);

  try {
    return response.status(201).json({
      ok: true,
      staff,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const displayAllAdminUser = async (request, response) => {
  try {
    const adminUsers = await AdminUser.find(request.body);

    return response.status(201).json({
      ok: true,
      adminUsers,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
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
    await newArticle.save();

    return response.status(201).json({
      ok: true,
      message: "article created",
      newArticle,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const displayArticles = async (request, response) => {
  try {
    const articles = await Article.find();
    return response.status(201).json({
      ok: true,
      articles,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: error.response.data,
    });
  }
};

const checkStatus = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const email = request.params.email
    const cachedStatus = await cache_connection.get(`admin_status=${email}`)
    if (cachedStatus) {
      cache_connection.del(`admin_status=${email}`)
      return response.status(201).json({
        ok: true,
        cached: true,
        online: JSON.parse(cachedStatus)
      })
    }
    const checkOnlineStatus = await AdminUser.findOne({ email: email })
    cache_connection.set(`admin_status=${email}`, JSON.stringify(checkOnlineStatus.online))
    cache_connection.expire(`admin_status=${email}`, 180)
    return response.status(201).json({
      ok: true,
      cached: false,
      online: checkOnlineStatus.online
    })
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      error
    })
  }
}
module.exports = {
  renewToken,
  loginUser,
  createAdminUser,
  editAdminUser,
  editOtherAdminUser,
  deleteAdminUser,
  updatePassword,
  showAllUsers,
  showStaffs,
  displayAllAdminUser,
  articleSetup,
  displayArticles,
  checkStatus,
};
