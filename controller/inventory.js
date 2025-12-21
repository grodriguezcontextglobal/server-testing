const express = require("express");
const Inventory = require("../models/Inventory");
const logger = require("../helpers/logger");
const { logStaffActivity } = require("./staffActivityLog");

const createInventory = async (request, response = express.response) => {
  try {
    let item = new Inventory(request.body);
    await item.save();

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: item.company,
      action: "CREATE",
      target_model: "Inventory",
      target_id: item.id,
      details: { batch: item.batch, event: item.event },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.status(201).json({
      ok: true,
      savedItem: item,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const editInventory = async (request, response = response) => {
  const itemId = request.params.id;
  try {
    const itemFound = await Inventory.findById(itemId);
    if (!itemFound) {
      return response.status(404).json({
        ok: false,
        msg: "Item does not exist",
      });
    }
    const itemNewInfoToEdit = {
      ...request.body,
    };

    const staffEventEdited = await Inventory.findByIdAndUpdate(
      itemId,
      itemNewInfoToEdit,
      {
        new: true,
      }
    );

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: staffEventEdited.company,
      action: "UPDATE",
      target_model: "Inventory",
      target_id: staffEventEdited.id,
      details: { updates: request.body },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.json({
      ok: true,
      itemUpdated: staffEventEdited,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

const deleteInventory = async (request, response) => {
  try {
    const itemId = request.params.id;
    const itemToDelete = await Inventory.findByIdAndDelete(itemId);
    if (!itemToDelete) {
      return response.status(404).json({
        ok: false,
        msg: "Item does not exist.",
      });
    }

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: itemToDelete.company,
      action: "DELETE",
      target_model: "Inventory",
      target_id: itemToDelete.id,
      details: { batch: itemToDelete.batch },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.status(201).json({
      ok: true,
      itemDeleted: itemToDelete,
      msg: "Item deleted",
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const listOfInventories = async (request, response) => {
  try {
    let items = await Inventory.find();
    return response.status(201).json({
      ok: true,
      listOfItems: items,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

module.exports = {
  createInventory,
  editInventory,
  deleteInventory,
  listOfInventories,
};
