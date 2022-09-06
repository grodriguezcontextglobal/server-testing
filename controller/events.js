const { response } = require("express");
const Event = require("../models/Event");

const getEvents = async (request, response = response) => {
  const events = await Event.find().populate("user", "name"); //to bring more info of the event

  return response.json({
    ok: true,
    events,
  });
};

const createEvent = async (request, response = response) => {
  const event = new Event(request.body);
  console.log(request.body);

  try {
    event.user = request.uid;
    console.log("Event.user", event.user);

    const eventSaved = await event.save();
    console.log({eventSaved})

    return response.json({
      ok: true,
      msg: "Create event",
      event: eventSaved,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact administrater",
    });
  }
};

const editEvent = async (request, response = response) => {
  const eventId = request.params.id;
  const uid = request.uid;

  console.log(eventId);
  console.log(uid);

  try {
    const event = await Event.findById(eventId);
    console.log(event);

    if (!event) {
      return response.status(404).json({
        ok: false,
        msg: "Event/id do not match",
      });
    }

    if (event.user.toString() !== uid) {
      return response.status(401).json({
        ok: false,
        msg: "No auhorize to edit event",
      });
    }

    const newEvent = {
      ...request.body,
      user: uid,
    };

    const eventUpdated = await Event.findByIdAndUpdate(eventId, newEvent, {
      new: true,
    }); //3 parameters event id, new event and how it will be returned as new event

    return response.json({
      ok: true,
      event: eventUpdated,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

const deleteEvent = async (request, response = response) => {
  const eventId = request.params.id;
  const uid = request.uid;

  console.log(eventId);
  console.log(uid);

  try {
    const event = await Event.findById(eventId);
    console.log(event);

    if (!event) {
      return response.status(404).json({
        ok: false,
        msg: "Event/id do not match",
      });
    }

    if (event.user.toString() !== uid) {
      return response.status(401).json({
        ok: false,
        msg: "No auhorize to edit event",
      });
    }

    const eventDeleted = await Event.findByIdAndDelete(eventId);

    return response.json({
      ok: true,
      eventDeleted,
    });
  } catch (error) {
    console.log(error);
    msg: "Please contact administrator";
  }
};

module.exports = {
  getEvents,
  createEvent,
  editEvent,
  deleteEvent,
};
