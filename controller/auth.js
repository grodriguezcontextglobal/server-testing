const User = require("../models/User");
const Event = require("../models/Event");
const Receivers = require("../models/Receivers");
const { generateJWT } = require("../helpers/jwt");
const { clientRedis } = require("../database/cacheMemoryConfig");
const { groupBy } = require("lodash");
const mongoose = require("mongoose");
const logger = require("../helpers/logger");

const showAllUsers = async (request, response) => {
  try {
    const users = await User.find(request.body);
    return response.status(200).json({
      ok: true,
      users,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const getListOfUsers = async (request, response = response) => {
  try {
    const cache_connection = await clientRedis();
    const params = request._parsedUrl.query;
    const eventID = new URLSearchParams(params).get("event_providers");
    const companyID = new URLSearchParams(params).get("company_providers");

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
      const formatting = [...params.split("&")];
      const check = formatting.reduce(
        (a, v) => ({ ...a, [v.split("=")[0]]: v.split("=")[1] }),
        {}
      );
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

    if (user !== null) {
      const token = await generateJWT(user.id, user.name);

      return response.status(201).json({
        ok: true,
        user,
        token,
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
    const token = await generateJWT(user.id, user.name);
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

    const token = await generateJWT(user.id, user.name);

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
      token,
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
    const params = request._parsedUrl.query;
    const eventID = new URLSearchParams(params).get("event_providers");
    const companyID = new URLSearchParams(params).get("company_providers");

    const formatting = [...params.split("&")];
    const check = formatting.reduce(
      (a, v) => ({ ...a, [v.split("=")[0]]: v.split("=")[1] }),
      {}
    );
    const eventInfo = await Event.findOne({ _id: eventID });
    const users = await User.find(check);
    let result = [];
    for (let user of users) {
      const transactions = await Receivers.find({
        user: user.email,
        eventSelected: eventInfo.eventInfoDetail.eventName,
        company: companyID,
      });

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
      const usersList = await User.find({
        company_providers: { $in: [companyID] },
      }).lean();
      const leaseConsumersList = await Event.find({
        company_id: companyID,
        type: "lease",
      }).count();
      let result = {
        inactiveTransactions: 0,
        activeTransactions: 0,
        total: 0,
        totalConsumers: usersList.length,
        usersList: [],
        totalConsumersFromEvents: usersList.length,
        lease: leaseConsumersList,
      };
      for (let user of usersList) {
        const inactiveTransactions = await Receivers.find({
          user: user.email,
          company: companyID,
          "device.status": false,
        }).count();
        const activeTransactions = await Receivers.find({
          user: user.email,
          company: companyID,
          "device.status": true,
        }).count();
        const totalEventsActive = await Event.find({
          _id: {
            $in: user.event_providers.map(
              (id) => new mongoose.Types.ObjectId(id)
            ),
          },
          company_id: companyID,
          active: true,
        }).count();
        result.usersList.push({
          ...user,
          totalDeviceRequested: inactiveTransactions + activeTransactions,
          totalEventsActive: totalEventsActive,
        });
        result.inactiveTransactions += inactiveTransactions;
        result.activeTransactions += activeTransactions;
        result.total += inactiveTransactions + activeTransactions;
      }
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
  showAllUsers,
  newUser,
  editUser,
  getUser,
  getListOfUsers,
  checkUser,
  getListOfUsersAndTransactionsPerEvent,
  getAllConsumersBasedOnAllEventsPerCompany,
};
