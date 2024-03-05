const express = require("express");
const Image = require("../models/Image");
const storingImage = async (request, response = express.response) => {
    try {
        let item = new Image(request.body);
        await item.save();
        return response.status(201).json({
            ok: true,
            image: item
        });
    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: "Please contact Administrator",
        });
    }
};

const retrieveImage = async (request, response) => {
    try {
        let item = await Image.find(request.body)
        if (!item) return response.status(500).json({ ok: true, msg: "Item does not exist in our record." })
        return response.status(201).json({
            ok: true,
            item
        })
    } catch (error) {
        console.log("🚀 ~ retrieveImage ~ error:", error)
        response.status(500).json({
            ok: false,
            msg: error.message
        })
    }
}
module.exports = {
    storingImage,
    retrieveImage,
};
