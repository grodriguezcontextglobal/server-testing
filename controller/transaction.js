const { response, json } = require("express");
const { default: mongoose } = require("mongoose");
const Transaction = require("../models/Transaction");
require("dotenv").config();

const saveTransaction = async (request, response) => {
    const transaction = new Transaction(request.body);
    try {
        const transactionSaved = await transaction.save();
        response.status(201).json({
            ok: true,
            msg: "Transaction saved",
            transaction: transactionSaved,
        });
    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: "Please contact adminitrator",
        });
    }
};


const saveTransactionAdmin = async (request, response) => {
    const transaction = new Transaction(request.body);
    try {
        const transactionSaved = await transaction.save();
        response.status(201).json({
            ok: true,
            msg: "Transaction saved",
            transaction: transactionSaved,
        });
    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: "Please contact adminitrator",
        });
    }
};

const saveTransactionTemplateForNoRegularUser = async (
    request,
    response
) => {
    const Transaction = new Transaction(request.body);
    try {
        const TransactionSaved = await Transaction.save();
        response.status(201).json({
            ok: true,
            msg: "Transaction saved",
            Transaction: TransactionSaved,
        });
    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: "Please contact adminitrator",
        });
    }
};

const updateTransaction = async (request, response) => {
    // const { id, active } = request.body;
    try {
        const id = request.params.id
        const transaction = await Transaction.findById(id);
        if (!transaction) {
            return response.status(404).json({
                ok: false,
                msg: "Transaction does not match to our records.",
            });
        }
        const transactionEdited = {
            ...request.body
        };
        const updatedTransaction = await Transaction.findByIdAndUpdate(
            transaction,
            transactionEdited,
            {
                new: true,
            }
        );
        return response.status(201).json({
            ok: true,
            transaction: updatedTransaction
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({
            ok: false,
            msg: error.message,
        });
    }
};

const getListOfAllSavedTransaction = async (request, response) => {
    try {
        const listOfTransactionsSaved = await Transaction.find(request.body)
        response.status(201).json({
            ok: true,
            list: listOfTransactionsSaved
        })
    } catch (error) {
        console.log("🚀 ~ file: .js:343 ~ getListOfAllSavedTransaction ~ error:", error)
        response.status(500).json({
            ok: false,
            msg: error
        })
    }
}

const removeDuplicateEntry = async (request, response) => {
    try {
        const duplicateEnrty = await Transaction.findByIdAndDelete(request.params.id);
        if (duplicateEnrty) {
            response.status(201).json({
                ok: true,
                msg: `duplicate entry id ${request.params.id} removed from transaction document`,
            });
        }
    } catch (error) {
        console.log(
            "🚀 ~ file: stripe.js ~ line 159 ~ removeDuplicateEntries ~ error",
            error
        );
        response.status(500).json({
            ok: false,
            msg: error,
        });
    }
};

module.exports = {
    saveTransaction,
    saveTransactionAdmin,
    saveTransactionTemplateForNoRegularUser,
    getListOfAllSavedTransaction,
    removeDuplicateEntry,
    updateTransaction,
};