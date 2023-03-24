const express = require("express");
const Event = require("../models/Event");


const createEvent = async (request, response = express.response) => {
    try {
        let event = new Event(request.body);
        await event.save();
        return response.status(201).json({
            ok: true,
           event
        });
    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: "Please contact Administrater",
        });
    }
};

const editEvent = async (request, response = response) => {
    const adminUserId = request.params.id;
    try {
        const adminUser = await AdminUser.findById(adminUserId);
        if (!adminUser) {
            return response.status(404).json({
                ok: false,
                msg: "Admin user/id do not match",
            });
        }
        const adminUserEdited = {
            ...request.body,
        };
        //generate JWT
        const token = await generateJWT(adminUserId, adminUser.name);
        const adminUserUpdated = await AdminUser.findByIdAndUpdate(
            adminUserId,
            adminUserEdited,
            {
                new: true,
            }
        );
        return response.json({
            msg: "admin user updated",
            ok: true,
            uid: adminUserUpdated.id,
            name: adminUserUpdated.name,
            email: adminUserUpdated.email,
            phone: adminUserUpdated.phone,
            role: adminUserUpdated.role,
            token,
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({
            ok: false,
            msg: "Contact Administrator",
        });
    }
};

const deleteEvent = async (request, response) => {
    try {
        const adminUserId = await request.params.id;
        const adminUser = await AdminUser.findByIdAndDelete(adminUserId);
        if (!adminUser) {
            return response.status(404).json({
                ok: false,
                msg: "Admin user/id do not match",
            });
        }
        response.status(201).json({
            ok: true,
            adminUser,
            msg: "admin user deleted",
        });
    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: error,
        });
    }
};

const eventList = async(request, response) => {
    try {
        let list = await Event.find();
        response.status(201).json({
            ok: true,
            list
        })
    } catch (error) {
        console.log("🚀 ~ file: event.js:91 ~ eventList ~ error:", error)
        response.status(500).json({
            ok:false,
            msg:"Please contact Administrator"
        })
    }
}
module.exports = {
createEvent,
eventList
};
