const { response, request } = require("express");
const mongoose = require("mongoose");
const ReceiverReturnedStatus = require("../models/ReceiverReturnedStatus");
const Receivers = require("../models/Receivers");
const ReceiversPool = require("../models/ReceiversPool");
const User = require("../models/User");
const { clientRedis } = require("../database/cacheMemoryConfig");
const runGoWorker = require("../helpers/goWorker");

const addReceiverToTransaction = async (request, response) => {
  try {
    Receivers.adminuser = request.body.adminUser;
    const receiversAssignedPerUser = new Receivers(request.body);
    await receiversAssignedPerUser.save();

    return response.status(201).json({
      ok: true,
      message: "ASSIGNED",
      device: receiversAssignedPerUser.device,
      paymentIntent: receiversAssignedPerUser.paymentIntent,
      receiversAssignedPerUser,
      date: new Date(),
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: error,
    });
    //   const result = await runGoWorker("add-receiver-transaction", request.body);
    //   return response.status(201).json({
    //     ok: true,
    //     message: "ASSIGNED",
    //     device: result.device,
    //     paymentIntent: result.paymentIntent,
    //     receiversAssignedPerUser: result,
    //     date: new Date(),
    //   });
    // } catch (error) {
    //   return response.status(500).json({
    //     ok: false,
    //     msg: "Please contact Administrator",
    //     err: error.message,
    //   });
    // }
  }
};

const checkingReceiversAssigned = async (request, response) => {
  const { paymentIntent } = request.body;

  try {
    const receiver = await Receivers.find({ paymentIntent: paymentIntent });

    if (receiver !== null) {
      return response.status(201).json({
        receiver,
      });
    } else {
      return response.status(201).json({
        ok: false,
        msg: "PaymentIntent does not have receivers assigned yet",
      });
    }
  } catch (error) {
    return response.status(501).json({
      ok: false,
      msg: error,
    });
  }
};

const checkingReceiversExistInDatabase = async (request, response) => {
  const { device } = request.body;

  try {
    const receiver = await Receivers.findOne({ device: device });

    //*if exist, modify state
    if (receiver) {
      return response.status(201).json({
        ok: true,
        receiver,
      });

      //*if it does not exist, add it as new
    } else {
      return response.status(201).json({
        ok: false,
        msg: "PaymentIntent does not have receivers assigned yet",
      });
    }
  } catch (error) {
    return response.status(501).json({
      ok: false,
      msg: error,
    });
  }
};

