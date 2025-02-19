const { clientRedis } = require("../database/cacheMemoryConfig");
const AdminUser = require("../models/AdminUser");
const Company = require("../models/Company");
const Event = require("../models/Event");
const Receivers = require("../models/Receivers");
const ReceiversPool = require("../models/ReceiversPool");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const mongoose = require("mongoose");

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

module.exports = {
  searching,
  moreConsumer,
  moreEvents,
  moreStaff,
  moreDeviceTransaction,
};
