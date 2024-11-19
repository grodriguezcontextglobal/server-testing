const { response, json } = require("express");
const { default: mongoose } = require("mongoose");
const Transaction = require("../models/Transaction");
const { clientRedis } = require("../database/cacheMemoryConfig");
require("dotenv").config();

const saveTransaction = async (request, response) => {
  try {
    // event_id=6712d08f807dd7ac37f8ed8d&company=66cdf26906fd8fd5e9b13ef2&consumerInfo.id=671ab5d88757ebec2c530900
    const cache_connection = await clientRedis();
    const { event_id, company, consumerInfo } = request.body;
    cache_connection.del(
      `event_id=${event_id}&company=${company}&consumerInfo.id=${consumerInfo.id}`
    );
    // cache_connection.quit();

    const transaction = new Transaction(request.body);
    const transactionSaved = await transaction.save();
    response.status(201).json({
      ok: true,
      msg: "Transaction saved",
      transaction: transactionSaved,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const saveTransactionAdmin = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const { event_id, company, consumerInfo } = request.body;
    cache_connection.del(
      `event_id=${event_id}&company=${company}&consumerInfo.id=${consumerInfo.id}`
    );
    // cache_connection.quit();

    const transaction = new Transaction(request.body);
    const transactionSaved = await transaction.save();
    response.status(201).json({
      ok: true,
      msg: "Transaction saved",
      transaction: transactionSaved,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const saveTransactionTemplateForNoRegularUser = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const { event_id, company, consumerInfo } = request.body;
    cache_connection.del(
      `event_id=${event_id}&company=${company}&consumerInfo.id=${consumerInfo.id}`
    );
    // cache_connection.quit();
    const Transaction = new Transaction(request.body);
    const TransactionSaved = await Transaction.save();
    response.status(201).json({
      ok: true,
      msg: "Transaction saved",
      Transaction: TransactionSaved,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact administrator",
    });
  }
};

const updateTransaction = async (request, response) => {
  // const { id, active } = request.body;
  try {
    const id = request.params.id;
    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return response.status(404).json({
        ok: false,
        msg: "Transaction does not match to our records.",
      });
    }
    const transactionEdited = {
      ...request.body,
    };
    const updatedTransaction = await Transaction.findByIdAndUpdate(
      transaction,
      transactionEdited,
      {
        new: true,
      }
    );
    const cache_connection = await clientRedis();
    const { event_id, company, consumerInfo } = transactionEdited;
    cache_connection.del(
      `event_id=${event_id}&company=${company}&consumerInfo.id=${consumerInfo.id}`
    );
    // cache_connection.quit();
    return response.status(201).json({
      ok: true,
      transaction: updatedTransaction,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const getListOfAllSavedTransaction = async (request, response) => {
  try {
    const listOfTransactionsSaved = await Transaction.find(request.body);
    response.status(201).json({
      ok: true,
      list: listOfTransactionsSaved,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const gettingListOfSavedTransaction = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const params = request._parsedUrl.query;
    const retrieveDatainMemeory = await cache_connection.get(`${params}`);
    if (retrieveDatainMemeory) {
      return response.status(201).json({
        ok: true,
        list: JSON.parse(retrieveDatainMemeory),
      });
    } else {
      const formatting = [...params.split("&")];
      const check = formatting.reduce(
        (a, v) => ({ ...a, [v.split("=")[0]]: v.split("=")[1] }),
        {}
      );
      const listOfTransactionsSaved = await Transaction.find(check);
      cache_connection.set(
        `${params}`,
        JSON.stringify(listOfTransactionsSaved)
      );
      // cache_connection.quit();
      response.status(201).json({
        ok: true,
        list: listOfTransactionsSaved,
      });
    }
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const updateMultipleDocuments = async (request, response) => {
  try {
    const updateDocuments = await Transaction.find(
      request.body.find
    ).updateMany(request.body.update);
    response.status(201).json({
      ok: true,
      list: updateDocuments,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const removeDuplicateEntry = async (request, response) => {
  try {
    const duplicateEnrty = await Transaction.findByIdAndDelete(
      request.params.id
    );
    if (duplicateEnrty) {
      response.status(201).json({
        ok: true,
        msg: `duplicate entry id ${request.params.id} removed from transaction document`,
      });
    }
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

module.exports = {
  saveTransaction,
  saveTransactionAdmin,
  saveTransactionTemplateForNoRegularUser,
  getListOfAllSavedTransaction,
  updateMultipleDocuments,
  removeDuplicateEntry,
  updateTransaction,
  gettingListOfSavedTransaction,
};
