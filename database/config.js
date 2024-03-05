const mongoose = require("mongoose");
require("dotenv").config();

const dbConnection = async () => {
  try {
    await mongoose.connect(process.env.DB_TESTING_CNN, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    // Set strictQuery option to prepare for future changes
    mongoose.set('strictQuery', false); // or true if you prefer to suppress the warning

    console.log("Connected to MongoDB")
  } catch (error) {
    console.log(error);
    throw new Error(`Error a la hora de inicializar DB ${error.message}`);
  }
};

module.exports = {
  dbConnection
};
