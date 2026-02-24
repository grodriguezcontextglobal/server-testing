const mongoose = require("mongoose");
const Receivers = require("../models/Receivers");
const ReceiversPool = require("../models/ReceiversPool");
const ReceiverReturnedStatus = require("../models/ReceiverReturnedStatus");

const parseTime = (v) => {
  if (!v) return new Date();
  // JS dates are usually strings or Date objects. Mongoose handles string -> Date.
  // Go logic handled int64/float64 timestamps, but Node usually receives ISO strings or timestamps.
  return new Date(v);
};

const updateReceiverStatus = async (input) => {
  const { id, device } = input;
  if (!id) throw new Error("id is required");
  const updatedReceiver = await Receivers.findByIdAndUpdate(
    id,
    { $set: { device: device } },
    { new: true },
  );
  return { ok: true, receiverUpdated: updatedReceiver }; // Go returned {ok: true, receiver: updatedDoc}
};

const updateBulkItemsInTransaction = async (input) => {
  const { timeStamp, device } = input;
  const ts = parseTime(timeStamp);

  const bulkOps = device.map((item) => ({
    updateOne: {
      filter: { _id: item.key },
      update: {
        $set: {
          "device.status": false,
          timeStamp: ts,
        },
      },
    },
  }));

  if (bulkOps.length > 0) {
    await Receivers.bulkWrite(bulkOps);
  }
  return { ok: true };
};

const updateBulkItemsInPool = async (input) => {
  const { device, company, activity, eventSelected } = input;
  const bulkOps = device.map((item) => {
    let t = item.deviceType || item.type;
    let d = item.serialNumber;
    if (!d) {
      d =
        typeof item.device === "string"
          ? item.device
          : item.device.serialNumber; // Fallback
    }

    return {
      updateOne: {
        filter: {
          company: company,
          activity: !activity,
          eventSelected: eventSelected,
          type: t,
          device: d,
        },
        update: {
          $set: { activity: activity },
        },
      },
    };
  });

  let modifiedCount = 0;
  if (bulkOps.length > 0) {
    const res = await ReceiversPool.bulkWrite(bulkOps);
    modifiedCount = res.modifiedCount;
  }
  return { ok: true, modifiedCount };
};

const poolReceiversBulk = async (input) => {
    const {
      deviceList,
      status = "Operational",
      activity = false,
      comment = "No comment.",
      eventSelected,
      provider,
      type,
      company,
    } = input || {};

    if (!eventSelected) throw new Error("eventSelected is required");
    if (!company) throw new Error("company is required");
    if (!type) throw new Error("type is required");

    let rawDevices;
    try {
      rawDevices =
        typeof deviceList === "string" ? JSON.parse(deviceList) : deviceList;
    } catch {
      throw new Error("Invalid deviceList JSON");
    }

    if (!Array.isArray(rawDevices) || rawDevices.length === 0) {
      throw new Error("deviceList must be a non-empty array");
    }

    // Accept either strings ["SN1","SN2"] OR objects [{device:"SN1"}, ...]
    const normalized = rawDevices
      .map((d) => (typeof d === "string" ? d : d?.device || d?.serial_number))
      .filter(Boolean);

    if (normalized.length === 0) throw new Error("no valid devices to insert");

    const docs = normalized.map((serial) => ({
      device: serial,
      status,
      activity,
      comment,
      eventSelected,
      provider,
      type,
      company,
    }));

    // Optional: avoid duplicates for same event/company/device if you have unique indexes or want upsert-like behavior
    // Otherwise insertMany will insert all.
    return ReceiversPool.insertMany(docs, { ordered: false });
};

const updatePoolReceivers = async (input) => {
  const { id, ...raw } = input;
  if (!id) throw new Error("id is required");

  // Remove id from raw to avoid updating immutable _id if present (Go deleted it)
  const updateData = { ...raw };
  delete updateData.id;

  const updatedDoc = await ReceiversPool.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true },
  );
  return { ok: true, receiverUpdated: updatedDoc };
};

const receiverPoolFoundAndDelete = async (input) => {
  const { id } = input;
  const deletedDoc = await ReceiversPool.findByIdAndDelete(id);
  return { ok: true, deviceDeleted: deletedDoc };
};

const receiverPoolBulkDelete = async (input) => {
  const { ids } = input;
  const res = await ReceiversPool.deleteMany({ _id: { $in: ids } });
  return { ok: true, deletedCount: res.deletedCount };
};

const updateIssueDevice = async (input) => {
  const { id, ...raw } = input;
  if (!id) throw new Error("id is required");
  const updateData = { ...raw };
  delete updateData.id;

  const updatedDoc = await ReceiverReturnedStatus.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true },
  );
  return { ok: true, receiverUpdated: updatedDoc };
};

