const { response } = require("express");
const User = require("../models/User");
const { generateJWT } = require("../helpers/jwt");

const showAllUsers = async (request, response) => {
  try {

    const users = await User.find()

      return response.status(200).json({
    ok: true,
    users,
  });

  } catch (error) {
    console.log(error)
    response.status(500).json({
      ok: false,
      msg: error
    })
  }
};

const getUser = async (request, response = response) => {
  const userId = request.params.id;

  try {
    const user = await User.findById(userId); //.populate('user');

    if (!user) {
      return response.status(404).json({
        ok: false,
        msg: "User/id do not match",
      });
    }

    return response.json({
      ok: true,
      user,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};
const checkUser = async (request, response = response) => {
  const { userInfoEmailCheck } = request.body;

  try {
    const user = await User.findOne({ email: userInfoEmailCheck });

    if (user !== null) {
      //generate JWT
      const token = await generateJWT(user.id, user.name);

      return response.status(201).json({
        ok: true,
        user,
        token,
        msg: "existing user",
      });
    } else {
      return response.status(201).json({
        ok: false,
        msg: "user does not exist",
      });
    }
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

const newUser = async (request, response = response) => {
  const { email, phoneNumber } = request.body;
  try {
    let user = await User.findOne({ email });
    //generate JWT
    if (user) {
      return response.status(400).json({
        ok: false,
        msg: "Email is registered already",
      });
    }
    user = await User.findOne({ phoneNumber });

    if (user) {
      return response.status(400).json({
        ok: false,
        msg: "Phone number is registered already",
      });
    }

    user = new User(request.body);
    const userCreated = await user.save(); 
    //generate JWT
    const token = await generateJWT(user.id, user.name);

    response.status(201).json({
      ok: true,
      msg: "New user created",
      category:userCreated.category,
      name: userCreated.name,
      lastName: userCreated.lastName,
      email: userCreated.email,
      phone: userCreated.phoneNumber,
      privacyPolicy: userCreated.privacyPolicy,
      uid: userCreated.id,
      token,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact adminitrator",
    });
  }
};

const editUser = async (request, response = response) => {
  const userId = request.params.id;
  console.log("userId", { userId });

  try {
    const user = await User.findById(userId);

    console.log("user", user);

    if (!user) {
      return response.status(404).json({
        ok: false,
        msg: "User/id do not match",
      });
    }
    const userEdited = {
      ...request.body,
    };

    //generate JWT
    const token = await generateJWT(user.id, user.name);

    const userUpdated = await User.findByIdAndUpdate(userId, userEdited, {
      new: true,
    }); //3 parameters user id, new user and how it will be returned as new event

    return response.json({
      ok: true,
      msg: "user updated",
      name: userUpdated.name,
      lastName: userUpdated.lastName,
      email: userUpdated.email,
      phone: userUpdated.phoneNumber,
      uid: userUpdated.id,
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

module.exports = {
  showAllUsers,
  newUser,
  editUser,
  getUser,
  checkUser,
};
