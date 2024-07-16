const { response } = require("express");
const ReceiverReturnedStatus = require("../models/ReceiverReturnedStatus");
const Receivers = require("../models/Receivers");
const ReceiversPool = require("../models/ReceiversPool");
const User = require("../models/User");

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
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrater",
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
    const receiversInventory = await ReceiversPool.find(request.body);
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

const receiverPoolFoundAndDelete = async (request, response) => {
  try {
    const deviceDeleted = await ReceiversPool.findByIdAndDelete({
      _id: request.params.id,
    });
    response.status(201).json({
      ok: true,
      deviceDeleted,
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
    const listOfReceivers = await Receivers.find(request.body);
    await response.status(201).json({
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
const listOfAssignedReceiverPlusUserInformation = async (request, response) => {
  try {
    const listOfReceivers = await Receivers.find(request.body);

    // Extract user emails from the list of receivers
    const userEmails = listOfReceivers.map((receiver) => receiver.user);

    // Query the users collection to populate user information
    const usersInfo = await User.find({ email: { $in: userEmails } });

    // Merge user information into the list of receivers
    const receiversWithUserInfo = listOfReceivers.map((receiver) => {
      const userInfo = usersInfo.find((user) => user.email === receiver.user);
      return {
        ...receiver.toObject(),
        userInfo, // Add user information to each receiver object
      };
    });

    response.status(200).json({
      ok: true,
      listOfReceivers: receiversWithUserInfo,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
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
    response.status(201).json({
      ok: true,
      record: trackDevice,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error.response,
    });
  }
};

const getListOfReceiverReturnedByIssue = async (request, response) => {
  try {
    const trackDevice = await ReceiverReturnedStatus.find(request.body);
    response.status(201).json({
      ok: true,
      record: trackDevice,
    });
  } catch (error) {
    response.status(500).json({
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

module.exports = {
  addReceiverToTransaction,
  checkingReceiversAssigned,
  checkingReceiversExistInDatabase,
  udpateReceiverStatus,
  poolReceivers,
  updatePoolReceivers,
  receiverPoolList,
  listOfAssignedReceiver,
  trackReturnedReceiverWithIssue,
  getListOfReceiverReturnedByIssue,
  updateIssueDevice,
  listOfAssignedReceiverPlusUserInformation,
  receiverPoolFoundAndDelete,
};
