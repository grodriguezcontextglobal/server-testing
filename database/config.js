const mongoose = require("mongoose");
require("dotenv").config();

const dbConnection = async () => {
  try {
    await mongoose.connect(process.env.DB_TESTING_CNN) 
    mongoose.set('strictQuery', true); 
  } catch (error) {
    console.log(error);
    throw new Error(`Error in starting connecting with DB ${error.message}`);
  }
};

module.exports = {
  dbConnection
};
