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
            msg: "Please contact Administrator",
        });
    }
};

const editEvent = async (request, response = response) => {
    const eventId = request.params.id;
    try {
        const eventToFind = await Event.findById(eventId);
        if (!eventToFind) {
            return response.status(404).json({
                ok: false,
                msg: "Event does not exist",
            });
        }
        const eventStaffToEdit = {
            ...request.body,
        };

        const staffEventEdited = await Event.findByIdAndUpdate(
            eventId,
            eventStaffToEdit,
            {
                new: true,
            }
        );
        return response.json({
            ok: true,
            event: staffEventEdited
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({
            ok: false,
            msg: "Contact Administrator",
        });
    }
};

const editSubscriptionEvent = async (request, response = response) => {
    const eventId = request.params.id;
    try {
        const eventToFind = await Event.findById(eventId);
        if (!eventToFind) {
            return response.status(404).json({
                ok: false,
                msg: "Event does not exist",
            });
        }
        const subscriptionEventInfoToEdit = {
            ...request.body,
        };
        //generate JWT

        const subscriptionEventEdited = await Event.findByIdAndUpdate(
            eventId,
            subscriptionEventInfoToEdit,
            {
                new: true,
            }
        );
        return response.json({
            ok: true,
            event: subscriptionEventEdited
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

const eventList = async (request, response) => {
    try {
        let list = await Event.find(request.body);
        response.status(201).json({
            ok: true,
            list
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
    createEvent,
    editSubscriptionEvent,
    eventList,
    editEvent
};
