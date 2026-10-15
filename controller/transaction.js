const { response, json } = require("express");
const { default: mongoose, isValidObjectId } = require("mongoose");
const Transaction = require("../models/Transaction");
const { clientRedis } = require("../database/cacheMemoryConfig");
require("dotenv").config();
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const logger = require("../helpers/logger");
const runGoWorker = require("../helpers/goWorker");
const { isStaffOrigin, isStaffSession } = require("../helpers/consumerUserFilter");
const {
  buildPublicTransactionList,
  buildPublicTransactionDoc,
  TransactionLaneError,
} = require("../helpers/publicTransactionLane");

// saveTransaction, getListOfAllSavedTransaction y removeDuplicateEntry los
// llama la app del consumidor sin sesión (también por /api/stripe). Staff con
// sesión válida: comportamiento de siempre. Dashboard sin sesión: 401. Resto:
// carril acotado de helpers/publicTransactionLane.js.
const resolveLane = async (request) => {
  if (await isStaffSession(request)) return "staff";
  if (isStaffOrigin(request)) {
    throw new TransactionLaneError(401, "Staff session required");
  }
  return "public";
};

const sendLaneError = (response, error) =>
  response.status(error.status).json({ ok: false, msg: error.message });

const saveTransaction = async (request, response) => {
  try {
    const lane = await resolveLane(request);
    let doc = request.body;
    if (lane === "public") {
      doc = buildPublicTransactionDoc(request.body);
      // La app deduplicaba en el cliente, borrando sin sesión. Si ya existe,
      // se devuelve la que hay en vez de crear otra.
      const existing = await Transaction.findOne(
        {
          paymentIntent: doc.paymentIntent,
          event_id: doc.event_id,
          "consumerInfo.email": doc.consumerInfo.email,
        },
        "-clientSecret"
      );
      if (existing) {
        return response.status(200).json({
          ok: true,
          msg: "Transaction already saved",
          transaction: existing,
        });
      }
    }
    const cache_connection = await clientRedis();
    const { event_id, company, consumerInfo } = doc;
    cache_connection.del(
      `event_id=${event_id}&company=${company}&consumerInfo.id=${consumerInfo.id}`
    );

    const transaction = new Transaction(doc);
    const transactionSaved = await transaction.save();
    return response.status(201).json({
      ok: true,
      msg: "Transaction saved",
      transaction: transactionSaved,
    });
  } catch (error) {
    if (error instanceof TransactionLaneError) return sendLaneError(response, error);
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
    const lane = await resolveLane(request);
    let listOfTransactionsSaved;
    if (lane === "staff") {
      listOfTransactionsSaved = await Transaction.find(request.body);
    } else {
      const { filter, projection } = buildPublicTransactionList(request.body);
      listOfTransactionsSaved = await Transaction.find(filter, projection);
    }
    return response.status(201).json({
      ok: true,
      list: listOfTransactionsSaved,
    });
  } catch (error) {
    if (error instanceof TransactionLaneError) return sendLaneError(response, error);
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
    const lane = await resolveLane(request);
    const { id } = request.params;
    // Antes, con un id inexistente no se respondía nada (408 por timeout).
    const document = isValidObjectId(id) ? await Transaction.findById(id) : null;
    if (!document) {
      return response.status(404).json({ ok: false, msg: "Transaction not found" });
    }
    // Sin sesión solo se borra un duplicado de verdad: tiene que existir otra
    // transacción más antigua con el mismo paymentIntent en el mismo evento. Es
    // lo que hace el dedupe de la app (se queda con la primera); antes se podía
    // borrar cualquier transacción sabiendo su id.
    if (lane === "public") {
      const olderTwin = await Transaction.findOne(
        {
          _id: { $lt: document._id },
          paymentIntent: document.paymentIntent,
          event_id: document.event_id,
        },
        "_id"
      );
      if (!olderTwin) {
        return response.status(409).json({ ok: false, msg: "Transaction is not a duplicate" });
      }
    }
    const cache_connection = await clientRedis();
    cache_connection.del(
      `event_id=${document.event_id}&company=${document.company}&consumerInfo.id=${document.consumerInfo?.id}`
    );
    await Transaction.findByIdAndDelete(id);
    return response.status(201).json({
      ok: true,
      msg: `Duplicate entry ID ${id} removed from transaction document`,
    });
  } catch (error) {
    if (error instanceof TransactionLaneError) return sendLaneError(response, error);
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
      // Filter valid payment intents that are not cash
      const candidates = findingTransactions
        .filter(
          (item) => item.paymentIntent && !item.paymentIntent.includes("cash")
        )
        .map((item) => item.paymentIntent);

      if (candidates.length > 0) {
        // Offload checks to Go Worker (parallel processing)
        const goResult = await runGoWorker("check-stripe-payment-intents", {
          payment_intents: candidates,
        });

        if (goResult && goResult.paymentIntents) {
          counting = goResult.paymentIntents;
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
      msg: error.message || error,
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
