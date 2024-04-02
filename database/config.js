const mongoose = require("mongoose");
require("dotenv").config();

const dbConnection = async () => {
  try {
    await mongoose.connect(process.env.DB_CNN, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    // Set strictQuery option to prepare for future changes
    mongoose.set('strictQuery', true); // or true if you prefer to suppress the warning
  } catch (error) {
    console.log(error);
    throw new Error(`Error in starting connecting with DB ${error.message}`);
  }
};

module.exports = {
  dbConnection
};
