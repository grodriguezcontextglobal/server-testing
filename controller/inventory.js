const express = require("express");
const Inventory = require("../models/Inventory");


const createInventory = async (request, response = express.response) => {
    try {
        let item = new Inventory(request.body);
        await item.save();
        return response.status(201).json({
            ok: true,
            savedItem: item
        });
    } catch (error) {
        console.log(error);
        response.status(500).json({
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
        return response.json({
            ok: true,
            itemUpdated: staffEventEdited
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({
            ok: false,
            msg: "Contact Administrator",
        });
    }
};

const deleteInventory = async (request, response) => {
    try {
        const itemId = await request.params.id;
        const itemToDelete = await Inventory.findByIdAndDelete(itemId);
        if (!itemToDelete) {
            return response.status(404).json({
                ok: false,
                msg: "Item does not exist.",
            });
        }
        response.status(201).json({
            ok: true,
            itemDeleted: itemToDelete,
            msg: "Item deleted",
        });
    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: error,
        });
    }
};

const listOfInventories = async (request, response) => {
    try {
        let items = await Inventory.find();
        response.status(201).json({
            ok: true,
            listOfItems: items
        })
    } catch (error) {
        console.log(error)
        response.status(500).json({
            ok: false,
            msg: "Please contact Administrator"
        })
    }
}
module.exports = {
    createInventory, editInventory, deleteInventory, listOfInventories
};