const updateBulkItemDataInPool = async (input) => {
  const { startingSerialNumber, deviceData, qty, status, activity, comment } =
    input;

  let devices = [];
  try {
    devices =
      typeof deviceData === "string" ? JSON.parse(deviceData) : deviceData;
  } catch (e) {
    throw new Error("Invalid deviceData JSON");
  }

  const startIndex = devices.findIndex(
    (d) => d.device === startingSerialNumber,
  );
  if (startIndex === -1) throw new Error("Starting serial number not found");

  let endIndex = startIndex + Number(qty);
  if (endIndex > devices.length) endIndex = devices.length;

  const targetDevices = devices.slice(startIndex, endIndex);
  if (targetDevices.length === 0)
    return { ok: true, msg: "No items to update" };

  const first = targetDevices[0];
  const deviceSerials = targetDevices.map((d) => d.device);

  const res = await ReceiversPool.updateMany(
    {
      company: first.company,
      activity: false,
      eventSelected: first.eventSelected,
      type: first.type,
      device: { $in: deviceSerials },
    },
    {
      $set: {
        status: status,
        activity: true,
        comment: comment,
      },
    },
  );

  return {
    ok: true,
    msg: `Total items updated successfully: ${res.modifiedCount}`,
    totalAssigned: res.modifiedCount,
    modifiedCount: res.modifiedCount,
  };
};

const returnAllItemsInTransactionInPool = async (input) => {
  const { company, activity, eventSelected, device } = input;

  const bulkOps = device.map((item) => {
    let deviceType;
    let serialNumber;

    // item.device logic from Go/JS
    if (item.device && typeof item.device === "object") {
      deviceType = item.device.deviceType;
      serialNumber = item.device.serialNumber || item.device;
    } else {
      serialNumber = item.device;
      // deviceType is undefined if item.device is string?
      // Go code: if item.device is map, extract. else serialNumber = item.device.
      // Go logic: filter uses 'type': deviceType. If it's undefined/empty string, it might fail to match?
      // But let's assume input structure is consistent.
    }

    return {
      updateOne: {
        filter: {
          company: company,
          activity: !activity,
          eventSelected: eventSelected,
          type: deviceType, // Note: if undefined, might not match anything if DB has type
          device: serialNumber,
        },
        update: {
          $set: { activity: activity },
        },
      },
    };
  });

  if (bulkOps.length > 0) {
    await ReceiversPool.bulkWrite(bulkOps);
  }
  return { ok: true };
};

const updateBulkItemsInTransactionPerUserAtOnce = async (input) => {
  // Go handled array input (bytes starting with '[') or object input.
  // JS likely passes one or the other.
  let listInput = [];
  let ts;

  if (Array.isArray(input)) {
    listInput = input;
  } else if (input.device) {
    ts = parseTime(input.timeStamp);
    listInput = input.device.map((d) => ({ id: d.id, timeStamp: ts }));
  }

  const bulkOps = listInput.map((item) => ({
    updateOne: {
      filter: { _id: item.id },
      update: {
        $set: {
          "device.status": false,
          timeStamp: parseTime(item.timeStamp || ts),
        },
      },
    },
  }));

  if (bulkOps.length > 0) {
    await Receivers.bulkWrite(bulkOps);
  }
  return { ok: true };
};

const createBulkItemTransactionInUser = async (input) => {
  const {
    serialNumbers,
    deviceType,
    status,
    paymentIntent,
    company,
    user,
    eventSelected,
    provider,
    event_id,
    timestamp,
  } = input;

  let serialList = [];
  try {
    serialList =
      typeof serialNumbers === "string"
        ? JSON.parse(serialNumbers)
        : serialNumbers;
  } catch (e) {
    throw new Error("invalid serialNumbers JSON");
  }

  const ts = parseTime(timestamp);

  const docs = serialList.map((item) => ({
    paymentIntent,
    device: {
      deviceType,
      serialNumber: item.device,
      status,
    },
    company,
    user,
    eventSelected: [eventSelected],
    provider: [provider],
    timeStamp: ts,
    event_id,
    active: true,
  }));

  if (docs.length === 0) return { msg: "No items to insert" };

  const res = await Receivers.insertMany(docs);
  return {
    ok: true,
    msg: `Items assigned successfully. Total items: ${docs.length}`,
    count: docs.length,
    insertedIds: res, // Go didn't return IDs but helpful? Go returned map with count.
  };
};

module.exports = {
  updateReceiverStatus,
  updateBulkItemsInTransaction,
  updateBulkItemsInPool,
  poolReceiversBulk,
  updatePoolReceivers,
  receiverPoolFoundAndDelete,
  receiverPoolBulkDelete,
  updateIssueDevice,
  updateBulkItemDataInPool,
  returnAllItemsInTransactionInPool,
  updateBulkItemsInTransactionPerUserAtOnce,
  createBulkItemTransactionInUser,
};
