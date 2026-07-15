/* eslint-disable no-console */
/**
 * Enrich the "Summit Unified School District" demo to district scale:
 *   - two schools: Lincoln Middle (grades 6-8) + Roosevelt High (grades 9-12)
 *   - ~1,000 students with guardians (plus a realistic dirty-data tail of
 *     minors missing representative info)
 *   - ~30 staff across every permission level (district office + per school)
 *   - per-school inventory: 1:1 Chromebooks, iPad carts, TI-84s, hotspots,
 *     and the AV/theater/athletics gear school events actually use
 *   - ~90% of students holding a device lease (1:1 program), small overdue tail
 *   - a school-year event calendar (field trip, pep rally, homecoming,
 *     theater production, science fair, graduation, STEM camp, BTS night)
 *
 * Idempotent: skips each stage when its data already exists.
 * Run AFTER seed-school-demo.js:  node seed/seed-school-demo-rich.js
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
const DISTRICT = "Summit Unified School District";
const DISTRICT_MONGO_ID = "5000000000000000000b0001";

// deterministic PRNG so re-runs generate identical people
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(20260715);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const FIRST = ["Aiden","Sofia","Liam","Emma","Noah","Olivia","Ethan","Ava","Lucas","Isabella","Mason","Mia","Logan","Charlotte","James","Amelia","Elijah","Harper","Ben","Evelyn","Alex","Abigail","Daniel","Emily","Matteo","Ella","Jayden","Scarlett","Sebastian","Grace","Jack","Chloe","Owen","Camila","Gabriel","Aria","Carter","Nora","Julian","Zoey","Leo","Riley","Isaac","Layla","Miles","Lily","Nathan","Hazel","Diego","Maya","Kai","Ruby","Omar","Nadia","Marcus","Priya","Andre","Keiko","Rafael","Amara","Tomas","Ingrid","Jamal","Yuki","Mateo","Fatima","Cole","Sasha","Finn","Leila"];
const LAST = ["Anderson","Martinez","Thompson","Nguyen","Garcia","Kim","Patel","Johnson","Lee","Hernandez","Brown","Chen","Davis","Lopez","Wilson","Park","Moore","Singh","Taylor","Ramirez","Thomas","Wang","White","Torres","Harris","Ali","Clark","Flores","Lewis","Yamamoto","Walker","Rivera","Hall","Cruz","Young","Reyes","King","Morales","Wright","Ortiz","Scott","Gutierrez","Green","Chavez","Adams","Mendoza","Baker","Vargas","Nelson","Castillo","Carter","Jimenez","Mitchell","Rossi","Perez","Okafor","Roberts","Haddad","Turner","Kowalski"];
const STREETS = ["Cedar Ave","Alder St","Birch Rd","Spruce Ln","Maple Ct","Willow Way","Oak Dr","Elm Pl","Laurel St","Madrone Ave","Redwood Blvd","Juniper Ct","Sycamore Ln","Bayview Dr","Hilltop Rd"];
const CITIES = [["San Rafael","94901"],["San Rafael","94903"],["Novato","94945"],["Novato","94947"],["Larkspur","94939"],["Corte Madera","94925"],["Mill Valley","94941"]];

const SCHOOLS = {
  LMS: { name: "Lincoln Middle School", grades: [6, 7, 8], perGrade: 128, teachers: ["Rivera","Okafor","Bennett","Cho","Delgado"], library: "Lincoln Middle Library", av: "Lincoln Middle AV Storage" },
  RHS: { name: "Roosevelt High School", grades: [9, 10, 11, 12], perGrade: 153, teachers: ["Chen","Morales","Brooks","Whitfield","Iyer","Nakamura"], library: "Roosevelt High Media Center", av: "Roosevelt High Theater" },
};

const NEW_STAFF = [
  // district office
  { first: "Marcus", last: "Bell", email: "superintendent@summitunified.edu", role: "0", title: "Superintendent" },
  { first: "Alicia", last: "Fontaine", email: "operations@summitunified.edu", role: "2", title: "Director of Operations" },
  // Lincoln Middle
  { first: "Jordan", last: "Mills", email: "ap.lincoln@summitunified.edu", role: "1", title: "Assistant Principal — Lincoln" },
  { first: "Terry", last: "Okafor", email: "t.okafor@summitunified.edu", role: "5", title: "Teacher — Lincoln" },
  { first: "Grace", last: "Bennett", email: "g.bennett@summitunified.edu", role: "5", title: "Teacher — Lincoln" },
  { first: "Min", last: "Cho", email: "m.cho@summitunified.edu", role: "5", title: "Teacher — Lincoln" },
  { first: "Rosa", last: "Delgado", email: "r.delgado@summitunified.edu", role: "5", title: "Teacher — Lincoln" },
  { first: "Chris", last: "Amato", email: "athletics.lincoln@summitunified.edu", role: "3", title: "Athletics Coordinator — Lincoln" },
  // Roosevelt High
  { first: "Naomi", last: "Fields", email: "principal.rhs@summitunified.edu", role: "1", title: "Principal — Roosevelt" },
  { first: "Devon", last: "Pratt", email: "ap.rhs@summitunified.edu", role: "3", title: "Assistant Principal — Roosevelt" },
  { first: "Vic", last: "Morales", email: "athletics.rhs@summitunified.edu", role: "3", title: "Athletic Director — Roosevelt" },
  { first: "Lena", last: "Brooks", email: "theater.rhs@summitunified.edu", role: "3", title: "Theater Director — Roosevelt" },
  { first: "Karen", last: "Diaz", email: "media.rhs@summitunified.edu", role: "4", title: "Media Center — Roosevelt" },
  { first: "Omar", last: "Sayed", email: "tech.rhs@summitunified.edu", role: "4", title: "IT Technician — Roosevelt" },
  { first: "Paul", last: "Iyer", email: "p.iyer@summitunified.edu", role: "5", title: "Teacher — Roosevelt" },
  { first: "Emi", last: "Nakamura", email: "e.nakamura@summitunified.edu", role: "5", title: "Teacher — Roosevelt" },
  { first: "Sean", last: "Whitfield", email: "s.whitfield@summitunified.edu", role: "5", title: "Teacher — Roosevelt" },
  { first: "Tanya", last: "Volkov", email: "t.volkov@summitunified.edu", role: "5", title: "Teacher — Roosevelt" },
  { first: "Hector", last: "Fuentes", email: "h.fuentes@summitunified.edu", role: "5", title: "Teacher — Roosevelt" },
  { first: "Judy", last: "Lam", email: "registrar.rhs@summitunified.edu", role: "5", title: "Registrar — Roosevelt" },
];

const INVENTORY = [
  // 1:1 fleets
  { prefix: "LMS-CB", start: 1001, count: 400, category: "Computers", group: "Chromebook Gen 11 (LMS)", location: "Lincoln Middle Library", cost: 320, desc: "Lincoln 1:1 student Chromebook" },
  { prefix: "RHS-CB", start: 1001, count: 650, category: "Computers", group: "Chromebook Gen 11 (RHS)", location: "Roosevelt High Media Center", cost: 320, desc: "Roosevelt 1:1 student Chromebook" },
  // classroom tech
  { prefix: "LMS-IPD", start: 2001, count: 30, category: "Tablets", group: "iPad Cart A (LMS)", location: "Lincoln Middle Library", cost: 450, desc: "Shared classroom iPad" },
  { prefix: "RHS-IPD", start: 2001, count: 30, category: "Tablets", group: "iPad Cart A (RHS)", location: "Roosevelt High Media Center", cost: 450, desc: "Shared classroom iPad" },
  { prefix: "RHS-CAL", start: 3001, count: 120, category: "Calculators", group: "TI-84 Plus CE (RHS)", location: "Roosevelt High Media Center", cost: 120, desc: "Math dept graphing calculator" },
  { prefix: "SUSD-HSP", start: 4001, count: 40, category: "Connectivity", group: "MiFi Hotspot X2", location: "District IT Office", cost: 90, desc: "Take-home internet hotspot" },
  // event / AV gear
  { prefix: "LMS-PRJ", start: 5001, count: 10, category: "AV Equipment", group: "Epson Projector (LMS)", location: "Lincoln Middle AV Storage", cost: 600, desc: "Classroom/assembly projector" },
  { prefix: "RHS-PRJ", start: 5001, count: 12, category: "AV Equipment", group: "Epson Projector (RHS)", location: "Roosevelt High Theater", cost: 600, desc: "Classroom/assembly projector" },
  { prefix: "SUSD-PA", start: 6001, count: 6, category: "AV Equipment", group: "Portable PA System", location: "District IT Office", cost: 850, desc: "Rallies, field days, outdoor events" },
  { prefix: "RHS-MIC", start: 7001, count: 16, category: "AV Equipment", group: "Wireless Mic (RHS Theater)", location: "Roosevelt High Theater", cost: 240, desc: "Theater/assembly wireless microphone" },
  { prefix: "RHS-LGT", start: 8001, count: 8, category: "Theater", group: "LED Stage Light Kit", location: "Roosevelt High Theater", cost: 700, desc: "Stage wash/spot kit" },
  { prefix: "RHS-SND", start: 9001, count: 2, category: "Theater", group: "Digital Soundboard", location: "Roosevelt High Theater", cost: 2400, desc: "16ch theater soundboard" },
  { prefix: "RHS-TIM", start: 9501, count: 4, category: "Athletics", group: "Scoreboard/Timing Console", location: "Roosevelt High Gym", cost: 1100, desc: "Gym scoreboard + timing console" },
  { prefix: "SUSD-CAM", start: 9601, count: 6, category: "AV Equipment", group: "Camcorder Kit", location: "District IT Office", cost: 500, desc: "Event recording camcorder + tripod" },
];

const daysFromNow = (d) => new Date(Date.now() + d * 86400000);
const sqlDate = (d) => d.toISOString().slice(0, 19).replace("T", " ");

(async () => {
  const mongo = await MongoClient.connect(MONGO_URI);
  const db = mongo.db(MONGO_DB);
  const conn = await mysql.createConnection(SQL);

  const [[schoolRow]] = await conn.query(
    "SELECT company_id FROM company_info WHERE company_name=?", [DISTRICT]);
  if (!schoolRow) throw new Error("Run seed-school-demo.js first.");
  const CID = schoolRow.company_id;
  const CIDs = String(CID);

  // ── locations ────────────────────────────────────────────────────────────
  for (const loc of ["Lincoln Middle AV Storage", "Roosevelt High Theater", "Roosevelt High Gym"]) {
    await conn.query(
      `INSERT INTO locations (company_id, location_name)
       SELECT ?, ? FROM DUAL WHERE NOT EXISTS
         (SELECT 1 FROM locations WHERE company_id=? AND location_name=?)`,
      [CID, loc, CID, loc]);
  }

  // ── staff ────────────────────────────────────────────────────────────────
  const companyDoc = await db.collection("companies").findOne({ _id: DISTRICT_MONGO_ID });
  const newEmployees = [];
  for (const s of NEW_STAFF) {
    if (await db.collection("adminusers").findOne({ email: s.email })) continue;
    const doc = {
      _id: new ObjectId(), name: s.first, lastName: s.last, email: s.email,
      phone: "(415) 555-0" + String(400 + NEW_STAFF.indexOf(s) + 10),
      password: bcrypt.hashSync("DemoPass123!", 10),
      question: "Demo security question", answer: bcrypt.hashSync("demo answer", 10),
      role: s.role, active: true, company: DISTRICT_MONGO_ID, imageProfile: "",
      mfaEnabled: false,
      emailNotifications: { newsAndUpdates: false, tipsAndTutorials: false, userResearch: false },
      dailySummaries: "do not notify me", eventReminder: "do not notify me",
      subscriptionRenewals: "do not notify me", online: false,
      super_user: s.role === "0", multipleCompanies: false, tokenVersion: 0,
      agreedPlatformConditions: true, companiesAssigned: [], __v: 0,
    };
    await db.collection("adminusers").insertOne(doc);
    let [[st]] = await conn.query("SELECT staff_id FROM staff_member WHERE email=?", [s.email]);
    if (!st) {
      const [r] = await conn.query(
        "INSERT INTO staff_member (first_name,last_name,email,phone_number) VALUES (?,?,?,?)",
        [s.first, s.last, s.email, doc.phone]);
      st = { staff_id: r.insertId };
    }
    await conn.query(
      `INSERT IGNORE INTO company_staff (id,company_id,company_name,staff_id,role_id,is_active,assigned_by)
       SELECT UUID(), ?, ?, ?, r.id, 1, 'rich-seed' FROM roles r WHERE r.role_level=?`,
      [CID, DISTRICT, st.staff_id, Number(s.role)]);
    newEmployees.push({
      user: s.email, firstName: s.first, lastName: s.last, email: s.email,
      employee_id: `SUSD-${String((companyDoc?.employees?.length || 0) + newEmployees.length + 1).padStart(4, "0")}`,
      status: "Active", super_user: s.role === "0", role: s.role, active: true,
      preference: { inventory_location: [], managerLocation: [] },
      userId: String(doc._id), _id: new ObjectId(),
    });
    console.log(`✓ staff ${s.title}`);
  }
  if (newEmployees.length) {
    await db.collection("companies").updateOne(
      { _id: DISTRICT_MONGO_ID }, { $push: { employees: { $each: newEmployees } } });
  }

  // ── students ─────────────────────────────────────────────────────────────
  const [[{ n: existingStudents }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM members_info WHERE company_id=?", [CIDs]);
  if (existingStudents < 100) {
    const rows = [];
    let extId = 2000;
    const usedEmails = new Set();
    for (const key of Object.keys(SCHOOLS)) {
      const school = SCHOOLS[key];
      for (const grade of school.grades) {
        for (let i = 0; i < school.perGrade; i++) {
          const first = pick(FIRST), last = pick(LAST);
          let email = `${first}.${last}.${extId}@summit-district.edu`.toLowerCase();
          while (usedEmails.has(email)) email = `${first}.${last}.${++extId}@summit-district.edu`.toLowerCase();
          usedEmails.add(email);
          const section = school.teachers[i % school.teachers.length];
          const [city, zip] = pick(CITIES);
          const street = `${Math.floor(rand() * 900) + 10} ${pick(STREETS)}`;
          // seniors: ~40% already 18; everyone else is a minor
          const isAdult = grade === 12 && rand() < 0.4;
          // dirty-data tail: ~1.5% of minors missing guardian info
          const missingRep = !isAdult && rand() < 0.015;
          const gFirst = pick(FIRST), gLast = last; // guardian usually shares surname
          rows.push([
            first, last, email, `(415) 555-${String(1000 + (extId % 9000)).padStart(4, "0")}`,
            `STU-${extId}`, `${street}, ${city}, CA ${zip}`, street, city, "CA", zip,
            CIDs, String(grade), `${section} ${grade}${String.fromCharCode(65 + (i % 4))}`,
            isAdult ? 0 : 1,
            isAdult || missingRep ? null : gFirst,
            isAdult || missingRep ? null : gLast,
            isAdult || missingRep ? null : `${gFirst}.${gLast}.${extId}@example.com`.toLowerCase(),
            isAdult || missingRep ? null : `(415) 555-${String(1000 + ((extId + 7) % 9000)).padStart(4, "0")}`,
          ]);
          extId++;
        }
      }
    }
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await conn.query(
        `INSERT INTO members_info
          (first_name,last_name,email,phone_number,external_id,address,address_street,address_city,address_state,address_zip,
           company_id,grade,homeroom,minor,parent_guardian_first_name,parent_guardian_last_name,parent_guardian_email,parent_guardian_phone_number)
         VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}`,
        chunk.flat());
    }
    console.log(`✓ ${rows.length} students enrolled (Lincoln 6-8, Roosevelt 9-12)`);
  } else console.log(`• students already enrolled (${existingStudents})`);

  // ── inventory ────────────────────────────────────────────────────────────
  for (const line of INVENTORY) {
    const [[{ n }]] = await conn.query(
      "SELECT COUNT(*) AS n FROM item_inv WHERE company_id=? AND item_group=?",
      [CIDs, line.group]);
    if (n >= line.count) { console.log(`• ${line.group} already stocked (${n})`); continue; }
    const rows = [];
    for (let i = 0; i < line.count; i++) {
      rows.push([line.category, line.group, line.cost, "Demo Ed", line.desc, "Owned",
        `${line.prefix}-${line.start + i}`, 1, line.location, line.location, CIDs,
        1, 1, "Operational", "in-stock"]);
    }
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await conn.query(
        `INSERT INTO item_inv
          (category_name,item_group,cost,brand,descript_item,ownership,serial_number,warehouse,location,current_location,company_id,
           display_item,enableAssignFeature,status,logistic_status)
         VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}`,
        chunk.flat());
    }
    console.log(`✓ ${line.count} × ${line.group}`);
  }

  // ── 1:1 leases (~90% of students hold a Chromebook) ─────────────────────
  const [[{ n: leaseCount }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM member_assigned_device_lease WHERE company_id=? AND returned=0", [CIDs]);
  if (leaseCount < 100) {
    const [[assigner]] = await conn.query(
      "SELECT staff_id FROM staff_member WHERE email='it.director@summitunified.edu'");
    const [students] = await conn.query(
      "SELECT member_id, grade FROM members_info WHERE company_id=? AND external_id LIKE 'STU-2%' ORDER BY member_id", [CIDs]);
    const [lmsCbs] = await conn.query(
      "SELECT item_id FROM item_inv WHERE company_id=? AND item_group='Chromebook Gen 11 (LMS)' AND warehouse=1 ORDER BY item_id", [CIDs]);
    const [rhsCbs] = await conn.query(
      "SELECT item_id FROM item_inv WHERE company_id=? AND item_group='Chromebook Gen 11 (RHS)' AND warehouse=1 ORDER BY item_id", [CIDs]);
    let lms = 0, rhs = 0;
    const leases = [];
    const yearEnd = sqlDate(new Date("2027-06-11T20:00:00Z"));
    const schoolStart = sqlDate(new Date("2026-06-20T17:00:00Z"));
    let overdueBudget = 20;
    for (const s of students) {
      if (rand() > 0.9) continue; // ~10% opted out / device at home program
      const pool = Number(s.grade) <= 8 ? lmsCbs : rhsCbs;
      const idx = Number(s.grade) <= 8 ? lms++ : rhs++;
      if (idx >= pool.length) continue;
      // small overdue tail (loaner swaps due back already), 2-12 days late
      const overdue = overdueBudget > 0 && rand() < 0.025;
      if (overdue) overdueBudget--;
      leases.push([
        s.member_id, String(assigner.staff_id), pool[idx].item_id, CIDs,
        schoolStart, overdue ? sqlDate(daysFromNow(-(2 + Math.floor(rand() * 11)))) : yearEnd,
        0, Number(s.grade) <= 8 ? "Lincoln Middle School" : "Roosevelt High School",
      ]);
    }
    for (let i = 0; i < leases.length; i += 200) {
      const chunk = leases.slice(i, i + 200);
      await conn.query(
        `INSERT INTO member_assigned_device_lease
          (member_id,staff_member_id,device_id,company_id,assigned_date,expected_return_date,returned,location)
         VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?)").join(",")}`,
        chunk.flat());
    }
    const deviceIds = leases.map((l) => l[2]);
    for (let i = 0; i < deviceIds.length; i += 500) {
      const chunk = deviceIds.slice(i, i + 500);
      await conn.query(
        `UPDATE item_inv SET warehouse=0, logistic_status='assigned'
         WHERE item_id IN (${chunk.map(() => "?").join(",")})`, chunk);
    }
    console.log(`✓ ${leases.length} Chromebook leases issued (${20 - overdueBudget} overdue)`);
  } else console.log(`• leases already issued (${leaseCount})`);

  // ── events ───────────────────────────────────────────────────────────────
  const EVENTS = [
    { name: "8th Grade Field Trip — Exploratorium", loc: "San Francisco, CA", addr: "Pier 15, San Francisco CA, 94111", start: 9, end: 9, gear: [["Connectivity", "MiFi Hotspot X2", 10], ["AV Equipment", "Camcorder Kit", 2]] },
    { name: "Fall Pep Rally", loc: "San Rafael, CA", addr: "Roosevelt High Gym, San Rafael CA, 94901", start: 24, end: 24, gear: [["AV Equipment", "Portable PA System", 3], ["AV Equipment", "Wireless Mic (RHS Theater)", 6]] },
    { name: "Homecoming Game vs. Bayview Prep", loc: "San Rafael, CA", addr: "Roosevelt High Stadium, San Rafael CA, 94901", start: 31, end: 31, gear: [["Athletics", "Scoreboard/Timing Console", 2], ["AV Equipment", "Portable PA System", 2], ["AV Equipment", "Camcorder Kit", 2]] },
    { name: "Fall Theater Production — Into the Woods", loc: "San Rafael, CA", addr: "Roosevelt High Theater, San Rafael CA, 94901", start: 45, end: 48, gear: [["Theater", "LED Stage Light Kit", 8], ["Theater", "Digital Soundboard", 1], ["AV Equipment", "Wireless Mic (RHS Theater)", 12]] },
    { name: "Back-to-School Night", loc: "San Rafael, CA", addr: "Both campuses, San Rafael CA, 94901", start: 36, end: 36, gear: [["AV Equipment", "Epson Projector (LMS)", 6], ["AV Equipment", "Epson Projector (RHS)", 8]] },
    { name: "Summer STEM Camp", loc: "San Rafael, CA", addr: "Lincoln Middle School, San Rafael CA, 94901", start: -10, end: 14, gear: [["Tablets", "iPad Cart A (LMS)", 30], ["AV Equipment", "Epson Projector (LMS)", 2]] },
    { name: "Science Fair 2026", loc: "San Rafael, CA", addr: "Lincoln Middle Gym, San Rafael CA, 94901", start: -60, end: -59, gear: [["AV Equipment", "Portable PA System", 2], ["AV Equipment", "Epson Projector (LMS)", 4]] },
    { name: "Graduation — Class of 2026", loc: "San Rafael, CA", addr: "Roosevelt High Stadium, San Rafael CA, 94901", start: -33, end: -33, gear: [["AV Equipment", "Portable PA System", 4], ["AV Equipment", "Wireless Mic (RHS Theater)", 8], ["AV Equipment", "Camcorder Kit", 3]] },
  ];
  const existingEvents = await db.collection("events").countDocuments({ company: DISTRICT });
  if (existingEvents === 0) {
    for (const ev of EVENTS) {
      const begin = daysFromNow(ev.start), end = daysFromNow(ev.end);
      await db.collection("events").insertOne({
        _id: new ObjectId(),
        user: "principal@summitunified.edu",
        company: DISTRICT,
        subscription: [],
        eventInfoDetail: {
          eventName: ev.name, eventLocation: ev.loc, address: ev.addr,
          building: ev.addr.split(",")[0], floor: "",
          phoneNumber: ["(415) 555-0400"], merchant: DISTRICT,
          dateBegin: begin.toISOString(), dateEnd: end.toISOString(),
          dateBeginTime: begin.getTime(), dateEndTime: end.getTime(),
        },
        staff: {
          adminUser: [
            { firstName: "Elena", lastName: "Vasquez", email: "principal@summitunified.edu", role: "Administrator" },
            { firstName: "Sam", lastName: "Whitaker", email: "it.director@summitunified.edu", role: "Administrator" },
          ],
          headsetAttendees: [],
        },
        contactInfo: { name: "Sam Whitaker", email: "it.director@summitunified.edu", phone: ["(415) 555-0402"] },
        deviceSetup: ev.gear.map(([category, group, qty]) => ({
          category, group, value: "0.00",
          description: `${group} for ${ev.name}`,
          company: DISTRICT_MONGO_ID, isItSetAsContainerForEvent: false,
          quantity: qty, ownership: "Owned", container: false,
          createdBy: "school-rich-seed", key: `ds_${ev.name.replace(/\W+/g, "_")}_${group.replace(/\W+/g, "_")}`,
          existing: true, consumerUses: false,
        })),
        extraServicesNeeded: false, extraServices: [],
        type: "event",
        active: end.getTime() >= Date.now(),
        contactName: "Sam Whitaker",
        qrCodeLink: "",
        company_id: DISTRICT_MONGO_ID,
      });
      await conn.query(
        `INSERT INTO event_info (event_name, venue_name, street_address, city_address, state_address, zip_address, email_company, phone_number, company_assigned_event_id)
         SELECT ?,?,?,?,?,?,?,?,? FROM DUAL
         WHERE NOT EXISTS (SELECT 1 FROM event_info WHERE event_name=? AND company_assigned_event_id=?)`,
        [ev.name, ev.addr.split(",")[0], ev.addr.split(",")[0], ev.loc.split(",")[0], "CA", ev.addr.match(/\d{5}/)?.[0] ?? "94901",
          "info@summitunified.edu", "(415) 555-0400", CID, ev.name, CID]);
      console.log(`✓ event: ${ev.name}`);
    }
  } else console.log(`• events already present (${existingEvents})`);

  const [[{ n: sc }]] = await conn.query("SELECT COUNT(*) AS n FROM members_info WHERE company_id=?", [CIDs]);
  const [[{ n: ic }]] = await conn.query("SELECT COUNT(*) AS n FROM item_inv WHERE company_id=?", [CIDs]);
  const [[{ n: lc }]] = await conn.query("SELECT COUNT(*) AS n FROM member_assigned_device_lease WHERE company_id=? AND returned=0", [CIDs]);
  console.log(`\nDistrict now: ${sc} students · ${ic} inventory items · ${lc} devices out`);
  await mongo.close();
  await conn.end();
})().catch((e) => { console.error("SEED FAILED:", e.message); process.exit(1); });
