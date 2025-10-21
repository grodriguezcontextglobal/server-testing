const { response, json } = require("express");
const { default: mongoose } = require("mongoose");
const Transaction = require("../models/Transaction");
const { clientRedis } = require("../database/cacheMemoryConfig");
require("dotenv").config();
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const logger = require("../helpers/logger");

const saveTransaction = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const { event_id, company, consumerInfo } = request.body;
    cache_connection.del(
      `event_id=${event_id}&company=${company}&consumerInfo.id=${consumerInfo.id}`
    );

    const transaction = new Transaction(request.body);
    const transactionSaved = await transaction.save();
    return response.status(201).json({
      ok: true,
      msg: "Transaction saved",
      transaction: transactionSaved,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
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

    const transaction = new Transaction(request.body);
    const transactionSaved = await transaction.save();
    return response.status(201).json({
      ok: true,
      msg: "Transaction saved",
      transaction: transactionSaved,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
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
    const Transaction = new Transaction(request.body);
    const TransactionSaved = await Transaction.save();
    return response.status(201).json({
      ok: true,
      msg: "Transaction saved",
      Transaction: TransactionSaved,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact administrator",
    });
  }
};

const updateTransaction = async (request, response) => {
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
      transaction._id,
      transactionEdited,
      {
        new: true,
      }
    );
    return response.status(201).json({
      ok: true,
      transaction: updatedTransaction,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const getListOfAllSavedTransaction = async (request, response) => {
  try {
    const listOfTransactionsSaved = await Transaction.find(request.body);
    return response.status(201).json({
      ok: true,
      list: listOfTransactionsSaved,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
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
      cache_connection.expire(`${params}`, 60);
      return response.status(201).json({
        ok: true,
        list: listOfTransactionsSaved,
      });
    }
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
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
    return response.status(201).json({
      ok: true,
      list: updateDocuments,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const removeDuplicateEntry = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const documentClearUpCache = await Transaction.findById(request.params.id);
    if (documentClearUpCache) {
      cache_connection.del(
        `event_id=${documentClearUpCache.event_id}&company=${documentClearUpCache.company}&consumerInfo.id=${documentClearUpCache.consumerInfo.id}`
      );
      const duplicateEntry = await Transaction.findByIdAndDelete(
        request.params.id
      );
      if (duplicateEntry) {
        return response.status(201).json({
          ok: true,
          msg: `Duplicate entry ID ${request.params.id} removed from transaction document`,
        });
      }
    }
    const duplicateEntry = await Transaction.findByIdAndDelete(
      request.params.id
    );
    if (duplicateEntry) {
      return response.status(201).json({
        ok: true,
        msg: `Duplicate entry ID ${request.params.id} removed from transaction document`,
      });
    }
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const checkingAndReleasingDepositTransactions = async (request, response) => {
  try {
    const { eventSelected, company } = request.body;
    const findingTransactions = await Transaction.find({
      eventSelected,
      company,
      active: true,
      paymentIntent: { $exists: true },
      $expr: { $gt: [{ $strLenCP: "$paymentIntent" }, 15] },
    });
    let counting = [];
    if (findingTransactions.length > 0) {
      for (let item of findingTransactions) {
        if (!item.paymentIntent.includes("cash")) {
          const paymentIntent = await stripe.paymentIntents.retrieve(
            `${item.paymentIntent}`
          );
          if (paymentIntent.status === "requires_capture") {
            counting.push(paymentIntent);
            //!here needs to be the logic to release the transaction in stripe by passing the payment intent id in cancel function
          }
        }
      }
    }
    return response.status(201).json({
      ok: true,
      msg: "Transactions found",
      transactions: findingTransactions,
      paymentIntents: counting,
    });
  } catch (error) {
    return response.status(500).json({
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
  checkingAndReleasingDepositTransactions,
};
