/**
 * Summit AV Rentals — polished, client-ready demo seeder (DUAL database).
 * Writes coherent data to BOTH local MongoDB and local MySQL so the full
 * dual-DB app (including multi-company login) works end-to-end.
 *
 * Usage (from server-testing/):
 *   node seed/seed-summit.js --wipe
 *   node seed/seed-summit.js --wipe-only
 *
 * Env / flags:
 *   --mongo=mongodb://127.0.0.1:27017/devitrak_demo   (default)
 *   --owner=cacaminero@contextglobal.com  → folded in as Root administrator (role 0)
 *   MySQL: local socket/root by default (127.0.0.1:3306 devitrak_db).
 *
 * Safety: local-only (mongo host must be localhost). Demo company has a fixed
 * Mongo _id so --wipe is precise; SQL rows are removed by company_name/company_id.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

const Company = require("../models/Company");
const AdminUser = require("../models/AdminUser");
const Event = require("../models/Event");
const Item = require("../models/Item");
const Inventory = require("../models/Inventory");
const User = require("../models/User");
const Receivers = require("../models/Receivers");
const Transaction = require("../models/Transaction");
const StripeTransaction = require("../models/StripeTransaction");
const Post = require("../models/Post");

const argv = process.argv.slice(2);
const args = new Set(argv);
const getArg = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const WIPE = args.has("--wipe") || args.has("--wipe-only");
const WIPE_ONLY = args.has("--wipe-only");
const DRY = args.has("--dry-run");

const MONGO_URI = getArg("mongo", "mongodb://127.0.0.1:27017/devitrak_demo");
const OWNER_EMAIL = getArg("owner", "cacaminero@contextglobal.com").toLowerCase();
const OWNER_PASSWORD = getArg("password", "DemoPass123!");

const COMPANY_NAME = "Summit AV Rentals";
const COMPANY_ID = "5000000000000000000a0001"; // fixed Mongo _id (recognizable)
const DOMAIN = "summitavrentals.com";
const NOW = Date.now();
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const pad = (n, l = 4) => String(n).padStart(l, "0");

// --- realistic pools -------------------------------------------------------
const STAFF = [
  ["Marcus", "Reyes", 0], ["Priya", "Chandra", 1], ["Daniel", "OConnor", 1],
  ["Sofia", "Nakamura", 2], ["Andre", "Willis", 2], ["Grace", "Kim", 3],
  ["Tomas", "Herrera", 3], ["Nadia", "Farouk", 4], ["Ben", "Whitfield", 4],
  ["Elena", "Rossi", 2], ["Jamal", "Carter", 1], ["Lily", "Zhang", 3],
];
const CONSUMERS = [
  ["Olivia", "Bennett"], ["Ethan", "Morales"], ["Ava", "Thompson"], ["Liam", "Patel"],
  ["Sophia", "Nguyen"], ["Noah", "Ramirez"], ["Isabella", "Cohen"], ["Mason", "Brooks"],
  ["Mia", "Fitzgerald"], ["Lucas", "Turner"], ["Amelia", "Diaz"], ["Henry", "Foster"],
  ["Charlotte", "Reed"], ["Jack", "Sullivan"], ["Harper", "Nolan"], ["Leo", "Vance"],
  ["Zoe", "Mercer"], ["Owen", "Castillo"],
];
const EVENTS = [
  ["Horizon Tech Summit 2026", "Moscone Center", "San Francisco", "CA", "94103", NOW - 1 * DAY, NOW + 3 * DAY, true, "active"],
  ["Northwest Media Expo", "Washington State Convention Center", "Seattle", "WA", "98101", NOW - 2 * DAY, NOW + 1 * DAY, true, "active"],
  ["Skyline Developer Conference 2025", "McCormick Place", "Chicago", "IL", "60616", NOW - 42 * DAY, NOW - 39 * DAY, false, "completed"],
  ["Coastal Marketing Forum", "San Diego Convention Center", "San Diego", "CA", "92101", NOW - 75 * DAY, NOW - 73 * DAY, false, "completed"],
  ["Summit Product Launch 2026", "Javits Center", "New York", "NY", "10001", NOW + 26 * DAY, NOW + 29 * DAY, true, "upcoming"],
  ["Global Partners Assembly", "Orange County Convention Center", "Orlando", "FL", "32819", NOW + 60 * DAY, NOW + 63 * DAY, true, "upcoming"],
];
const DEVICE_TYPES = [
  ["Receivers", "Sennheiser EK 6042", "285.00"],
  ["Chargers", "Charging Case 8-slot", "60.00"],
];

const roleName = (n) => ["Root administrator", "Administrator", "Manager", "Support", "Staff Event Assistant"][n] ?? "Staff";
const managerPref = (loc) => ({
  inventory_location: [loc],
  managerLocation: [{ location: loc, actions: { create: true, update: true, transfer: true, delete: true, assign: true, view: true } }],
});

async function wipeMongo() {
  const C = COMPANY_ID;
  const r = {
    companies: await Company.deleteMany({ _id: C }),
    events: await Event.deleteMany({ company_id: C }),
    items: await Item.deleteMany({ company: C }),
    inventories: await Inventory.deleteMany({ company: C }),
    users: await User.deleteMany({ company_providers: C }),
    receivers: await Receivers.deleteMany({ company: C }),
    transactions: await Transaction.deleteMany({ company: C }),
    stripetransactions: await StripeTransaction.deleteMany({ company: C }),
    posts: await Post.deleteMany({ company_id: C }),
    // demo staff (fictional @domain) — but NOT the real owner account
    staff: await AdminUser.deleteMany({ company: C, email: { $regex: `@${DOMAIN}$` } }),
  };
  console.log("🧹 Mongo wiped:", Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.deletedCount])));
}

async function wipeSql(conn) {
  const [[co]] = await conn.query("SELECT company_id FROM company_info WHERE company_name=?", [COMPANY_NAME]);
  const cid = co?.company_id;
  const tables = [
    ["stripe_info", "company_id", cid],
    ["event_info", "company_assigned_event_id", cid],
    ["company_info", "company_name", COMPANY_NAME],
    ["staff_member", "email", `%@${DOMAIN}`],
    ["consumer_info", "email", "%@summit-attendee.com"],
    ["item_inv", "company_id", String(cid ?? "")],
  ];
  for (const [t, col, val] of tables) {
    if (val === undefined || val === null || val === "") continue;
    const op = String(val).includes("%") ? "LIKE" : "=";
    await conn.query(`DELETE FROM \`${t}\` WHERE \`${col}\` ${op} ?`, [val]);
  }
  // locations + sub-locations for this company
  if (cid) {
    await conn.query(
      "DELETE FROM sub_locations WHERE location_id IN (SELECT location_id FROM locations WHERE company_id=?)",
      [cid]
    );
    await conn.query("DELETE FROM locations WHERE company_id=?", [cid]);
  }
  // also remove the owner's staff_member row so re-runs don't duplicate
  await conn.query("DELETE FROM staff_member WHERE email=?", [OWNER_EMAIL]);
  console.log("🧹 SQL wiped for", COMPANY_NAME);
}

async function seed(conn) {
  const summary = {};

  // ---- MySQL: company + stripe first (need company_id) ----
  const [companyRes] = await conn.query(
    `INSERT INTO company_info (company_name, street_address, city_address, state_address, zip_address, phone_number, email_company, industry)
     VALUES (?,?,?,?,?,?,?,?)`,
    [COMPANY_NAME, "500 Harrison St", "San Francisco", "CA", "94105", "(415) 555-0170", `ops@${DOMAIN}`, "Audio Visual Rental"]
  );
  const sqlCompanyId = companyRes.insertId;
  await conn.query(`INSERT INTO stripe_info (stripe_id, company_id) VALUES (?,?)`, ["acct_demo_summit", sqlCompanyId]);
  summary.sql_company_id = sqlCompanyId;

  // ---- Mongo: staff AdminUsers (numeric roles) ----
  // NOTE: AdminUser.password has a UNIQUE index → each hash must differ, so use a fresh salt per user.
  const hash = (s) => bcrypt.hashSync(s, bcrypt.genSaltSync());
  const staffDocs = STAFF.map(([first, last, role], i) => ({
    name: first, lastName: last,
    email: `${first}.${last}@${DOMAIN}`.toLowerCase(),
    phone: `(415) 555-${pad(200 + i, 4)}`,
    password: hash(OWNER_PASSWORD),
    question: "Demo security question", answer: hash("summit"),
    role: String(role), active: i % 11 !== 10, company: COMPANY_ID,
    super_user: role === 0, agreedPlatformConditions: true,
  }));
  const staff = DRY ? staffDocs : await AdminUser.insertMany(staffDocs);
  summary.staff = staff.length;

  // ---- Owner (real user) folded in as Root admin (role 0) ----
  let owner = await AdminUser.findOne({ email: OWNER_EMAIL });
  const ownerFields = {
    name: "Cesar", lastName: "Caminero", email: OWNER_EMAIL,
    password: hash(OWNER_PASSWORD),
    question: "Demo security question", answer: hash("summit"),
    role: "0", active: true, company: COMPANY_ID, super_user: true,
    multipleCompanies: true, agreedPlatformConditions: true,
  };
  if (!DRY) {
    if (owner) { await AdminUser.updateOne({ _id: owner._id }, { $set: ownerFields }); owner = await AdminUser.findById(owner._id); }
    else owner = await AdminUser.create(ownerFields);
  }

  // ---- Mongo Company with employees (numeric roles + preference) ----
  const loc = "Main Warehouse";
  const employees = [
    { user: OWNER_EMAIL, firstName: "Cesar", lastName: "Caminero", email: OWNER_EMAIL, employee_id: "EMP-0001", status: "Active", super_user: true, role: "0", active: true, preference: managerPref(loc), userId: DRY ? undefined : owner._id },
    ...STAFF.map(([first, last, role], i) => ({
      user: `${first}.${last}@${DOMAIN}`.toLowerCase(), firstName: first, lastName: last,
      email: `${first}.${last}@${DOMAIN}`.toLowerCase(), employee_id: `EMP-${pad(i + 2)}`,
      status: "Active", super_user: role === 0, role: String(role), active: staffDocs[i].active,
      preference: managerPref(loc), userId: DRY ? undefined : staff[i]._id,
    })),
  ];
  if (!DRY) await Company.create({
    _id: new mongoose.Types.ObjectId(COMPANY_ID),
    company_name: COMPANY_NAME,
    address: { street: "500 Harrison St", city: "San Francisco", state: "California", postal_code: "94105" },
    location: [loc, "Staging Area"],
    phone: { main: "(415) 555-0170", alternative: "(415) 555-0171", fax: "(415) 555-0172" },
    owner: { first_name: "Cesar", last_name: "Caminero", email: OWNER_EMAIL },
    website: `https://${DOMAIN}`, main_email: `hello@${DOMAIN}`,
    industry: "Audio Visual Rental", stripe_customer_id: "cus_demo_summit",
    employees, company_logo: "",
  });
  summary.company = 1;

  // ---- Events (Mongo) + event_info (SQL) ----
  const eventDocs = EVENTS.map(([name, venue, city, state, zip, begin, end, active, status], i) => ({
    user: employees[1].email, company: COMPANY_NAME, company_id: COMPANY_ID, subscription: [],
    eventInfoDetail: {
      eventName: name, eventLocation: `${city}, ${state}`, address: `${venue}, ${city} ${state}, ${zip}`,
      building: venue, floor: "Exhibit Hall", phoneNumber: ["(415) 555-0170"], merchant: COMPANY_NAME,
      dateBegin: iso(begin), dateEnd: iso(end), dateBeginTime: begin, dateEndTime: end, daysBeforeEvent: 3, daysAfterEvent: 2,
    },
    staff: {
      adminUser: [{ firstName: STAFF[i][0], lastName: STAFF[i][1], email: `${STAFF[i][0]}.${STAFF[i][1]}@${DOMAIN}`.toLowerCase(), role: "Administrator" }],
      headsetAttendees: [{ firstName: STAFF[(i + 5) % STAFF.length][0], lastName: STAFF[(i + 5) % STAFF.length][1], email: `${STAFF[(i + 5) % STAFF.length][0]}.${STAFF[(i + 5) % STAFF.length][1]}@${DOMAIN}`.toLowerCase(), role: "HeadsetAttendees" }],
    },
    contactInfo: { name: `${STAFF[i][0]} ${STAFF[i][1]}`, email: `${STAFF[i][0]}.${STAFF[i][1]}@${DOMAIN}`.toLowerCase(), phone: ["(415) 555-0170"] },
    deviceSetup: DEVICE_TYPES.map(([cat, grp, val], k) => ({
      category: cat, group: grp, value: val, description: `${grp} for ${name}`, company: COMPANY_ID,
      isItSetAsContainerForEvent: false, quantity: k === 0 ? 60 : 25, ownership: "Rent", container: false,
      createdBy: "summit-seed", key: `ds_${i}_${grp}`.replace(/\s+/g, "_"), dateCreated: new Date(NOW).toString(),
      resume: `${cat} ${grp} ${val}`, consumerUses: true, startingNumber: String(1000 + k * 1000), endingNumber: String(1000 + k * 1000 + (k === 0 ? 59 : 24)), existing: false,
    })),
    extraServicesNeeded: false, extraServices: [], active, qrCodeLink: `https://app.devitrak.net/e/summit-${i}`,
    type: "event", show: active, legal_contract: false,
    logistic_inventory_status: status === "completed" ? "received" : "no_received_yet",
    configuration: status === "upcoming" ? "in-progress" : "completed",
  }));
  const events = DRY ? eventDocs.map((d, i) => ({ ...d, _id: `dry${i}` })) : await Event.insertMany(eventDocs);
  const eventIds = events.map((e) => String(e._id));
  const eventNames = EVENTS.map((e) => e[0]);
  summary.events = events.length;

  if (!DRY) for (let i = 0; i < EVENTS.length; i++) {
    const [n, venue, city, state, zip] = EVENTS[i];
    await conn.query(
      `INSERT INTO event_info (event_name, venue_name, street_address, city_address, state_address, zip_address, email_company, phone_number, company_assigned_event_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [n, venue, "", city, state, zip, `ops@${DOMAIN}`, "(415) 555-0170", sqlCompanyId]
    );
  }

  // ---- Items + Inventory (Mongo) + item_inv (SQL) ----
  const itemDefs = [
    ["Receivers", "Sennheiser EK 6042", "285.00", "Bodypack receiver"],
    ["Chargers", "Charging Case 8-slot", "60.00", "8-slot charging case"],
    ["Accessories", "Over-ear Headset", "35.00", "Comfort-fit headset"],
    ["Tablets", "Check-in iPad", "650.00", "Registration desk tablet"],
  ];
  const itemDocs = itemDefs.map(([cat, grp, val, desc], i) => ({
    category: cat, group: grp, value: val, description: desc, company: COMPANY_ID, quantity: "120",
    ownership: i % 2 ? "Rent" : "Company", createdBy: "summit-seed", key: `item_${grp}`.replace(/\s+/g, "_"),
    dateCreated: new Date(NOW).toISOString().slice(0, 10), resume: `${cat} ${grp} ${val} ${desc}`, consumerUses: true,
  }));
  if (!DRY) {
    await Item.insertMany(itemDocs);
    await Inventory.insertMany(eventDocs.map((_, i) => ({ batch: `BATCH-${pad(i + 1, 3)}`, company: COMPANY_ID, event: eventIds[i], items: itemDocs, saveDefaultFormat: false })));
    // SQL locations + sub-locations, then serialized item_inv units assigned to them
    const [locRes] = await conn.query(
      "INSERT INTO locations (company_id, location_name, status) VALUES (?, 'Main Warehouse', 'active')",
      [sqlCompanyId]
    );
    const locationId = locRes.insertId;
    const [subRes] = await conn.query("INSERT INTO sub_locations (location_id, name) VALUES (?, 'Shelf A')", [locationId]);
    const subId = subRes.insertId;
    await conn.query("INSERT INTO sub_locations (location_id, name) VALUES (?, 'Shelf B')", [locationId]);
    for (let i = 0; i < 40; i++) {
      const t = DEVICE_TYPES[i % 2];
      await conn.query(
        `INSERT INTO item_inv (category_name, item_group, cost, brand, descript_item, ownership, serial_number, company, company_id, location, location_id, sub_location, sub_location_id, current_location, status, logistic_status, enableAssignFeature, display_item)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [t[0], t[1], t[2], "Sennheiser", `${t[1]} unit`, "Rent", `SAV-${pad(1001 + i)}`, COMPANY_NAME, String(sqlCompanyId), "Main Warehouse", locationId, "Shelf A", subId, "Main Warehouse", "Operational", "in-stock", 1, 1]
      );
    }
  }
  summary.items = itemDocs.length;
  summary.sql_item_units = DRY ? 0 : 40;

  // ---- Consumers (Mongo) + consumer_info (SQL) ----
  const TIED = 14, UNTIED = 4;
  const consumerDocs = CONSUMERS.map(([first, last], i) => {
    const tied = i < TIED;
    const evIdx = i % eventIds.length;
    return {
      name: first, lastName: last,
      email: `${first}.${last}@summit-attendee.com`.toLowerCase(),
      phoneNumber: 4155560000 + i, privacyPolicy: true, category: "Regular", provider: [COMPANY_NAME],
      eventSelected: tied ? [eventNames[evIdx]] : [], company_providers: [COMPANY_ID],
      event_providers: tied ? [eventIds[evIdx]] : [],
      notes: i % 6 === 0 ? [{ company: COMPANY_ID, date: new Date(NOW - i * DAY), notes: "Priority attendee — VIP badge." }] : [],
    };
  });
  const consumers = DRY ? consumerDocs.map((d, i) => ({ ...d, _id: `dryc${i}` })) : await User.insertMany(consumerDocs);
  summary.consumers = consumers.length;
  if (!DRY) for (const [first, last] of CONSUMERS) {
    await conn.query(`INSERT INTO consumer_info (first_name, last_name, email, phone_number) VALUES (?,?,?,?)`,
      [first, last, `${first}.${last}@summit-attendee.com`.toLowerCase(), "(415) 555-0190"]);
  }

  // ---- SQL staff_member rows (staff + owner) for consulting-member ----
  if (!DRY) {
    for (const [first, last] of STAFF) {
      await conn.query(`INSERT INTO staff_member (first_name, last_name, email, phone_number) VALUES (?,?,?,?)`,
        [first, last, `${first}.${last}@${DOMAIN}`.toLowerCase(), "(415) 555-0170"]);
    }
    await conn.query(`INSERT INTO staff_member (first_name, last_name, email, phone_number) VALUES (?,?,?,?)`,
      ["Cesar", "Caminero", OWNER_EMAIL, "(415) 555-0170"]);
  }

  // ---- Receivers + Transactions (Mongo) ----
  if (!DRY) {
    const receiverDocs = [], txDocs = [], stripeDocs = [];
    for (let i = 0; i < TIED; i++) {
      const c = consumers[i], evIdx = i % eventIds.length, out = i % 3 !== 0;
      receiverDocs.push({ device: { serialNumber: `SAV-${pad(1001 + i)}`, deviceType: "Sennheiser EK 6042", status: out },
        paymentIntent: `pi_summit_${pad(i)}`, user: c.email, active: out, eventSelected: [eventNames[evIdx]],
        provider: [COMPANY_NAME], company: COMPANY_ID, timeStamp: new Date(NOW - i * DAY), event_id: eventIds[evIdx] });
      const lost = i % 4 === 0;
      txDocs.push({ device: [{ deviceNeeded: 1, deviceType: "Sennheiser EK 6042", deviceValue: "285.00" }],
        paymentIntent: `pi_summit_${pad(i)}`, clientSecret: `seti_summit_${pad(i)}`,
        consumerInfo: { id: String(c._id), uid: String(c._id), email: c.email, name: c.name, lastName: c.lastName, data: { event_providers: [eventIds[evIdx]], company_providers: [COMPANY_ID], eventSelected: [eventNames[evIdx]], provider: [COMPANY_NAME] } },
        eventSelected: eventNames[evIdx], event_id: eventIds[evIdx], provider: COMPANY_NAME, date: iso(NOW - i * DAY),
        active: true, company: COMPANY_ID, created_at: NOW - i * DAY, type: lost ? "lost_device_fee" : "deposit" });
      stripeDocs.push({ device: 1, paymentIntent: `pi_summit_${pad(i)}`, clientSecret: `seti_summit_${pad(i)}`, user: c._id,
        eventSelected: eventNames[evIdx], provider: COMPANY_NAME, company: COMPANY_ID, type: lost ? "lost_device_fee" : "event" });
    }
    await Receivers.insertMany(receiverDocs);
    await Transaction.insertMany(txDocs);
    await StripeTransaction.insertMany(stripeDocs);
    summary.receivers = receiverDocs.length;
    summary.transactions = txDocs.length;
  }

  // ---- FAQ Posts ----
  if (!DRY) {
    const faqs = [
      ["Where do I pick up my device?", "Device pickup", "Head to the Summit AV desk near registration with a photo ID."],
      ["What if my device is lost?", "Lost device policy", "A replacement fee applies to the card on file. Report losses to any staff member."],
      ["How do I return my device?", "Returns", "Drop it at the return station before the event closes to avoid extra charges."],
      ["Is a deposit required?", "Deposits", "A refundable hold is placed at pickup and released on return in good condition."],
    ];
    await Post.insertMany(faqs.map(([title, subtitle, description]) => ({
      title, subtitle, description, displayed_in: eventIds, media: { cover: "", content: [] }, company_id: COMPANY_ID, published: true,
    })));
    summary.posts = faqs.length;
  }

  return summary;
}

(async () => {
  if (!/127\.0\.0\.1|localhost/i.test(MONGO_URI)) {
    console.error("❌ Refusing: this seeder is local-only (mongo must be localhost).");
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  // Local-only seeder → always the local MySQL (ignore prod PlanetScale env from .env).
  const conn = await mysql.createConnection({
    host: getArg("sql-host", "127.0.0.1"), port: Number(getArg("sql-port", "3306")),
    user: getArg("sql-user", "root"), password: getArg("sql-pass", ""),
    database: getArg("sql-db", "devitrak_db"),
  });
  console.log(`🔌 Mongo: ${mongoose.connection.db.databaseName} | MySQL: devitrak_db`);
  try {
    if (WIPE) { await wipeMongo(); await wipeSql(conn); }
    if (WIPE_ONLY) { console.log("✅ Wipe-only done."); return; }
    const summary = await seed(conn);
    console.log(`\n✅ "${COMPANY_NAME}" seeded across Mongo + MySQL:`);
    for (const [k, v] of Object.entries(summary)) console.log(`   ${k}: ${v}`);
    console.log(`\n   Owner login: ${OWNER_EMAIL} / ${OWNER_PASSWORD} (Root administrator, role 0)`);
  } catch (e) {
    console.error("\n❌ Seed failed:", e.message);
    if (e.errors) for (const [f, err] of Object.entries(e.errors)) console.error(`   - ${f}: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await conn.end().catch(() => {});
    await mongoose.disconnect().catch(() => {});
    process.exit(process.exitCode || 0);
  }
})();
