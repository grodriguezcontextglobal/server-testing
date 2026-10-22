const User = require("../models/User");
const Event = require("../models/Event");
const Receivers = require("../models/Receivers");
const { issueConsumerToken } = require("../helpers/consumerToken");
const { clientRedis } = require("../database/cacheMemoryConfig");
const runGoWorker = require("../helpers/goWorker");
const { groupBy } = require("lodash");
const mongoose = require("mongoose");
const logger = require("../helpers/logger");
const {
  buildUserFilter,
  isStaffOrigin,
  parseQueryString,
  isStaffSession,
  UserFilterError,
  PUBLIC_PROJECTION,
} = require("../helpers/consumerUserFilter");

const sendFilterError = (response, error) =>
  response.status(error.status).json({ ok: false, msg: error.message });

// Con sesión de staff filtra por cualquier campo del modelo; sin sesión solo
// busca por email exacto (ver helpers/consumerUserFilter.js). `publicFromDashboard`
// deja ese carril público abierto también para el dashboard (solo POST
// /user-query, por /attendance-confirmation).
const findUsers = async (request, response, { publicFromDashboard }) => {
  try {
    const authenticated = await isStaffSession(request);
    const filter = buildUserFilter(request.body, {
      authenticated,
      sessionRequired: !publicFromDashboard && isStaffOrigin(request),
    });
    const users = filter
      ? await User.find(filter, authenticated ? null : PUBLIC_PROJECTION)
      : [];
    return response.status(200).json({
      ok: true,
      users,
    });
  } catch (error) {
    if (error instanceof UserFilterError) return sendFilterError(response, error);
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

// GET/POST /users
const showAllUsers = (request, response) =>
  findUsers(request, response, { publicFromDashboard: false });

// POST /user-query
const lookupUsers = (request, response) =>
  findUsers(request, response, { publicFromDashboard: true });

const getListOfUsers = async (request, response = response) => {
  try {
    const authenticated = await isStaffSession(request);
    const check = buildUserFilter(parseQueryString(request._parsedUrl.query), {
      authenticated,
      sessionRequired: isStaffOrigin(request),
    });
    // La caché es la lista por evento+compañía que pide el dashboard. Cualquier
    // otra consulta (p. ej. por email) iba a parar a "event=null&company=null"
    // y devolvía lo que hubiera guardado otra consulta distinta.
    if (!check) return response.status(200).json({ ok: true, users: [] });
    if (!check.event_providers || !check.company_providers) {
      const users = await User.find(check, authenticated ? null : PUBLIC_PROJECTION);
      return response.status(200).json({ ok: true, users });
    }

    const cache_connection = await clientRedis();
    const eventID = check.event_providers;
    const companyID = check.company_providers;

    const cachedList = await cache_connection.get(
      `event=${eventID}&company=${companyID}`
    );
    if (cachedList) {
      return response.status(200).json({
        cached: true,
        ok: true,
        users: JSON.parse(cachedList),
      });
    } else {
      const users = await User.find(check);
      cache_connection.set(
        `event=${eventID}&company=${companyID}`,
        JSON.stringify(users)
      );
      cache_connection.expire(`event=${eventID}&company=${companyID}`, 180);
      return response.status(200).json({
        ok: true,
        users,
      });
    }
  } catch (error) {
    if (error instanceof UserFilterError) return sendFilterError(response, error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const getUser = async (request, response = response) => {
  const userId = request.params.id;
  try {
    const user = await User.findById(userId);
    if (!user) {
      return response.status(404).json({
        ok: false,
        msg: "User/id do not match",
      });
    }
    return response.json({
      ok: true,
      user,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

const checkUser = async (request, response = response) => {
  const { userInfoEmailCheck } = request.body;
  try {
    const user = await User.findOne({ email: userInfoEmailCheck });

    // Sin token (2026-10-21): devolvía un JWT firmado con la semilla de staff a
    // cualquiera que conociera un email. Un consumidor existente obtiene su
    // token con el enlace del correo (POST /consumer-login-link).
    if (user !== null) {
      return response.status(201).json({
        ok: true,
        user,
        msg: "existing user",
      });
    } else {
      return response.status(201).json({
        ok: false,
        msg: "user does not exist",
      });
    }
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

const newUser = async (request, response = response) => {
  try {
    const cache_connection = await clientRedis();
    const { email } = request.body;
    let user = await User.findOne({ email });
    if (user) {
      return response.status(400).json({
        ok: false,
        msg: "Email is registered already",
      });
    }
    user = new User(request.body);
    const userCreated = await user.save();
    // Token de consumidor (helpers/consumerToken.js): quién, en qué evento y de
    // qué compañía. Antes era un JWT con la semilla de staff que validateJWT
    // aceptaba como sesión.
    const token = await issueConsumerToken(userCreated.id, userCreated.event_providers.at(-1)).catch(
      () => null
    );
    await cache_connection.del(
      `event_providers=${userCreated.event_providers.at(
        -1
      )}&company_providers=${userCreated.company_providers.at(-1)}`
    );
    await cache_connection.del(
      `event=${userCreated.event_providers.at(
        -1
      )}&company=${userCreated.company_providers.at(-1)}`
    );

    return response.status(201).json({
      ok: true,
      msg: "New user created",
      category: userCreated.category,
      name: userCreated.name,
      lastName: userCreated.lastName,
      email: userCreated.email,
      phone: userCreated.phoneNumber,
      eventSelected: userCreated.eventSelected,
      company: userCreated.company,
      privacyPolicy: userCreated.privacyPolicy,
      uid: userCreated.id,
      token,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact administrator",
    });
  }
};

const editUser = async (request, response = response) => {
  try {
    const cache_connection = await clientRedis();
    const userId = request.params.id;
    const user = await User.findById(userId);
    if (!user) {
      return response.status(404).json({
        ok: false,
        msg: "User/id do not match",
      });
    }
    const userEdited = {
      ...request.body,
    };

    // Sin token (2026-10-21): esta ruta es anónima y edita por id, así que
    // emitirlo aquí se lo daría a cualquiera que conozca el id.
    const userUpdated = await User.findByIdAndUpdate(userId, userEdited, {
      new: true,
    });
    cache_connection.del(
      `event=${userUpdated.event_providers.at(
        -1
      )}&company=${userUpdated.company_providers.at(-1)}`
    );
    await cache_connection.del(
      `event_providers=${userUpdated.event_providers.at(
        -1
      )}&company_providers=${userUpdated.company_providers.at(-1)}`
    );

    return response.json({
      ok: true,
      msg: "user updated",
      userUpdated,
      name: userUpdated.name,
      lastName: userUpdated.lastName,
      email: userUpdated.email,
      phone: userUpdated.phoneNumber,
      uid: userUpdated.id,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

const getListOfUsersAndTransactionsPerEvent = async (request, response) => {
  try {
    // La ruta exige sesión de staff (routes/event.js).
    const check = buildUserFilter(parseQueryString(request._parsedUrl.query), {
      authenticated: true,
    });
    const eventID = check.event_providers;
    const companyID = check.company_providers;
    const eventInfo = await Event.findOne({ _id: eventID });
    const users = await User.find(check);
    // Una sola query por TODAS las transacciones del evento, en vez de un
    // Receivers.find() por usuario esperando al anterior (N+1 secuencial: 200
    // asistentes = 200 viajes a Mongo). El reparto por usuario va en memoria.
    const userEmails = [
      ...new Set(users.map((user) => user.email).filter(Boolean)),
    ];
    const allTransactions = userEmails.length
      ? await Receivers.find({
          user: { $in: userEmails },
          eventSelected: eventInfo.eventInfoDetail.eventName,
          company: companyID,
        })
      : [];
    const transactionsByUser = groupBy(allTransactions, "user");
    let result = [];
    for (let user of users) {
      const transactions = transactionsByUser[user.email] || [];

      let groupingByActiveTransaction = {};
      if (transactions.length > 0) {
        groupingByActiveTransaction = groupBy(transactions, "device.status");
      }
      let status = 0;
      if (
        groupingByActiveTransaction[true] &&
        groupingByActiveTransaction[false]
      ) {
        status = 1;
      } else if (
        groupingByActiveTransaction[true] &&
        !groupingByActiveTransaction[false]
      ) {
        status = 2;
      } else if (
        !groupingByActiveTransaction[true] &&
        groupingByActiveTransaction[false]
      ) {
        status = 3;
      }
      result.push({
        user: user,
        transactions: status,
      });
    }

    return response.status(200).json({
      ok: true,
      msg: "Success",
      data: JSON.stringify(result),
    });
  } catch (error) {
    if (error instanceof UserFilterError) return sendFilterError(response, error);
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
      error: error,
    });
  }
};

const getAllConsumersBasedOnAllEventsPerCompany = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const { companyID } = request.params;
    const cachedList = await cache_connection.get(
      `consumersInfoPerCompany=${companyID}`
    );
    if (cachedList) {
      return response.status(200).json({
        cached: true,
        ok: true,
        result: JSON.parse(cachedList),
      });
    } else {
      const result = await runGoWorker("get-consumer-stats", { companyID });
      cache_connection.set(
        `consumersInfoPerCompany=${companyID}`,
        JSON.stringify(result)
      );
      cache_connection.expire(`consumersInfoPerCompany=${companyID}`, 180);
      return response.status(200).json({
        ok: true,
        cache: false,
        result: {
          ...result,
          usersList: JSON.stringify(result.usersList),
        },
      });
    }
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
      error: error.message,
    });
  }
};

module.exports = {
  lookupUsers,
  showAllUsers,
  newUser,
  editUser,
  getUser,
  getListOfUsers,
  checkUser,
  getListOfUsersAndTransactionsPerEvent,
  getAllConsumersBasedOnAllEventsPerCompany,
};
