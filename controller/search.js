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

/**
 * A keyword typed into the global search bar is user input. Escape it before it
 * reaches a Mongo $regex or a SQL LIKE so metacharacters match literally
 * instead of throwing ("C++") or matching every row ("%").
 */
const escapeRegex = (value) =>
  String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const escapeLike = (value) =>
  String(value ?? "").replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * SHOW COLUMNS is cheap and cached per process. Resolving the real column list
 * keeps the search resilient to schema drift: a column that isn't there is
 * simply not searched, instead of turning the whole query into a 500.
 */
const tableColumnsCache = new Map();
const getTableColumns = async (table) => {
  if (tableColumnsCache.has(table)) {
    return tableColumnsCache.get(table);
  }
  const connection = getConnection();
  const [described] = await connection.query(`SHOW COLUMNS FROM \`${table}\``);
  const columns = new Set(described.map((column) => column.Field));
  tableColumnsCache.set(table, columns);
  return columns;
};

const buildLikeClause = (columns, needle, alias = null) => ({
  clause: columns
    .map(
      (column) =>
        `${alias ? `${alias}.` : ""}\`${column}\` LIKE ?`
    )
    .join(" OR "),
  params: columns.map(() => needle),
});

/**
 * What makes an open lease match a keyword. Parameterised by the item alias so
 * the same list drives both the Assigned bucket (which selects lease rows) and
 * the item_id set that Inventory subtracts — they must never drift apart, or the
 * two buckets stop partitioning the units.
 */
const leaseMatchConditions = (itemAlias) => [
  `${itemAlias}.\`serial_number\` LIKE ?`,
  `${itemAlias}.\`item_group\` LIKE ?`,
  `${itemAlias}.\`category_name\` LIKE ?`,
  `${itemAlias}.\`brand\` LIKE ?`,
  "mi.`first_name` LIKE ?",
  "mi.`last_name` LIKE ?",
  "mi.`email` LIKE ?",
  "CONCAT_WS(' ', mi.`first_name`, mi.`last_name`) LIKE ?",
  "madl.`location` LIKE ?",
];

/**
 * The exact set of item_ids the Assigned bucket will show for this keyword.
 * Inventory excludes this set so the section counts add up to the header total.
 */
const matchedLeaseItemsSql = (needle, companyId) => {
  const conditions = leaseMatchConditions("ii2");
  return {
    sql: `SELECT DISTINCT ii2.item_id
            FROM member_assigned_device_lease madl
            JOIN item_inv ii2 ON ii2.item_id = madl.device_id
            LEFT JOIN members_info mi ON mi.member_id = madl.member_id
           WHERE madl.\`company_id\` = ?
             AND (madl.\`returned\` = 0 OR madl.\`returned\` IS NULL)
             AND (${conditions.join(" OR ")})`,
    params: [companyId, ...conditions.map(() => needle)],
  };
};

/**
 * item_inv and members_info are keyed by the MySQL company id, but this
 * endpoint is called with the Mongo company id. Use the SQL id when the client
 * sends it, otherwise resolve it from company_info by name.
 */
