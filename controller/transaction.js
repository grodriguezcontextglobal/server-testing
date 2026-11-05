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

// Filtros que manda el staff (A8, 2026-10-27). El dashboard usa operadores de
// comparación (`active: { $in: [...] }`), así que no se neutralizan todos: solo
// los que ejecutan código o expresiones sobre la colección.
const DANGEROUS_OPERATORS = new Set(["$where", "$expr", "$function", "$accumulator", "$jsonSchema"]);
const hasDangerousOperator = (value) => {
  if (Array.isArray(value)) return value.some(hasDangerousOperator);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([k, v]) => DANGEROUS_OPERATORS.has(k) || hasDangerousOperator(v));
};

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
    // Antes `const Transaction = new Transaction(...)`: la variable tapaba al
    // modelo y la ruta respondía 500 (ReferenceError) siempre.
    const transaction = new Transaction(request.body);
    const TransactionSaved = await transaction.save();
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
    // Solo `active` (A8, 2026-10-27): es lo único que manda el dashboard (anular
    // la transacción al capturar, liberar o reembolsar el depósito). Antes se
    // escribía el body entero, `company` y `paymentIntent` incluidos.
    const { active } = request.body || {};
    if (typeof active !== "boolean") {
      return response.status(400).json({ ok: false, msg: "Only `active` (boolean) can be updated." });
    }
    const ignored_fields = Object.keys(request.body || {}).filter((k) => !["active", "id"].includes(k));
    const updatedTransaction = await Transaction.findByIdAndUpdate(
      transaction._id,
      { $set: { active } },
      {
        new: true,
      }
    );
    return response.status(201).json({
      ok: true,
      transaction: updatedTransaction,
      ...(ignored_fields.length ? { ignored_fields } : {}),
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
      if (hasDangerousOperator(request.body)) {
        return response.status(400).json({ ok: false, msg: "Unsupported query operator." });
      }
      // La compañía la fija la ruta (requireStripeOwnership, injectBodyCompany).
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
    // La caché es por query; con la compañía puesta por la ruta, también por ella.
    const cacheKey = request.transactionScopeCompany
      ? `${params}&__company=${request.transactionScopeCompany}`
      : `${params}`;
    const retrieveDatainMemeory = await cache_connection.get(cacheKey);
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
      // Staff sin `company` en la query: la ruta deja la del contexto
      // (requireStripeOwnership, STRIPE_OWNERSHIP_MODE=enforce).
      if (request.transactionScopeCompany) check.company = request.transactionScopeCompany;
      const listOfTransactionsSaved = await Transaction.find(check);
      cache_connection.set(
        cacheKey,
        JSON.stringify(listOfTransactionsSaved)
      );
      cache_connection.expire(cacheKey, 60);
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
    // Lo que manda el dashboard al cerrar un evento: { find: { eventSelected,
    // company }, update: { active: false } }. Antes filtro y cambio llegaban
    // enteros del cliente: un find vacío actualizaba las transacciones de TODAS
    // las compañías (A8, 2026-10-27).
    const { find, update } = request.body || {};
    const FIND_KEYS = ["eventSelected", "event_id", "company"];
    const findKeys = Object.keys(find || {});
    if (!find?.company || findKeys.some((k) => !FIND_KEYS.includes(k))) {
      return response.status(400).json({
        ok: false,
        msg: `find must include company and may only use: ${FIND_KEYS.join(", ")}.`,
      });
    }
    if (!update || Object.keys(update).join() !== "active" || typeof update.active !== "boolean") {
      return response.status(400).json({ ok: false, msg: "update may only set `active` (boolean)." });
    }
    const updateDocuments = await Transaction.updateMany(
      mongoose.sanitizeFilter({ ...find }),
      { $set: { active: update.active } }
    );
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
