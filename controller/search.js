const { clientRedis } = require("../database/cacheMemoryConfig");
const AdminUser = require("../models/AdminUser");
const Company = require("../models/Company");
const Event = require("../models/Event");
const Receivers = require("../models/Receivers");
const ReceiversPool = require("../models/ReceiversPool");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const mongoose = require("mongoose");
const moment = require("moment");
const getConnection = require("../mysql/database/config");
const { groupBy, noConflict } = require("lodash");

const searchingCompanyInfo = async (company) => {
  const cache_connection = await clientRedis();
  const cached = await cache_connection.get(`company_${company}`);
  if (cached) {
    return JSON.parse(cached);
  }
  const companyInfo = await Company.findById(company).lean();
  await cache_connection.set(`company_${company}`, JSON.stringify(companyInfo));
  await cache_connection.expire(`company_${company}`, 60);
  return companyInfo;
};

// const searchingConsumer = async (variable, company) => {
//   return await User.find({
//     $or: [
//       { name: { $regex: variable, $options: "i" } },
//       { lastName: { $regex: variable, $options: "i" } },
//       { email: { $regex: variable, $options: "i" } },
//     ],
//     $and: [{ company_providers: { $in: [company] } }],
//   });
// };

const searchingConsumer = async (variable, company, lastId = null) => {
  const query = {
    $or: [
      { name: { $regex: variable, $options: "i" } },
      { lastName: { $regex: variable, $options: "i" } },
      { email: { $regex: variable, $options: "i" } },
    ],
    company_providers: { $in: [company] },
  };
  if (lastId) {
    query._id = { $gt: new mongoose.Types.ObjectId(lastId) };
  }
  const limit = 11;
  const results = await User.find(query).sort({ _id: 1 }).limit(limit);
  const hasMore = results.length === limit;
  if (hasMore) {
    results.pop();
  }
  return {
    consumers: results,
    hasMore,
  };
};

const searchingTransaction = async (variable, company) => {
  return await Transaction.find({
    $or: [
      { paymentIntent: variable },
      { clientSecret: variable },
      { "consumerInfo.name": { $regex: variable, $options: "i" } },
      { "consumerInfo.lastName": { $regex: variable, $options: "i" } },
      { "consumerInfo.email": { $regex: variable, $options: "i" } },
      { eventSelected: variable },
    ],
    $and: [{ active: true }, { company: company }],
  });
};

// const searchingDeviceTransaction = async (variable, company) => {
//   return await Receivers.find({
//     $or: [
//       { paymentIntent: variable },
//       { user: { $regex: variable, $options: "i" } },
//       { "device.serialNumber": { $regex: variable, $options: "i" } },
//       { "device.deviceType": { $regex: variable, $options: "i" } },
//     ],
//     $and: [{ company: company }],
//   });
// };

const searchingDeviceTransaction = async (variable, company, lastId = null) => {
  const query = {
    $or: [
      { paymentIntent: variable },
      { user: { $regex: variable, $options: "i" } },
      { "device.serialNumber": { $regex: variable, $options: "i" } },
      { "device.deviceType": { $regex: variable, $options: "i" } },
    ],
    company: { $in: [company] },
  };
  if (lastId) {
    query._id = { $gt: new mongoose.Types.ObjectId(lastId) };
  }
  const limit = 11;
  const results = await Receivers.find(query).sort({ _id: 1 }).limit(limit);
  const hasMore = results.length === limit;
  if (hasMore) {
    results.pop();
  }
  return { deviceTransaction: results, hasMore };
};

const searchingDevicePool = async (variable, company, lastId = null) => {
  const result = new Set();
  const query = {
    $or: [
      { device: { $regex: variable, $options: "i" } },
      { type: { $regex: variable, $options: "i" } },
      { eventSelected: { $regex: variable, $options: "i" } },
    ],
    $and: [{ company: company }],
  };
  if (lastId) {
    query._id = { $gt: new mongoose.Types.ObjectId(lastId) };
  }
  const limit = 11;

  const devicesFoundInPool = await ReceiversPool.find(query)
    .sort({ _id: 1 })
    .limit(limit);
  const hasMore = devicesFoundInPool.length === limit;
  if (hasMore) {
    devicesFoundInPool.pop();
  }
  for (let data of devicesFoundInPool) {
    const checkIfEventIsActive = await Event.findOne({
      "eventInfoDetail.eventName": data.eventSelected,
      active: true,
      company_id: company,
    });
    if (checkIfEventIsActive) {
      result.add(data);
    }
  }
  return {
    devicePool: Array.from(result),
    hasMore,
  };
};

