const express = require("express");
const Event = require("../models/Event");
const { clientRedis } = require("../database/cacheMemoryConfig");
const AdminUser = require("../models/AdminUser");
const moment = require("moment");
const getConnection = require("../mysql/database/config");
const ReceiversPool = require("../models/ReceiversPool");
const logger = require("../helpers/logger");
const { logStaffActivity } = require("./staffActivityLog");
const _ = require("lodash");
const createEvent = async (request, response = express.response) => {
  try {
    const cache_connection = await clientRedis();
    let event = new Event(request.body);
    await event.save();

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: event.company_id,
      action: "CREATE",
      target_model: "Event",
      target_id: event.id,
      details: { name: event.eventName, type: event.type },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    cache_connection.del(`company=${event.company}&type=${event.type}`);
    return response.status(201).json({
      ok: true,
      event,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
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
      },
    );

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: staffEventEdited.company_id,
      action: "UPDATE",
      target_model: "Event",
      target_id: staffEventEdited.id,
      details: { updates: request.body },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    cache_connection.del(
      `company=${eventStaffToEdit.company}&type=${eventStaffToEdit.type}`,
    );
    cache_connection.del(`event_staff_info=${eventStaffToEdit.id}`);
    return response.json({
      ok: true,
      event: staffEventEdited,
    });
  } catch (error) {
    logger.error(error);
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
      },
    );

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: subscriptionEventEdited.company_id,
      action: "UPDATE",
      target_model: "Event",
      target_id: subscriptionEventEdited.id,
      details: { updates: request.body },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.json({
      ok: true,
      event: subscriptionEventEdited,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

const deleteEvent = async (request, response) => {
  try {
    const eventId = request.params.id;
    const event = await Event.findByIdAndDelete(eventId);
    if (!event) {
      return response.status(404).json({
        ok: false,
        msg: "Event does not exist",
      });
    }

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: event.company_id,
      action: "DELETE",
      target_model: "Event",
      target_id: event.id,
      details: { name: event.eventName },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.status(201).json({
      ok: true,
      event,
      msg: "event deleted",
    });
  } catch (error) {
    logger.error(error);
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
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      error: JSON.stringify(error),
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
      `company=${companyName}&type=${typeEvent}`,
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
        JSON.stringify(list),
      );
      cache_connection.expire(`company=${companyName}&type=${typeEvent}`, 180);
      return response.status(201).json({
        cached: false,
        ok: true,
        list,
      });
    }
  } catch (error) {
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
      `event_staff_info=${eventId}`,
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

const filterEventsByDate = (referenceDateStr, events) => {
  // Set reference date
  const referenceDate = moment(referenceDateStr, "YYYY-MM-DD").startOf("day");

  // Define conditions
  const threeDaysBefore = referenceDate
    .clone()
    .subtract(3, "days")
    .endOf("day")
    .valueOf();
  const oneDayBefore = referenceDate
    .clone()
    .subtract(1, "days")
    .endOf("day")
    .valueOf();
  const refStart = referenceDate.valueOf();
  const refEnd = referenceDate.clone().endOf("day").valueOf();

  // Process events
  return events
    .map((event) => {
      const {
        event: eventName,
        startTime,
        endTime,
        inventory,
        eventId,
        companyId,
      } = event;
      let status = "";

      if (endTime >= threeDaysBefore && endTime < oneDayBefore) {
        status = "Ended 3 days before the reference date";
      } else if (startTime <= refEnd && endTime >= refStart) {
        status = "Ongoing during the reference date";
      } else if (endTime >= oneDayBefore && endTime < refStart) {
        status = "Ended 1 day before the reference date";
      }

      return status
        ? { eventName, status, inventory, eventId, companyId }
        : null;
    })
    .filter(Boolean); // Remove null values
};

const returnSerialNumberUsedInEvent = async (props) => {
  const result = new Set();
  let collection = [];
  for (let data of props) {
    const deviceInfo = await ReceiversPool.find(
      {
        company: data.companyId,
        eventSelected: data.eventName,
      },
      { device: 1 },
    ).lean();
    if (deviceInfo.length > 0) {
      deviceInfo.forEach((device) => result.add(device.device));
    }
  }
  collection = [...collection, ...Array.from(result)];
  return collection;
};

const returnItemsInfoInUsedInEvents = async ({
  serialNumbers,
  companySqlId,
  dateRef2,
}) => {
  const connection = getConnection();
  const cache_connection = await clientRedis();
  const cachedData = await cache_connection.get(
    `inventory_search_by_date_for_company=${dateRef2}_${companySqlId}_${serialNumbers}`,
  );
  if (cachedData) {
    return JSON.parse(cachedData);
  }
  if (serialNumbers.length === 0) {
    const query = `SELECT * FROM item_inv WHERE company_id = ?`;
    try {
      const [result] = await connection
        .promise()
        .execute(query, [companySqlId]);
      cache_connection.set(
        `inventory_search_by_date_for_company=${dateRef2}_${companySqlId}_${serialNumbers}`,
        JSON.stringify(result),
      );
      cache_connection.expire(
        `inventory_search_by_date_for_company=${dateRef2}_${companySqlId}_${serialNumbers}`,
        60,
      );
      return result;
    } catch (error) {
      return [];
    }
  } else {
    const placeholders = serialNumbers.map(() => "?").join(", "); // Create dynamic placeholders
    const query = `SELECT * FROM item_inv WHERE company_id = ? AND serial_number NOT IN (${placeholders})`;
    try {
      const [result] = await connection
        .promise()
        .execute(query, [companySqlId, ...serialNumbers]);
      cache_connection.set(
        `inventory_search_by_date_for_company=${dateRef2}_${companySqlId}_${serialNumbers}`,
        JSON.stringify(result),
      );
      cache_connection.expire(
        `inventory_search_by_date_for_company=${dateRef2}_${companySqlId}_${serialNumbers}`,
        60,
      );

      return result;
    } catch (error) {
      console.error("Database error:", error);
      return [];
    }
  }
};

const inventoryEventBasedOnPeriod = async (request, response) => {
  try {
    const companyId = request.query.company_id;
    const dateRef2 = request.query.date2;
    const companySqlId = request.query.company_sql_id;
    const eventInfo = await Event.find({
      company_id: companyId,
      active: true,
      type: "event",
    }).lean(); //company_id: companyId
    const result = [];
    const referenceDate = moment(dateRef2, "YYYY-MM-DD").startOf("day");
    for (let data of eventInfo) {
      const startTime = new Date(data.eventInfoDetail.dateBegin).getTime();
      const endTime = new Date(data.eventInfoDetail.dateEnd).getTime();
      result.push({
        referenceDate,
        event: data.eventInfoDetail.eventName,
        startTime,
        endTime,
        inventory: data.deviceSetup,
        eventId: `${data._id}`,
        companyId: `${data.company_id}`,
      });
    }
    const filteredEvents = filterEventsByDate(dateRef2, result);
    const checkingItem = await returnSerialNumberUsedInEvent(filteredEvents);
    const serialNumbers = [...checkingItem];
    const sqlItemInfoAvailable = await returnItemsInfoInUsedInEvents({
      serialNumbers,
      companySqlId,
      dateRef2,
    });
    return response.status(201).json({
      ok: true,
      events: sqlItemInfoAvailable,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      error,
    });
  }
};

const updateLargeNumberOfEventsAtOnce = async (request, response) => {
  try {
    let { ids, newValues } = request.body;

    // Basic validation and normalization
    if (!ids) ids = [];
    if (typeof ids === "string") ids = [ids];
    if (!Array.isArray(ids)) {
      return response
        .status(400)
        .json({ ok: false, msg: "ids must be an array of strings." });
    }
    const uniqueIds = Array.from(
      new Set(ids.map((v) => String(v).trim()).filter(Boolean)),
    );

    if (uniqueIds.length === 0) {
      return response
        .status(400)
        .json({ ok: false, msg: "Ids must not be empty." });
    }

    if (!newValues || typeof newValues !== "object") {
      return response
        .status(400)
        .json({ ok: false, msg: "newValues must be an object." });
    }

    // Prevent illegal updates to id fields
    const { _id, id, ...safeValues } = newValues;
    if (Object.keys(safeValues).length === 0) {
      return response.status(400).json({
        ok: false,
        msg: "newValues must include at least one field to update.",
      });
    }

    // Single efficient bulk update for all ids
    const result = await Event.updateMany(
      { _id: { $in: uniqueIds } },
      { $set: safeValues },
      { strict: false },
    );

    const matched = result.matchedCount ?? result.n ?? 0;
    const modified = result.modifiedCount ?? result.nModified ?? 0;

    // If not all IDs matched, inform the caller without an additional read
    const unmatchedCount = Math.max(uniqueIds.length - matched, 0);

    return response.status(200).json({
      ok: true,
      counts: {
        requested: uniqueIds.length,
        matched,
        modified,
        unmatched: unmatchedCount,
      },
      set: safeValues,
    });
  } catch (error) {
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const updateGlobalStateOfEvent = async (request, response) => {
  try {
    const { event_id } = request.body;
    const eventInfoFound = await Event.findById(event_id);

    if (!eventInfoFound) {
      return response.status(404).json({
        ok: false,
        message: "Event not found.",
      });
    }

    const { deviceSetup, eventInfoDetail, company_id } = eventInfoFound;
    if (!deviceSetup || deviceSetup.length === 0) {
      return response.status(400).json({
        ok: false,
        message: "There is no inventory set for this event yet.",
      });
    }

    const updatedDeviceSetup = await Promise.all(
      deviceSetup.map(async (item) => {
        const items = await ReceiversPool.find({
          type: item.group,
          eventSelected: eventInfoDetail.eventName,
          company: company_id,
        }).sort({ device: 1 });

        const newItem = { ...item };
        if (items.length > 0) {
          newItem.quantity =
            Number(newItem.quantity) > Number(items.length) ? newItem.quantity : items.length;
          newItem.startingNumber = items.at(0).device;
          newItem.endingNumber = items.at(-1).device;
        }
        return newItem;
      }),
    );

    const updatedEvent = await Event.findByIdAndUpdate(
      event_id,
      { $set: { deviceSetup: updatedDeviceSetup, logistic_inventory_status:"in-idle" } },
      { new: true },
    );

    if (!updatedEvent) {
      return response.status(404).json({
        ok: false,
        message: "Event not found after update attempt.",
      });
    }

    return response.status(200).json({
      ok: true,
      message: "Event inventory updated successfully.",
      updatedEventInventary: updatedEvent.deviceSetup,
    });
  } catch (error) {
    logger.error("Error updating event global state:", error);
    return response.status(500).json({
      ok: false,
      message: "An internal server error occurred.",
      error: error.message,
    });
  }
};
const updateEventInventoryFreshestData = async (request, response) => {
  try {
    const { event_id, updatedBy } = request.body;

    // -----------------------
    // Guard clauses
    // -----------------------
    if (!event_id) {
      return response
        .status(400)
        .json({ ok: false, message: "event_id is required" });
    }

    const event = await Event.findById(event_id);
    if (!event) {
      return response
        .status(404)
        .json({ ok: false, message: "Event not found." });
    }

    const eventName = event?.eventInfoDetail?.eventName;
    const companyId = event?.company_id;

    if (!eventName || !companyId) {
      return response.status(400).json({
        ok: false,
        message: "Event missing eventInfoDetail.eventName or company_id.",
      });
    }

    // -----------------------
    // Helpers (kept inside one controller as requested)
    // -----------------------
    const isNumericString = (v) =>
      typeof v === "string" && /^[0-9]+$/.test(v.trim());

    const compareDevice = (a, b) => {
      const A = String(a ?? "").trim();
      const B = String(b ?? "").trim();

      if (isNumericString(A) && isNumericString(B)) {
        const aN = BigInt(A);
        const bN = BigInt(B);
        if (aN === bN) return 0;
        return aN < bN ? -1 : 1;
      }

      return A.localeCompare(B, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    };

    const getRangeFromPoolGroup = (items = []) => {
      if (!items.length)
        return { startingNumber: null, endingNumber: null, quantity: 0 };
      const sorted = [...items].sort((x, y) =>
        compareDevice(x.device, y.device),
      );
      return {
        startingNumber: String(sorted[0]?.device ?? "").trim() || null,
        endingNumber:
          String(sorted[sorted.length - 1]?.device ?? "").trim() || null,
        quantity: sorted.length,
      };
    };

    const buildDeviceSetupEntryFromPool = ({
      type,
      provider,
      createdBy,
      startingNumber,
      endingNumber,
      quantity,
    }) => {
      const now = new Date();
      const dateCreated = now.toString();

      return {
        category: "Receivers",
        group: type,
        value: 0,
        description: `Auto-synced from device pool (${type})`,
        company: provider ?? "",
        isItSetAsContainerForEvent: false,
        quantity: quantity ?? 0,
        ownership: "Rent",
        container: false,
        createdBy: createdBy ?? "",
        key: _.uniqueId("deviceSetup_"),
        dateCreated,
        resume: `Receivers ${type} 0 Auto-synced from receivers pool (${type}) ${
          provider ?? ""
        } ${quantity ?? 0} Rent ${createdBy ?? ""} ${dateCreated} true undefined undefined`,
        consumerUses: false,
        startingNumber: startingNumber ?? null,
        endingNumber: endingNumber ?? null,
        existing: true,
      };
    };

    // -----------------------
    // Fetch freshest pool & group it
    // -----------------------
    const pool = await ReceiversPool.find({
      eventSelected: eventName,
      company: companyId,
    }).lean();

    const poolByType = _.groupBy(pool, "type"); // { Item1: [...], Item3: [...] }

    // -----------------------
    // Prepare deviceSetup indexing
    // -----------------------
    if (!Array.isArray(event.deviceSetup)) event.deviceSetup = [];

    const setupIndexByGroup = new Map();
    event.deviceSetup.forEach((entry, idx) => {
      const g = String(entry?.group ?? "").trim();
      if (g) setupIndexByGroup.set(g, idx);
    });

    // -----------------------
    // Sync logic: update existing or add missing
    // -----------------------
    const changes = { updated: [], added: [], skippedEmptyPoolGroups: [] };

    for (const [type, items] of Object.entries(poolByType)) {
      const groupName = String(type ?? "").trim();
      if (!groupName) continue;

      const { startingNumber, endingNumber, quantity } =
        getRangeFromPoolGroup(items);

      if (!startingNumber || !endingNumber) {
        changes.skippedEmptyPoolGroups.push(groupName);
        continue;
      }

      const existingIdx = setupIndexByGroup.get(groupName);

      if (existingIdx !== undefined) {
        const current = event.deviceSetup[existingIdx];

        const prev = {
          startingNumber: current.startingNumber ?? null,
          endingNumber: current.endingNumber ?? null,
          quantity: current.quantity ?? null,
        };

        current.startingNumber = startingNumber;
        current.endingNumber = endingNumber;

        // Conditionally update quantity as per business rule
        const existingQuantity = Number(current.quantity || 0);
        const newQuantity = Number(quantity || 0);

        if (newQuantity > existingQuantity) {
          current.quantity = newQuantity;
        }
        current.existing = true;

        changes.updated.push({
          group: groupName,
          prev,
          next: {
            startingNumber,
            endingNumber,
            quantity: current.quantity, // Log the final quantity
          },
        });
      } else {
        const first = items?.[0] || {};

        const newEntry = buildDeviceSetupEntryFromPool({
          type: groupName,
          provider: first?.provider,
          createdBy: updatedBy || first?.createdBy || "",
          startingNumber,
          endingNumber,
          quantity,
        });

        event.deviceSetup.push(newEntry);
        setupIndexByGroup.set(groupName, event.deviceSetup.length - 1);

        changes.added.push({
          group: groupName,
          startingNumber,
          endingNumber,
          quantity,
        });
      }
    }

    // -----------------------
    // Save & respond
    // -----------------------
    await event.save();

    return response.status(200).json({
      ok: true,
      message: "Event inventory synced with freshest receivers pool data.",
      event,
      changes,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      message: "Internal server error.",
      error: error.message,
    });
  }
};

module.exports = {
  updateGlobalStateOfEvent,
  createEvent,
  editSubscriptionEvent,
  eventList,
  editEvent,
  searchStaffAllEvents,
  gettingEventListPerCompany,
  eventStaffDetailInfo,
  inventoryEventBasedOnPeriod,
  deleteEvent,
  updateLargeNumberOfEventsAtOnce,
  updateEventInventoryFreshestData,
};
