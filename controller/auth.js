const { response } = require("express");
const User = require("../models/User");

const newUser = async (request, response = response) => {
  // const { groupName, name, lastName, email, phoneNumber} = request.body
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

    await user.save();

    response.status(201).json({
      ok: true,
      msg: "new user",
      user,
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

      const { email, phoneNumber } = user

  
      if (!user) {
        return response.status(404).json({
          ok: false,
          msg: "User/id do not match",
        });
      }

      const userEdited = {
        ...request.body,
      };
      if( userEdited.email === request.body.email){
        return response.status(404).json({
          ok: false,
          msg: "Email is already registered",
        });
      }

      if( userEdited.phoneNumber === request.body.phoneNumber){
        return response.status(404).json({
          ok: false,
          msg: "Phone number is already registered",
        });
      }

      const userUpdated = await User.findByIdAndUpdate(userId, userEdited, {
        new: true,
        
      }); //3 parameters user id, new user and how it will be returned as new event
  
      console.log({userUpdated})
      
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
};
