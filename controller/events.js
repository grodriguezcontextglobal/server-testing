const express = require("express");
const bcrypt = require("bcryptjs");
// const { validationResult } = require("express-validator");
const User = require("../models/User");
const { generateJWT } = require("../helpers/jwt");

const newUser = async (request, response = express.response) => {
  const { email, password } = request.body;

  try {
    let user = await User.findOne({ email });

    console.log(user);

    if (user) {
      return response.status(400).json({
        ok: false,
        msg: "Email is registered already",
      });
    }

    user = new User(request.body);

    ///encriptar password
    const salt = bcrypt.genSaltSync();
    user.password = bcrypt.hashSync(password, salt);

    await user.save();

    //generate JWT
    const token =  await generateJWT(user.id, user.name);

    return response.status(201).json({
      ok: true,
      message: "register",
      uid: user.id,
      name: user.name,
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

const login = async (request, response = express.response) => {
  const { email, password } = request.body;
  console.log(request.body )

  try {
    let user = await User.findOne({ email });

    console.log(user);

    if (!user) {
      return response.status(400).json({
        ok: false,
        msg: "User is not found",
      });
    }

    //confirmar password
    const validPassword = bcrypt.compareSync(password, user.password);

    if (!validPassword) {
      return response.status(400).json({
        ok: false,
        msg: "Pasword incorrect",
      });
    }

    //generate jwt (json web token)
    const token = await generateJWT(user.id, user.name);

    return response.status(200).json({
      ok: true,
      uid: user.id,
      name: user.name,
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
  newUser,
  login,
  renewToken,
};
