const mongoose = require("mongoose");
require("dotenv").config();

const dbConnection = async () => {
  try {
    await mongoose.connect(process.env.DB_TESTING_CNN, {
      ssl: true,
      tlsInsecure: true // For development purposes
    });
    mongoose.set('strictQuery', true); 
    console.log("Database connected successfully");
  } catch (error) {
    console.log(error);
    throw new Error(`Error in starting connecting with DB ${error.message}`);
  }
};

module.exports = {
  dbConnection
};