const resolveCompanySqlId = async (companyInfo, providedSqlId) => {
  const asNumber = Number(providedSqlId);
  if (providedSqlId && Number.isFinite(asNumber)) {
    return asNumber;
  }
  if (!companyInfo?.company_name) {
    return null;
  }
  try {
    const connection = getConnection();
    const [rows] = await connection.execute(
      "SELECT company_id FROM company_info WHERE company_name = ? LIMIT 1",
      [companyInfo.company_name]
    );
    return rows[0]?.company_id ?? null;
  } catch (error) {
    console.error("resolveCompanySqlId:", error.message);
    return null;
  }
};

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
  const safe = escapeRegex(variable);
  const query = {
    $or: [
      { name: { $regex: safe, $options: "i" } },
      { lastName: { $regex: safe, $options: "i" } },
      { email: { $regex: safe, $options: "i" } },
      // so a full name typed as one string still matches
      {
        $expr: {
          $regexMatch: {
            input: {
              $concat: [
                { $ifNull: ["$name", ""] },
                " ",
                { $ifNull: ["$lastName", ""] },
              ],
            },
            regex: safe,
            options: "i",
          },
        },
      },
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
  const safe = escapeRegex(variable);
  return await Transaction.find({
    $or: [
      { paymentIntent: variable },
      { clientSecret: variable },
      { "consumerInfo.name": { $regex: safe, $options: "i" } },
      { "consumerInfo.lastName": { $regex: safe, $options: "i" } },
      { "consumerInfo.email": { $regex: safe, $options: "i" } },
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
  const safe = escapeRegex(variable);
  const query = {
    $or: [
      { paymentIntent: variable },
      { user: { $regex: safe, $options: "i" } },
      { "device.serialNumber": { $regex: safe, $options: "i" } },
      { "device.deviceType": { $regex: safe, $options: "i" } },
      { eventSelected: { $regex: safe, $options: "i" } },
    ],
    company: { $in: [company] },
  };
  if (lastId) {
    query._id = { $gt: new mongoose.Types.ObjectId(lastId) };
  }
  const limit = 11;
  // `results` is a capped page for display; `total` and `serials` cover the whole
  // match set, so the header count and the Inventory subtraction don't silently
  // work off the first ten rows only.
  const [results, total, serials] = await Promise.all([
    Receivers.find(query).sort({ _id: 1 }).limit(limit),
    Receivers.countDocuments(query),
    Receivers.distinct("device.serialNumber", query),
  ]);
  const hasMore = results.length === limit;
  if (hasMore) {
    results.pop();
  }
  return {
    deviceTransaction: results,
    total,
    serials: serials.filter(Boolean),
    hasMore,
  };
};

const searchingDevicePool = async (variable, company, lastId = null) => {
  const result = new Set();
  const safe = escapeRegex(variable);
  const query = {
    $or: [
      { device: { $regex: safe, $options: "i" } },
      { type: { $regex: safe, $options: "i" } },
      { eventSelected: { $regex: safe, $options: "i" } },
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

/**
 * Company inventory lives in MySQL (item_inv), which the global search used to
 * ignore entirely -- so a keyword like "Chromebook" (an item_group / category /
 * brand value) returned nothing even when hundreds of units were on the books.
 * Returns the matching units plus a category/group/brand rollup so the UI can
 * answer "how many Chromebooks do we have" without paging the whole list.
 */
const INVENTORY_DETAIL_LIMIT = 120;
const INVENTORY_SEARCHABLE_COLUMNS = [
  "serial_number",
  "item_group",
  "category_name",
  "brand",
  "descript_item",
  "location",
  "sub_location",
  "current_location",
  "warehouse",
  "ownership",
  "status",
  "extra_serial_number",
];
const INVENTORY_RETURN_COLUMNS = [
  "item_id",
  "category_name",
  "item_group",
  "brand",
  "descript_item",
  "serial_number",
  "location",
  "sub_location",
  "current_location",
  "ownership",
  "status",
  "cost",
  "image_url",
  "return_date",
  "company_id",
];

const searchingInventory = async (
  variable,
  company_sql_id,
  excludeSerials = []
) => {
  const empty = {
    items: [],
    groups: [],
    total: 0,
    matchedTotal: 0,
    elsewhereTotal: 0,
    hasMore: false,
  };
  if (!variable || !company_sql_id) {
    return empty;
  }
  try {
    const connection = getConnection();
    const existing = await getTableColumns("item_inv");
    const searchable = INVENTORY_SEARCHABLE_COLUMNS.filter((column) =>
      existing.has(column)
    );
    if (searchable.length === 0) {
      return empty;
    }
    const needle = `%${escapeLike(variable)}%`;
    const serials = [...new Set((excludeSerials ?? []).filter(Boolean))];
    const lease = matchedLeaseItemsSql(needle, String(company_sql_id));

    // every matching unit, whichever bucket ends up showing it -- this is what
    // the group rollup reports, so "how many Chromebooks do we have" still works
    const { clause, params } = buildLikeClause(searchable, needle);
    const matchWhere = `company_id = ? AND (${clause})`;
    const matchValues = [company_sql_id, ...params];

    // the Inventory bucket proper: matching units that no *other* bucket shows.
    // Subtracting exactly the rows Assigned/Devices display is what makes the
    // section counts add up to the header total instead of overlapping it.
    let shownWhere = `${matchWhere} AND item_id NOT IN (${lease.sql})`;
    const shownValues = [...matchValues, ...lease.params];
    if (serials.length > 0) {
      shownWhere += ` AND (serial_number IS NULL OR serial_number NOT IN (?))`;
      shownValues.push(serials);
    }

    const selectList = INVENTORY_RETURN_COLUMNS.filter((column) =>
      existing.has(column)
    )
      .map((column) => `\`${column}\``)
      .join(", ");
    const groupColumns = ["category_name", "item_group", "brand"].filter(
      (column) => existing.has(column)
    );
    const aliasedGroupColumns = groupColumns
      .map((column) => `ii.\`${column}\``)
      .join(", ");
    const groupLike = buildLikeClause(searchable, needle, "ii");

    const [matchedRows, shownRows, itemRows, groupRows] = await Promise.all([
      connection.query(
        `SELECT COUNT(*) AS total FROM item_inv WHERE ${matchWhere}`,
        matchValues
      ),
      connection.query(
        `SELECT COUNT(*) AS total FROM item_inv WHERE ${shownWhere}`,
        shownValues
      ),
      connection.query(
        `SELECT ${selectList} FROM item_inv WHERE ${shownWhere}
          ORDER BY \`item_group\` ASC, \`serial_number\` ASC
          LIMIT ${INVENTORY_DETAIL_LIMIT + 1}`,
        shownValues
      ),
      groupColumns.length > 0
        ? // the rollup keeps the whole picture: per group, how many exist and how
          // many of those are out on an assignment
          connection.query(
            `SELECT ${aliasedGroupColumns}, COUNT(*) AS total,
                    SUM(CASE WHEN L.item_id IS NULL THEN 0 ELSE 1 END) AS assigned
               FROM item_inv ii
               LEFT JOIN (${lease.sql}) L ON L.item_id = ii.item_id
              WHERE ii.company_id = ? AND (${groupLike.clause})
              GROUP BY ${aliasedGroupColumns}
              ORDER BY total DESC
              LIMIT 40`,
            [...lease.params, company_sql_id, ...groupLike.params]
          )
        : Promise.resolve([[]]),
    ]);

    const items = itemRows[0];
    const hasMore = items.length > INVENTORY_DETAIL_LIMIT;
    if (hasMore) {
      items.pop();
    }
    const matchedTotal = Number(matchedRows[0][0]?.total ?? 0);
    const total = Number(shownRows[0][0]?.total ?? items.length);
    return {
      items,
      groups: groupRows[0],
      // what this section shows, and therefore contributes to the header
      total,
      // every matching unit, including the ones another bucket is showing
      matchedTotal,
      elsewhereTotal: Math.max(0, matchedTotal - total),
      hasMore,
    };
  } catch (error) {
    console.error("searchingInventory:", error.message);
    return { ...empty, error: error.message };
  }
};

/**
 * The people a company hands devices to (members_info) -- "students" in the
 * education accounts. Also MySQL-only, also previously unsearchable.
 */
const MEMBER_DETAIL_LIMIT = 60;
const MEMBER_SEARCHABLE_COLUMNS = [
  "first_name",
  "last_name",
  "email",
  "phone_number",
  "address",
  "address_street",
  "address_city",
  "address_state",
  "address_zip",
];
const MEMBER_RETURN_COLUMNS = [
  "member_id",
  "first_name",
  "last_name",
  "email",
  "phone_number",
  "address",
  "address_street",
  "address_city",
  "address_state",
  "address_zip",
  "image_url",
  "company_id",
];

const searchingMembers = async (variable, company_sql_id) => {
  const empty = { members: [], total: 0, hasMore: false };
  if (!variable || !company_sql_id) {
    return empty;
  }
  try {
    const connection = getConnection();
    const existing = await getTableColumns("members_info");
    const searchable = MEMBER_SEARCHABLE_COLUMNS.filter((column) =>
      existing.has(column)
    );
    if (searchable.length === 0) {
      return empty;
    }
    const needle = `%${escapeLike(variable)}%`;
    const { clause, params } = buildLikeClause(searchable, needle);
    const conditions = [clause];
    // members_info.company_id is varchar -- bind a string so the index is usable
    const values = [String(company_sql_id), ...params];
    // so a full name typed as one string ("Jane Doe") still matches
    if (existing.has("first_name") && existing.has("last_name")) {
      conditions.push("CONCAT_WS(' ', `first_name`, `last_name`) LIKE ?");
      values.push(needle);
    }
    const where = `company_id = ? AND (${conditions.join(" OR ")})`;
    const selectList = MEMBER_RETURN_COLUMNS.filter((column) =>
      existing.has(column)
    )
      .map((column) => `\`${column}\``)
      .join(", ");

    const [countRows, memberRows] = await Promise.all([
      connection.execute(
        `SELECT COUNT(*) AS total FROM members_info WHERE ${where}`,
        values
      ),
      connection.execute(
        `SELECT ${selectList} FROM members_info WHERE ${where}
          ORDER BY \`last_name\` ASC, \`first_name\` ASC
          LIMIT ${MEMBER_DETAIL_LIMIT + 1}`,
        values
      ),
    ]);

    const members = memberRows[0];
    const hasMore = members.length > MEMBER_DETAIL_LIMIT;
    if (hasMore) {
      members.pop();
    }
    return {
      members,
      total: countRows[0][0]?.total ?? members.length,
      hasMore,
    };
  } catch (error) {
    console.error("searchingMembers:", error.message);
    return { ...empty, error: error.message };
  }
};

/**
 * Units currently in someone's hands, the members way: member_assigned_device_lease
 * joined to the item and the person holding it.
 *
 * The Mongo `Receivers` collection only covers the event-checkout flow (consumer
 * + paymentIntent + event), which a school district never uses — so without this
 * a district could not answer "who has this Chromebook, and when is it due?".
 *
 * Only open leases are returned: this bucket means "out right now", not history.
 */
const ASSIGNMENT_DETAIL_LIMIT = 60;

const searchingMemberAssignments = async (variable, company_sql_id) => {
  const empty = { assignments: [], total: 0, overdue: 0, hasMore: false };
  if (!variable || !company_sql_id) {
    return empty;
  }
  try {
    const connection = getConnection();
    const needle = `%${escapeLike(variable)}%`;
    // company_id is varchar on the members tables -- bind a string so the index
    // is usable instead of forcing MySQL to cast the column
    const companyId = String(company_sql_id);
    const conditions = leaseMatchConditions("ii");
    const where =
      "madl.`company_id` = ? AND (madl.`returned` = 0 OR madl.`returned` IS NULL)" +
      ` AND (${conditions.join(" OR ")})`;
    const values = [companyId, ...conditions.map(() => needle)];

    const from = `FROM member_assigned_device_lease madl
        JOIN item_inv ii ON ii.item_id = madl.device_id
        LEFT JOIN members_info mi ON mi.member_id = madl.member_id`;

    const [countRows, assignmentRows] = await Promise.all([
      connection.execute(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN madl.expected_return_date IS NOT NULL
                          AND madl.expected_return_date < NOW()
                         THEN 1 ELSE 0 END) AS overdue
           ${from} WHERE ${where}`,
        values
      ),
      connection.execute(
        `SELECT madl.lease_id, madl.member_id, madl.assigned_date,
                madl.expected_return_date, madl.location AS lease_location,
                madl.staff_member_id, madl.returned,
                mi.first_name, mi.last_name, mi.email, mi.image_url,
                ii.item_id, ii.serial_number, ii.item_group, ii.category_name,
                ii.brand, ii.status
           ${from} WHERE ${where}
          ORDER BY madl.expected_return_date IS NULL,
                   madl.expected_return_date ASC
          LIMIT ${ASSIGNMENT_DETAIL_LIMIT + 1}`,
        values
      ),
    ]);

    const assignments = assignmentRows[0];
    const hasMore = assignments.length > ASSIGNMENT_DETAIL_LIMIT;
    if (hasMore) {
      assignments.pop();
    }
    return {
      assignments,
      total: countRows[0][0]?.total ?? assignments.length,
      overdue: Number(countRows[0][0]?.overdue ?? 0),
      hasMore,
    };
  } catch (error) {
    console.error("searchingMemberAssignments:", error.message);
    return { ...empty, error: error.message };
  }
};

/**
 * The header count must not bill the same physical unit twice. A Chromebook that
 * is both on the books and in a student's hands shows up in the Inventory bucket
 * *and* the Assigned bucket — two lenses, one laptop.
 *
 * So the unit total is |inventory ∪ open leases ∪ event checkouts|, deduped on
 * item_id. Event checkouts live in Mongo and are keyed by serial: one that
 * resolves to an item_inv row is that unit, one that doesn't (the AV demo data
 * uses a separate serial namespace) counts on its own.
 *
 * People and events are different kinds of thing from units, so they still add:
 * matching a student *and* the laptop they hold is genuinely two results.
 */
const countDistinctUnits = async (variable, company_sql_id, checkoutSerials) => {
  const serials = [...new Set((checkoutSerials ?? []).filter(Boolean))];
  if (!variable || !company_sql_id) {
    return serials.length;
  }
  try {
    const connection = getConnection();
    const needle = `%${escapeLike(variable)}%`;
    const companyId = String(company_sql_id);
    const existing = await getTableColumns("item_inv");
    const inventoryColumns = INVENTORY_SEARCHABLE_COLUMNS.filter((column) =>
      existing.has(column)
    );

    const arms = [];
    const params = [];

    if (inventoryColumns.length > 0) {
      const { clause, params: likeParams } = buildLikeClause(
        inventoryColumns,
        needle
      );
      arms.push(
        `SELECT item_id FROM item_inv WHERE company_id = ? AND (${clause})`
      );
      params.push(company_sql_id, ...likeParams);
    }

    const lease = matchedLeaseItemsSql(needle, companyId);
    arms.push(lease.sql);
    params.push(...lease.params);

    // checkout serials that ARE inventory rows fold into the same set
    if (serials.length > 0) {
      arms.push(
        `SELECT item_id FROM item_inv WHERE company_id = ? AND serial_number IN (?)`
      );
      params.push(company_sql_id, serials);
    }

    // UNION (not UNION ALL) is what does the de-duplication on item_id
    const [unionRows] = await connection.query(
      `SELECT COUNT(*) AS units FROM (${arms.join(" UNION ")}) u`,
      params
    );
    let units = Number(unionRows[0]?.units ?? 0);

    // ...and the ones that aren't inventory rows stand on their own
    if (serials.length > 0) {
      const [knownRows] = await connection.query(
        `SELECT COUNT(DISTINCT serial_number) AS known FROM item_inv
          WHERE company_id = ? AND serial_number IN (?)`,
        [company_sql_id, serials]
      );
      units += serials.length - Number(knownRows[0]?.known ?? 0);
    }
    return units;
  } catch (error) {
    console.error("countDistinctUnits:", error.message);
    return serials.length;
  }
};

/**
 * Warehouses / rooms a keyword might name, with the unit count behind each one.
 */
const searchingInventoryLocations = async (variable, company_sql_id) => {
  const empty = { locations: [] };
  if (!variable || !company_sql_id) {
    return empty;
  }
  try {
    const connection = getConnection();
    const existing = await getTableColumns("locations");
    if (!existing.has("location_name")) {
      return empty;
    }
    const needle = `%${escapeLike(variable)}%`;
    const [rows] = await connection.execute(
      `SELECT l.location_id, l.location_name,
              (SELECT COUNT(*) FROM item_inv i
                WHERE i.location_id = l.location_id) AS item_count
         FROM locations l
        WHERE l.company_id = ? AND l.location_name LIKE ?
        ORDER BY l.location_name ASC
        LIMIT 25`,
      [company_sql_id, needle]
    );
    return { locations: rows };
  } catch (error) {
    console.error("searchingInventoryLocations:", error.message);
    return { ...empty, error: error.message };
  }
};

const searchingEvents = async (props) => {
  const { variable, company } = props;
  const safe = escapeRegex(variable);
  const query = {
    $or: [
      { "eventInfoDetail.eventName": { $regex: safe, $options: "i" } },
      { "eventInfoDetail.dateBegin": { $regex: safe, $options: "i" } },
      { "eventInfoDetail.address": { $regex: safe, $options: "i" } },
      { user: { $regex: safe, $options: "i" } },
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
  for (let employee of employees ?? []) {
    const ref = JSON.stringify(employee);
    // case-insensitive: consumers/devices/events all match with $options "i"
    if (String(ref).toLowerCase().includes(String(variable).toLowerCase())) {
      const query = {
        email: JSON.parse(ref).user,
      };
      const staffFound = await AdminUser.find(query);
      result.push(staffFound[0]);
    }
  }
  // an employee invited but never registered has no AdminUser doc -- dropping
  // those keeps the result count honest instead of padding it with undefined
  return result.flat().filter(Boolean);
};

const searching = async (req, res) => {
  // const { variable, company } = req.body;
  const variable = req.query.variable;
  const company = req.query.company;
  try {
    const companyInfo = await searchingCompanyInfo(company);
    const companySqlId = await resolveCompanySqlId(
      companyInfo,
      req.query.company_sql_id
    );
    // The event-checkout serials have to be known before Inventory runs, because
    // Inventory subtracts whatever another bucket is already showing.
    const deviceTransactionFound = await searchingDeviceTransaction(
      variable,
      company
    );
    const checkoutSerials = deviceTransactionFound.serials ?? [];

    const [
      consumerFound,
      transactionFound,
      devicePoolFound,
      eventFound,
      staffFound,
      inventoryFound,
      memberFound,
      inventoryLocationFound,
      memberAssignmentFound,
      unitTotal,
    ] = await Promise.all([
      searchingConsumer(variable, company),
      searchingTransaction(variable, company),
      searchingDevicePool(variable, company),
      searchingEvents({
        variable: variable,
        company: companyInfo.company_name,
      }),
      searchingStaff({
        variable: variable,
        employees: companyInfo.employees,
      }),
      searchingInventory(variable, companySqlId, checkoutSerials),
      searchingMembers(variable, companySqlId),
      searchingInventoryLocations(variable, companySqlId),
      searchingMemberAssignments(variable, companySqlId),
      // One physical unit = one result, however many buckets surface it.
      countDistinctUnits(variable, companySqlId, checkoutSerials),
    ]);
    const totals = {
      units: unitTotal,
      consumers: consumerFound.consumers?.length ?? 0,
      staff: staffFound.length,
      members: memberFound.total ?? 0,
      events: eventFound.results?.length ?? 0,
      // how `units` splits across the buckets that render it -- these add up to
      // `units`, which is what lets the sections reconcile to the header
      unitsByBucket: {
        inventory: inventoryFound.total ?? 0,
        eventCheckouts: deviceTransactionFound.total ?? 0,
        assigned: memberAssignmentFound.total ?? 0,
      },
    };
    totals.all =
      totals.units +
      totals.consumers +
      totals.staff +
      totals.members +
      totals.events;

    return res.status(200).json({
      ok: true,
      comps: companyInfo,
      company_sql_id: companySqlId,
      totals,
      consumer: consumerFound,
      transaction: transactionFound,
      deviceTransaction: deviceTransactionFound,
      devicePool: devicePoolFound,
      event: eventFound,
      staff: staffFound,
      inventory: inventoryFound,
      member: memberFound,
      inventoryLocation: inventoryLocationFound,
      memberAssignment: memberAssignmentFound,
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