const udpateReceiverStatus = async (request, response) => {
  try {
    const result = await runGoWorker("update-receiver-status", request.body);
    return response.status(201).json({
      ok: true,
      id: result.id,
      user: result.user,
      paymentIntent: result.paymentIntent,
      device: result.device,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateBulkItemsInTransaction = async (request, response) => {
  try {
    await runGoWorker("update-bulk-items-transaction", request.body);
    return response.status(201).json({
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateBulkItemsInPool = async (request, response) => {
  try {
    await runGoWorker("update-bulk-items-pool", request.body);
    return response.status(201).json({
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const poolReceivers = async (request, response) => {
  try {
    const receiversPool = new ReceiversPool(request.body);
    await receiversPool.save();
    return response.status(201).json({
      ok: true,
      receiversPool,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: error,
    });
  }
};

const poolReceiversBulk = async (request, response) => {
  try {
    const result = await runGoWorker("pool-receivers-bulk", request.body);
    return response.status(201).json({
      ok: true,
      receiversPool: result,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: error,
    });
  }
};
const getListOfItemsInEventPool = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const params = request._parsedUrl.query;
    const eventID = new URLSearchParams(params).get("eventSelected");
    const companyID = new URLSearchParams(params).get("company");
    const cachedList = await cache_connection.get(
      `eventSelected=${eventID}&company=${companyID}`
    );
    if (cachedList && cachedList.length > 5) {
      return response.status(200).json({
        cached: true,
        ok: true,
        receiversInventory: cachedList, //JSON.parse(cachedList),
      });
    } else {
      const formatting = [...params.split("&")];
      let check = formatting.reduce(
        (a, v) => ({ ...a, [v.split("=")[0]]: v.split("=")[1] }),
        {}
      );
      if (check.eventSelected) {
        check.eventSelected = eventID;
      }
      const items = await ReceiversPool.find(check).sort({ device: 1 });
      cache_connection.set(
        `eventSelected=${eventID}&company=${companyID}`,
        JSON.stringify(items)
      );
      cache_connection.expire(
        `eventSelected=${eventID}&company=${companyID}`,
        120
      );
      return response.status(200).json({
        ok: true,
        cached: false,
        receiversInventory: JSON.stringify(items),
      });
    }
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: error,
    });
  }
};

const updatePoolReceivers = async (request, response) => {
  try {
    // Pass params.id into body or separate argument?
    // Go worker expects full JSON.
    // request.body usually doesn't have id if it's in params.
    // We should merge them.
    const payload = { ...request.body, id: request.params.id };
    const result = await runGoWorker("update-pool-receivers", payload);
    return response.status(201).json({
      ok: true,
      receiverUpdated: JSON.stringify(result.receiverUpdated),
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const receiverPoolList = async (request, response) => {
  try {
    const receiversInventory = await ReceiversPool.find(request.body).sort({
      device: 1,
    });
    return response.status(201).json({
      ok: true,
      receiversInventory: receiversInventory,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const receiverPoolFoundAndDelete = async (request, response) => {
  try {
    const payload = { id: request.params.id };
    const result = await runGoWorker("receiver-pool-found-delete", payload);
    return response.status(201).json({
      ok: true,
      deviceDeleted: result.deviceDeleted,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const receiverPoolBulkDelete = async (request, response) => {
  try {
    const result = await runGoWorker("receiver-pool-bulk-delete", request.body);
    return response.status(200).json({
      ok: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      debug: error,
    });
  }
};

const listOfAssignedReceiver = async (request, response) => {
  try {
    const listOfReceivers = await Receivers.find(request.body);
    return response.status(201).json({
      ok: true,
      listOfReceivers: listOfReceivers,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const listOfAssignedReceiverPlusUserInformation = async (request, response) => {
  try {
    const listOfReceivers = await Receivers.find(request.body);

    const userEmails = listOfReceivers.map((receiver) => receiver.user);
    const usersInfo = await User.find({ email: { $in: userEmails } });

    const receiversWithUserInfo = listOfReceivers.map((receiver) => {
      const userInfo = usersInfo.find((user) => user.email === receiver.user);
      return {
        ...receiver.toObject(),
        userInfo,
      };
    });

    return response.status(200).json({
      ok: true,
      listOfReceivers: receiversWithUserInfo,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Error fetching receiver information",
      error: error.message,
    });
  }
};

const trackReturnedReceiverWithIssue = async (request, response) => {
  try {
    const trackDevice = new ReceiverReturnedStatus(request.body);
    trackDevice.save();
    return response.status(201).json({
      ok: true,
      record: trackDevice,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.response,
    });
  }
};

const getListOfReceiverReturnedByIssue = async (request, response) => {
  try {
    const trackDevice = await ReceiverReturnedStatus.find(request.body);
    return response.status(201).json({
      ok: true,
      record: trackDevice,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.response,
    });
  }
};

const updateIssueDevice = async (request, response) => {
  try {
    const payload = { ...request.body, id: request.params.id };
    const receiverUpdated = await runGoWorker("update-issue-device", payload);
    return response.status(201).json({
      ok: true,
      receiverUpdated,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateBulkItemDataInPool = async (request, response) => {
  try {
    const result = await runGoWorker(
      "update-bulk-item-data-pool",
      request.body
    );
    return response.status(201).json({
      ok: true,
      message: `Total items updated successfully: ${result.modifiedCount}`,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Internal server error.",
      error: error.message,
    });
  }
};

const returnAllItemsInTransactionInPool = async (request, response) => {
  try {
    await runGoWorker("return-all-items-transaction-pool", request.body);
    return response.status(201).json({
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateBulkItemsInTransactionPerUserAtOnce = async (request, response) => {
  try {
    await runGoWorker("update-bulk-items-transaction-user", request.body);
    return response.status(201).json({
      ok: true,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const createBulkItemTransactionInUser = async (request, response) => {
  try {
    const result = await runGoWorker(
      "create-bulk-item-transaction",
      request.body
    );
    return response.status(201).json({
      ok: true,
      message: "Receivers created",
      receiversAssignedPerUser: result,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      message: "Please contact Administrator",
      err: error.message,
    });
  }
};

const removingItemFromTransaction = async (request, response) => {
  try {
    const transactionId = request.params.id;
    const foundItem = await Receivers.findByIdAndDelete(transactionId);
    return response.status(200).json({
      ok: true,
      msg: "Item removed from transaction",
      response: foundItem,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

module.exports = {
  addReceiverToTransaction,
  checkingReceiversAssigned,
  checkingReceiversExistInDatabase,
  createBulkItemTransactionInUser,
  getListOfItemsInEventPool,
  getListOfReceiverReturnedByIssue,
  listOfAssignedReceiver,
  listOfAssignedReceiverPlusUserInformation,
  poolReceivers,
  poolReceiversBulk,
  receiverPoolBulkDelete,
  receiverPoolFoundAndDelete,
  receiverPoolList,
  removingItemFromTransaction,
  returnAllItemsInTransactionInPool,
  trackReturnedReceiverWithIssue,
  udpateReceiverStatus,
  updateBulkItemDataInPool,
  updateBulkItemsInPool,
  updateBulkItemsInTransaction,
  updateBulkItemsInTransactionPerUserAtOnce,
  updateIssueDevice,
  updatePoolReceivers,
};
