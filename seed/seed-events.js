/**
 * Summit AV Rentals — curated EVENT scenario (dual DB), additive.
 * Reshapes events into: 1 live, 1 upcoming, 2 past — fully wired:
 *   - Mongo Event + SQL event_info (linked by event_name)
 *   - Inventory assigned to every event (Mongo deviceSetup + ReceiversPool + SQL item_inv_assigned_event)
 *   - Consumers: attendees for the 2 past events + the live event (Mongo User.event_providers[Mongo _id]
 *     + SQL consumer_info + consumer_attending_event); live attendees get active device Receivers
 *   - Staff assigned to ALL events (Mongo Event.staff + SQL staff_event)
 *
 * Does NOT touch company_info (SQL company_id stays stable) / Company / staff_member / item_inv / locations.
 * Run (from server-testing/):  node seed/seed-events.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const mysql = require("mysql2/promise");

const Company = require("../models/Company");
const Event = require("../models/Event");
const User = require("../models/User");
const Receivers = require("../models/Receivers");
const ReceiversPool = require("../models/ReceiversPool");
const Transaction = require("../models/Transaction");
const StripeTransaction = require("../models/StripeTransaction");

const MONGO_URI = "mongodb://127.0.0.1:27017/devitrak_demo";
const COMPANY_ID = "5000000000000000000a0001"; // Mongo company _id (Summit AV Rentals)
const COMPANY_NAME = "Summit AV Rentals";
const NOW = Date.now();
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const pad = (n, l = 4) => String(n).padStart(l, "0");

const FIRST = ["Olivia","Ethan","Ava","Liam","Sophia","Noah","Isabella","Mason","Mia","Lucas","Amelia","Henry","Charlotte","Jack","Harper","Leo","Zoe","Owen","Nora","Eli","Ruby","Sam","Iris","Cole"];
const LAST = ["Bennett","Morales","Thompson","Patel","Nguyen","Ramirez","Cohen","Brooks","Fitzgerald","Turner","Diaz","Foster","Reed","Sullivan","Nolan","Vance","Mercer","Castillo","Hayes","Bishop","Frost","Dorsey","Meyer","Park"];

const DEVICE_TYPES = [
  ["Receivers", "Sennheiser EK 6042", "285.00"],
  ["Chargers", "Charging Case 8-slot", "60.00"],
];

// live / upcoming / past×2
const EVENTS = [
  { key: "live",  name: "Bay Area Product Summit 2026",   venue: "Moscone West",              city: "San Francisco", state: "CA", zip: "94103", begin: NOW - 1 * DAY,  end: NOW + 2 * DAY,   active: true,  status: "live",     attendees: 12, devices: 20 },
  { key: "up",    name: "Cascade Tech Conference 2026",   venue: "Oregon Convention Center",  city: "Portland",      state: "OR", zip: "97232", begin: NOW + 30 * DAY, end: NOW + 33 * DAY,  active: true,  status: "upcoming", attendees: 0,  devices: 18 },
  { key: "past1", name: "Metro Media Expo 2025",          venue: "Los Angeles Convention Ctr",city: "Los Angeles",   state: "CA", zip: "90015", begin: NOW - 90 * DAY, end: NOW - 88 * DAY,  active: false, status: "past",     attendees: 10, devices: 16 },
  { key: "past2", name: "Harbor Innovation Forum 2025",   venue: "Boston Convention Center",  city: "Boston",        state: "MA", zip: "02210", begin: NOW - 160 * DAY,end: NOW - 158 * DAY, active: false, status: "past",     attendees: 8,  devices: 14 },
];

function deviceSetup(name) {
  return DEVICE_TYPES.map(([cat, grp, val], k) => ({
    category: cat, group: grp, value: val, description: `${grp} for ${name}`, company: COMPANY_ID,
    isItSetAsContainerForEvent: false, quantity: k === 0 ? 12 : 8, ownership: "Rent", container: false,
    createdBy: "events-seed", key: `ds_${name}_${grp}`.replace(/\s+/g, "_"), dateCreated: new Date(NOW).toString(),
    resume: `${cat} ${grp} ${val}`, consumerUses: true, startingNumber: String(1000 + k * 1000),
    endingNumber: String(1000 + k * 1000 + (k === 0 ? 11 : 7)), existing: false,
  }));
}

(async () => {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const conn = await mysql.createConnection({ host: "127.0.0.1", port: 3306, user: "root", password: "", database: "devitrak_db" });

  // Resolve SQL company_id + item_id pool + staff map (do NOT recreate these)
  const [[co]] = await conn.query("SELECT company_id FROM company_info WHERE company_name=? LIMIT 1", [COMPANY_NAME]);
  const sqlCompanyId = co?.company_id;
  if (!sqlCompanyId) throw new Error("Summit company_info row not found — run seed-summit.js first.");
  const [itemRows] = await conn.query("SELECT item_id, serial_number, category_name, item_group FROM item_inv WHERE company_id=? ORDER BY item_id", [String(sqlCompanyId)]);
  const [staffRows] = await conn.query("SELECT staff_id, first_name, last_name, email FROM staff_member");
  const staffByEmail = Object.fromEntries(staffRows.map((s) => [s.email.toLowerCase(), s]));

  const company = await Company.findById(COMPANY_ID);
  const employees = (company?.employees || []).filter((e) => e.active);

  // ---- WIPE prior event scenario (keep company, staff, item_inv, locations) ----
  await Event.deleteMany({ company_id: COMPANY_ID });
  await Receivers.deleteMany({ company: COMPANY_ID });
  await ReceiversPool.deleteMany({ company: COMPANY_ID });
  await User.deleteMany({ company_providers: COMPANY_ID });
  await Transaction.deleteMany({ company: COMPANY_ID });
  await StripeTransaction.deleteMany({ company: COMPANY_ID });
  await conn.query("DELETE FROM event_info WHERE company_assigned_event_id=?", [sqlCompanyId]);
  await conn.query("DELETE FROM consumer_info WHERE email LIKE '%@summit-attendee.com'");
  await conn.query("DELETE FROM consumer_attending_event WHERE 1=1");
  await conn.query("DELETE FROM staff_event WHERE 1=1");
  await conn.query("DELETE FROM item_inv_assigned_event WHERE 1=1");
  console.log("🧹 Cleared prior event scenario (kept company, staff, inventory, locations).");

  const summary = { events: [], consumers: 0, receivers_active: 0, poolDevices: 0, itemAssignments: 0, staffAssignments: 0 };
  let serialCursor = 0;
  let consumerIdx = 0;

  for (const ev of EVENTS) {
    // staff picks: 2 admins + 2 headset attendees (rotating through employees)
    const pick = (n, off) => employees.slice(off, off + n);
    const admins = pick(2, EVENTS.indexOf(ev) * 2);
    const headsets = pick(2, EVENTS.indexOf(ev) * 2 + 2);
    const asStaff = (e, role) => ({ firstName: e.firstName, lastName: e.lastName, email: e.email, role });

    // 1) Mongo Event
    const eventDoc = await Event.create({
      user: employees[0]?.email, company: COMPANY_NAME, company_id: COMPANY_ID, subscription: [],
      eventInfoDetail: {
        eventName: ev.name, eventLocation: `${ev.city}, ${ev.state}`, address: `${ev.venue}, ${ev.city} ${ev.state}, ${ev.zip}`,
        building: ev.venue, floor: "Exhibit Hall", phoneNumber: ["(415) 555-0170"], merchant: COMPANY_NAME,
        dateBegin: iso(ev.begin), dateEnd: iso(ev.end), dateBeginTime: ev.begin, dateEndTime: ev.end, daysBeforeEvent: 3, daysAfterEvent: 2,
      },
      staff: {
        adminUser: admins.map((e) => asStaff(e, "Administrator")),
        headsetAttendees: headsets.map((e) => asStaff(e, "HeadsetAttendees")),
      },
      contactInfo: { name: `${admins[0]?.firstName} ${admins[0]?.lastName}`, email: admins[0]?.email, phone: ["(415) 555-0170"] },
      deviceSetup: deviceSetup(ev.name),
      extraServicesNeeded: false, extraServices: [], active: ev.active,
      qrCodeLink: `https://app.devitrak.net/e/summit-${ev.key}`, type: "event", show: ev.active, legal_contract: false,
      logistic_inventory_status: ev.status === "past" ? "received" : ev.status === "live" ? "received" : "no_received_yet",
      configuration: ev.status === "upcoming" ? "in-progress" : "completed",
    });
    const mongoEventId = String(eventDoc._id);

    // SQL event_info
    const [evRes] = await conn.query(
      `INSERT INTO event_info (event_name, venue_name, street_address, city_address, state_address, zip_address, email_company, phone_number, company_assigned_event_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [ev.name, ev.venue, "", ev.city, ev.state, ev.zip, `ops@summitavrentals.com`, "(415) 555-0170", sqlCompanyId]
    );
    const sqlEventId = evRes.insertId;

    // 2) Staff → SQL staff_event
    for (const e of [...admins, ...headsets]) {
      const sm = staffByEmail[e.email?.toLowerCase()];
      if (sm) { await conn.query("INSERT INTO staff_event (event_id, staff_id, role) VALUES (?,?,?)", [sqlEventId, sm.staff_id, String(e.role)]); summary.staffAssignments++; }
    }

    // 3) Inventory: ReceiversPool (Mongo, by name) + item_inv_assigned_event (SQL, by event_id)
    for (let d = 0; d < ev.devices; d++) {
      const t = DEVICE_TYPES[d % 2];
      const serial = `SAV-${ev.key.toUpperCase()}-${pad(d + 1, 3)}`;
      const inUse = ev.status === "live" && d < ev.attendees; // live: some devices actively out
      // NOTE: ReceiversPool.device is a plain SERIAL STRING in real usage
      // (DeviceDatabase.jsx renders it directly); Receivers.device is the object.
      await ReceiversPool.create({
        eventSelected: ev.name, device: serial,
        type: t[1], status: "Operational", activity: inUse, comment: "No comment",
        provider: COMPANY_NAME, company: COMPANY_ID, contract_type: "event",
      });
      summary.poolDevices++;
    }
    // Link real warehouse units to the event (SQL) — historical/current assignment
    const assignCount = Math.min(ev.devices, itemRows.length);
    for (let k = 0; k < assignCount; k++) {
      const item = itemRows[(serialCursor + k) % itemRows.length];
      await conn.query(
        "INSERT INTO item_inv_assigned_event (item_id, event_id, status, `condition`, active) VALUES (?,?,?,?,?)",
        [item.item_id, sqlEventId, ev.status === "past" ? "returned" : "assigned", "good", ev.status === "past" ? 0 : 1]
      );
      summary.itemAssignments++;
    }
    serialCursor += assignCount;

    // 4) Consumers/attendees for live + past events
    for (let a = 0; a < ev.attendees; a++) {
      const first = FIRST[consumerIdx % FIRST.length];
      const last = LAST[(consumerIdx + 7) % LAST.length];
      const email = `${first}.${last}.${consumerIdx}@summit-attendee.com`.toLowerCase();
      consumerIdx++;
      const userDoc = await User.create({
        name: first, lastName: last, email, phoneNumber: 4155570000 + consumerIdx, privacyPolicy: true,
        category: "Regular", provider: [COMPANY_NAME], eventSelected: [ev.name],
        company_providers: [COMPANY_ID], event_providers: [mongoEventId], notes: [],
      });
      // SQL consumer_info + consumer_attending_event
      const [cRes] = await conn.query("INSERT INTO consumer_info (first_name, last_name, email, phone_number) VALUES (?,?,?,?)", [first, last, email, "(415) 555-0190"]);
      await conn.query("INSERT INTO consumer_attending_event (consumer_attending_id, event_attended_id) VALUES (?,?)", [cRes.insertId, sqlEventId]);
      summary.consumers++;

      // Device assignment (Receivers): live attendees hold active devices; past attendees returned
      const active = ev.status === "live";
      await Receivers.create({
        device: { serialNumber: `SAV-${ev.key.toUpperCase()}-${pad(a + 1, 3)}`, deviceType: "Sennheiser EK 6042", status: active },
        paymentIntent: `pi_${ev.key}_${pad(a)}`, user: email, active, eventSelected: [ev.name],
        provider: [COMPANY_NAME], company: COMPANY_ID, timeStamp: new Date(ev.begin), event_id: mongoEventId,
      });
      if (active) summary.receivers_active++;
    }

    summary.events.push(`${ev.status}: ${ev.name} (mongo ${mongoEventId} / sql ${sqlEventId})`);
  }

  // Standalone leads (consumers not tied to any event) — preserves that demo aspect
  for (let i = 0; i < 5; i++) {
    const first = FIRST[(consumerIdx + 2) % FIRST.length];
    const last = LAST[(consumerIdx + 11) % LAST.length];
    consumerIdx++;
    await User.create({
      name: first, lastName: last, email: `lead${i}@summit-attendee.com`, phoneNumber: 4155579000 + i,
      privacyPolicy: true, category: "Regular", provider: [COMPANY_NAME], eventSelected: [],
      company_providers: [COMPANY_ID], event_providers: [], notes: [],
    });
    summary.consumers++;
  }
  summary.leads = 5;

  console.log(`\n✅ Curated event scenario seeded for ${COMPANY_NAME} (sql company_id=${sqlCompanyId}):`);
  for (const e of summary.events) console.log("   •", e);
  console.log(`   consumers/attendees: ${summary.consumers} | active device holders: ${summary.receivers_active}`);
  console.log(`   ReceiversPool devices: ${summary.poolDevices} | SQL item→event links: ${summary.itemAssignments} | staff→event links: ${summary.staffAssignments}`);

  await conn.end();
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error("❌ Failed:", e.message);
  if (e.errors) for (const [f, err] of Object.entries(e.errors)) console.error(`   - ${f}: ${err.message}`);
  process.exit(1);
});
