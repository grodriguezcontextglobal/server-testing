const express = require("express");
const Item = require("../models/Item");
const logger = require("../helpers/logger");

const createItem = async (request, response = express.response) => {
  try {
    let item = new Item(request.body);
    await item.save();
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

const editItem = async (request, response = response) => {
  const itemId = request.params.id;
  try {
    const itemFound = await Item.findById(itemId);
    if (!itemFound) {
      return response.status(404).json({
        ok: false,
        msg: "Item does not exist",
      });
    }
    const itemNewInfoToEdit = {
      ...request.body,
    };

    const staffEventEdited = await Item.findByIdAndUpdate(
      itemId,
      itemNewInfoToEdit,
      {
        new: true,
      }
    );
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

const deleteItem = async (request, response) => {
  try {
    const itemId = request.params.id;
    const itemToDelete = await Item.findByIdAndDelete(itemId);
    if (!itemToDelete) {
      return response.status(404).json({
        ok: false,
        msg: "Item does not exist.",
      });
    }
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

const listOfItems = async (request, response) => {
  try {
    let items = await Item.find(request.body);
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
  createItem,
  editItem,
  deleteItem,
  listOfItems,
};
