const { response } = require("express");
const { Error } = require("mongoose");
const Receivers = require("../models/Receivers");
const ReceiversPool = require("../models/ReceiversPool");

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
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrater",
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
    response.status(501).json({
      ok: false,
      msg: error,
    });
  }
};
//!function to check if device exist in database and if it exists, modify state instad of add it as new
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
    response.status(501).json({
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
      msg: Error,
    });
  }
};
const poolReceivers = async (request, response) => {
  try {
    const receiversPool = new ReceiversPool(request.body);
    console.log("🚀 ~ file: receiver.js ~ line 120 ~ poolReceivers ~ receiversPool", receiversPool)
    await receiversPool.save();
    return response.status(201).json({
      ok: true,
      device: receiversPool.device,
      status: receiversPool.status,
      activity: receiversPool.activity,
      comment: receiversPool.comment,
      id: receiversPool._id,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrater",
    });
  }
};
const updatePoolReceivers = async (request, response) => {
  const { device, status, activity, comment } = request.body;
  console.log("request", request.body);
  try {
    const receiverAssigned = await ReceiversPool.findById(request.params.id);
    console.log(
      "🚀 ~ file: receiver.js ~ line 120 ~ updatePoolReceivers ~ receiverAssigned",
      receiverAssigned
    );
    if (!receiverAssigned) {
      return response.status(404).json({
        ok: false,
        msg: "Receiver ID do not match",
      });
    }
    const receiverEdited = {
      device,
      status,
      activity,
      comment,
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

const receiverPoolList = async (request, response) => {
  try {
    const receiversInventory = await ReceiversPool.find();
    response.status(201).json({
      ok: true,
      receiversInventory,
    });
  } catch (error) {
    console.log(
      "🚀 ~ file: receiver.js ~ line 156 ~ receiverPoolList ~ error",
      error
    );
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const listOfAssignedReceiver = async (request, response) => {
  try {
    const listOfReceivers = await Receivers.find();
    response.status(201).json({
      ok: true,
      listOfReceivers,
    });
  } catch (error) {
    console.log(
      "🚀 ~ file: receiver.js ~ line 205 ~ listOfAssignedReceiver ~ error",
      error
    );

    response.status(500).json({
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
  updatePoolReceivers,
  receiverPoolList,
  listOfAssignedReceiver
};
