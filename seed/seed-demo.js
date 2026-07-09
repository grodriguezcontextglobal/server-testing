/**
 * Devitrak demo-content seeder
 * --------------------------------
 * Populates the TESTING database with a coherent demo company:
 *   - 1 company ("Devitrak Demo Co")
 *   - 12 staff (AdminUser) across roles: Ownership / Administrator / Manager / Editor / Approver
 *   - Events: active, completed AND upcoming
 *   - Item types + Inventory batches per event
 *   - Consumers: some tied to events, some with no event
 *   - Receivers (device assignments): a mix of active (assigned) and returned
 *   - Transactions + StripeTransactions: deposits and lost-device fees
 *   - FAQ Posts visible on the consumer side
 *
 * Usage (from server-testing/):
 *   node seed/seed-demo.js --wipe        # remove existing demo data, then seed
 *   node seed/seed-demo.js --wipe-only   # remove demo data and exit
 *   node seed/seed-demo.js --dry-run     # connect + report, write nothing
 *   node seed/seed-demo.js --force       # bypass the "testing DB only" guard (NOT recommended)
 *
 * Safety: refuses to run unless the resolved connection string looks like a
 * testing cluster (contains "testing"), unless --force is passed. All demo
 * documents are tagged with DEMO_COMPANY_ID so --wipe is precise.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const args = new Set(argv);
const DRY_RUN = args.has("--dry-run");
const WIPE = args.has("--wipe") || args.has("--wipe-only");
const WIPE_ONLY = args.has("--wipe-only");
const FORCE = args.has("--force");
// --uri=mongodb://... overrides the env connection string (used for local MongoDB).
const URI_OVERRIDE = (argv.find((a) => a.startsWith("--uri=")) || "").slice(6);

// Fixed id so the demo company is stable across re-runs and wipes are precise.
const DEMO_COMPANY_ID = "dededededededededededede"; // 24-hex ObjectId
const COMPANY_NAME = "Devitrak Demo Co";
const DEMO_PASSWORD = "DemoPass123!"; // all demo staff share this login password
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const URI =
  URI_OVERRIDE ||
  process.env.DB_TESTING_CNN ||
  process.env.DB_TESTING_NEW_CNN ||
  process.env.DB_CNN;

// ---------------------------------------------------------------------------
// Small helpers (no Math.random — deterministic, re-run friendly)
// ---------------------------------------------------------------------------
const pad = (n, len = 3) => String(n).padStart(len, "0");
const iso = (ms) => new Date(ms).toISOString();
const log = (...a) => console.log(...a);

const FIRST = ["John", "Jane", "Mike", "Sarah", "David", "Emily", "Carlos",
  "Aisha", "Liam", "Noah", "Olivia", "Mia", "Lucas", "Ethan", "Sofia", "Ava"];
const LAST = ["Smith", "Doe", "Johnson", "Williams", "Brown", "Garcia",
  "Martinez", "Lee", "Walker", "Hall", "Young", "King", "Wright", "Lopez"];

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
function buildStaff() {
  // 12 staff across 5 roles; first is the Ownership/super_user.
  const rolePlan = [
    "Ownership", "Administrator", "Administrator", "Manager", "Manager",
    "Editor", "Editor", "Approver", "Approver", "Editor", "Manager", "Administrator",
  ];
  return rolePlan.map((role, i) => {
    const name = FIRST[i % FIRST.length];
    const lastName = LAST[i % LAST.length];
    const email = `demo.${name}.${lastName}.${i}@devitrak-demo.com`.toLowerCase();
    const salt = bcrypt.genSaltSync();
    return {
      name,
      lastName,
      email,
      phone: `(415) 555-${pad(1000 + i, 4)}`,
      password: bcrypt.hashSync(DEMO_PASSWORD, salt),
      question: "What is your demo word?",
      answer: bcrypt.hashSync("devitrak", salt),
      role,
      active: i % 7 !== 6, // one inactive for variety
      company: DEMO_COMPANY_ID,
      super_user: role === "Ownership",
      agreedPlatformConditions: true,
    };
  });
}

function buildEvents() {
  // active (spanning now), completed (past), upcoming (future)
  const plan = [
    { key: "active1", name: "Annual Tech Conference 2026", begin: NOW - 1 * DAY, end: NOW + 3 * DAY, active: true, status: "active" },
    { key: "active2", name: "Spring Product Expo", begin: NOW - 2 * DAY, end: NOW + 1 * DAY, active: true, status: "active" },
    { key: "done1", name: "Winter Developer Summit 2025", begin: NOW - 40 * DAY, end: NOW - 37 * DAY, active: false, status: "completed" },
    { key: "done2", name: "Q1 Partner Roadshow", begin: NOW - 70 * DAY, end: NOW - 68 * DAY, active: false, status: "completed" },
    { key: "up1", name: "Summer Innovation Forum", begin: NOW + 21 * DAY, end: NOW + 24 * DAY, active: true, status: "upcoming" },
    { key: "up2", name: "Global User Conference 2026", begin: NOW + 55 * DAY, end: NOW + 58 * DAY, active: true, status: "upcoming" },
  ];

  return plan.map((p, idx) => {
    const owner = `demo.${FIRST[idx]}.${LAST[idx]}.${idx}@devitrak-demo.com`.toLowerCase();
    const deviceSetup = [
      buildDeviceSetupEntry("Receivers", "Audio Receiver", "250.00", 50, 1001),
      buildDeviceSetupEntry("Chargers", "Charging Case", "45.00", 20, 2001),
    ];
    return {
      doc: {
        user: owner,
        company: DEMO_COMPANY_ID,
        company_id: DEMO_COMPANY_ID,
        subscription: [],
        eventInfoDetail: {
          eventName: p.name,
          eventLocation: "San Francisco, California",
          address: "123 Market St, San Francisco California, 94105",
          building: p.name,
          floor: "Main Hall",
          phoneNumber: ["(415) 555-0123"],
          merchant: COMPANY_NAME,
          dateBegin: iso(p.begin),
          dateEnd: iso(p.end),
          dateBeginTime: p.begin,
          dateEndTime: p.end,
          daysBeforeEvent: 3,
          daysAfterEvent: 2,
        },
        staff: {
          adminUser: [
            { firstName: FIRST[idx], lastName: LAST[idx], email: owner, role: "Administrator" },
          ],
          headsetAttendees: [
            { firstName: FIRST[(idx + 1) % FIRST.length], lastName: LAST[(idx + 1) % LAST.length], email: `attendee${idx}@devitrak-demo.com`, role: "HeadsetAttendees" },
          ],
        },
        contactInfo: {
          name: `${FIRST[idx]} ${LAST[idx]}`,
          email: owner,
          phone: ["(415) 555-0123"],
        },
        deviceSetup,
        extraServicesNeeded: false,
        extraServices: [],
        active: p.active,
        qrCodeLink: `https://app.devitrak.net/event/${p.key}`,
        type: "event",
        show: p.active,
        legal_contract: false,
        logistic_inventory_status: p.status === "completed" ? "received" : "no_received_yet",
        configuration: p.status === "upcoming" ? "in-progress" : "completed",
      },
      meta: p,
      deviceSetup,
    };
  });
}

function buildDeviceSetupEntry(category, group, value, quantity, startNum) {
  const endNum = startNum + quantity - 1;
  return {
    category,
    group,
    value,
    description: `${group} for event checkout`,
    company: DEMO_COMPANY_ID,
    isItSetAsContainerForEvent: false,
    quantity,
    ownership: "Rent",
    container: false,
    createdBy: "demo-seed",
    key: `deviceSetup_${group}_${startNum}`.replace(/\s+/g, "_"),
    dateCreated: new Date(NOW).toString(),
    resume: `${category} ${group} ${value} ${quantity} Rent ${startNum} ${endNum}`,
    consumerUses: true,
    startingNumber: String(startNum),
    endingNumber: String(endNum),
    existing: false,
  };
}

function buildItems() {
  const defs = [
    ["Receivers", "Audio Receiver", "250.00", "Wireless audio receiver"],
    ["Chargers", "Charging Case", "45.00", "Charging case for receivers"],
    ["Accessories", "Lanyard", "5.00", "Branded lanyard"],
    ["Tablets", "Check-in Tablet", "600.00", "Tablet for consumer check-in"],
  ];
  return defs.map(([category, group, value, description], i) => ({
    category,
    group,
    value,
    description,
    company: DEMO_COMPANY_ID,
    quantity: "100",
    ownership: i % 2 === 0 ? "Company" : "Rent",
    createdBy: "demo-seed",
    key: `item_${group}`.replace(/\s+/g, "_"),
    dateCreated: new Date(NOW).toISOString().slice(0, 10),
    resume: `${category} ${group} ${value} ${description}`,
    consumerUses: true,
  }));
}

// ---------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------
async function wipeDemo() {
  const C = DEMO_COMPANY_ID;
  const results = {
    companies: await Company.deleteMany({ _id: C }),
    adminusers: await AdminUser.deleteMany({ company: C }),
    events: await Event.deleteMany({ company_id: C }),
    items: await Item.deleteMany({ company: C }),
    inventories: await Inventory.deleteMany({ company: C }),
    users: await User.deleteMany({ company_providers: C }),
    receivers: await Receivers.deleteMany({ company: C }),
    transactions: await Transaction.deleteMany({ company: C }),
    stripetransactions: await StripeTransaction.deleteMany({ company: C }),
    posts: await Post.deleteMany({ company_id: C }),
  };
  log("\n🧹 Wiped existing demo data:");
  for (const [k, r] of Object.entries(results)) {
    log(`   ${k}: ${r.deletedCount}`);
  }
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function seed() {
  const summary = {};

  // 1) Staff (AdminUser)
  const staffDocs = buildStaff();
  const staff = DRY_RUN ? staffDocs : await AdminUser.insertMany(staffDocs);
  summary.staff = staff.length;

  // 2) Company (embed staff into employees)
  const employees = staffDocs.map((s, i) => ({
    user: s.email,
    firstName: s.name,
    lastName: s.lastName,
    email: s.email,
    employee_id: `EMP-${pad(i + 1)}`,
    status: "Active",
    super_user: s.super_user,
    role: s.role,
    active: s.active,
    userId: DRY_RUN ? undefined : staff[i]._id,
  }));
  const companyDoc = {
    _id: new mongoose.Types.ObjectId(DEMO_COMPANY_ID),
    company_name: COMPANY_NAME,
    address: { street: "123 Market St", city: "San Francisco", state: "California", postal_code: "94105" },
    location: ["Main Warehouse", "Front Desk"],
    phone: { main: "(415) 555-0100", alternative: "(415) 555-0101", fax: "(415) 555-0102" },
    owner: { first_name: FIRST[0], last_name: LAST[0], email: employees[0].email },
    website: "https://devitrak-demo.com",
    main_email: "hello@devitrak-demo.com",
    industry: "Event Technology",
    stripe_customer_id: "cus_demo_placeholder",
    employees,
    company_logo: "",
  };
  if (!DRY_RUN) await Company.create(companyDoc);
  summary.company = 1;

  // 3) Events
  const builtEvents = buildEvents();
  const eventDocs = builtEvents.map((e) => e.doc);
  const events = DRY_RUN ? eventDocs.map((d, i) => ({ ...d, _id: `dryevent${i}` })) : await Event.insertMany(eventDocs);
  const eventIds = events.map((e) => String(e._id));
  const eventNames = builtEvents.map((e) => e.doc.eventInfoDetail.eventName);
  summary.events = events.length;

  // 4) Items + Inventory (one batch per event)
  const itemDocs = buildItems();
  if (!DRY_RUN) await Item.insertMany(itemDocs);
  summary.items = itemDocs.length;

  const inventoryDocs = builtEvents.map((e, i) => ({
    batch: `BATCH-${pad(i + 1)}`,
    company: DEMO_COMPANY_ID,
    event: eventIds[i],
    items: itemDocs,
    saveDefaultFormat: false,
  }));
  if (!DRY_RUN) await Inventory.insertMany(inventoryDocs);
  summary.inventories = inventoryDocs.length;

  // 5) Consumers (User) — tied to events + untied
  // Tie the first events; leave a handful with NO event.
  const consumerDocs = [];
  const TIED = 14;
  const UNTIED = 4;
  for (let i = 0; i < TIED; i++) {
    const evIdx = i % eventIds.length;
    const name = FIRST[(i + 3) % FIRST.length];
    const lastName = LAST[(i + 5) % LAST.length];
    consumerDocs.push({
      name,
      lastName,
      email: `consumer${i}@demo-attendee.com`,
      phoneNumber: 4155550000 + i,
      privacyPolicy: true,
      category: "Regular",
      provider: [COMPANY_NAME],
      eventSelected: [eventNames[evIdx]],
      company_providers: [DEMO_COMPANY_ID],
      event_providers: [eventIds[evIdx]],
      notes: i % 5 === 0 ? [{ company: DEMO_COMPANY_ID, date: new Date(NOW - i * DAY), notes: "VIP attendee — handle with priority." }] : [],
    });
  }
  for (let i = 0; i < UNTIED; i++) {
    const name = FIRST[(i + 7) % FIRST.length];
    const lastName = LAST[(i + 2) % LAST.length];
    consumerDocs.push({
      name,
      lastName,
      email: `lead${i}@demo-attendee.com`,
      phoneNumber: 4155551000 + i,
      privacyPolicy: true,
      category: "Regular",
      provider: [COMPANY_NAME],
      eventSelected: [],
      company_providers: [DEMO_COMPANY_ID],
      event_providers: [],
      notes: [],
    });
  }
  const consumers = DRY_RUN ? consumerDocs.map((d, i) => ({ ...d, _id: `dryuser${i}` })) : await User.insertMany(consumerDocs);
  summary.consumers = consumers.length;
  summary.consumers_untied = UNTIED;

  // 6) Receivers (device assignments) — for tied consumers only.
  //    Mix of active (still out) and returned (status false / active false).
  const receiverDocs = [];
  for (let i = 0; i < TIED; i++) {
    const c = consumers[i];
    const evIdx = i % eventIds.length;
    const stillOut = i % 3 !== 0; // ~2/3 active
    receiverDocs.push({
      device: {
        serialNumber: `RX-${pad(1001 + i, 4)}`,
        deviceType: "Audio Receiver",
        status: stillOut,
      },
      paymentIntent: `pi_demo_${pad(i)}`,
      user: c.email,
      active: stillOut,
      eventSelected: [eventNames[evIdx]],
      provider: [COMPANY_NAME],
      company: DEMO_COMPANY_ID,
      timeStamp: new Date(NOW - i * DAY),
      event_id: eventIds[evIdx],
    });
  }
  if (!DRY_RUN) await Receivers.insertMany(receiverDocs);
  summary.receivers = receiverDocs.length;
  summary.receivers_active = receiverDocs.filter((r) => r.active).length;

  // 7) Transactions + StripeTransactions (deposits + lost-device fees)
  const txDocs = [];
  const stripeDocs = [];
  for (let i = 0; i < TIED; i++) {
    const c = consumers[i];
    const evIdx = i % eventIds.length;
    const isLostFee = i % 4 === 0;
    txDocs.push({
      device: [{ deviceNeeded: 1, deviceType: "Audio Receiver", deviceValue: "250.00" }],
      paymentIntent: `pi_demo_${pad(i)}`,
      clientSecret: `seti_demo_${pad(i)}_secret`,
      consumerInfo: {
        id: String(c._id),
        uid: String(c._id),
        email: c.email,
        name: c.name,
        lastName: c.lastName,
        data: {
          event_providers: [eventIds[evIdx]],
          company_providers: [DEMO_COMPANY_ID],
          eventSelected: [eventNames[evIdx]],
          provider: [COMPANY_NAME],
        },
      },
      eventSelected: eventNames[evIdx],
      event_id: eventIds[evIdx],
      provider: COMPANY_NAME,
      date: iso(NOW - i * DAY),
      active: true,
      company: DEMO_COMPANY_ID,
      created_at: NOW - i * DAY,
      type: isLostFee ? "lost_device_fee" : "deposit",
    });
    stripeDocs.push({
      device: 1,
      paymentIntent: `pi_demo_${pad(i)}`,
      clientSecret: `seti_demo_${pad(i)}_secret`,
      user: DRY_RUN ? new mongoose.Types.ObjectId() : c._id,
      eventSelected: eventNames[evIdx],
      provider: COMPANY_NAME,
      company: DEMO_COMPANY_ID,
      type: isLostFee ? "lost_device_fee" : "event",
    });
  }
  if (!DRY_RUN) {
    await Transaction.insertMany(txDocs);
    await StripeTransaction.insertMany(stripeDocs);
  }
  summary.transactions = txDocs.length;
  summary.stripetransactions = stripeDocs.length;
  summary.lost_fee_transactions = txDocs.filter((t) => t.type === "lost_device_fee").length;

  // 8) FAQ Posts visible on the consumer side
  const faqDefs = [
    ["How do I pick up my device?", "Visit the front desk", "Bring a valid photo ID to the front desk and a staff member will hand you your device."],
    ["What happens if I lose my device?", "Lost device policy", "A replacement fee will be charged to the card on file. Report a lost device to any staff member immediately."],
    ["How do I return my device?", "Returning your device", "Drop your device at the return station before the event ends to avoid additional charges."],
    ["Is there a deposit?", "About deposits", "A refundable hold is placed on your card at pickup and released when the device is returned in good condition."],
  ];
  const postDocs = faqDefs.map(([title, subtitle, description]) => ({
    title,
    subtitle,
    description,
    displayed_in: eventIds, // all demo events
    media: { cover: "", content: [] },
    company_id: DEMO_COMPANY_ID,
    published: true,
  }));
  if (!DRY_RUN) await Post.insertMany(postDocs);
  summary.posts = postDocs.length;

  return summary;
}

// ---------------------------------------------------------------------------
// Exports (for offline validation harness)
// ---------------------------------------------------------------------------
module.exports = {
  DEMO_COMPANY_ID,
  COMPANY_NAME,
  buildStaff,
  buildEvents,
  buildItems,
  buildDeviceSetupEntry,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
if (require.main === module)
(async () => {
  if (!URI) {
    console.error("❌ No DB connection string found (DB_TESTING_CNN / DB_TESTING_NEW_CNN).");
    process.exit(1);
  }
  const isLocal = /127\.0\.0\.1|localhost/i.test(URI);
  const looksLikeTesting = /testing/i.test(URI);
  if (!looksLikeTesting && !isLocal && !FORCE) {
    console.error(
      "❌ Refusing to run: connection string is neither a testing cluster nor localhost.\n" +
        "   Use --uri=mongodb://127.0.0.1:27017/<db>, set DB_TESTING_CNN, or pass --force."
    );
    process.exit(1);
  }

  const label = isLocal ? "LOCAL" : looksLikeTesting ? "TESTING" : "(forced)";
  log(`\n🔌 Connecting to ${label} DB...`);
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 15000 });
  } catch (e) {
    console.error("❌ Connection failed:", e.message);
    if (/whitelist|IP|ENOTFOUND|ESERVFAIL|querySrv/i.test(e.message)) {
      console.error("   → Add your current IP to the Atlas Network Access allowlist for this cluster.");
    }
    process.exit(1);
  }
  log(`   Connected to DB: ${mongoose.connection.db.databaseName}`);

  try {
    if (WIPE) await wipeDemo();
    if (WIPE_ONLY) {
      log("\n✅ Wipe-only complete.");
      return;
    }
    if (DRY_RUN) log("\n🧪 DRY RUN — building documents, writing nothing.");
    const summary = await seed();
    log(`\n✅ Demo seed ${DRY_RUN ? "(dry-run) " : ""}complete for "${COMPANY_NAME}" (company_id=${DEMO_COMPANY_ID}):`);
    for (const [k, v] of Object.entries(summary)) log(`   ${k}: ${v}`);
    log(`\n   Staff login password (all): ${DEMO_PASSWORD}`);
  } catch (e) {
    console.error("\n❌ Seed failed:", e.message);
    if (e.errors) {
      for (const [field, err] of Object.entries(e.errors)) {
        console.error(`   - ${field}: ${err.message}`);
      }
    }
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    process.exit(process.exitCode || 0);
  }
})();
