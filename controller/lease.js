const express = require("express");
const Lease = require("../models/Lease");
const logger = require("../helpers/logger");

const createLease = async (request, response = express.response) => {
  try {
    let lease = new Lease(request.body);
    await lease.save();
    return response.status(201).json({
      ok: true,
      lease,
    });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const editLease = async (request, response = response) => {
  const leaseId = request.params.id;
  try {
    const leaseToFind = await Lease.findById(leaseId);
    if (!leaseToFind) {
      return response.status(404).json({
        ok: false,
        msg: "Lease does not exist",
      });
    }
    const LeaseInfoToEdit = {
      ...request.body,
    };

    const editedLeaseInfo = await Event.findByIdAndUpdate(
      leaseId,
      LeaseInfoToEdit,
      {
        new: true,
      }
    );
    return response.json({
      ok: true,
      event: editedLeaseInfo,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

const deleteLease = async (request, response) => {
  try {
    const leaseId = await request.params.id;
    const lease = await Lease.findByIdAndDelete(leaseId);
    if (!lease) {
      return response.status(404).json({
        ok: false,
        msg: "Lease id does not match",
      });
    }

    response.status(201).json({
      ok: true,
      adminUser,
      msg: "Lease deleted",
    });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const leaseList = async (request, response) => {
  try {
    let list = await Lease.find(request.body);
    response.status(201).json({
      ok: true,
      list,
    });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};
module.exports = {
  createLease,
  editLease,
  deleteLease,
  leaseList,
};
