const { response, request } = require("express");
const ReceiverReturnedStatus = require("../models/ReceiverReturnedStatus");
const Receivers = require("../models/Receivers");
const ReceiversPool = require("../models/ReceiversPool");
const User = require("../models/User");
const { clientRedis } = require("../database/cacheMemoryConfig");

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
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
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
    console.log(error);
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
    console.log(error);
    return response.status(501).json({
      ok: false,
      msg: error,
    });
  }
};

const udpateReceiverStatus = async (request, response) => {
  const { id, device } = request.body;
  try {
    const receiverAssigned = await Receivers.findById(id);
    if (!receiverAssigned) {
      return response.status(404).json({
        ok: false,
        msg: "Receiver ID do not match",
      });
    }
    const receiverEdited = {
      device,
    };
    const receiverUpdated = await Receivers.findByIdAndUpdate(
      receiverAssigned,
      receiverEdited,
      {
        new: true,
      }
    );

    return response.status(201).json({
      ok: true,
      id: receiverUpdated.id,
      user: receiverUpdated.user,
      paymentIntent: receiverUpdated.paymentIntent,
      device: receiverUpdated.device,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateBulkItemsInTransaction = async (request, response) => {
  const { timeStamp, device } = request.body;
  try {
    for (let item of device) {
      await Receivers.findByIdAndUpdate(
        item.key,
        {
          "device.status": false,
          timeStamp: timeStamp,
        },
        {
          new: true,
        }
      );
    }
    return response.status(201).json({
      ok: true,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateBulkItemsInPool = async (request, response) => {
  const { device, company, activity, eventSelected } = request.body;
  try {
    const cache_connection = await clientRedis();
    for (let item of device) {
      await ReceiversPool.findOneAndUpdate(
        {
          company,
          activity: !activity,
          eventSelected: eventSelected,
          type: item.deviceType ?? item.type,
          device: item.serialNumber ?? item.device,
        },
        {
          activity,
        },
        {
          new: true,
        }
      );
    }
    return response.status(201).json({
      ok: true,
    });
  } catch (error) {
    console.log(error);
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
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const poolReceiversBulk = async (request, response) => {
  try {
    const {
      deviceList,
      status,
      activity,
      comment,
      eventSelected,
      provider,
      type,
      company,
    } = request.body;
    const list = JSON.parse(deviceList);
    const receiversPoolData = list.map((item) => ({
      device: item.serial_number,
      status,
      activity,
      comment,
      eventSelected,
      provider,
      type,
      company,
    }));

    const savedItems = await ReceiversPool.insertMany(receiversPoolData);

    return response.status(201).json({
      ok: true,
      receiversPool: savedItems,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
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
      const items = await ReceiversPool.find(check);
      cache_connection.set(
        `eventSelected=${eventID}&company=${companyID}`,
        JSON.stringify(items)
      );
      cache_connection.expire(
        `eventSelected=${eventID}&company=${companyID}`,
        180
      );
      return response.status(200).json({
        ok: true,
        cached: false,
        receiversInventory: JSON.stringify(items),
      });
    }
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const updatePoolReceivers = async (request, response) => {
  try {
    const receiverAssigned = await ReceiversPool.findById(request.params.id);
    if (!receiverAssigned) {
      return response.status(404).json({
        ok: false,
        msg: "Receiver ID do not match",
      });
    }
    const receiverEdited = {
      ...request.body,
    };
    const receiverUpdated = await ReceiversPool.findByIdAndUpdate(
      request.params.id,
      receiverEdited,
      {
        new: true,
      }
    );
    return response.status(201).json({
      ok: true,
      receiverUpdated: JSON.stringify(receiverUpdated),
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const receiverPoolList = async (request, response) => {
  try {
    const receiversInventory = await ReceiversPool.find(request.body);
    return response.status(201).json({
      ok: true,
      receiversInventory: receiversInventory,
    });
  } catch (error) {
    console.log(
      "🚀 ~ file: receiver.js ~ line 156 ~ receiverPoolList ~ error",
      error
    );
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const receiverPoolFoundAndDelete = async (request, response) => {
  try {
    const deviceDeleted = await ReceiversPool.findByIdAndDelete({
      _id: request.params.id,
    });
    return response.status(201).json({
      ok: true,
      deviceDeleted,
    });
  } catch (error) {
    console.log(
      "🚀 ~ file: receiver.js ~ line 156 ~ receiverPoolList ~ error",
      error
    );
    return response.status(500).json({
      ok: false,
      msg: error,
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
    console.log(
      "🚀 ~ file: receiver.js ~ line 205 ~ listOfAssignedReceiver ~ error",
      error
    );
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
    console.log(error);
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
    console.log(error);
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
    const receiver = await ReceiverReturnedStatus.findById(request.params.id);
    if (!receiver) {
      return response.status(404).json({
        ok: false,
        msg: "Receiver ID do not match",
      });
    }
    const updateIssueReceiver = {
      ...request.body,
    };
    const receiverUpdated = await ReceiverReturnedStatus.findByIdAndUpdate(
      request.params.id,
      updateIssueReceiver,
      {
        new: true,
      }
    );
    return response.status(201).json({
      ok: true,
      receiverUpdated,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const updateBulkItemDataInPool = async (request, response) => {
  try {
    const { startingSerialNumber, deviceData, qty } = request.body;
    const devices = JSON.parse(deviceData);
    const dataIndex = devices.findIndex(
      (item) => item.device === startingSerialNumber
    );
    if (dataIndex === -1) {
      return response.status(400).json({
        ok: false,
        msg: "Starting serial number not found in device data.",
      });
    }
    const data = devices.slice(dataIndex, dataIndex + Number(qty));

    const dataPoolItems = await ReceiversPool.find({
      company: data[0].company,
      activity: false,
      eventSelected: data[0].eventSelected,
      type: data[0].type,
      device: { $in: data.map((item) => item.device) },
    });

    const updateData = dataPoolItems.map((item) => {
      return {
        id: `${item._id}`,
        type: item.type,
        device: item.device,
        status: request.body.status,
        activity: request.body.activity,
        provider: item.provider,
        eventSelected: item.eventSelected,
        company: item.company,
        comment: request.body.comment,
      };
    });

    const bulkOperations = updateData.map((item) => ({
      updateOne: {
        filter: { _id: item.id },
        update: {
          $set: {
            status: item.status,
            activity: true,
            comment: item.comment,
          },
        },
      },
    }));

    const result = await ReceiversPool.bulkWrite(bulkOperations);
    return response.status(201).json({
      ok: true,
      msg: `Total items updated successfully: ${result.modifiedCount}`,
      totalAssigned: result.modifiedCount,
    });
  } catch (error) {
    console.error("updateBulkItemDataInPool error:", error);
    return response.status(500).json({
      ok: false,
      msg: "Internal server error.",
      error: error.message,
    });
  }
};

const returnAllItemsInTransactionInPool = async (request, response) => {
  const { device, company, activity, eventSelected } = request.body;
  try {
    for (let item of device) {
      await ReceiversPool.findOneAndUpdate(
        {
          company,
          activity: !activity,
          eventSelected: eventSelected,
          type: item.device.deviceType,
          device: item.device.serialNumber ?? item.device,
        },
        {
          activity,
        },
        {
          new: true,
        }
      );
    }

    return response.status(201).json({
      ok: true,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateBulkItemsInTransactionPerUserAtOnce = async (request, response) => {
  const { timeStamp, device } = request.body;
  try {
    for (let item of device) {
      await Receivers.findByIdAndUpdate(
        item.id,
        {
          "device.status": false,
          timeStamp: timeStamp,
        },
        {
          new: true,
        }
      );
    }
    return response.status(201).json({
      ok: true,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const createBulkItemTransactionInUser = async (request, response) => {
  try {
    const {
      serialNumbers,
      deviceType,
      status,
      paymentIntent,
      company,
      user,
      eventSelected,
      provider,
      event_id,
      timestamp,
    } = request.body;
    const data = JSON.parse(serialNumbers);
    const template = data.map((item) => {
      return {
        paymentIntent,
        device: {
          deviceType,
          serialNumber: item.device,
          status,
        },
        company,
        user,
        eventSelected,
        provider,
        timeStamp: timestamp,
        event_id,
      };
    });
    const bulkInsertedData = await Receivers.insertMany(template);
    return response.status(201).json({
      ok: true,
      msg: `Items assigned successfully. Total items: ${bulkInsertedData.length}`,
      data: bulkInsertedData,
      device: bulkInsertedData.map((item) => item.device),
      paymentIntent: paymentIntent,
      receiversAssignedPerUser: bulkInsertedData,
      date: new Date(),
    });
  } catch (error) {
    console.log("createBulkItemTransactionInUser", error);
    return response.status(500).json({
      ok: false,
      msg: error,
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
    console.log("removingItemFromTransaction", error);
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
  udpateReceiverStatus,
  poolReceivers,
  getListOfItemsInEventPool,
  updatePoolReceivers,
  receiverPoolList,
  listOfAssignedReceiver,
  trackReturnedReceiverWithIssue,
  getListOfReceiverReturnedByIssue,
  updateIssueDevice,
  listOfAssignedReceiverPlusUserInformation,
  receiverPoolFoundAndDelete,
  updateBulkItemsInTransaction,
  updateBulkItemsInPool,
  poolReceiversBulk,
  updateBulkItemDataInPool,
  createBulkItemTransactionInUser,
  removingItemFromTransaction,
  returnAllItemsInTransactionInPool,
  updateBulkItemsInTransactionPerUserAtOnce,
};
