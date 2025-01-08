const express = require("express");
const Event = require("../models/Event");
const { clientRedis } = require("../database/cacheMemoryConfig");
const AdminUser = require("../models/AdminUser");

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
    return response.status(500).json({
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
    cache_connection.del(`event_staff_info=${eventStaffToEdit.id}`);
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
    const adminUserId = request.params.id;
    const adminUser = await AdminUser.findByIdAndDelete(adminUserId);
    if (!adminUser) {
      return response.status(404).json({
        ok: false,
        msg: "Admin user/id do not match",
      });
    }

    return response.status(201).json({
      ok: true,
      adminUser,
      msg: "admin user deleted",
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const eventList = async (request, response) => {
  try {
    let list = await Event.find(request.body);
    return response.status(201).json({
      ok: true,
      list,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
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
      cache_connection.expire(`company=${companyName}&type=${typeEvent}`, 180);
      return response.status(201).json({
        cached: false,
        ok: true,
        list,
      });
    }
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};

const searchStaffAllEvents = async (request, response) => {
  const { email } = request.body;

  try {
    const events = await Event.find({
      $or: [
        { "staff.adminUser.email": email },
        { "staff.headsetAttendees.email": email },
      ],
    });

    return response.status(200).json({ ok: true, events });
  } catch (error) {
    return response.status(500).json({ ok: false, message: error.message });
  }
};

const eventStaffDetailInfo = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const eventId = request.params.id;
    const cachedEventStaffInfo = await cache_connection.get(
      `event_staff_info=${eventId}`
    );
    if (cachedEventStaffInfo) {
      cache_connection.del(`event_staff_info=${eventId}`);
      return response.status(201).json({
        ok: true,
        cached: true,
        staff: cachedEventStaffInfo,
      });
    }
    const eventInfo = await Event.findById(eventId);
    const staffEventInfo = [
      ...eventInfo.staff.adminUser,
      ...eventInfo.staff.headsetAttendees,
    ];
    const result = [];
    for (const staff of staffEventInfo) {
      const extraInfo = await AdminUser.findOne({ email: staff.email });
      if (extraInfo) {
        result.push({
          staff,
          photo: extraInfo.imageProfile,
          phone: extraInfo.phone,
          admin_id: extraInfo.id,
        });
      } else {
        result.push({
          staff,
          photo: null,
          phone: "",
          admin_id: null,
        });
      }
    }
    cache_connection.set(`event_staff_info=${eventId}`, JSON.stringify(result));
    cache_connection.expire(`event_staff_info=${eventId}`, 180);
    return response.status(201).json({
      ok: true,
      staff: JSON.stringify(result),
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      error,
    });
  }
};

module.exports = {
  createEvent,
  editSubscriptionEvent,
  eventList,
  editEvent,
  searchStaffAllEvents,
  gettingEventListPerCompany,
  eventStaffDetailInfo,
};
