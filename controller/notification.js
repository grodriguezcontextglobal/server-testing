const { response } = require("express");
const { default: mongoose } = require("mongoose");
const Notification = require("../models/Notification")
require("dotenv").config();

const newMessage = async ( request, response) => {
    try {
        const message = new Notification(request.body)
        await message.save()
        response.status(201).json({
            ok: true,
            msg: "Notifiation was created"
        })
    } catch (error) {
        console.log("🚀 ~ file: notification.js:9 ~ newMessage ~ error", error)
        response.status(500).json({
            ok: false,
            msg: error.response
        })
    }
}

const listOfMessages = async ( request, response) => {
    try {
        const message = await Notification.find()
        response.status(201).json({
            ok: true,
            message: message
        })
    } catch (error) {
        console.log("🚀 ~ file: notification.js:9 ~ newMessage ~ error", error)
        response.status(500).json({
            ok: false,
            msg: error.response
        })
    }
}

module.exports = {
    newMessage,
    listOfMessages,
};
