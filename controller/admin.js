const express = require("express");
const bcrypt = require("bcryptjs");
const AdminUser = require("../models/AdminUser");
const { generateJWT } = require("../helpers/jwt");

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
    const token =  await generateJWT(adminUser.id, adminUser.name);

    return response.status(201).json({
      ok: true,
      message: "register",
      uid: adminUser.id,
      name: adminUser.name,
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
  console.log(request.body)
  try {
    let adminUser = await AdminUser.findOne({ email });
    console.log( adminUser)

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

const renewToken = async (request, response = express.response) => {

  const { uid, name } = request


  //genrate a new jwt and return it in this request
  const token = await generateJWT(uid, name);

  response.json({
    ok: true,
    name,
    uid,
    token
  });
};


module.exports = {
  renewToken,
  loginUser,
  createAdminUser,
};
