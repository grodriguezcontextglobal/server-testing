/* eslint-disable no-console */
/**
 * Seed: "Summit Unified School District" — a complete Education-industry demo
 * company (staff, students, school inventory, device leases incl. overdue),
 * and revert "Summit AV Rentals" to its original Audio Visual Rental identity.
 *
 * Idempotent: safe to re-run; skips documents/rows that already exist.
 *
 * Usage:
 *   node seed/seed-school-demo.js
 * Env (defaults match the local demo stack):
 *   MONGO_URI, MONGO_DB, MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
 */
const { MongoClient, ObjectId } = require("mongodb");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const MONGO_DB = process.env.MONGO_DB || "devitrak_demo";
const SQL = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DB || "devitrak_db",
};

const SCHOOL = {
  mongoId: "5000000000000000000b0001",
  name: "Summit Unified School District",
  industry: "Education",
  locations: [
    "Lincoln Middle Library",
    "Roosevelt High Media Center",
    "District IT Office",
  ],
  address: {
    street: "1200 Education Blvd",
    city: "San Rafael",
    state: "California",
    postal_code: "94901",
  },
  website: "https://summitunified.edu",
  main_email: "info@summitunified.edu",
};

// All demo accounts use the standard demo password. The demo DB has a
// unique index on the password hash, so each account gets its own salt.
const demoPasswordHash = () => bcrypt.hashSync("DemoPass123!", 10);
const demoAnswerHash = () => bcrypt.hashSync("demo answer", 10);

// role: Mongo role string ↔ SQL role_level (same scale)
const STAFF = [
  { first: "Elena", last: "Vasquez", email: "principal@summitunified.edu", phone: "(415) 555-0401", role: "0", title: "Principal" },
  { first: "Sam", last: "Whitaker", email: "it.director@summitunified.edu", phone: "(415) 555-0402", role: "1", title: "IT Director" },
  { first: "Angela", last: "Rivera", email: "arivera@summitunified.edu", phone: "(415) 555-0403", role: "3", title: "Teacher — Grade 7" },
  { first: "David", last: "Chen", email: "dchen@summitunified.edu", phone: "(415) 555-0404", role: "3", title: "Teacher — Grade 8" },
  { first: "Dana", last: "Kowalski", email: "library@summitunified.edu", phone: "(415) 555-0405", role: "4", title: "Library / Media Specialist" },
  { first: "Ray", last: "Thompson", email: "tech@summitunified.edu", phone: "(415) 555-0406", role: "4", title: "IT Technician" },
];

const INVENTORY = [
  { prefix: "CHR", start: 3001, count: 24, category: "Computers", group: "Chromebook Gen 11", location: "Lincoln Middle Library", cost: 320, description: "Student 1:1 Chromebook" },
  { prefix: "IPD", start: 4001, count: 12, category: "Tablets", group: "iPad 10th Gen", location: "Roosevelt High Media Center", cost: 450, description: "Classroom iPad" },
  { prefix: "CAL", start: 5001, count: 18, category: "Calculators", group: "TI-84 Plus CE", location: "Lincoln Middle Library", cost: 120, description: "Graphing calculator" },
  { prefix: "HSP", start: 6001, count: 8, category: "Connectivity", group: "MiFi Hotspot X2", location: "District IT Office", cost: 90, description: "Take-home internet hotspot" },
  { prefix: "CRT", start: 7001, count: 2, category: "Charging", group: "30-bay Charging Cart", location: "District IT Office", cost: 900, description: "Classroom charging cart" },
];

const daysFromNow = (d) => {
  const t = new Date(Date.now() + d * 86400000);
  return t.toISOString().slice(0, 19).replace("T", " ");
};

