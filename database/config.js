const mongoose = require('mongoose');
require('dotenv').config();

let isConnected = false;

const dbConnection = async () => {
  try {
    if (isConnected) {
      console.log('Database is already connected.');
      return mongoose.connection;
    }

    await mongoose.connect(process.env.DB_CNN, {
      maxPoolSize: 10, // Set connection pool size
    });

    mongoose.set('strictQuery', true);

    mongoose.connection.on('connected', () => {
      isConnected = true;
      console.log('Connected to DB');
    });

    mongoose.connection.on('error', (err) => {
      console.error(`Error in DB connection: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      console.warn('Disconnected from DB');
    });

    return mongoose.connection;
  } catch (error) {
    console.error(`Error connecting to DB: ${error.message}`);
    throw new Error(`Failed to connect to the database: ${error.message}`);
  }
};

module.exports = { dbConnection };
