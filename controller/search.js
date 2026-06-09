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
  const results = await User.find(query).sort({ _id: 1 }) //.limit(limit);
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
  const results = await Receivers.find(query).sort({ _id: 1 }) //.limit(limit);
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
    // .limit(limit);
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
  const results = await Event.find(query).sort({ _id: 1 }) //.limit(limit);
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
    const results = await User.find(query).sort({ _id: -1 }) //.limit(limit);
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

// all company inventory
const inventoryQuery = async (payload) => {
  try {
    const {
      category_name,
      item_group,
      brand,
      location,
      company_sql_id,
      ownership,
    } = payload;
    const connection = getConnection();

    // Build dynamic query with proper parameterization
    let query = `SELECT item_id, category_name, item_group, location, current_location, image_url, serial_number, main_warehouse, return_date, brand, cost, status FROM item_inv WHERE ownership = ? ${
      ownership === "Rent" ? "AND return_date IS NOT NULL AND " : "AND"
    } company_id = ?`;
    const params = [ownership, company_sql_id];

    if (
      category_name &&
      category_name !== "undefined" &&
      category_name !== "null"
    ) {
      query += ` AND category_name = ?`;
      params.push(category_name);
    }
    if (item_group && item_group !== "undefined" && item_group !== "null") {
      query += ` AND item_group = ?`;
      params.push(item_group);
    }
    if (brand && brand !== "undefined" && brand !== "null") {
      query += ` AND brand = ?`;
      params.push(brand);
    }
    if (location && location !== "undefined" && location !== "null") {
      query += ` AND location = ?`;
      params.push(location);
    }

    // Add ORDER BY to sort by location
    query += ` ORDER BY location ASC, item_group ASC, brand ASC`;
    const [results] = await connection.execute(query, params);
    // Group results by location for better organization
    const groupedByLocation = results.reduce((acc, item) => {
      const loc = item.location || "unknown_location";
      if (!acc[loc]) {
        acc[loc] = {
          location: loc,
          items: [],
          total_count: 0,
        };
      }
      acc[loc].items.push(item);
      acc[loc].total_count += 1;
      return acc;
    }, {});

    // Convert to array and sort by location name
    const sortedLocations = Object.values(groupedByLocation).sort((a, b) =>
      a.location.localeCompare(b.location)
    );

    return {
      total_items: results.length,
      locations: sortedLocations,
      raw_results: results,
    };
  } catch (error) {
    console.error("Error in ownedInventoryQuery:", error);
    return {
      total_items: 0,
      locations: [],
      raw_results: [],
      error: error.message,
    };
  }
};
const eventInventoryInPeriod = async (payload) => {
  try {
    const {
      company_id,
      item_group,
      category_name,
      brand,
      date_start,
      date_end,
    } = payload;

    // Convert dates to proper ISO format for MongoDB comparison
    const startDate = new Date(date_start);
    const endDate = new Date(date_end);

    // Build the base query for company and active events in the period
    const params = {
      company_id: company_id,
      type: "event",
      active: true,
      // Check for events that overlap with the period
      $or: [
        {
          // Event starts within the period
          "eventInfoDetail.dateBegin": {
            $gte: startDate.toISOString(),
            $lte: endDate.toISOString(),
          },
        },
        {
          // Event ends within the period
          "eventInfoDetail.dateEnd": {
            $gte: startDate.toISOString(),
            $lte: endDate.toISOString(),
          },
        },
        {
          // Event spans the entire period (starts before, ends after)
          $and: [
            { "eventInfoDetail.dateBegin": { $lte: startDate.toISOString() } },
            { "eventInfoDetail.dateEnd": { $gte: endDate.toISOString() } },
          ],
        },
      ],
    };

    // Get all events in the period for this company first
    const eventList = await Event.find(params).lean();

    // Group and count devices by category, group, and brand
    const deviceCounts = eventList.reduce((acc, event) => {

      if (event.deviceSetup && Array.isArray(event.deviceSetup)) {
        event.deviceSetup.forEach((device) => {
          const category = device.category || "unknown_category";
          const group = device.group || "unknown_group";
          const deviceBrand = device.brand || "unknown_brand";

          // Apply search parameter filters - only include devices that match search criteria
          // If no search params provided, include all devices
          let includeDevice = true;

          if (
            category_name &&
            category_name !== "undefined" &&
            category !== category_name
          ) {
            includeDevice = false;
          }

          if (
            item_group &&
            item_group !== "undefined" &&
            group !== item_group
          ) {
            includeDevice = false;
          }

          if (brand && brand !== "undefined" && deviceBrand !== brand) {
            includeDevice = false;
          }

          // Only include devices that match search criteria
          if (includeDevice) {
            // Create unique key for grouping
            const key = `${category}_${group}_${deviceBrand}`;

            if (!acc[key]) {
              acc[key] = {
                category: category,
                group: group,
                brand: deviceBrand,
                count: 0,
                events: [],
              };
            }

            acc[key].count += device.quantity || 1;

            // Check if this event is already added for this device type
            const existingEvent = acc[key].events.find(
              (e) => e.event_id.toString() === event._id.toString()
            );
            if (!existingEvent) {
              acc[key].events.push({
                event_id: event._id,
                event_name: event.eventInfoDetail?.eventName || "Unknown Event",
                date_begin: event.eventInfoDetail?.dateBegin,
                date_end: event.eventInfoDetail?.dateEnd,
                active: event.active,
                ownership: device.ownership,
              });
            }
          }
        });
      } else {
      }

      return acc;
    }, {});
    // Convert to array and sort by category, then group
    const sortedCounts = Object.values(deviceCounts).sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.group.localeCompare(b.group);
    });

    // Calculate totals
    const totalDevices = sortedCounts.reduce(
      (sum, item) => Number(sum) + Number(item.count),
      0
    );
    const totalEvents = eventList.length;
    const filteredEvents = sortedCounts.reduce(
      (sum, item) => sum + item.events.length,
      0
    );

    return {
      total_devices: totalDevices,
      total_events: totalEvents,
      filtered_events: filteredEvents, // Events that match search criteria
      device_counts: sortedCounts,
      period: {
        date_start,
        date_end,
      },
      search_filters_applied: {
        category_name: category_name || null,
        item_group: item_group || null,
        brand: brand || null,
      },
      raw_events: eventList, // All events in period (for debugging)
    };
  } catch (error) {
    console.error("Error in eventInventoryInPeriod:", error);
    return {
      total_devices: 0,
      total_events: 0,
      filtered_events: 0,
      device_counts: [],
      period: { date_start: payload.date_start, date_end: payload.date_end },
      search_filters_applied: {
        category_name: payload.category_name || null,
        item_group: payload.item_group || null,
        brand: payload.brand || null,
      },
      raw_events: [],
      error: error.message,
    };
  }
};
const subtractRentedInventoryPerDate = async (payload) => {
  try {
    const { raw_results, date_start, date_end, total_items, locations } =
      payload;

    // Convert date strings to Date objects for comparison
    const periodStart = new Date(date_start);
    const periodEnd = new Date(date_end);

    // Initialize counters
    const analysis = {
      before_period: [],
      within_period: [],
      after_period: [],
      no_return_date: [],
      summary: {
        before_count: 0,
        within_count: 0,
        after_count: 0,
        no_return_date_count: 0,
        total_analyzed: 0,
      },
      period: {
        start: date_start,
        end: date_end,
      },
    };

    // Analyze each rental item
    raw_results.forEach((item, index) => {
      const returnDate = item.return_date ? new Date(item.return_date) : null;

      const itemInfo = {
        item_id: item.item_id,
        serial_number: item.serial_number,
        item_group: item.item_group,
        brand: item.brand,
        category_name: item.category_name,
        location: item.location,
        return_date: item.return_date,
        cost: item.cost,
        status: item.status,
      };

      if (!returnDate) {
        // No return date specified
        analysis.no_return_date.push(itemInfo);
        analysis.summary.no_return_date_count++;
      } else if (returnDate < periodStart) {
        // Return date is before the period
        analysis.before_period.push(itemInfo);
        analysis.summary.before_count++;
      } else if (returnDate >= periodStart && returnDate <= periodEnd) {
        // Return date is within the period
        analysis.within_period.push(itemInfo);
        analysis.summary.within_count++;
      } else {
        // Return date is after the period
        analysis.after_period.push(itemInfo);
        analysis.summary.after_count++;
      }
    });

    analysis.summary.total_analyzed = raw_results.length;

    // Group by location for detailed breakdown
    const locationBreakdown = {};
    locations.forEach((loc) => {
      locationBreakdown[loc.location] = {
        location: loc.location,
        total_items: loc.total_count,
        before_period: 0,
        within_period: 0,
        after_period: 0,
        no_return_date: 0,
      };

      loc.items.forEach((item) => {
        const returnDate = item.return_date ? new Date(item.return_date) : null;

        if (!returnDate) {
          locationBreakdown[loc.location].no_return_date++;
        } else if (returnDate < periodStart) {
          locationBreakdown[loc.location].before_period++;
        } else if (returnDate >= periodStart && returnDate <= periodEnd) {
          locationBreakdown[loc.location].within_period++;
        } else {
          locationBreakdown[loc.location].after_period++;
        }
      });
    });

    analysis.location_breakdown = Object.values(locationBreakdown);
    return analysis;
  } catch (error) {
    console.error("Error in subtractRentedInventoryPerDate:", error);
    return {
      error: error.message,
      summary: {
        before_count: 0,
        within_count: 0,
        after_count: 0,
        no_return_date_count: 0,
        total_analyzed: 0,
      },
    };
  }
};
const calculateInventoryAvailabilityProjection = async (payload) => {
  try {
    const {
      // category_name,
      // item_group,
      // brand,
      // location,
      date_start,
      date_end,
      // company_id,
      // company_sql_id,
    } = payload;
    // Get owned inventory (permanent assets)
    const ownedInventory = await inventoryQuery({
      ...payload,
      ownership: "Permanent",
    });
    // Get rental inventory and analyze return dates
    const rentedInventory = await inventoryQuery({
      ...payload,
      ownership: "Rent",
    });
    const rentalAnalysis = await subtractRentedInventoryPerDate({
      ...rentedInventory,
      date_start,
      date_end,
    });
    // Get event inventory requirements for the period
    const eventInventory = await eventInventoryInPeriod(payload);
    // Calculate availability by location and item group
    const availabilityProjection = {};
    // Process owned inventory
    ownedInventory.locations.forEach((loc) => {
      if (!availabilityProjection[loc.location]) {
        availabilityProjection[loc.location] = {};
      }
      loc.items.forEach((item) => {
        const key = `${item.category_name}_${item.item_group}_${item.brand}`;
        if (!availabilityProjection[loc.location][key]) {
          availabilityProjection[loc.location][key] = {
            category: item.category_name,
            group: item.item_group,
            brand: item.brand,
            location: loc.location,
            owned_count: 0,
            rental_available_after_period: 0,
            rental_unavailable_before_within_period: 0,
            rental_no_return_date: 0,
            event_demand: 0,
            total_available: 0,
            net_availability: 0,
            restock_needed: false,
            availability_status: "sufficient",
          };
        }
        availabilityProjection[loc.location][key].owned_count += 1;
      });
    });
    // Process rental analysis
    if (rentalAnalysis.location_breakdown) {
      rentalAnalysis.location_breakdown.forEach((locBreakdown) => {
        const location = locBreakdown.location;
        // Group rental items by category, group, and brand
        const rentalByType = {};
        // Items returning AFTER period (AVAILABLE - count in total)
        rentalAnalysis.after_period.forEach((item) => {
          if (item.location === location) {
            const key = `${item.category_name}_${item.item_group}_${item.brand}`;
            if (!rentalByType[key])
              rentalByType[key] = {
                available_after: 0,
                unavailable_before_within: 0,
                no_date: 0,
              };
            rentalByType[key].available_after += 1;
          }
        });
        // Items returning BEFORE or WITHIN period (UNAVAILABLE - exclude from total)
        rentalAnalysis.before_period.forEach((item) => {
          if (item.location === location) {
            const key = `${item.category_name}_${item.item_group}_${item.brand}`;
            if (!rentalByType[key])
              rentalByType[key] = {
                available_after: 0,
                unavailable_before_within: 0,
                no_date: 0,
              };
            rentalByType[key].unavailable_before_within += 1;
          }
        });
        rentalAnalysis.within_period.forEach((item) => {
          if (item.location === location) {
            const key = `${item.category_name}_${item.item_group}_${item.brand}`;
            if (!rentalByType[key])
              rentalByType[key] = {
                available_after: 0,
                unavailable_before_within: 0,
                no_date: 0,
              };
            rentalByType[key].unavailable_before_within += 1;
          }
        });
        // Items with no return date (UNAVAILABLE - exclude from total)
        rentalAnalysis.no_return_date.forEach((item) => {
          if (item.location === location) {
            const key = `${item.category_name}_${item.item_group}_${item.brand}`;
            if (!rentalByType[key])
              rentalByType[key] = {
                available_after: 0,
                unavailable_before_within: 0,
                no_date: 0,
              };
            rentalByType[key].no_date += 1;
          }
        });
        // Update availability projection with rental data
        Object.keys(rentalByType).forEach((key) => {
          if (!availabilityProjection[location]) {
            availabilityProjection[location] = {};
          }
          if (!availabilityProjection[location][key]) {
            const [category, group, brand] = key.split("_");
            availabilityProjection[location][key] = {
              category,
              group,
              brand,
              location,
              owned_count: 0,
              rental_available_before_period: 0,
              rental_available_within_period: 0,
              rental_unavailable_after_period: 0,
              rental_no_return_date: 0,
              event_demand: 0,
              total_available: 0,
              net_availability: 0,
              restock_needed: false,
              availability_status: "sufficient",
            };
          }
          availabilityProjection[location][key].rental_available_after_period =
            rentalByType[key].available_after;
          availabilityProjection[location][
            key
          ].rental_unavailable_before_within_period =
            rentalByType[key].unavailable_before_within;
          availabilityProjection[location][key].rental_no_return_date =
            rentalByType[key].no_date;
        });
      });
    }
    // Process event demand
    if (eventInventory.device_counts) {
      eventInventory.device_counts.forEach((deviceCount) => {
        // For events, we need to estimate location impact
        // Since events might not have specific location data, distribute demand across all locations
        const locations = Object.keys(availabilityProjection);
        const demandPerLocation = Math.ceil(
          deviceCount.count / (locations.length || 1)
        );
        locations.forEach((location) => {
          const key = `${deviceCount.category}_${deviceCount.group}_${deviceCount.brand}`;
          if (
            availabilityProjection[location] &&
            availabilityProjection[location][key]
          ) {
            availabilityProjection[location][key].event_demand +=
              demandPerLocation;
          }
        });
      });
    }
    // Calculate final availability and recommendations
    const projectionSummary = {
      locations: [],
      overall_summary: {
        total_locations: 0,
        total_item_types: 0,
        sufficient_inventory: 0,
        restock_needed: 0,
        critical_shortage: 0,
      },
      period: {
        start: date_start,
        end: date_end,
      },
      chart_data: {
        availability_by_location: [],
        inventory_composition: [],
        demand_vs_supply: [],
      },
    };
    Object.keys(availabilityProjection).forEach((location) => {
      const locationData = {
        location,
        items: [],
        location_summary: {
          total_items: 0,
          available_items: 0,
          restock_needed: 0,
          availability_percentage: 0,
        },
      };
      Object.keys(availabilityProjection[location]).forEach((key) => {
        const item = availabilityProjection[location][key];
        // Calculate total available inventory (owned + rental items returning AFTER period)
        item.total_available =
          item.owned_count + item.rental_available_after_period;
        // Calculate net availability (available - demand)
        item.net_availability = item.total_available - item.event_demand;
        // Determine restock needs and status
        if (item.net_availability < 0) {
          item.restock_needed = true;
          item.availability_status = "critical_shortage";
        } else if (item.net_availability < item.event_demand * 0.2) {
          item.restock_needed = true;
          item.availability_status = "low_stock";
        } else {
          item.availability_status = "sufficient";
        }
        locationData.items.push(item);
        locationData.location_summary.total_items += 1;
        if (item.availability_status === "sufficient") {
          locationData.location_summary.available_items += 1;
        } else {
          locationData.location_summary.restock_needed += 1;
        }
      });
      locationData.location_summary.availability_percentage =
        locationData.location_summary.total_items > 0
          ? Math.round(
              (locationData.location_summary.available_items /
                locationData.location_summary.total_items) *
                100
            )
          : 0;
      projectionSummary.locations.push(locationData);
      // Update overall summary
      projectionSummary.overall_summary.total_item_types +=
        locationData.location_summary.total_items;
      projectionSummary.overall_summary.sufficient_inventory +=
        locationData.location_summary.available_items;
      projectionSummary.overall_summary.restock_needed +=
        locationData.location_summary.restock_needed;
    });
    projectionSummary.overall_summary.total_locations = Object.keys(
      availabilityProjection
    ).length;
    // Prepare chart data for client-side visualization
    projectionSummary.chart_data.availability_by_location =
      projectionSummary.locations.map((loc) => ({
        location: loc.location,
        available: loc.location_summary.available_items,
        restock_needed: loc.location_summary.restock_needed,
        availability_percentage: loc.location_summary.availability_percentage,
      }));
    projectionSummary.chart_data.inventory_composition =
      projectionSummary.locations.flatMap((loc) =>
        loc.items.map((item) => ({
          location: item.location,
          category: item.category,
          group: item.group,
          brand: item.brand,
          owned: item.owned_count,
          rental_available: item.rental_available_after_period,
          rental_unavailable:
            item.rental_unavailable_before_within_period +
            item.rental_no_return_date,
          total_available: item.total_available,
          demand: item.event_demand,
          net_availability: item.net_availability,
        }))
      );
    projectionSummary.chart_data.demand_vs_supply =
      projectionSummary.locations.flatMap((loc) =>
        loc.items.map((item) => ({
          item_key: `${item.category}_${item.group}_${item.brand}`,
          location: item.location,
          supply: item.total_available,
          demand: item.event_demand,
          surplus_deficit: item.net_availability,
          status: item.availability_status,
        }))
      );
    return projectionSummary;
  } catch (error) {
    console.error("Error in calculateInventoryAvailabilityProjection:", error);
    return {
      error: error.message,
      locations: [],
      overall_summary: {
        total_locations: 0,
        total_item_types: 0,
        sufficient_inventory: 0,
        restock_needed: 0,
        critical_shortage: 0,
      },
      chart_data: {
        availability_by_location: [],
        inventory_composition: [],
        demand_vs_supply: [],
      },
    };
  }
};
// Update the advanceSearchingQuery to include the availability projection
const comprehensiveInventoryAnalysis = async (payload) => {
  try {
    const {
      // category_name,
      // item_group,
      // brand,
      // location,
      // company_sql_id,
      date_start,
      date_end,
    } = payload;

    // Get all inventory (both Permanent and Rent)
    const permanentInventory = await inventoryQuery({
      ...payload,
      ownership: "Permanent",
    });

    const rentalInventory = await inventoryQuery({
      ...payload,
      ownership: "Rent",
    });

    // Analyze rental return dates if date range provided
    let rentalAnalysis = null;
    if (date_start && date_end) {
      rentalAnalysis = await subtractRentedInventoryPerDate({
        ...rentalInventory,
        date_start,
        date_end,
      });
    }

    // Structure the comprehensive analysis
    const analysis = {
      summary: {
        total_permanent_items: permanentInventory.total_items,
        total_rental_items: rentalInventory.total_items,
        total_locations: new Set([
          ...permanentInventory.locations.map((loc) => loc.location),
          ...rentalInventory.locations.map((loc) => loc.location),
        ]).size,
        analysis_period:
          date_start && date_end ? { start: date_start, end: date_end } : null,
      },

      inventory_by_ownership: {
        permanent: {
          total_items: permanentInventory.total_items,
          locations: permanentInventory.locations.map((loc) => ({
            location: loc.location,
            total_count: loc.total_count,
            items_by_category:
              comprehensiveInventoryAnalysis.groupItemsByCategory(loc.items),
            raw_items: loc.items.map((item) => ({
              serial_number: item.serial_number,
              location: item.location,
              current_location: item.current_location,
              item_group: item.item_group,
              category_name: item.category_name,
              brand: item.brand || "Unknown",
              image_url: item.image_url,
              main_warehouse: item.main_warehouse,
              ownership: "Permanent",
            })),
          })),
        },

        rental: {
          total_items: rentalInventory.total_items,
          locations: rentalInventory.locations.map((loc) => ({
            location: loc.location,
            total_count: loc.total_count,
            items_by_category:
              comprehensiveInventoryAnalysis.groupItemsByCategory(loc.items),
            items_by_return_date:
              comprehensiveInventoryAnalysis.groupRentalItemsByReturnDate(
                loc.items,
                date_start,
                date_end
              ),
            raw_items: loc.items.map((item) => ({
              serial_number: item.serial_number,
              location: item.location,
              current_location: item.current_location,
              item_group: item.item_group,
              category_name: item.category_name,
              brand: item.brand || "Unknown",
              return_date: item.return_date,
              cost: item.cost,
              status: item.status,
              image_url: item.image_url,
              main_warehouse: item.main_warehouse,
              ownership: "Rent",
              return_status:
                comprehensiveInventoryAnalysis.categorizeReturnDate(
                  item.return_date,
                  date_start,
                  date_end
                ),
            })),
          })),

          return_date_analysis: rentalAnalysis
            ? {
                before_period: {
                  count: rentalAnalysis.summary.before_count,
                  items: rentalAnalysis.before_period,
                },
                within_period: {
                  count: rentalAnalysis.summary.within_count,
                  items: rentalAnalysis.within_period,
                },
                after_period: {
                  count: rentalAnalysis.summary.after_count,
                  items: rentalAnalysis.after_period,
                },
                no_return_date: {
                  count: rentalAnalysis.summary.no_return_date_count,
                  items: rentalAnalysis.no_return_date,
                },
              }
            : null,
        },
      },

      location_summary: comprehensiveInventoryAnalysis.createLocationSummary(
        permanentInventory.locations,
        rentalInventory.locations
      ),

      restock_recommendations:
        comprehensiveInventoryAnalysis.generateRestockRecommendations(
          permanentInventory.locations,
          rentalInventory.locations,
          rentalAnalysis,
          date_start,
          date_end
        ),
    };

    return analysis;
  } catch (error) {
    console.error("Error in comprehensiveInventoryAnalysis:", error);
    return {
      error: error.message,
      summary: {
        total_permanent_items: 0,
        total_rental_items: 0,
        total_locations: 0,
      },
      inventory_by_ownership: {
        permanent: { total_items: 0, locations: [] },
        rental: { total_items: 0, locations: [], return_date_analysis: null },
      },
    };
  }
};
// Helper function to group items by category
comprehensiveInventoryAnalysis.groupItemsByCategory = function (items) {
  return items.reduce((acc, item) => {
    const category = item.category_name || "Unknown";
    const group = item.item_group || "Unknown";
    const brand = item.brand || "Unknown";

    const key = `${category}_${group}_${brand}`;

    if (!acc[key]) {
      acc[key] = {
        category_name: category,
        item_group: group,
        brand: brand,
        count: 0,
        items: [],
      };
    }

    acc[key].count += 1;
    acc[key].items.push({
      serial_number: item.serial_number,
      location: item.location,
      return_date: item.return_date || null,
    });

    return acc;
  }, {});
};
// Helper function to group rental items by return date
comprehensiveInventoryAnalysis.groupRentalItemsByReturnDate = function (
  items,
  dateStart,
  dateEnd
) {
  const groups = {
    no_return_date: { count: 0, items: [] },
    before_period: { count: 0, items: [] },
    within_period: { count: 0, items: [] },
    after_period: { count: 0, items: [] },
    all_dates: {},
  };

  items.forEach((item) => {
    const returnDate = item.return_date ? new Date(item.return_date) : null;
    const itemData = {
      serial_number: item.serial_number,
      item_group: item.item_group,
      category_name: item.category_name,
      brand: item.brand,
      return_date: item.return_date,
      cost: item.cost,
      status: item.status,
    };

    if (!returnDate) {
      groups.no_return_date.count += 1;
      groups.no_return_date.items.push(itemData);
    } else {
      // Group by specific return date
      const dateKey = returnDate.toISOString().split("T")[0]; // YYYY-MM-DD format
      if (!groups.all_dates[dateKey]) {
        groups.all_dates[dateKey] = { count: 0, items: [] };
      }
      groups.all_dates[dateKey].count += 1;
      groups.all_dates[dateKey].items.push(itemData);

      // Categorize by period if date range provided
      if (dateStart && dateEnd) {
        const periodStart = new Date(dateStart);
        const periodEnd = new Date(dateEnd);

        if (returnDate < periodStart) {
          groups.before_period.count += 1;
          groups.before_period.items.push(itemData);
        } else if (returnDate >= periodStart && returnDate <= periodEnd) {
          groups.within_period.count += 1;
          groups.within_period.items.push(itemData);
        } else {
          groups.after_period.count += 1;
          groups.after_period.items.push(itemData);
        }
      }
    }
  });

  return groups;
};
// Helper function to categorize return date status
comprehensiveInventoryAnalysis.categorizeReturnDate = function (
  returnDate,
  dateStart,
  dateEnd
) {
  if (!returnDate) return "no_return_date";
  if (!dateStart || !dateEnd) return "unknown_period";

  const returnDateObj = new Date(returnDate);
  const periodStart = new Date(dateStart);
  const periodEnd = new Date(dateEnd);

  if (returnDateObj < periodStart) return "before_period";
  if (returnDateObj >= periodStart && returnDateObj <= periodEnd)
    return "within_period";
  return "after_period";
};
// Helper function to create location summary
comprehensiveInventoryAnalysis.createLocationSummary = function (
  permanentLocations,
  rentalLocations
) {
  const locationMap = new Map();

  // Process permanent inventory locations
  permanentLocations.forEach((loc) => {
    if (!locationMap.has(loc.location)) {
      locationMap.set(loc.location, {
        location: loc.location,
        permanent_count: 0,
        rental_count: 0,
        total_count: 0,
        categories: new Set(),
        item_groups: new Set(),
        brands: new Set(),
      });
    }

    const locData = locationMap.get(loc.location);
    locData.permanent_count = loc.total_count;
    locData.total_count += loc.total_count;

    loc.items.forEach((item) => {
      locData.categories.add(item.category_name || "Unknown");
      locData.item_groups.add(item.item_group || "Unknown");
      locData.brands.add(item.brand || "Unknown");
    });
  });

  // Process rental inventory locations
  rentalLocations.forEach((loc) => {
    if (!locationMap.has(loc.location)) {
      locationMap.set(loc.location, {
        location: loc.location,
        permanent_count: 0,
        rental_count: 0,
        total_count: 0,
        categories: new Set(),
        item_groups: new Set(),
        brands: new Set(),
      });
    }

    const locData = locationMap.get(loc.location);
    locData.rental_count = loc.total_count;
    locData.total_count += loc.total_count;

    loc.items.forEach((item) => {
      locData.categories.add(item.category_name || "Unknown");
      locData.item_groups.add(item.item_group || "Unknown");
      locData.brands.add(item.brand || "Unknown");
    });
  });

  // Convert to array and format
  return Array.from(locationMap.values())
    .map((loc) => ({
      location: loc.location,
      permanent_count: loc.permanent_count,
      rental_count: loc.rental_count,
      total_count: loc.total_count,
      categories: Array.from(loc.categories),
      item_groups: Array.from(loc.item_groups),
      brands: Array.from(loc.brands),
      diversity_score:
        loc.categories.size + loc.item_groups.size + loc.brands.size,
    }))
    .sort((a, b) => b.total_count - a.total_count);
};
// Helper function to generate restock recommendations
comprehensiveInventoryAnalysis.generateRestockRecommendations = function (
  permanentLocations,
  rentalLocations,
  rentalAnalysis,
  dateStart,
  dateEnd
) {
  const recommendations = [];
  // Analyze each location
  const allLocations = new Set([
    ...permanentLocations.map((loc) => loc.location),
    ...rentalLocations.map((loc) => loc.location),
  ]);
  allLocations.forEach((location) => {
    const permLoc = permanentLocations.find((loc) => loc.location === location);
    const rentLoc = rentalLocations.find((loc) => loc.location === location);
    const permanentCount = permLoc ? permLoc.total_count : 0;
    const rentalCount = rentLoc ? rentLoc.total_count : 0;
    const totalInventory = permanentCount + rentalCount;
    // Calculate rental availability if analysis provided
    let availableRentals = rentalCount;
    if (rentalAnalysis && rentalAnalysis.location_breakdown) {
      const locAnalysis = rentalAnalysis.location_breakdown.find(
        (loc) => loc.location === location
      );
      if (locAnalysis) {
        // Items returning after period are available
        availableRentals =
          locAnalysis.after_period + locAnalysis.no_return_date;
      }
    }
    const effectiveInventory = permanentCount + availableRentals;
    // Generate recommendations based on inventory levels
    let recommendation = {
      location: location,
      permanent_inventory: permanentCount,
      rental_inventory: rentalCount,
      available_rentals: availableRentals,
      effective_inventory: effectiveInventory,
      recommendation_level: "sufficient",
      actions: [],
      priority: "low",
    };
    // Determine recommendation level
    if (effectiveInventory === 0) {
      recommendation.recommendation_level = "critical";
      recommendation.priority = "high";
      recommendation.actions.push(
        "Immediate restocking required - no available inventory"
      );
    } else if (effectiveInventory < 5) {
      recommendation.recommendation_level = "low_stock";
      recommendation.priority = "medium";
      recommendation.actions.push("Consider restocking - low inventory levels");
    } else if (permanentCount === 0 && rentalCount > 0) {
      recommendation.recommendation_level = "rental_dependent";
      recommendation.priority = "medium";
      recommendation.actions.push(
        "Consider acquiring permanent inventory to reduce rental dependency"
      );
    }
    // Add specific category/group recommendations if available
    if (permLoc) {
      const categoryGroups =
        comprehensiveInventoryAnalysis.groupItemsByCategory(permLoc.items);
      Object.values(categoryGroups).forEach((group) => {
        if (group.count < 2) {
          recommendation.actions.push(
            `Low stock in ${group.category_name} - ${group.item_group} (${group.count} items)`
          );
        }
      });
    }
    recommendations.push(recommendation);
  });
  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
};
const dailyEventInventorySchedule = async (payload) => {
  try {
    const {
      company_id,
      item_group,
      category_name,
      brand,
      date_start,
      date_end,
    } = payload;
    // Convert dates to proper format
    const startDate = new Date(date_start);
    const endDate = new Date(date_end);
    // Build query for active events in the period
    const params = {
      company_id: company_id,
      type: "event",
      active: true,
      // Check for events that overlap with the period
      $or: [
        {
          // Event starts within the period
          "eventInfoDetail.dateBegin": {
            $gte: startDate.toISOString(),
            $lte: endDate.toISOString(),
          },
        },
        {
          // Event ends within the period
          "eventInfoDetail.dateEnd": {
            $gte: startDate.toISOString(),
            $lte: endDate.toISOString(),
          },
        },
        {
          // Event spans the entire period (starts before, ends after)
          $and: [
            { "eventInfoDetail.dateBegin": { $lte: startDate.toISOString() } },
            { "eventInfoDetail.dateEnd": { $gte: endDate.toISOString() } },
          ],
        },
      ],
    };
    // Get all active events in the period
    const eventList = await Event.find(params).lean();
    // Create date range array
    const dateRange = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      dateRange.push(new Date(currentDate).toISOString().split("T")[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    // Initialize daily inventory structure
    const dailyInventory = {};
    dateRange.forEach((date) => {
      dailyInventory[date] = {
        date: date,
        total_inventory_demand: 0,
        events_active: [],
        device_breakdown: {},
      };
    });
    // Process each event and its device inventory
    eventList.forEach((event) => {
      const eventStart = new Date(event.eventInfoDetail?.dateBegin);
      const eventEnd = new Date(event.eventInfoDetail?.dateEnd);
      // Process device setup for this event
      if (event.deviceSetup && Array.isArray(event.deviceSetup)) {
        event.deviceSetup.forEach((device) => {
          const category = device.category || "unknown_category";
          const group = device.group || "unknown_group";
          const deviceBrand = device.brand || "unknown_brand";
          const quantity = device.quantity || 1;
          // Apply search parameter filters
          let includeDevice = true;
          if (
            category_name &&
            category_name !== "undefined" &&
            category !== category_name
          ) {
            includeDevice = false;
          }
          if (
            item_group &&
            item_group !== "undefined" &&
            group !== item_group
          ) {
            includeDevice = false;
          }
          if (brand && brand !== "undefined" && deviceBrand !== brand) {
            includeDevice = false;
          }
          if (includeDevice) {
            const deviceKey = `${category}_${group}_${deviceBrand}`;
            // Add inventory demand for each day the event is active
            dateRange.forEach((dateStr) => {
              const checkDate = new Date(dateStr);
              // Check if this date falls within the event period
              if (checkDate >= eventStart && checkDate <= eventEnd) {
                // Add to total inventory demand for this day
                dailyInventory[dateStr].total_inventory_demand += quantity;
                // Add event info if not already present
                const existingEvent = dailyInventory[
                  dateStr
                ].events_active.find(
                  (e) => e.event_id.toString() === event._id.toString()
                );
                if (!existingEvent) {
                  dailyInventory[dateStr].events_active.push({
                    event_id: event._id,
                    event_name:
                      event.eventInfoDetail?.eventName || "Unknown Event",
                    date_begin: event.eventInfoDetail?.dateBegin,
                    date_end: event.eventInfoDetail?.dateEnd,
                    ownership: device.ownership,
                  });
                }
                // Add device breakdown
                if (!dailyInventory[dateStr].device_breakdown[deviceKey]) {
                  dailyInventory[dateStr].device_breakdown[deviceKey] = {
                    category: category,
                    group: group,
                    brand: deviceBrand,
                    total_quantity: 0,
                    events_using: [],
                  };
                }
                dailyInventory[dateStr].device_breakdown[
                  deviceKey
                ].total_quantity += quantity;

                // Add event to device breakdown if not already present
                const existingDeviceEvent = dailyInventory[
                  dateStr
                ].device_breakdown[deviceKey].events_using.find(
                  (e) => e.event_id.toString() === event._id.toString()
                );

                if (!existingDeviceEvent) {
                  dailyInventory[dateStr].device_breakdown[
                    deviceKey
                  ].events_using.push({
                    event_id: event._id,
                    event_name:
                      event.eventInfoDetail?.eventName || "Unknown Event",
                    quantity: quantity,
                    ownership: device.ownership,
                  });
                }
              }
            });
          }
        });
      }
    });
    // Calculate summary statistics
    const summaryStats = {
      total_days: dateRange.length,
      days_with_events: 0,
      peak_inventory_demand: 0,
      peak_inventory_date: null,
      total_unique_events: eventList.length,
      average_daily_demand: 0,
    };
    let totalDemandAcrossPeriod = 0;
    Object.keys(dailyInventory).forEach((date) => {
      const dayData = dailyInventory[date];
      if (dayData.events_active.length > 0) {
        summaryStats.days_with_events++;
      }
      if (dayData.total_inventory_demand > summaryStats.peak_inventory_demand) {
        summaryStats.peak_inventory_demand = dayData.total_inventory_demand;
        summaryStats.peak_inventory_date = date;
      }
      totalDemandAcrossPeriod += dayData.total_inventory_demand;
    });
    summaryStats.average_daily_demand =
      Math.round((totalDemandAcrossPeriod / dateRange.length) * 100) / 100;
    return {
      success: true,
      period: {
        date_start,
        date_end,
        total_days: dateRange.length,
      },
      search_filters_applied: {
        category_name: category_name || null,
        item_group: item_group || null,
        brand: brand || null,
      },
      summary_statistics: summaryStats,
      daily_schedule: dailyInventory,
      events_found: eventList.map((event) => ({
        event_id: event._id,
        event_name: event.eventInfoDetail?.eventName || "Unknown Event",
        date_begin: event.eventInfoDetail?.dateBegin,
        date_end: event.eventInfoDetail?.dateEnd,
        active: event.active,
        device_count: event.deviceSetup ? event.deviceSetup.length : 0,
      })),
    };
  } catch (error) {
    console.error("Error in dailyEventInventorySchedule:", error);
    return {
      success: false,
      error: error.message,
      period: {
        date_start: payload.date_start,
        date_end: payload.date_end,
      },
      search_filters_applied: {
        category_name: payload.category_name || null,
        item_group: payload.item_group || null,
        brand: payload.brand || null,
      },
      summary_statistics: null,
      daily_schedule: {},
      events_found: [],
    };
  }
};
const getActiveEventsWithTimeline = async (payload) => {
  try {
    const {
      company_id,
      item_group,
      category_name,
      brand,
      date_start,
      date_end,
      rentedInventory,
      ownedInventory,
    } = payload;
    // Convert dates to proper format
    const startDate = new Date(date_start);
    const endDate = new Date(date_end);
    // Build query for active events in the period
    const params = {
      company_id: company_id,
      type: "event",
      active: true,
      // Check for events that overlap with the period
      $or: [
        {
          // Event starts within the period
          "eventInfoDetail.dateBegin": {
            $gte: startDate.toISOString(),
            $lte: endDate.toISOString(),
          },
        },
        {
          // Event ends within the period
          "eventInfoDetail.dateEnd": {
            $gte: startDate.toISOString(),
            $lte: endDate.toISOString(),
          },
        },
        {
          // Event spans the entire period (starts before, ends after)
          $and: [
            { "eventInfoDetail.dateBegin": { $lte: startDate.toISOString() } },
            { "eventInfoDetail.dateEnd": { $gte: endDate.toISOString() } },
          ],
        },
      ],
    };
    // Get all active events in the period
    const eventList = await Event.find(params).lean();
    // Filter events and their deviceSetup based on search parameters
    const filteredEvents = [];
    eventList.forEach((event) => {
      if (event.deviceSetup && Array.isArray(event.deviceSetup)) {
        // Filter deviceSetup based on search parameters
        const matchingDevices = event.deviceSetup.filter((device) => {
          const category = device.category || "";
          const group = device.group || "";
          const deviceBrand = device.brand || "";

          // Apply search parameter filters
          let includeDevice = true;

          // Check category_name (if not null/undefined)
          if (
            category_name &&
            category_name !== "null" &&
            category_name !== "undefined" &&
            category !== category_name
          ) {
            includeDevice = false;
          }
          // Check item_group (if not null/undefined)
          if (
            item_group &&
            item_group !== "null" &&
            item_group !== "undefined" &&
            group !== item_group
          ) {
            includeDevice = false;
          }
          // Check brand (if not null/undefined)
          if (
            brand &&
            brand !== "null" &&
            brand !== "undefined" &&
            deviceBrand !== brand
          ) {
            includeDevice = false;
          }
          return includeDevice;
        });
        // Only include event if it has matching devices
        if (matchingDevices.length > 0) {
          filteredEvents.push({
            eventInfoDetail: {
              eventName: event.eventInfoDetail?.eventName || "Unknown Event",
              dateBegin: event.eventInfoDetail?.dateBegin,
              dateEnd: event.eventInfoDetail?.dateEnd,
            },
            deviceSetup: matchingDevices.map((device) => ({
              category: device.category,
              group: device.group,
              brand: device.brand,
              quantity: device.quantity || 1,
            })),
          });
        }
      }
    });
    // Create date range array
    const dateRange = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      dateRange.push(new Date(currentDate).toISOString().split("T")[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    // Initialize daily timeline
    const dailyTimeline = dateRange.map((date) => ({
      date: date,
      total_available: rentedInventory.total_items + ownedInventory.total_items,
      total_demand: 0,
      total_inventory: rentedInventory.total_items + ownedInventory.total_items,
    }));

    // Calculate daily demand based on filtered events
    filteredEvents.forEach((event) => {
      const eventStart = new Date(event.eventInfoDetail.dateBegin);
      const eventEnd = new Date(event.eventInfoDetail.dateEnd);

      // Calculate total quantity for this event
      const eventTotalQuantity = event.deviceSetup.reduce((sum, device) => {
        return sum + (device.quantity || 1);
      }, 0);

      // Apply demand to each day the event is active
      dailyTimeline.forEach((dayData) => {
        const checkDate = new Date(dayData.date + "T00:00:00.000Z");

        // Normalize dates to compare only the date part (ignore time)
        const eventStartDate = new Date(
          eventStart.toISOString().split("T")[0] + "T00:00:00.000Z"
        );
        const eventEndDate = new Date(
          eventEnd.toISOString().split("T")[0] + "T00:00:00.000Z"
        );

        // Check if this date falls within the event period (inclusive)
        if (checkDate >= eventStartDate && checkDate <= eventEndDate) {
          dayData.total_demand += eventTotalQuantity;
          dayData.total_available -= eventTotalQuantity;
        }
      });
    });
    return {
      success: true,
      events_found: filteredEvents,
      daily_timeline: dailyTimeline,
      period: {
        date_start,
        date_end,
        total_days: dateRange.length,
      },
      search_filters_applied: {
        category_name: category_name === "null" ? null : category_name,
        item_group: item_group === "null" ? null : item_group,
        brand: brand === "null" ? null : brand,
      },
      summary: {
        total_events_found: filteredEvents.length,
        total_events_in_period: eventList.length,
        peak_demand: Math.max(...dailyTimeline.map((d) => d.total_demand)),
        days_with_demand: dailyTimeline.filter((d) => d.total_demand > 0)
          .length,
      },
    };
  } catch (error) {
    console.error("Error in getActiveEventsWithTimeline:", error);
    return {
      success: false,
      error: error.message,
      events_found: [],
      daily_timeline: [],
      period: {
        date_start: payload.date_start,
        date_end: payload.date_end,
      },
      search_filters_applied: {
        category_name:
          payload.category_name === "null" ? null : payload.category_name,
        item_group: payload.item_group === "null" ? null : payload.item_group,
        brand: payload.brand === "null" ? null : payload.brand,
      },
      summary: {
        total_events_found: 0,
        total_events_in_period: 0,
        peak_demand: 0,
        days_with_demand: 0,
      },
    };
  }
};
const dailyInventoryCount = async (payload) => {
  try {
    const {
      category_name,
      item_group,
      brand,
      location,
      date_start,
      date_end,
      company_id,
      company_sql_id,
    } = payload;
    const connection = getConnection();
    // Build base query conditions for filtering
    let baseConditions = `company_id = ?`;
    const baseParams = [company_sql_id];
    if (
      category_name &&
      category_name !== "undefined" &&
      category_name !== "null"
    ) {
      baseConditions += ` AND category_name = ?`;
      baseParams.push(category_name);
    }
    if (item_group && item_group !== "undefined" && item_group !== "null") {
      baseConditions += ` AND item_group = ?`;
      baseParams.push(item_group);
    }
    if (brand && brand !== "undefined" && brand !== "null") {
      baseConditions += ` AND brand = ?`;
      baseParams.push(brand);
    }
    if (location && location !== "undefined" && location !== "null") {
      baseConditions += ` AND location = ?`;
      baseParams.push(location);
    }
    // Get permanent inventory count (always available)
    const permanentQuery = `SELECT COUNT(*) as count FROM item_inv WHERE ownership = 'Permanent' AND ${baseConditions}`;
    const [permanentResult] = await connection.execute(
      permanentQuery,
      baseParams
    );
    const permanentInventoryCount = permanentResult[0].count;
    // Generate date range
    const startDate = new Date(date_start);
    const endDate = new Date(date_end);
    const dailyTimeline = [];
    // Iterate through each day in the period
    for (
      let currentDate = new Date(startDate);
      currentDate <= endDate;
      currentDate.setDate(currentDate.getDate() + 1)
    ) {
      const dateString = currentDate.toISOString().split("T")[0]; // YYYY-MM-DD format
      // Create date boundaries for the current day
      const dayStart = new Date(currentDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(currentDate);
      dayEnd.setUTCHours(23, 59, 59, 999);
      // Count rental inventory available on this day (return_date > current day OR return_date IS NULL)
      // Items are available if their return date is AFTER the current day
      const rentalAvailableQuery = `
        SELECT COUNT(*) as count 
        FROM item_inv 
        WHERE ownership = 'Rent' 
        AND ${baseConditions}
        AND (
          return_date > ? 
          OR return_date IS NULL
        )
      `;
      const rentalAvailableParams = [...baseParams, dayEnd.toISOString()];
      const [rentalAvailableResult] = await connection.execute(
        rentalAvailableQuery,
        rentalAvailableParams
      );
      const rentalInventoryAvailable = rentalAvailableResult[0].count;
      // Count rental items being returned today (return_date falls within current day)
      const rentalReturnedTodayQuery = `
        SELECT COUNT(*) as count 
        FROM item_inv 
        WHERE ownership = 'Rent' 
        AND ${baseConditions}
        AND return_date >= ? 
        AND return_date <= ?
        AND return_date IS NOT NULL
      `;
      const rentalReturnedParams = [
        ...baseParams,
        dayStart.toISOString(),
        dayEnd.toISOString(),
      ];
      const [rentalReturnedResult] = await connection.execute(
        rentalReturnedTodayQuery,
        rentalReturnedParams
      );
      const rentalItemsReturnedToday = rentalReturnedResult[0].count;
      // Calculate total inventory for the day
      const totalInventoryForDay =
        permanentInventoryCount + rentalInventoryAvailable;
      dailyTimeline.push({
        date: dateString,
        total_inventory: totalInventoryForDay,
        permanent_inventory: permanentInventoryCount,
        rental_inventory_available: rentalInventoryAvailable,
        rental_items_returned_today: rentalItemsReturnedToday,
      });
    }
    // Get summary statistics for rental inventory
    const totalRentalQuery = `SELECT COUNT(*) as count FROM item_inv WHERE ownership = 'Rent' AND ${baseConditions}`;
    const [totalRentalResult] = await connection.execute(
      totalRentalQuery,
      baseParams
    );
    const totalRentalItems = totalRentalResult[0].count;
    const rentalWithReturnDateQuery = `
      SELECT COUNT(*) as count 
      FROM item_inv 
      WHERE ownership = 'Rent' 
      AND ${baseConditions}
      AND return_date IS NOT NULL
    `;
    const [rentalWithReturnDateResult] = await connection.execute(
      rentalWithReturnDateQuery,
      baseParams
    );
    const rentalItemsWithReturnDate = rentalWithReturnDateResult[0].count;
    // Calculate summary statistics
    const summary = {
      period: {
        start: date_start,
        end: date_end,
        total_days: dailyTimeline.length,
      },
      inventory_summary: {
        permanent_inventory_count: permanentInventoryCount,
        total_rental_items: totalRentalItems,
        rental_items_with_return_date: rentalItemsWithReturnDate,
        rental_items_without_return_date:
          totalRentalItems - rentalItemsWithReturnDate,
      },
      daily_statistics: {
        max_inventory: Math.max(
          ...dailyTimeline.map((day) => day.total_inventory)
        ),
        min_inventory: Math.min(
          ...dailyTimeline.map((day) => day.total_inventory)
        ),
        avg_inventory: Math.round(
          dailyTimeline.reduce((sum, day) => sum + day.total_inventory, 0) /
            dailyTimeline.length
        ),
      },
    };
    // Get location breakdown for permanent inventory
    const permanentLocationQuery = `
      SELECT location, COUNT(*) as count 
      FROM item_inv 
      WHERE ownership = 'Permanent' AND ${baseConditions}
      GROUP BY location 
      ORDER BY location
    `;
    const [permanentLocationResult] = await connection.execute(
      permanentLocationQuery,
      baseParams
    );
    // Get location breakdown for rental inventory
    const rentalLocationQuery = `
      SELECT location, COUNT(*) as count 
      FROM item_inv 
      WHERE ownership = 'Rent' AND ${baseConditions}
      GROUP BY location 
      ORDER BY location
    `;
    const [rentalLocationResult] = await connection.execute(
      rentalLocationQuery,
      baseParams
    );
    // Apply search parameter filters for detailed breakdown
    const searchFiltersApplied = {
      category_name: category_name || "all",
      item_group: item_group || "all",
      brand: brand || "all",
      location: location || "all",
    };
    return {
      success: true,
      daily_timeline: dailyTimeline,
      summary,
      search_filters_applied: searchFiltersApplied,
      permanent_inventory_details: {
        total_items: permanentInventoryCount,
        locations: permanentLocationResult.map((loc) => ({
          location: loc.location,
          count: loc.count,
        })),
      },
      rental_inventory_details: {
        total_items: totalRentalItems,
        locations: rentalLocationResult.map((loc) => ({
          location: loc.location,
          count: loc.count,
        })),
      },
    };
  } catch (error) {
    console.error("Error in dailyInventoryCount:", error);
    return {
      success: false,
      error: error.message,
      daily_timeline: [],
      summary: {
        period: { start: date_start, end: date_end, total_days: 0 },
        inventory_summary: {
          permanent_inventory_count: 0,
          total_rental_items: 0,
          rental_items_with_return_date: 0,
          rental_items_without_return_date: 0,
        },
        daily_statistics: {
          max_inventory: 0,
          min_inventory: 0,
          avg_inventory: 0,
        },
      },
    };
  }
};
const inventoryView = async (payload) => {
  try {
    const { eventCount, view } = payload;
    const eventView = eventCount.map((event, index) => ({
      ...event,
      total_available: view[index].total_inventory - event.total_demand,
      total_inventory: view[index].total_inventory,
      total_porcentage: (event.total_available / event.total_inventory) * 100,

    }));
    return eventView;
  } catch (error) {
    console.error("Error in inventoryView:", error);
    return {
      success: false,
      error: error.message,
      eventCount: [],
      view: [],
    };
  }
};
const advanceSearchingQuery = async (request, response) => {
  try {
    const payload = {
      category_name: request.query.category,
      item_group: request.query.group,
      brand: request.query.brand,
      location: request.query.location,
      date_start: request.query.date_start,
      date_end: request.query.date_end,
      company_id: request.query.company_id,
      company_sql_id: request.query.company_sql_id,
    };
    const ownedInventory = await inventoryQuery({
      ...payload,
      ownership: "Permanent",
    });
    const rentedInventory = await inventoryQuery({
      ...payload,
      ownership: "Rent",
    });
    const rentalAnalysis = await subtractRentedInventoryPerDate({
      ...rentedInventory,
      date_start: payload.date_start,
      date_end: payload.date_end,
    });
    const eventInventoryBreakDownTimeline = await getActiveEventsWithTimeline({
      ...payload,
      rentedInventory,
      ownedInventory,
    });
    const eventInventory = await eventInventoryInPeriod(payload);
    const scheduledEventsInventory = await dailyEventInventorySchedule(payload);
    const daily_inventory_count = await dailyInventoryCount(payload);
    const availabilityProjection =
      await calculateInventoryAvailabilityProjection(payload);
    const inventoryView_ = await inventoryView({
      eventCount: eventInventoryBreakDownTimeline.daily_timeline,
      view: daily_inventory_count.daily_timeline,
    });
    response.status(200).json({
      ok: true,
      ownedInventory,
      rentedInventory,
      rentalAnalysis,
      eventInventory,
      availabilityProjection,
      chartData: availabilityProjection.chart_data,
      availabilityProjection,
      scheduledEventsInventory,
      breakdown: eventInventoryBreakDownTimeline,
      dailyCount: daily_inventory_count,
      inventoryView: inventoryView_,
    });
  } catch (error) {
    response.status(500).json({
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
