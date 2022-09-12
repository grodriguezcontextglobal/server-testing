const { response } = require("express");
const User = require("../models/User");
const { generateJWT } = require("../helpers/jwt");

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

    // console.log('user created', response.body.user )
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};
const checkUser = async (request, response = response) => {
  console.log('request',request.body)

  try {
    const user = await User.findOne(request.body)

    if (user) {
      return response.status(201).json({
        ok: true,
        user,
        msg: "existing user"
      });
    } else {
      return response.status(201).json({
        ok: false,
        msg: "user does not exist"
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
  console.log({request})

  const { email, phoneNumber } = request.body;
  try {
    let user = await User.findOne({ email });

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

    console.log({ userCreated })

    //generate JWT
    const token = await generateJWT( user.id, user.name)

    response.status(201).json({
      ok: true,
      msg: "new user",
      name: userCreated.name,
      lastName: userCreated.lastName,
      email: userCreated.email,
      phone: userCreated.phoneNumber,
      uid: userCreated.id,
      token
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

  try {
    const user = await User.findById(userId);

    if (!user) {
      return response.status(404).json({
        ok: false,
        msg: "User/id do not match",
      });
    }

    const userEdited = {
      ...request.body,
    };

    const userUpdated = await User.findByIdAndUpdate(userId, userEdited, {
      new: true,
    }); //3 parameters user id, new user and how it will be returned as new event

    return response.json({
      ok: true,
      user: userUpdated,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

const renewToken = (request, response = response) => {
  response.json({
    ok: true,
    msg: "renew",
  });
};

module.exports = {
  newUser,
  renewToken,
  editUser,
  getUser,
  checkUser,
};