const searchingEvents = async (props) => {
  const { variable, company } = props;
  const query = {
    $or: [
      { "eventInfoDetail.eventName": { $regex: `${variable}`, $options: "i" } },
      { "eventInfoDetail.dateBegin": { $regex: `${variable}`, $options: "i" } },
      { "eventInfoDetail.address": { $regex: `${variable}`, $options: "i" } },
      { user: { $regex: variable, $options: "i" } },
    ],
    $and: [
      { active: true },
      { show: true },
      { company: company, type: "event" },
    ],
  };
  const limit = 11;
  const results = await Event.find(query).sort({ _id: 1 }).limit(limit);
  let hasMore = results.length === limit;
  if (results.length === limit) {
    results.pop();
  }
  return { hasMore, results };
};

const searchingStaff = async (props) => {
  const { variable, employees } = props;
  let result = [];
  for (let employee of employees) {
    const ref = JSON.stringify(employee);
    if (String(ref).includes(variable)) {
      const query = {
        email: JSON.parse(ref).user,
      };
      const staffFound = await AdminUser.find(query);
      result.push(staffFound[0]);
    }
  }
  return result.flat();
};

const searching = async (req, res) => {
  // const { variable, company } = req.body;
  const variable = req.query.variable;
  const company = req.query.company;
  try {
    const companyInfo = await searchingCompanyInfo(company);
    const [
      consumerFound,
      transactionFound,
      deviceTransactionFound,
      devicePoolFound,
      eventFound,
      staffFound,
    ] = await Promise.all([
      searchingConsumer(variable, company),
      searchingTransaction(variable, company),
      searchingDeviceTransaction(variable, company),
      searchingDevicePool(variable, company),
      searchingEvents({
        variable: variable,
        company: companyInfo.company_name,
      }),
      searchingStaff({
        variable: variable,
        employees: companyInfo.employees,
      }),
    ]);

    return res.status(200).json({
      ok: true,
      comps: companyInfo,
      consumer: consumerFound,
      transaction: transactionFound,
      deviceTransaction: deviceTransactionFound,
      devicePool: devicePoolFound,
      event: eventFound,
      staff: staffFound,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const moreConsumer = async (req, res) => {
  const variable = req.query.variable;
  const company = req.query.company;
  const lastId = req.query.lastId;
  try {
    const [consumerFound] = await Promise.all([
      searchingConsumer(variable, company, lastId),
    ]);

    return res.status(200).json({
      ok: true,
      consumers: consumerFound,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const previousConsumer = async (req, res) => {
  try {
    const variable = req.query.variable;
    const company = req.query.company;
    const lastId = req.query.lastId;
    const query = {
      $or: [
        { name: { $regex: variable, $options: "i" } },
        { lastName: { $regex: variable, $options: "i" } },
        { email: { $regex: variable, $options: "i" } },
      ],
      company_providers: { $in: [company] },
    };
    if (lastId) {
      query._id = { $gt: new mongoose.Types.ObjectId(lastId) };
    }
    const limit = 11;
    const results = await User.find(query).sort({ _id: -1 }).limit(limit);
    const hasMore = results.length === limit;
    if (hasMore) {
      results.pop();
    }
    return res.status(200).json({
      ok: true,
      consumers: results,
      hasMore,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message,
      error,
    });
  }
};

const moreEvents = async (req, res) => {
  const variable = req.query.variable;
  const company = req.query.company;
  const lastId = req.query.lastId;
  try {
    const [eventFound] = await Promise.all([
      searchingEvents({
        variable: variable,
        company: company,
        lastId: lastId,
      }),
    ]);

    return res.status(200).json({
      ok: true,
      event: eventFound,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const moreStaff = async (req, res) => {
  const variable = req.query.variable;
  const employees = req.query.employees;
  const lastId = req.query.lastId;
  try {
    const [staffFound] = await Promise.all([
      searchingStaff({
        variable: variable,
        employees: employees,
        lastId: lastId,
      }),
    ]);
    return res.status(200).json({
      ok: true,
      staff: staffFound,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const moreDeviceTransaction = async (req, res) => {
  const variable = req.query.variable;
  const company = req.query.company;
  const lastId = req.query.lastId;
  try {
    const [deviceTransactionFound, devicePoolFound] = await Promise.all([
      searchingDeviceTransaction(variable, company, lastId),
      searchingDevicePool(variable, company, lastId),
    ]);

    return res.status(200).json({
      ok: true,
      deviceTransaction: deviceTransactionFound,
      devicePool: devicePoolFound,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const filterEventsByDate = (referenceStartStr, referenceEndStr, events) => {
  // Create reference moments
  const refStart = moment(referenceStartStr, "YYYY-MM-DD").startOf("day");
  const refEnd = moment(referenceEndStr, "YYYY-MM-DD").endOf("day");
  // Define the extended period: 5 days before refStart and 5 days after refEnd
  const periodStart = refStart.clone().subtract(5, "days");
  const periodEnd = refEnd.clone().add(5, "days");

  // Process events: Here we filter events that overlap with the extended period.
  // You can add additional status labeling if needed.
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

      // Convert event times to moment objects
      const eventStart = moment(startTime);
      const eventEnd = moment(endTime);

      // If the event ends before the extended period starts or starts after it ends,
      // then skip this event.
      if (eventEnd.isBefore(periodStart) || eventStart.isAfter(periodEnd)) {
        return null;
      }

      // Optionally, determine a status based on the event's position relative to the reference period.
      let status = "";
      if (eventStart.isBefore(refStart) && eventEnd.isAfter(refEnd)) {
        status = "Spans entire reference period";
      } else if (
        eventStart.isBefore(refStart) &&
        eventEnd.isBetween(refStart, refEnd, null, "[]")
      ) {
        status = "Started before but ends during reference period";
      } else if (
        eventStart.isBetween(refStart, refEnd, null, "[]") &&
        eventEnd.isAfter(refEnd)
      ) {
        status = "Starts during but ends after reference period";
      } else if (
        eventStart.isBetween(refStart, refEnd, null, "[]") &&
        eventEnd.isBetween(refStart, refEnd, null, "[]")
      ) {
        status = "Occurs entirely within reference period";
      } else {
        status = "Within extended period";
      }

      return { eventName, status, inventory, eventId, companyId };
    })
    .filter(Boolean); // Remove any null values (i.e. events outside the extended period)
};

const returnSerialNumberUsedInEvent = async ({ renderingData, group }) => {
  const result = new Set();
  let collection = [];
  for (let data of renderingData) {
    const deviceInfo = await ReceiversPool.find(
      {
        company: data.companyId,
        eventSelected: data.eventName,
      },
      { device: 1 }
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
  location = null,
  group = null,
  brand = null,
  category = null,
}) => {
  const connection = getConnection();
  // const cache_connection = await clientRedis();
  // const cacheKey = `inventory_search_by_date_for_company=${dateRef2}_${companySqlId}_${serialNumbers.join(
  //   ","
  // )}`;
  // const cachedData = await cache_connection.get(cacheKey);

  // if (cachedData) {
  //   return JSON.parse(cachedData);
  // }

  // Start building the base query and parameter array
  let query = "SELECT * FROM item_inv WHERE company_id = ?";
  const params = [companySqlId];

  // If serialNumbers are provided, add a NOT IN clause
  if (serialNumbers && serialNumbers.length > 0) {
    const placeholders = serialNumbers.map(() => "?").join(", ");
    query += ` AND serial_number NOT IN (${placeholders})`;
    params.push(...serialNumbers);
  }

  // Add optional filters dynamically
  if (location !== null) {
    query += " AND location = ?";
    params.push(location);
  }
  if (group !== null) {
    query += " AND item_group = ?"; // Wrap group with backticks since it's a reserved word
    params.push(group);
  }
  if (brand !== null) {
    query += " AND brand = ?";
    params.push(brand);
  }
  if (category !== null) {
    query += " AND category_name = ?";
    params.push(category);
  }

  try {
    const [result] = await connection.execute(query, params);
    // Cache the result with a 60-second expiry
    // await cache_connection.set(cacheKey, JSON.stringify(result));
    // await cache_connection.expire(cacheKey, 60);
    return result;
  } catch (error) {
    console.error("Database error:", error);
    return [];
  }
};

const checkEventInventoryActivity = async ({ filteredEvents, group }) => {
  const result = new Map();
  for (let data of filteredEvents) {
    const deviceInfo = await ReceiversPool.find(
      {
        company: data.companyId,
        eventSelected: data.eventName,
      },
      { type: 1 }
    ).lean();
    if (deviceInfo.length > 0) {
      const groupingInfo = groupBy(deviceInfo, "type");
      if (group) {
        result.set(data.eventId, {
          type: group,
          count: groupingInfo[group].length,
        });
      } else {
        result.set(data.eventId, {
          ...Object.keys(groupingInfo).map((key) => ({
            type: key,
            count: groupingInfo[key].length,
          })),
        });
      }
    }
  }
  return result;
};

const checkPlannedEventInventoryActivity = async ({ events, group }) => {
  const result = new Map();
  for (let data of events) {
    const { inventory } = data;
    if (group) {
      const foundGroup = inventory.find((item) => item.group === group);
      if (foundGroup) {
        if (!result.has(group)) {
          result.set(group, Number(foundGroup.quantity));
        } else {
          result.set(
            group,
            Number(result.get(group)) + Number(foundGroup.quantity)
          );
        }
      }
    } else {
      for (let item of inventory) {
        if (!result.has(item.group)) {
          result.set(item.group, Number(item.quantity));
        } else {
          result.set(
            item.group,
            result.get(item.group) + Number(item.quantity)
          );
        }
      }
    }
  }
  return result;
};

const displayPlannedEventInventory = async ({
  checkPlannedEventInventory,
  companySqlId,
  location = null,
  group = null,
  brand = null,
  category = null,
  dateRef2 = 0o0,
}) => {
  const connection = getConnection();
  const formattedResult = new Set();
  try {
    if (checkPlannedEventInventory.size === 0) {
      let query =
        "SELECT item_group, COUNT(*) FROM item_inv WHERE company_id = ?";
      const params = [companySqlId];

      if (location !== null) {
        query += " AND location = ?";
        params.push(location);
      }
      if (group !== null) {
        query += " AND item_group = ?"; // Wrap group with backticks since it's a reserved word
        params.push(group);
      }
      if (brand !== null) {
        query += " AND brand = ?";
        params.push(brand);
      }
      if (category !== null) {
        query += " AND category_name = ?";
        params.push(category);
      }

      query += " GROUP BY item_group";
      const [results] = await connection.execute(query, params);
      for (let data of results) {
        formattedResult.add({
          group: data.item_group,
          available: data["count(*)"],
          notAvailable: 0,
        });
      }
      return new Array(...formattedResult);
    }
    const result = new Map();
    for (let [key, value] of checkPlannedEventInventory) {
      let query =
        "SELECT COUNT(*) FROM item_inv WHERE company_id = ? AND item_group = ?";
      const params = [companySqlId, key];
      const [results] = await connection.execute(query, params);
      result.set(key, {
        available: Number(results[0]["count(*)"]) - Number(value),
        notAvailable: Number(value),
      });
    }
    for (let [key, value] of result) {
      formattedResult.add({
        group: key,
        available: value.available,
        notAvailable: value.notAvailable,
      });
    }
    return new Array(...formattedResult);
  } catch (error) {
    return [];
  }
};
const advanceSearchingQuery = async (request, response) => {
  try {
    const companyId = request.query.company_id;
    const date_start = request.query.date_start;
    const date_end = request.query.date_end;
    const location =
      request.query.location !== "undefined" ? request.query.location : null;
    const group =
      request.query.group !== "undefined" ? request.query.group : null;
    const brand =
      request.query.brand !== "undefined" ? request.query.brand : null;
    const category =
      request.query.category !== "undefined" ? request.query.category : null;
    const companySqlId = request.query.company_sql_id;
    const eventInfo = await Event.find({
      company_id: companyId,
      active: true,
      type: "event",
    }).lean();
    const result = [];
    const referenceDateStarts = moment(date_start, "YYYY-MM-DD").startOf("day");
    const referenceDateEnds = moment(date_end, "YYYY-MM-DD").startOf("day");
    for (let data of eventInfo) {
      const startTime = new Date(data.eventInfoDetail.dateBegin).getTime();
      const endTime = new Date(data.eventInfoDetail.dateEnd).getTime();
      result.push({
        referenceDateStarts,
        referenceDateEnds,
        event: data.eventInfoDetail.eventName,
        startTime,
        endTime,
        inventory: data.deviceSetup,
        eventId: `${data._id}`,
        companyId: `${data.company_id}`,
      });
    }
    const filteredEvents = await filterEventsByDate(
      referenceDateStarts,
      referenceDateEnds,
      result
    );
    const checkingItem = await returnSerialNumberUsedInEvent({
      renderingData: filteredEvents,
      group: group,
    });
    const serialNumbers = [...checkingItem];
    const eventInventory = await checkEventInventoryActivity({
      filteredEvents,
      group,
    });
    const sqlItemInfoAvailable = await returnItemsInfoInUsedInEvents({
      serialNumbers,
      companySqlId,
      date_start,
      location,
      group,
      brand,
      category,
    });

    const checkPlannedEventInventory = await checkPlannedEventInventoryActivity(
      {
        events: filteredEvents,
        group: group,
      }
    );

    const displayPlannedEventInventoryData = await displayPlannedEventInventory(
      {
        checkPlannedEventInventory,
        companySqlId,
        location,
        group,
        brand,
        category,
      }
    );
    return response.status(201).json({
      ok: true,
      advanceSearchResult: sqlItemInfoAvailable,
      events: eventInventory,
      plannedInventoryToUseInEvents: displayPlannedEventInventoryData,
      period: {
        start: date_start,
        end: date_end,
      },
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      error: JSON.stringify(error),
    });
  }
};

module.exports = {
  searching,
  moreConsumer,
  moreEvents,
  moreStaff,
  moreDeviceTransaction,
  previousConsumer,
  advanceSearchingQuery,
};
