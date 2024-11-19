const express = require("express");
const Event = require("../models/Event");
const { clientRedis } = require("../database/cacheMemoryConfig");

const createEvent = async (request, response = express.response) => {
  try {
    const cache_connection = await clientRedis();
    let event = new Event(request.body);
    await event.save();
    cache_connection.del(`company=${event.company}&type=${event.type}`);
    return response.status(201).json({
      ok: true,
      event,
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
  try {
    const cache_connection = await clientRedis();
    const eventId = request.params.id;
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
    cache_connection.del(
      `company=${eventStaffToEdit.company}&type=${eventStaffToEdit.type}`
    );
    return response.json({
      ok: true,
      event: staffEventEdited,
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
      event: subscriptionEventEdited,
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
      list,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const gettingEventListPerCompany = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const params = request._parsedUrl.query;
    const companyName = new URLSearchParams(params).get("company");
    const typeEvent = new URLSearchParams(params).get("type");
    const cachedEvents = await cache_connection.get(
      `company=${companyName}&type=${typeEvent}`
    );
    if (cachedEvents) {
      cache_connection.del(`company=${companyName}&type=${typeEvent}`);
      cache_connection.del(`company=${companyName}`);
      return response.status(201).json({
        cached: true,
        ok: true,
        list: JSON.parse(cachedEvents),
      });
    } else {
      let list = await Event.find({ company: companyName, type: typeEvent });
      cache_connection.set(
        `company=${companyName}&type=${typeEvent}`,
        JSON.stringify(list)
      );
      cache_connection.expire(`company=${companyName}&type=${typeEvent}`, 60);
      response.status(201).json({
        cached: false,
        ok: true,
        list,
      });
    }
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};
const searchStaffAllEvents = async (request, response) => {
  const { email } = request.body; // Extract email from request

  try {
    // Query to find all documents where email exists in adminUser or headsetAttendees
    const events = await Event.find({
      $or: [
        { "staff.adminUser.email": email }, // Search in adminUser email field
        { "staff.headsetAttendees.email": email }, // Search in headsetAttendees email field
      ],
    });

    // Return all events, including those that may not have the email
    response.status(200).json({ ok: true, events });
  } catch (error) {
    response.status(500).json({ ok: false, message: error.message });
  }
};
module.exports = {
  createEvent,
  editSubscriptionEvent,
  eventList,
  editEvent,
  searchStaffAllEvents,
  gettingEventListPerCompany,
};