(async () => {
  const mongo = await MongoClient.connect(MONGO_URI);
  const db = mongo.db(MONGO_DB);
  const conn = await mysql.createConnection(SQL);

  // ── 1. Revert Summit AV Rentals to its original industry ────────────────
  await db.collection("companies").updateMany(
    { company_name: "Summit AV Rentals" },
    { $set: { industry: "Audio Visual Rental" } }
  );
  await conn.query(
    "UPDATE company_info SET industry='Audio Visual Rental' WHERE company_name='Summit AV Rentals'"
  );
  console.log("✓ Summit AV Rentals reverted to Audio Visual Rental");

  // ── 2. SQL company row ───────────────────────────────────────────────────
  let [[schoolRow]] = await conn.query(
    "SELECT company_id FROM company_info WHERE company_name=?",
    [SCHOOL.name]
  );
  if (!schoolRow) {
    const [res] = await conn.query(
      `INSERT INTO company_info (company_name, industry, street_address, city_address, state_address)
       VALUES (?,?,?,?,?)`,
      [SCHOOL.name, SCHOOL.industry, SCHOOL.address.street, SCHOOL.address.city, SCHOOL.address.state]
    );
    schoolRow = { company_id: res.insertId };
  }
  const schoolId = schoolRow.company_id;
  console.log(`✓ SQL company_id: ${schoolId}`);

  // locations
  for (const loc of SCHOOL.locations) {
    await conn.query(
      `INSERT INTO locations (company_id, location_name)
       SELECT ?, ? FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM locations WHERE company_id=? AND location_name=?)`,
      [schoolId, loc, schoolId, loc]
    );
  }

  // ── 3. Staff: adminusers + staff_member + company_staff ────────────────
  const employees = [];
  for (const s of STAFF) {
    let adminDoc = await db.collection("adminusers").findOne({ email: s.email });
    if (!adminDoc) {
      const doc = {
        _id: new ObjectId(),
        name: s.first,
        lastName: s.last,
        email: s.email,
        phone: s.phone,
        password: demoPasswordHash(),
        question: "Demo security question",
        answer: demoAnswerHash(),
        role: s.role,
        active: true,
        company: SCHOOL.mongoId,
        imageProfile: "",
        mfaEnabled: false,
        emailNotifications: { newsAndUpdates: false, tipsAndTutorials: false, userResearch: false },
        dailySummaries: "do not notify me",
        eventReminder: "do not notify me",
        subscriptionRenewals: "do not notify me",
        online: false,
        super_user: s.role === "0",
        multipleCompanies: false,
        tokenVersion: 0,
        agreedPlatformConditions: true,
        companiesAssigned: [],
        __v: 0,
      };
      await db.collection("adminusers").insertOne(doc);
      adminDoc = doc;
    }

    let [[staffRow]] = await conn.query(
      "SELECT staff_id FROM staff_member WHERE email=?",
      [s.email]
    );
    if (!staffRow) {
      const [res] = await conn.query(
        "INSERT INTO staff_member (first_name, last_name, email, phone_number) VALUES (?,?,?,?)",
        [s.first, s.last, s.email, s.phone]
      );
      staffRow = { staff_id: res.insertId };
    }
    await conn.query(
      `INSERT IGNORE INTO company_staff (id, company_id, company_name, staff_id, role_id, is_active, assigned_by)
       SELECT UUID(), ?, ?, ?, r.id, 1, 'school-demo-seed' FROM roles r WHERE r.role_level = ?`,
      [schoolId, SCHOOL.name, staffRow.staff_id, Number(s.role)]
    );

    employees.push({
      user: s.email,
      firstName: s.first,
      lastName: s.last,
      email: s.email,
      employee_id: `SUSD-${String(employees.length + 1).padStart(4, "0")}`,
      status: "Active",
      super_user: s.role === "0",
      role: s.role,
      active: true,
      preference: {
        inventory_location: SCHOOL.locations,
        managerLocation: SCHOOL.locations.map((loc) => ({
          location: loc,
          actions: { create: true, update: true, transfer: true, delete: true, assign: true, view: true },
          _id: new ObjectId(),
        })),
      },
      userId: String(adminDoc._id),
      _id: new ObjectId(),
    });
    console.log(`✓ staff: ${s.title} — ${s.email}`);
  }

  // ── 4. Mongo company doc ─────────────────────────────────────────────────
  const existingCompany = await db.collection("companies").findOne({ _id: new ObjectId(SCHOOL.mongoId) });
  if (!existingCompany) {
    await db.collection("companies").insertOne({
      _id: new ObjectId(SCHOOL.mongoId),
      company_name: SCHOOL.name,
      address: SCHOOL.address,
      location: SCHOOL.locations,
      phone: { main: "(415) 555-0400", alternative: "", fax: "" },
      owner: { first_name: "Elena", last_name: "Vasquez", email: "principal@summitunified.edu" },
      website: SCHOOL.website,
      main_email: SCHOOL.main_email,
      industry: SCHOOL.industry,
      stripe_customer_id: "cus_demo_susd",
      employees,
      sqlInfo: { company_id: schoolId },
    });
    console.log("✓ Mongo company created");
  }

  // ── 5. Move the demo students (and their guardians) to the district ────
  const [moved] = await conn.query(
    "UPDATE members_info SET company_id=? WHERE company_id='2'",
    [String(schoolId)]
  );
  console.log(`✓ students moved to district: ${moved.affectedRows ?? moved.changedRows ?? 0}`);

  // clean AV-company member leases (devices restocked to the AV warehouse)
  const [oldLeases] = await conn.query(
    "SELECT DISTINCT device_id FROM member_assigned_device_lease WHERE company_id='2'"
  );
  if (oldLeases.length) {
    await conn.query(
      `UPDATE item_inv SET warehouse=1, logistic_status='in-stock'
       WHERE company_id='2' AND item_id IN (${oldLeases.map(() => "?").join(",")})`,
      oldLeases.map((r) => r.device_id)
    );
    await conn.query("DELETE FROM member_assigned_device_lease WHERE company_id='2'");
    console.log(`✓ AV Rentals member leases removed, ${oldLeases.length} device(s) restocked`);
  }

  // ── 6. School inventory ──────────────────────────────────────────────────
  for (const line of INVENTORY) {
    for (let i = 0; i < line.count; i++) {
      const serial = `${line.prefix}-${line.start + i}`;
      await conn.query(
        `INSERT INTO item_inv
           (category_name, item_group, cost, brand, descript_item, ownership,
            serial_number, warehouse, location, current_location, company_id,
            display_item, enableAssignFeature, status, logistic_status)
         SELECT ?,?,?,?,?,?,?,1,?,?,?,1,1,'Operational','in-stock' FROM DUAL
         WHERE NOT EXISTS (SELECT 1 FROM item_inv WHERE serial_number=? AND company_id=?)`,
        [line.category, line.group, line.cost, "Demo Ed", line.description, "Owned",
         serial, line.location, line.location, String(schoolId), serial, String(schoolId)]
      );
    }
    console.log(`✓ inventory: ${line.count} × ${line.group}`);
  }

  // ── 7. Demo leases (3 overdue + 1 current), assigned by the IT Director ──
  const [[assigner]] = await conn.query(
    "SELECT staff_id FROM staff_member WHERE email='it.director@summitunified.edu'"
  );
  const leasePlans = [
    { memberEmail: "maya.okafor@summit-district.edu", serial: "CHR-3001", due: -14 },
    { memberEmail: "diego.fuentes@summit-district.edu", serial: "CHR-3002", due: -7 },
    { memberEmail: "ethan.zhou@summit-district.edu", serial: "HSP-6001", due: -2 },
    { memberEmail: "omar.haddad@summit-district.edu", serial: "CHR-3003", due: 120 },
  ];
  for (const plan of leasePlans) {
    const [[member]] = await conn.query(
      "SELECT member_id FROM members_info WHERE email=?", [plan.memberEmail]);
    const [[device]] = await conn.query(
      "SELECT item_id FROM item_inv WHERE serial_number=? AND company_id=?",
      [plan.serial, String(schoolId)]);
    if (!member || !device) { console.log(`  ! skipped lease ${plan.serial}`); continue; }
    await conn.query(
      `INSERT INTO member_assigned_device_lease
         (member_id, staff_member_id, device_id, company_id, assigned_date, expected_return_date, returned, location)
       SELECT ?,?,?,?,?,?,0,'Lincoln Middle Library' FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM member_assigned_device_lease
                         WHERE member_id=? AND device_id=? AND returned=0)`,
      [member.member_id, String(assigner.staff_id), device.item_id, String(schoolId),
       daysFromNow(plan.due - 60), daysFromNow(plan.due),
       member.member_id, device.item_id]
    );
    await conn.query(
      "UPDATE item_inv SET warehouse=0, logistic_status='assigned' WHERE item_id=?",
      [device.item_id]
    );
  }
  console.log("✓ demo leases created (3 overdue, 1 current)");

  console.log("\nDone. School demo login: principal@summitunified.edu / DemoPass123!");
  await mongo.close();
  await conn.end();
})().catch((e) => {
  console.error("SEED FAILED:", e.message);
  process.exit(1);
});
