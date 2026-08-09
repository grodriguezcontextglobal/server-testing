/* eslint-disable no-console */
/**
 * Seed: "Bridges Public Charter School" — a PK3–grade 5 Education tenant.
 *
 * Built for the Bridges sales demo. Deliberately a different shape from the
 * Summit Unified seed: one campus instead of a district, ~369 students who are
 * ALL under 13, and an inclusion program that puts assistive technology
 * (AAC talkers, FM hearing systems, sensory kit) on named students. That makes
 * the FERPA/COPPA consent spine the centre of the story rather than an edge
 * case — for Summit the under-13 cohort is a quarter of the roster, here it is
 * the whole school.
 *
 * The institutional profile (grade span, ~365 students, 10:1, inclusion model,
 * arts integration, DC Ward 4 campus) mirrors the real school. Every person,
 * serial number, address and consent record below is fabricated demo data.
 *
 * Idempotent: each stage skips when its data is already present, so re-running
 * is safe. Touches nothing belonging to Summit (company 3) or the AV tenant
 * (company 2).
 *
 *   node seed/seed-bridges-demo.js
 */
const { MongoClient, ObjectId } = require("mongodb");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");
const { generateOtc, hashOtc } = require("../mysql/helpers/consentOtc");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const MONGO_DB = process.env.MONGO_DB || "devitrak_demo";
const SQL = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DB || "devitrak_bridges",
};

const SCHOOL = {
  mongoId: "5000000000000000000b0002",
  name: "Bridges Public Charter School",
  // Compared case-sensitively by the frontend (industriesList.json) and
  // lowercased by the /api/school middleware. "Education" satisfies both.
  industry: "Education",
  address: {
    street: "100 Gallatin St NE",
    city: "Washington",
    state: "District of Columbia",
    postal_code: "20011",
  },
  phone: "(202) 555-0140",
  website: "https://bridgespcs.org",
  main_email: "info@bridgespcs.org",
};
/** Single-line address stamped on inventory rows ("Taxable address" column). */
const CAMPUS_ADDRESS = "100 Gallatin St NE, Washington, DC 20011";
/** Echoed into the readiness header chip as "policy v2". */
const POLICY_VERSION = "2";

/* --------------------------------------------------------------- helpers */

// Deterministic PRNG so every re-run against a fresh DB produces the same
// people, serials and consent mix.
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(20260809);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

const daysFromNow = (d) => new Date(Date.now() + d * 86400000);
const sqlDate = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const chunked = async (rows, size, fn) => {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
};

/**
 * Birthdate for a PK3–grade 5 student.
 *
 * The seed-school-demo-rich helper assumes grade+5 and clamps at 17, which is
 * meaningless below kindergarten. Here each grade carries its own nominal age
 * (PK3 turns 4 during the year, grade 5 turns 11), and the age is taken
 * relative to the day the seed runs so a demo restored months later still
 * shows plausible ages. Every value lands far under 13, which is the point:
 * the Under-13 readiness tile should read 100%.
 */
const dobForAge = (age) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - age);
  d.setUTCDate(d.getUTCDate() - Math.floor(rand() * 365));
  return d.toISOString().slice(0, 10);
};

/* ------------------------------------------------------------- reference */

// Locations are the canonical name list. The same strings are reused for
// item_inv.location, preference.inventory_location and managerLocation —
// Summit's seed lets these drift, which leaves the Assign-Location dropdown
// offering names that match nothing in the assignment table.
const LOCATIONS = [
  { name: "Main Office", subs: [] },
  { name: "Technology Office", subs: ["Device Intake", "Repair Bench", "Spare Parts"] },
  { name: "Library & Media Center", subs: ["Cart Bay", "Shelf A", "Shelf B"] },
  { name: "Art Studio", subs: ["Supply Closet"] },
  { name: "Music Room", subs: ["Instrument Storage"] },
  { name: "Movement Studio", subs: [] },
  { name: "OT/PT Suite", subs: ["Equipment Closet"] },
  { name: "Speech Therapy Suite", subs: ["AAC Cabinet"] },
  { name: "Sensory Room", subs: ["Bin Storage"] },
  { name: "Gymnasium", subs: [] },
  { name: "Early Childhood Wing", subs: ["PK3 Caterpillars", "PK3 Ladybugs", "PK3 Turtles", "PK3 Fireflies", "PK4 Butterflies", "PK4 Dragonflies", "PK4 Owls", "PK4 Foxes"] },
  { name: "Lower Elementary Wing", subs: ["K Sunflowers", "K Sequoias", "K Rivers", "Grade 1 Adeyemi", "Grade 1 Rosario", "Grade 1 Kirkland", "Grade 2 Nakamura", "Grade 2 Ferreira", "Grade 2 Boateng"] },
  { name: "Upper Elementary Wing", subs: ["Grade 3 Lynch", "Grade 3 Castellanos", "Grade 4 Tran", "Grade 4 Waverly", "Grade 5 Achebe", "Grade 5 Donnelly"] },
  { name: "Health Suite", subs: [] },
  { name: "Family Resource Center", subs: [] },
];

// role: Mongo role string ↔ SQL roles.role_level (same 0–5 scale).
// roleType MUST be set — server/middlewares/authorizeMongoPermission.js reads
// the actor's role only from companies.employees[].roleType, and both existing
// school seeds omit it, which 403s every non-super_user.
const LEGACY_ROLE_MAP = {
  0: "root_admin", 1: "admin", 2: "sale_manager",
  3: "event_manager", 4: "inventory_manager", 5: "assistant",
};

// ~21 platform accounts out of a ~52-person staff — realistic, since classroom
// aides and most specials teachers never get an equipment-system login, and the
// staff table fires one /staff/admin-users request per row.
const STAFF = [
  { first: "Alicia", last: "Mensah", email: "head@bridgespcs.org", role: "0", title: "Head of School" },
  { first: "Marcus", last: "Okonkwo", email: "operations@bridgespcs.org", role: "1", title: "Director of Operations" },
  { first: "Renée", last: "Baptiste", email: "studentsupport@bridgespcs.org", role: "1", title: "Director of Student Support Services" },
  { first: "Tanya", last: "Whitfield", email: "compliance@bridgespcs.org", role: "2", title: "Data & Compliance Manager" },
  { first: "Curtis", last: "Delacroix", email: "business@bridgespcs.org", role: "2", title: "Business Manager" },
  { first: "Imani", last: "Session", email: "dean@bridgespcs.org", role: "3", title: "Dean of Students" },
  { first: "Gabriela", last: "Reyes-Ortiz", email: "family@bridgespcs.org", role: "3", title: "Family Engagement Coordinator" },
  { first: "Nathaniel", last: "Poole", email: "arts@bridgespcs.org", role: "3", title: "Arts Integration Lead" },
  { first: "Yusuf", last: "Abdi", email: "pe@bridgespcs.org", role: "3", title: "PE & Field Day Coordinator" },
  { first: "Priya", last: "Raghunathan", email: "tech@bridgespcs.org", role: "4", title: "Technology Manager" },
  { first: "Devon", last: "Carrington", email: "library@bridgespcs.org", role: "4", title: "Library & Media Specialist" },
  { first: "Sofia", last: "Marchetti", email: "at@bridgespcs.org", role: "4", title: "Assistive Technology Specialist" },
  { first: "Keisha", last: "Braxton", email: "slp1@bridgespcs.org", role: "5", title: "Speech-Language Pathologist" },
  { first: "Hannah", last: "Oyelaran", email: "ot1@bridgespcs.org", role: "5", title: "Occupational Therapist" },
  { first: "Miguel", last: "Santos-Vega", email: "pt@bridgespcs.org", role: "5", title: "Physical Therapist" },
  { first: "Aisha", last: "Kamara", email: "a.kamara@bridgespcs.org", role: "5", title: "Lead Teacher — PK4 Butterflies" },
  { first: "Brendan", last: "Lynch", email: "b.lynch@bridgespcs.org", role: "5", title: "Lead Teacher — Grade 3" },
  { first: "Nia", last: "Whitlock", email: "registrar@bridgespcs.org", role: "5", title: "Front Office Manager / Registrar" },
  // Amber "Pending" chips + a non-zero "Pending invitations" KPI. No userId,
  // which is also what marks them un-reassignable on the roles board.
  { first: "Omar", last: "Haddadi", email: "tech.assistant@bridgespcs.org", role: "4", title: "Technology Assistant", pending: true },
  { first: "Charlotte", last: "Emerson", email: "slp2@bridgespcs.org", role: "5", title: "Speech-Language Pathologist", pending: true },
  // One grey "Inactive" chip — staff on extended leave.
  { first: "Grace", last: "Tulloch", email: "behavior@bridgespcs.org", role: "5", title: "Behavior Specialist", inactive: true },
];

/** Per-location permission grants, so the Assign Location tab isn't all-true. */
const FULL_ACTIONS = { create: true, update: true, transfer: true, delete: true, assign: true, view: true };
const VIEW_ASSIGN = { create: false, update: false, transfer: false, delete: false, assign: true, view: true };
const TECH_ACTIONS = { create: true, update: true, transfer: true, delete: false, assign: true, view: true };
const scopeFor = (staff) => {
  if (staff.role === "0" || staff.role === "1") {
    return { names: LOCATIONS.map((l) => l.name), actions: FULL_ACTIONS };
  }
  if (staff.email === "tech@bridgespcs.org" || staff.email === "tech.assistant@bridgespcs.org") {
    return { names: ["Technology Office", "Library & Media Center", "Upper Elementary Wing", "Lower Elementary Wing"], actions: TECH_ACTIONS };
  }
  if (staff.email === "library@bridgespcs.org") {
    return { names: ["Library & Media Center", "Lower Elementary Wing", "Upper Elementary Wing"], actions: TECH_ACTIONS };
  }
  if (staff.email === "at@bridgespcs.org") {
    return { names: ["Speech Therapy Suite", "OT/PT Suite", "Sensory Room", "Technology Office"], actions: TECH_ACTIONS };
  }
  if (["slp1@bridgespcs.org", "slp2@bridgespcs.org"].includes(staff.email)) {
    return { names: ["Speech Therapy Suite", "Sensory Room"], actions: VIEW_ASSIGN };
  }
  if (["ot1@bridgespcs.org", "pt@bridgespcs.org", "behavior@bridgespcs.org"].includes(staff.email)) {
    return { names: ["OT/PT Suite", "Sensory Room"], actions: VIEW_ASSIGN };
  }
  if (staff.email === "arts@bridgespcs.org") return { names: ["Art Studio", "Music Room", "Movement Studio"], actions: VIEW_ASSIGN };
  if (staff.email === "pe@bridgespcs.org") return { names: ["Gymnasium", "Movement Studio"], actions: VIEW_ASSIGN };
  if (staff.email === "a.kamara@bridgespcs.org") return { names: ["Early Childhood Wing"], actions: VIEW_ASSIGN };
  if (staff.email === "b.lynch@bridgespcs.org") return { names: ["Upper Elementary Wing"], actions: VIEW_ASSIGN };
  return { names: ["Main Office", "Family Resource Center"], actions: VIEW_ASSIGN };
};

const GRADES = [
  { grade: "PK3", age: 3, per: 15, wing: "Early Childhood Wing", rooms: ["Caterpillars", "Ladybugs", "Turtles", "Fireflies"], roomLabel: (r) => `PK3 — ${r}`, sub: (r) => `PK3 ${r}` },
  { grade: "PK4", age: 4, per: 15, wing: "Early Childhood Wing", rooms: ["Butterflies", "Dragonflies", "Owls", "Foxes"], roomLabel: (r) => `PK4 — ${r}`, sub: (r) => `PK4 ${r}` },
  { grade: "K", age: 5, per: 17, wing: "Lower Elementary Wing", rooms: ["Sunflowers", "Sequoias", "Rivers"], roomLabel: (r) => `K — ${r}`, sub: (r) => `K ${r}` },
  { grade: "1", age: 6, per: 16, wing: "Lower Elementary Wing", rooms: ["Adeyemi", "Rosario", "Kirkland"], roomLabel: (r) => `Grade 1 — ${r}`, sub: (r) => `Grade 1 ${r}` },
  { grade: "2", age: 7, per: 16, wing: "Lower Elementary Wing", rooms: ["Nakamura", "Ferreira", "Boateng"], roomLabel: (r) => `Grade 2 — ${r}`, sub: (r) => `Grade 2 ${r}` },
  { grade: "3", age: 8, per: 18, wing: "Upper Elementary Wing", rooms: ["Lynch", "Castellanos"], roomLabel: (r) => `Grade 3 — ${r}`, sub: (r) => `Grade 3 ${r}` },
  { grade: "4", age: 9, per: 17, wing: "Upper Elementary Wing", rooms: ["Tran", "Waverly"], roomLabel: (r) => `Grade 4 — ${r}`, sub: (r) => `Grade 4 ${r}` },
  { grade: "5", age: 10, per: 16, wing: "Upper Elementary Wing", rooms: ["Achebe", "Donnelly"], roomLabel: (r) => `Grade 5 — ${r}`, sub: (r) => `Grade 5 ${r}` },
];

// A DC-plausible name pool: predominantly Black and Latino, with the East and
// West African communities that Ward 4 schools actually serve.
const FIRST = ["Amir", "Zaria", "Malachi", "Nia", "Josiah", "Amara", "Elijah", "Aaliyah", "Xavier", "Simone", "Marcus", "Imani", "Andre", "Journee", "Kingston", "Skylar", "Jamal", "Layla", "Isaiah", "Nyla", "Terrance", "Camille", "Devin", "Aniyah", "Cristian", "Valentina", "Diego", "Mariana", "Santiago", "Isabella", "Yonas", "Selam", "Abel", "Hana", "Mekdes", "Kofi", "Ama", "Ibrahim", "Fatoumata", "Sekou", "Aminata", "Liam", "Charlotte", "Owen", "Nora", "Henry", "Alice", "Theo", "Maeve", "Kai", "Amari", "Zuri", "Karter", "Genesis", "Messiah", "Saniyah", "Braylon", "Cataleya", "Jayceon", "Kenzie", "Elias", "Solomon", "Naima", "Tobias", "Adaeze", "Rashida", "Emeka", "Bilal", "Soraya", "Dashawn", "Milagros", "Rafael", "Yara", "Emmanuel", "Destiny", "Julian", "Ayana", "Khalil", "Lourdes", "Micah", "Precious"];
const LAST = ["Washington", "Jefferson", "Freeman", "Boykin", "Braxton", "Dorsey", "Gaskins", "Hollis", "Ivey", "Jenkins", "Lattimore", "Mabry", "Nesbitt", "Overton", "Pinkney", "Quarles", "Rhodes", "Session", "Tillery", "Vaughn", "Waddell", "Youngblood", "Barnes", "Carrington", "Ellerbe", "Ferebee", "Gilliam", "Hargrove", "Reyes", "Ortiz", "Mejia", "Hernandez", "Portillo", "Alvarado", "Cruz", "Lopez", "Guzman", "Tesfaye", "Bekele", "Haile", "Girma", "Diallo", "Camara", "Bah", "Sesay", "Kamara", "Toure", "Nguyen", "Okonkwo", "Adeyemi", "Boateng", "Mensah", "Osei", "O'Connell", "Donnelly", "Kirkland", "Thigpen", "Whitlow", "Ashford", "Beckwith", "Colefield", "Ducker", "Eskridge", "Fauntroy", "Grimke", "Hobson"];
// Ward 4 / Ward 5 streets and the ZIPs Bridges families actually sit in.
const STREETS = ["Gallatin St NE", "Kennedy St NW", "Upshur St NW", "South Dakota Ave NE", "Riggs Rd NE", "Georgia Ave NW", "Varnum St NW", "Webster St NW", "Hamilton St NE", "Blair Rd NE", "New Hampshire Ave NW", "Sherman Ave NW", "Park Rd NW", "Michigan Ave NE", "Allison St NW", "Farragut St NW", "Emerson St NW", "Buchanan St NE", "Taylor St NE", "Quincy St NW"];
const NEIGHBORHOODS = [["Washington", "20011"], ["Washington", "20011"], ["Washington", "20010"], ["Washington", "20017"], ["Washington", "20012"], ["Washington", "20001"], ["Washington", "20002"], ["Washington", "20018"]];

/**
 * Inventory catalogue — ~640 items, proportionate to a 369-student elementary
 * school rather than copied from the district seed.
 *
 * ownership must be one of Permanent / Rent / Sale / Resale: the pill renders
 * dictionary[ownership] and anything else (Summit uses the literal "Owned")
 * renders an empty pill.
 */
const INVENTORY = [
  // 1:1 fleets — K–2 on iPads, 3–5 on Chromebooks. PK3/PK4 deliberately get
  // cart-level tablets only, which is both realistic and shows the system
  // handling shared vs individually-assigned stock.
  { prefix: "BPCS-IPD", start: 1001, count: 160, category: "Tablets", group: "iPad 10th Gen (Grades K–2)", location: "Lower Elementary Wing", sub: [], cost: 349, brand: "Apple", desc: "Assigned student iPad, grades K–2" },
  { prefix: "BPCS-CHR", start: 2001, count: 115, category: "Computers", group: "Chromebook 11-inch (Grades 3–5)", location: "Upper Elementary Wing", sub: [], cost: 289, brand: "Acer", desc: "Assigned student Chromebook, grades 3–5" },
  { prefix: "BPCS-ECE", start: 2501, count: 60, category: "Tablets", group: "iPad ECE Cart (PK3–PK4)", location: "Early Childhood Wing", sub: [], cost: 349, brand: "Apple", desc: "Shared early-childhood classroom iPad" },
  { prefix: "BPCS-STF", start: 3001, count: 55, category: "Computers", group: "Staff Laptop", location: "Technology Office", sub: ["Device Intake"], cost: 940, brand: "Dell", desc: "Teacher / staff laptop" },
  // Assistive technology — the inclusion story, assigned to named IEP students.
  { prefix: "BPCS-AAC", start: 4001, count: 18, category: "Assistive Technology", group: "AAC Speech Device", location: "Speech Therapy Suite", sub: ["AAC Cabinet"], cost: 1750, brand: "Tobii Dynavox", desc: "Augmentative communication device (IEP-assigned)" },
  { prefix: "BPCS-SWT", start: 4101, count: 14, category: "Assistive Technology", group: "Adapted Switch Kit", location: "OT/PT Suite", sub: ["Equipment Closet"], cost: 210, brand: "AbleNet", desc: "Adapted access switch kit" },
  { prefix: "BPCS-AKB", start: 4201, count: 16, category: "Assistive Technology", group: "Adapted Keyboard / Trackball", location: "Technology Office", sub: ["Spare Parts"], cost: 165, brand: "Logitech", desc: "Large-key keyboard and trackball set" },
  { prefix: "BPCS-RDP", start: 4301, count: 10, category: "Assistive Technology", group: "Reading Pen", location: "Library & Media Center", sub: ["Shelf A"], cost: 275, brand: "C-Pen", desc: "Scanning reading pen for decoding support" },
  { prefix: "BPCS-FMH", start: 4401, count: 9, category: "Hearing & Audio", group: "FM/DM Hearing System", location: "Speech Therapy Suite", sub: ["AAC Cabinet"], cost: 1250, brand: "Phonak", desc: "Personal FM/DM hearing system (IEP-assigned)" },
  { prefix: "BPCS-SFD", start: 4501, count: 12, category: "Hearing & Audio", group: "Classroom Soundfield System", location: "Lower Elementary Wing", sub: [], cost: 890, brand: "Lightspeed", desc: "Classroom audio distribution system" },
  // Classroom AV
  { prefix: "BPCS-IDP", start: 5001, count: 23, category: "AV Equipment", group: "Interactive Display Panel", location: "Lower Elementary Wing", sub: [], cost: 2400, brand: "Promethean", desc: "65-inch classroom interactive panel" },
  { prefix: "BPCS-DOC", start: 5101, count: 23, category: "AV Equipment", group: "Document Camera", location: "Lower Elementary Wing", sub: [], cost: 180, brand: "IPEVO", desc: "Classroom document camera" },
  { prefix: "BPCS-PAS", start: 5201, count: 4, category: "AV Equipment", group: "Portable PA System", location: "Gymnasium", sub: [], cost: 780, brand: "Bose", desc: "Assemblies, field day and outdoor events" },
  { prefix: "BPCS-PRJ", start: 5301, count: 6, category: "AV Equipment", group: "Portable Projector", location: "Library & Media Center", sub: ["Shelf B"], cost: 520, brand: "Epson", desc: "Portable projector for family nights" },
  // Charging / logistics
  { prefix: "BPCS-CRT", start: 6001, count: 6, category: "Charging", group: "32-bay Charging Cart", location: "Technology Office", sub: ["Device Intake"], cost: 1150, brand: "Anywhere Cart", desc: "32-bay laptop charging cart" },
  { prefix: "BPCS-TCT", start: 6101, count: 8, category: "Charging", group: "16-bay Tablet Cart", location: "Early Childhood Wing", sub: [], cost: 690, brand: "Anywhere Cart", desc: "16-bay tablet charging cart" },
  // Related services — the OT/PT/sensory kit an inclusion school actually owns
  { prefix: "BPCS-TBL", start: 7001, count: 10, category: "Therapy Equipment", group: "Therapy Ball Set", location: "OT/PT Suite", sub: ["Equipment Closet"], cost: 95, brand: "Gymnic", desc: "Graduated therapy ball set" },
  { prefix: "BPCS-BAL", start: 7101, count: 12, category: "Therapy Equipment", group: "Balance Board", location: "OT/PT Suite", sub: ["Equipment Closet"], cost: 70, brand: "Bosu", desc: "Balance and proprioception board" },
  { prefix: "BPCS-WVS", start: 7201, count: 15, category: "Therapy Equipment", group: "Weighted Vest Set", location: "OT/PT Suite", sub: ["Equipment Closet"], cost: 120, brand: "Fun and Function", desc: "Weighted vest, sized set" },
  { prefix: "BPCS-SWG", start: 7301, count: 4, category: "Therapy Equipment", group: "Compression Swing", location: "Sensory Room", sub: ["Bin Storage"], cost: 260, brand: "Southpaw", desc: "Lycra compression swing" },
  { prefix: "BPCS-SLP", start: 7401, count: 6, category: "Sensory Equipment", group: "Sensory Light Panel", location: "Sensory Room", sub: ["Bin Storage"], cost: 340, brand: "Snoezelen", desc: "LED sensory light panel" },
  { prefix: "BPCS-HDP", start: 7501, count: 40, category: "Sensory Equipment", group: "Noise-Reducing Headphones", location: "Sensory Room", sub: ["Bin Storage"], cost: 45, brand: "Vanderfields", desc: "Noise-reducing headphones (student-assigned)" },
  { prefix: "BPCS-WBL", start: 7601, count: 20, category: "Sensory Equipment", group: "Wobble Seat Set", location: "Sensory Room", sub: ["Bin Storage"], cost: 55, brand: "Gaiam", desc: "Flexible-seating wobble cushion set" },
  // Arts integration
  { prefix: "BPCS-ORF", start: 8001, count: 8, category: "Music & Arts", group: "Orff Instrument Set", location: "Music Room", sub: ["Instrument Storage"], cost: 430, brand: "Sonor", desc: "Orff xylophone and metallophone set" },
  { prefix: "BPCS-UKE", start: 8101, count: 6, category: "Music & Arts", group: "Ukulele Class Set", location: "Music Room", sub: ["Instrument Storage"], cost: 310, brand: "Kala", desc: "Class set of 12 soprano ukuleles" },
  { prefix: "BPCS-PNO", start: 8201, count: 3, category: "Music & Arts", group: "Digital Piano", location: "Music Room", sub: ["Instrument Storage"], cost: 1100, brand: "Yamaha", desc: "88-key digital piano" },
  { prefix: "BPCS-ART", start: 8301, count: 9, category: "Music & Arts", group: "Mobile Art Cart", location: "Art Studio", sub: ["Supply Closet"], cost: 380, brand: "Sax", desc: "Mobile art supply cart" },
  // STEM
  { prefix: "BPCS-BEE", start: 9001, count: 12, category: "STEM & Robotics", group: "Bee-Bot Robot Set", location: "Library & Media Center", sub: ["Shelf A"], cost: 160, brand: "Terrapin", desc: "Early-coding floor robot set" },
  { prefix: "BPCS-OSM", start: 9101, count: 10, category: "STEM & Robotics", group: "Osmo Learning Kit", location: "Library & Media Center", sub: ["Shelf A"], cost: 105, brand: "Osmo", desc: "Tablet-based hands-on learning kit" },
  { prefix: "BPCS-LEG", start: 9201, count: 14, category: "STEM & Robotics", group: "LEGO Education Set", location: "Library & Media Center", sub: ["Shelf B"], cost: 230, brand: "LEGO Education", desc: "LEGO Education SPIKE Essential set" },
  // Family supports + safety
  { prefix: "BPCS-HSP", start: 9301, count: 30, category: "Connectivity", group: "MiFi Hotspot", location: "Family Resource Center", sub: [], cost: 85, brand: "Franklin", desc: "Take-home internet hotspot for families" },
  { prefix: "BPCS-AED", start: 9401, count: 3, category: "Health & Safety", group: "AED Unit", location: "Health Suite", sub: [], cost: 1400, brand: "Zoll", desc: "Automated external defibrillator" },
  { prefix: "BPCS-VIT", start: 9451, count: 2, category: "Health & Safety", group: "Nurse Vitals Kit", location: "Health Suite", sub: [], cost: 620, brand: "Welch Allyn", desc: "Nurse vitals and screening kit" },
];

/**
 * School-year calendar anchored to the seed date (early August = the week
 * before staff return). Field trips are the DC ones a Ward 4 elementary
 * actually takes.
 *
 * live: multi-day spans are the only way an event lands in the "Live now"
 * carousel — a single-instant event has a one-millisecond window.
 */
const EVENTS = [
  { name: "Summer Learning Academy 2026", start: -38, end: -10, logistic: "completed", contact: "dean@bridgespcs.org", gear: [["Tablets", "iPad ECE Cart (PK3–PK4)", 30, false], ["STEM & Robotics", "Bee-Bot Robot Set", 8, false]] },
  { name: "Fifth Grade Promotion Ceremony", start: -62, end: -62, logistic: "completed", contact: "arts@bridgespcs.org", gear: [["AV Equipment", "Portable PA System", 3, false], ["Music & Arts", "Digital Piano", 1, false]] },
  { name: "Bridges Field Day 2026", start: -70, end: -70, logistic: "completed", contact: "pe@bridgespcs.org", gear: [["AV Equipment", "Portable PA System", 4, false]] },
  // Live now — staff week spans today, so the Live carousel is populated.
  { name: "Staff Professional Development Week", start: -2, end: 5, logistic: "in-idle", contact: "head@bridgespcs.org", gear: [["Computers", "Staff Laptop", 48, false], ["AV Equipment", "Interactive Display Panel", 6, false], ["AV Equipment", "Portable Projector", 3, false]] },
  // Device rollout — the multi-day operational centrepiece of the demo.
  { name: "Device Rollout & Family Tech Night", start: 12, end: 16, logistic: "no_received_yet", contact: "tech@bridgespcs.org", gear: [["Tablets", "iPad 10th Gen (Grades K–2)", 150, true], ["Computers", "Chromebook 11-inch (Grades 3–5)", 105, true], ["Connectivity", "MiFi Hotspot", 28, true]] },
  { name: "Back-to-School Night 2026", start: 18, end: 18, logistic: "no_received_yet", contact: "family@bridgespcs.org", gear: [["AV Equipment", "Portable Projector", 5, false], ["AV Equipment", "Portable PA System", 2, false]] },
  { name: "Fall Family Picnic", start: 36, end: 36, logistic: "no_received_yet", contact: "family@bridgespcs.org", gear: [["AV Equipment", "Portable PA System", 3, false]] },
  { name: "Grade 2 Field Trip — National Zoo", start: 51, end: 51, logistic: "no_received_yet", contact: "dean@bridgespcs.org", gear: [["Connectivity", "MiFi Hotspot", 6, true], ["Assistive Technology", "AAC Speech Device", 4, true]] },
  { name: "Fall Family Conferences", start: 68, end: 70, logistic: "no_received_yet", contact: "registrar@bridgespcs.org", gear: [["Computers", "Staff Laptop", 40, false], ["Connectivity", "MiFi Hotspot", 5, true]] },
  { name: "STEAM Family Night", start: 94, end: 94, logistic: "no_received_yet", contact: "arts@bridgespcs.org", gear: [["STEM & Robotics", "LEGO Education Set", 12, false], ["STEM & Robotics", "Osmo Learning Kit", 10, false], ["STEM & Robotics", "Bee-Bot Robot Set", 10, false]] },
  { name: "Grade 4 Trip — Kennedy Center Performance", start: 112, end: 112, logistic: "no_received_yet", contact: "arts@bridgespcs.org", gear: [["Assistive Technology", "AAC Speech Device", 3, true], ["Hearing & Audio", "FM/DM Hearing System", 3, true]] },
  { name: "Winter Arts Showcase", start: 131, end: 132, logistic: "no_received_yet", contact: "arts@bridgespcs.org", gear: [["Music & Arts", "Orff Instrument Set", 6, false], ["Music & Arts", "Ukulele Class Set", 4, false], ["AV Equipment", "Portable PA System", 3, false], ["Music & Arts", "Digital Piano", 2, false]] },
];

/* ------------------------------------------------------------------ main */

(async () => {
  const mongo = await MongoClient.connect(MONGO_URI);
  const db = mongo.db(MONGO_DB);
  const conn = await mysql.createConnection(SQL);

  // The school tables are owned by mysql/migrations (add_school_consent.sql,
  // add_school_guardians.sql, add_company_school_settings.sql and the ALTERs
  // that follow them). A seed must not create them — if it did, and a migration
  // later changed a column, the demo tenant would silently diverge from every
  // real one. Fail loudly instead so the operator runs the migrations first.
  const REQUIRED_TABLES = [
    "school_consent", "guardians", "student_guardian", "company_school_settings",
  ];
  const [presentTables] = await conn.query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?, ?)`,
    REQUIRED_TABLES);
  const missing = REQUIRED_TABLES.filter(
    (t) => !presentTables.some((r) => r.t === t));
  if (missing.length) {
    throw new Error(
      `Missing school tables: ${missing.join(", ")}. ` +
      "Apply mysql/migrations/ against this database before seeding.");
  }

  // members_info.date_of_birth predates some installs and MySQL has no
  // ADD COLUMN IF NOT EXISTS. Without it the Under-13 tile is always 0.
  const [[{ n: dobCol }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='members_info' AND COLUMN_NAME='date_of_birth'`);
  if (dobCol === 0) await conn.query("ALTER TABLE members_info ADD COLUMN date_of_birth DATE NULL");

  /* ── 1. company ──────────────────────────────────────────────────────── */
  let [[companyRow]] = await conn.query(
    "SELECT company_id FROM company_info WHERE company_name=?", [SCHOOL.name]);
  if (!companyRow) {
    const [res] = await conn.query(
      `INSERT INTO company_info (company_name, industry, street_address, city_address, state_address)
       VALUES (?,?,?,?,?)`,
      [SCHOOL.name, SCHOOL.industry, SCHOOL.address.street, SCHOOL.address.city, SCHOOL.address.state]);
    companyRow = { company_id: res.insertId };
    console.log(`✓ company created — SQL company_id ${companyRow.company_id}`);
  } else console.log(`• company already present — SQL company_id ${companyRow.company_id}`);
  const CID = companyRow.company_id;   // BIGINT for company_info/company_staff/locations
  const CIDs = String(CID);            // VARCHAR for item_inv/members_info/leases/school_*

  /* ── 2. locations + sub-locations ────────────────────────────────────── */
  const locationIds = {};
  const subLocationIds = {}; // `${location}>${sub}` -> sub_location_id
  for (const loc of LOCATIONS) {
    let [[row]] = await conn.query(
      "SELECT location_id FROM locations WHERE company_id=? AND location_name=?", [CID, loc.name]);
    if (!row) {
      const [res] = await conn.query(
        "INSERT INTO locations (company_id, location_name, address_details, status) VALUES (?,?,?,'active')",
        [CID, loc.name, JSON.stringify({ street: SCHOOL.address.street, city: SCHOOL.address.city, state: "DC", zip: SCHOOL.address.postal_code })]);
      row = { location_id: res.insertId };
    }
    locationIds[loc.name] = row.location_id;

    for (const sub of loc.subs) {
      let [[sr]] = await conn.query(
        "SELECT sub_location_id FROM sub_locations WHERE location_id=? AND name=?", [row.location_id, sub]);
      if (!sr) {
        const [res] = await conn.query(
          "INSERT INTO sub_locations (location_id, name, parent_id, active) VALUES (?,?,NULL,1)",
          [row.location_id, sub]);
        sr = { sub_location_id: res.insertId };
      }
      subLocationIds[`${loc.name}>${sub}`] = sr.sub_location_id;
      await conn.query(
        `INSERT IGNORE INTO company_sub_location_paths (company_id, location_id, path_json, path_key, created_by)
         VALUES (?,?,?,?,'bridges-seed')`,
        [CID, row.location_id, JSON.stringify([sub]), sub]);
    }
  }
  console.log(`✓ ${LOCATIONS.length} locations · ${Object.keys(subLocationIds).length} sub-locations`);

  /* ── 3. staff ────────────────────────────────────────────────────────── */
  const employees = [];
  let staffSeq = 0;
  const staffIdByEmail = {};
  for (const s of STAFF) {
    staffSeq++;
    const phone = `(202) 555-0${String(140 + staffSeq).padStart(3, "0")}`;
    let adminDoc = await db.collection("adminusers").findOne({ email: s.email });
    if (!adminDoc && !s.pending) {
      // Each account gets its own bcrypt salt — adminusers.password is UNIQUE.
      const doc = {
        _id: new ObjectId(), name: s.first, lastName: s.last, email: s.email, phone,
        password: bcrypt.hashSync("DemoPass123!", 10),
        question: "Demo security question", answer: bcrypt.hashSync("demo answer", 10),
        role: s.role, active: !s.inactive, company: SCHOOL.mongoId, imageProfile: "",
        mfaEnabled: false,
        emailNotifications: { newsAndUpdates: false, tipsAndTutorials: false, userResearch: false },
        dailySummaries: "do not notify me", eventReminder: "do not notify me",
        subscriptionRenewals: "do not notify me", online: false,
        super_user: s.role === "0", multipleCompanies: false, tokenVersion: 0,
        agreedPlatformConditions: true, companiesAssigned: [], __v: 0,
      };
      await db.collection("adminusers").insertOne(doc);
      adminDoc = doc;
    }

    // staff_member is a global table keyed by email; company_staff is what
    // login reads to build activeCompanies. Without it there is no login.
    let [[staffRow]] = await conn.query("SELECT staff_id FROM staff_member WHERE email=?", [s.email]);
    if (!staffRow) {
      const [res] = await conn.query(
        "INSERT INTO staff_member (first_name, last_name, email, phone_number) VALUES (?,?,?,?)",
        [s.first, s.last, s.email, phone]);
      staffRow = { staff_id: res.insertId };
    }
    staffIdByEmail[s.email] = staffRow.staff_id;
    await conn.query(
      `INSERT IGNORE INTO company_staff (id, company_id, company_name, staff_id, role_id, is_active, assigned_by)
       SELECT UUID(), ?, ?, ?, r.id, ?, 'bridges-seed' FROM roles r WHERE r.role_level = ?`,
      [CID, SCHOOL.name, staffRow.staff_id, s.inactive ? 0 : 1, Number(s.role)]);

    const scope = scopeFor(s);
    employees.push({
      user: s.email, firstName: s.first, lastName: s.last, email: s.email,
      employee_id: `BPCS-${String(staffSeq).padStart(4, "0")}`,
      status: s.pending ? "Pending" : "Active",
      // roleType is what authorizeMongoPermission actually reads.
      role: s.role, roleType: LEGACY_ROLE_MAP[Number(s.role)],
      super_user: s.role === "0", active: !s.inactive && !s.pending,
      title: s.title,
      preference: {
        inventory_location: scope.names,
        managerLocation: scope.names.map((name) => ({
          location: name, actions: { ...scope.actions }, _id: new ObjectId(),
        })),
      },
      // No userId on pending invitations — that is what locks the row.
      ...(adminDoc ? { userId: String(adminDoc._id) } : {}),
      _id: new ObjectId(),
    });
  }

  const existingCompanyDoc = await db.collection("companies").findOne({ _id: new ObjectId(SCHOOL.mongoId) });
  if (!existingCompanyDoc) {
    await db.collection("companies").insertOne({
      _id: new ObjectId(SCHOOL.mongoId),
      company_name: SCHOOL.name,
      address: SCHOOL.address,
      location: LOCATIONS.map((l) => l.name),
      phone: { main: SCHOOL.phone, alternative: "", fax: "" },
      owner: { first_name: "Alicia", last_name: "Mensah", email: "head@bridgespcs.org" },
      website: SCHOOL.website, main_email: SCHOOL.main_email,
      industry: SCHOOL.industry,
      stripe_customer_id: "cus_demo_bridges",
      employees,
      sqlInfo: { company_id: CID },
    });
    console.log(`✓ Mongo company + ${employees.length} staff accounts`);
  } else {
    // Keep the employee roster in step on re-runs without duplicating people.
    const have = new Set((existingCompanyDoc.employees || []).map((e) => e.user));
    const missing = employees.filter((e) => !have.has(e.user));
    if (missing.length) {
      await db.collection("companies").updateOne(
        { _id: new ObjectId(SCHOOL.mongoId) }, { $push: { employees: { $each: missing } } });
    }
    console.log(`• Mongo company already present (${missing.length} staff added)`);
  }

  /* ── 4. category / group lookup tables ───────────────────────────────── */
  for (const cat of [...new Set(INVENTORY.map((i) => i.category))]) {
    await conn.query(
      `INSERT INTO company_item_categories (company_id, category_name, active)
       SELECT ?,?,1 FROM DUAL WHERE NOT EXISTS
        (SELECT 1 FROM company_item_categories WHERE company_id=? AND category_name=?)`,
      [CID, cat, CID, cat]);
  }
  for (const grp of [...new Set(INVENTORY.map((i) => i.group))]) {
    await conn.query(
      `INSERT INTO company_item_groups (company_id, item_group, active)
       SELECT ?,?,1 FROM DUAL WHERE NOT EXISTS
        (SELECT 1 FROM company_item_groups WHERE company_id=? AND item_group=?)`,
      [CID, grp, CID, grp]);
  }
  console.log(`✓ ${new Set(INVENTORY.map((i) => i.category)).size} categories · ${new Set(INVENTORY.map((i) => i.group)).size} groups registered`);

  /* ── 5. inventory ────────────────────────────────────────────────────── */
  const createdAt = sqlDate(daysFromNow(-210));
  for (const line of INVENTORY) {
    const [[{ n }]] = await conn.query(
      "SELECT COUNT(*) AS n FROM item_inv WHERE company_id=? AND item_group=?", [CIDs, line.group]);
    if (n >= line.count) { console.log(`• ${line.group} already stocked (${n})`); continue; }

    const locId = locationIds[line.location];
    const subKey = line.sub.length ? `${line.location}>${line.sub[0]}` : null;
    const subId = subKey ? subLocationIds[subKey] ?? null : null;
    const rows = [];
    for (let i = 0; i < line.count; i++) {
      // A small realistic tail of gear that is not in perfect shape, so the
      // Condition filter and the event DeviceHealthBar have >1 colour.
      const damaged = chance(0.015);
      rows.push([
        line.category, line.group, String(line.cost), line.brand, line.desc,
        "Permanent",                       // renders the "Owned" pill
        CAMPUS_ADDRESS,                    // main_warehouse → "Taxable address"
        `${line.prefix}-${line.start + i}`,
        1,                                 // warehouse: in stock
        line.location, JSON.stringify(line.sub), locId, subId, line.location,
        CIDs, 1, 1,
        damaged ? "Damaged" : "Operational",
        damaged ? "under-maintenance" : "in-stock",
        createdAt,
      ]);
    }
    await chunked(rows, 200, (chunk) => conn.query(
      `INSERT INTO item_inv
        (category_name,item_group,cost,brand,descript_item,ownership,main_warehouse,serial_number,
         warehouse,location,sub_location,location_id,sub_location_id,current_location,company_id,
         display_item,enableAssignFeature,status,logistic_status,create_at)
       VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}`,
      chunk.flat()));
    console.log(`✓ ${line.count} × ${line.group}`);
  }

  /* ── 6. students ─────────────────────────────────────────────────────── */
  const [[{ n: existingStudents }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM members_info WHERE company_id=?", [CIDs]);
  if (existingStudents < 50) {
    const rows = [];
    let extId = 5000;
    const usedEmails = new Set();
    for (const g of GRADES) {
      for (const room of g.rooms) {
        for (let i = 0; i < g.per; i++) {
          const first = pick(FIRST), last = pick(LAST);
          extId++;
          let email = `${first}.${last}.${extId}@bridges-students.org`.toLowerCase().replace(/'/g, "");
          while (usedEmails.has(email)) email = `${first}.${last}.${++extId}@bridges-students.org`.toLowerCase().replace(/'/g, "");
          usedEmails.add(email);

          const [city, zip] = pick(NEIGHBORHOODS);
          const street = `${Math.floor(rand() * 900) + 10} ${pick(STREETS)}`;
          // A deliberately small dirty-data tail (~1%) so the Minors tile shows
          // its red "N missing a representative" caption. Keep it small: these
          // students cannot be issued a device on camera.
          const missingRep = chance(0.011);
          const gFirst = pick(FIRST);
          const gLast = chance(0.8) ? last : pick(LAST); // most guardians share the surname
          rows.push([
            first, last, email, `(202) 555-${String(1000 + (extId % 9000)).padStart(4, "0")}`,
            `BPCS-${extId}`,
            `${street}, ${city}, DC ${zip}`,   // single-line `address` — the list column reads only this
            street, city, "DC", zip, CIDs,
            g.grade, g.roomLabel(room),
            1,                                  // every PK3–5 student is a minor
            missingRep ? null : gFirst,
            missingRep ? null : gLast,
            missingRep ? null : `${gFirst}.${gLast}.${extId}@example.com`.toLowerCase().replace(/'/g, ""),
            missingRep ? null : `(202) 555-${String(1000 + ((extId + 7) % 9000)).padStart(4, "0")}`,
            dobForAge(g.age),
          ]);
        }
      }
    }
    await chunked(rows, 200, (chunk) => conn.query(
      `INSERT INTO members_info
        (first_name,last_name,email,phone_number,external_id,address,address_street,address_city,
         address_state,address_zip,company_id,grade,homeroom,minor,
         parent_guardian_first_name,parent_guardian_last_name,parent_guardian_email,
         parent_guardian_phone_number,date_of_birth)
       VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}`,
      chunk.flat()));
    console.log(`✓ ${rows.length} students enrolled (PK3 → grade 5)`);
  } else console.log(`• students already enrolled (${existingStudents})`);

  const [students] = await conn.query(
    `SELECT member_id, first_name, last_name, grade, homeroom,
            parent_guardian_first_name AS gf, parent_guardian_last_name AS gl,
            parent_guardian_email AS ge, parent_guardian_phone_number AS gp
       FROM members_info WHERE company_id=? ORDER BY member_id`, [CIDs]);

  /* ── 7. guardians ────────────────────────────────────────────────────── */
  // `guardians` carries no unique key on email and the controllers do not fold
  // case, so two spellings of one address become two people. Dedupe here on a
  // normalised address and reuse the id — that is also what makes siblings
  // share a single guardian record.
  const normEmail = (e) => String(e ?? "").trim().toLowerCase();
  const [[{ n: guardianCount }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM guardians WHERE company_id=?", [CID]);
  if (guardianCount === 0) {
    const seen = new Map();
    for (const s of students) {
      const email = normEmail(s.ge);
      if (!email || seen.has(email)) continue;
      seen.set(email, [randomUUID(), CID, s.gf, s.gl, email, s.gp]);
    }
    await chunked([...seen.values()], 200, (chunk) => conn.query(
      `INSERT INTO guardians (id, company_id, first_name, last_name, email, phone_number)
       VALUES ${chunk.map(() => "(?,?,?,?,?,?)").join(",")}`, chunk.flat()));
  }
  const [guardianRows] = await conn.query(
    "SELECT id, email FROM guardians WHERE company_id=?", [CID]);
  const guardianIdByEmail = {};
  guardianRows.forEach((g) => { guardianIdByEmail[normEmail(g.email)] = g.id; });

  const [[{ n: linkCount }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM student_guardian WHERE company_id=?", [CID]);
  if (linkCount === 0) {
    const links = students
      .filter((s) => guardianIdByEmail[normEmail(s.ge)])
      .map((s) => [randomUUID(), CID, s.member_id, guardianIdByEmail[normEmail(s.ge)], "parent", 1]);
    await chunked(links, 200, (chunk) => conn.query(
      `INSERT IGNORE INTO student_guardian (id, company_id, member_id, guardian_id, relationship, is_primary)
       VALUES ${chunk.map(() => "(?,?,?,?,?,?)").join(",")}`, chunk.flat()));
    console.log(`✓ ${guardianRows.length} guardians · ${links.length} student links`);
  } else console.log(`• guardians already linked (${linkCount})`);

  /* ── 8. consent settings + records ───────────────────────────────────── */
  await conn.query(
    `INSERT INTO company_school_settings
       (company_id, enforce_member_consent, enforce_under_13_consent, required_consent_policy_version)
     VALUES (?,1,1,?)
     ON DUPLICATE KEY UPDATE enforce_member_consent=1, enforce_under_13_consent=1,
       required_consent_policy_version=VALUES(required_consent_policy_version)`,
    [CID, POLICY_VERSION]);

  const [[{ n: consentCount }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM school_consent WHERE company_id=?", [CID]);
  if (consentCount === 0) {
    const rows = [];
    // Coverage lands in the amber band (~83%): an all-green screen has nothing
    // to sell, and enforcement is ON, so there must still be enough 'agreed'
    // rows that assigning a device on camera works.
    //
    // The unique key is (member_id, policy_type, policy_version), so a student
    // gets ONE row. A "stale" student is given only a v1 agreement and no v2
    // row at all — that is precisely what makes deriveConsentState fall back to
    // the older row and report 'stale' rather than compliant.
    students.forEach((s, idx) => {
      if (!s.ge) return;             // no representative → no row → "not requested"
      const roll = rand();
      const signer = `${s.gf} ${s.gl}`;
      const gid = guardianIdByEmail[normEmail(s.ge)] ?? null;
      const base = [randomUUID(), CID, s.member_id, gid, "AUP"];
      if (roll < 0.815) {
        rows.push([...base, POLICY_VERSION, "agreed", signer, s.ge, "e-signature",
          sqlDate(daysFromNow(-45 + (idx % 30))),   // consented_at
          null, null,                                // otc_hash, otc_expires_at
          sqlDate(daysFromNow(-46 + (idx % 30))),   // requested_at
          sqlDate(daysFromNow(-45 + (idx % 30))),   // responded_at
          null]);                                    // refused_at
      } else if (roll < 0.881) {
        rows.push([...base, "1", "agreed", signer, s.ge, "e-signature",
          sqlDate(daysFromNow(-330)), null, null,
          sqlDate(daysFromNow(-331)), sqlDate(daysFromNow(-330)), null]);
      } else if (roll < 0.936) {
        // Link still live → "Awaiting guardian". A real digest so the unique
        // index and the hashed-OTC lookup path get exercised by demo data too.
        rows.push([...base, POLICY_VERSION, "pending", null, s.ge, "email-link",
          null, hashOtc(generateOtc()), sqlDate(daysFromNow(4 + (idx % 6))),
          sqlDate(daysFromNow(-3 + (idx % 6))), null, null]);
      } else if (roll < 0.972) {
        // Link lapsed → "Consent link expired".
        rows.push([...base, POLICY_VERSION, "pending", null, s.ge, "email-link",
          null, hashOtc(generateOtc()), sqlDate(daysFromNow(-3 - (idx % 9))),
          sqlDate(daysFromNow(-12 - (idx % 9))), null, null]);
      } else {
        rows.push([...base, POLICY_VERSION, "refused", signer, s.ge, "email-link",
          null, null, null,
          sqlDate(daysFromNow(-16)), sqlDate(daysFromNow(-14)), sqlDate(daysFromNow(-14))]);
      }
    });
    await chunked(rows, 200, (chunk) => conn.query(
      `INSERT INTO school_consent
        (id, company_id, member_id, guardian_id, policy_type, policy_version, status,
         signer_name, signer_email, method, consented_at, otc_hash, otc_expires_at,
         requested_at, responded_at, refused_at)
       VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}`, chunk.flat()));
    console.log(`✓ consent enforcement on (policy v${POLICY_VERSION}) · ${rows.length} consent records`);
  } else console.log(`• consent records already present (${consentCount})`);

  /* ── 9. device assignments ───────────────────────────────────────────── */
  const [[{ n: openLeases }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM member_assigned_device_lease WHERE company_id=? AND returned=0", [CIDs]);
  if (openLeases < 50) {
    const issuer = staffIdByEmail["tech@bridgespcs.org"];
    const poolFor = async (group) => {
      const [r] = await conn.query(
        "SELECT item_id FROM item_inv WHERE company_id=? AND item_group=? AND warehouse=1 ORDER BY item_id", [CIDs, group]);
      return r.map((x) => x.item_id);
    };
    const ipads = await poolFor("iPad 10th Gen (Grades K–2)");
    const chromebooks = await poolFor("Chromebook 11-inch (Grades 3–5)");
    const aac = await poolFor("AAC Speech Device");
    const fm = await poolFor("FM/DM Hearing System");
    const headphones = await poolFor("Noise-Reducing Headphones");
    const hotspots = await poolFor("MiFi Hotspot");

    const yearEnd = sqlDate(new Date(new Date().getUTCFullYear() + 1, 5, 12, 20, 0, 0));
    const issued = sqlDate(daysFromNow(-4));
    const leases = [];
    const take = (pool) => (pool.length ? pool.shift() : null);
    // Only students whose guardian consent is on file can hold a device —
    // enforcement is on, so this keeps the roster self-consistent.
    const [agreed] = await conn.query(
      `SELECT member_id FROM school_consent
        WHERE company_id=? AND status='agreed' AND policy_version=?`, [CID, POLICY_VERSION]);
    const agreedIds = new Set(agreed.map((r) => r.member_id));

    let overdueBudget = 11;
    for (const s of students) {
      const grade = String(s.grade);
      if (["PK3", "PK4"].includes(grade)) continue;    // cart-level only
      if (!agreedIds.has(s.member_id)) continue;
      if (chance(0.06)) continue;                       // not yet picked up
      const device = ["K", "1", "2"].includes(grade) ? take(ipads) : take(chromebooks);
      if (!device) continue;
      // A handful of loaner swaps already past due, spread either side of the
      // 7-day mark so both the orange and red overdue tags appear.
      const overdue = overdueBudget > 0 && chance(0.05);
      if (overdue) overdueBudget--;
      leases.push([
        String(s.member_id), String(issuer), device, CIDs, issued,
        overdue ? sqlDate(daysFromNow(-(2 + Math.floor(rand() * 18)))) : yearEnd,
        0, "Upper Elementary Wing".startsWith("U") && ["3", "4", "5"].includes(grade)
          ? "Upper Elementary Wing" : "Lower Elementary Wing",
      ]);
    }

    // Assistive tech and family supports, spread across all grades — the
    // inclusion story, and the reason serials matter for this buyer.
    const extras = [
      { pool: aac, location: "Speech Therapy Suite", n: 16 },
      { pool: fm, location: "Speech Therapy Suite", n: 8 },
      { pool: headphones, location: "Sensory Room", n: 30 },
      { pool: hotspots, location: "Family Resource Center", n: 26 },
    ];
    const eligible = students.filter((s) => agreedIds.has(s.member_id));
    for (const ex of extras) {
      for (let i = 0; i < ex.n; i++) {
        const device = take(ex.pool);
        if (!device) break;
        const s = eligible[Math.floor(rand() * eligible.length)];
        if (!s) break;
        leases.push([String(s.member_id), String(issuer), device, CIDs, issued, yearEnd, 0, ex.location]);
      }
    }

    await chunked(leases, 200, (chunk) => conn.query(
      `INSERT INTO member_assigned_device_lease
        (member_id,staff_member_id,device_id,company_id,assigned_date,expected_return_date,returned,location)
       VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?)").join(",")}`, chunk.flat()));
    await chunked(leases.map((l) => l[2]), 500, (chunk) => conn.query(
      `UPDATE item_inv SET warehouse=0, logistic_status='assigned'
        WHERE item_id IN (${chunk.map(() => "?").join(",")})`, chunk));
    console.log(`✓ ${leases.length} devices assigned (${11 - overdueBudget} overdue)`);

    // Closed leases from last year. The return flow UPDATEs rather than
    // deletes, so history like this is what the real table looks like — and it
    // does not inflate "Devices out".
    const returnedRows = [];
    const restock = await poolFor("iPad 10th Gen (Grades K–2)");
    for (let i = 0; i < 34 && i < restock.length; i++) {
      const s = students[Math.floor(rand() * students.length)];
      const outcome = rand();
      returnedRows.push([
        String(s.member_id), String(issuer), restock[i], CIDs,
        sqlDate(daysFromNow(-330)), sqlDate(daysFromNow(-72)), 1,
        outcome < 0.82 ? "returned" : outcome < 0.94 ? "damaged" : "lost",
        outcome < 0.82 ? null : outcome < 0.94 ? "Cracked screen — repaired over the summer" : "Not returned at end of year",
        sqlDate(daysFromNow(-70)), "Lower Elementary Wing",
      ]);
    }
    await chunked(returnedRows, 200, (chunk) => conn.query(
      `INSERT INTO member_assigned_device_lease
        (member_id,staff_member_id,device_id,company_id,assigned_date,expected_return_date,returned,
         return_status,condition_note,returned_date,location)
       VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",")}`, chunk.flat()));
    console.log(`✓ ${returnedRows.length} closed leases from the prior school year`);
  } else console.log(`• device assignments already present (${openLeases})`);

  /* ── 10. staff equipment (lease_info) ────────────────────────────────── */
  // The staff-detail equipment tab reads lease_info, not the member lease
  // table — seeding only student leases leaves every staff profile empty.
  const [[{ n: staffLeases }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM lease_info WHERE company_id=?", [CIDs]);
  if (staffLeases === 0) {
    const [laptops] = await conn.query(
      `SELECT item_id FROM item_inv WHERE company_id=? AND item_group='Staff Laptop' AND warehouse=1
        ORDER BY item_id LIMIT ?`, [CIDs, STAFF.length]);
    const rows = [];
    const staffIssued = sqlDate(daysFromNow(-190));
    const staffDue = sqlDate(new Date(new Date().getUTCFullYear() + 1, 5, 26, 20, 0, 0));
    STAFF.forEach((s, i) => {
      if (s.pending || !laptops[i]) return;
      rows.push([String(staffIdByEmail[s.email]), CIDs, laptops[i].item_id, 1, 1,
        `bpcs-verify-${String(i + 1).padStart(3, "0")}`, "Technology Office",
        staffIssued, staffDue]);
    });
    if (rows.length) {
      await conn.query(
        `INSERT INTO lease_info (staff_member_id, company_id, device_id, subscription_current_in_use, active,
                                 verification_id, location, subscription_initial_date, subscription_expected_return_data)
         VALUES ${rows.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}`, rows.flat());
      await conn.query(
        `UPDATE item_inv SET warehouse=0, logistic_status='assigned'
          WHERE item_id IN (${rows.map(() => "?").join(",")})`, rows.map((r) => r[2]));
      console.log(`✓ ${rows.length} staff laptops issued`);
    }
  } else console.log(`• staff equipment already present (${staffLeases})`);

  /* ── 11. events ──────────────────────────────────────────────────────── */
  const existingEvents = await db.collection("events").countDocuments({ company: SCHOOL.name });
  if (existingEvents === 0) {
    const adminUser = [
      { firstName: "Alicia", lastName: "Mensah", email: "head@bridgespcs.org", role: "Administrator" },
      { firstName: "Marcus", lastName: "Okonkwo", email: "operations@bridgespcs.org", role: "Administrator" },
      { firstName: "Priya", lastName: "Raghunathan", email: "tech@bridgespcs.org", role: "Administrator" },
    ];
    for (const ev of EVENTS) {
      const begin = daysFromNow(ev.start), end = daysFromNow(ev.end);
      const eventId = new ObjectId();
      const venue = "Bridges Public Charter School";
      const contactStaff = STAFF.find((s) => s.email === ev.contact);
      await db.collection("events").insertOne({
        _id: eventId,
        user: "head@bridgespcs.org",
        company: SCHOOL.name,                 // list query filters on the NAME
        subscription: [],
        eventInfoDetail: {
          eventName: ev.name, eventLocation: "Washington, DC",
          address: `${SCHOOL.address.street}, Washington DC, ${SCHOOL.address.postal_code}`,
          building: venue, floor: "",
          phoneNumber: [SCHOOL.phone],
          merchant: false,                    // boolean flag: does this event take deposits
          dateBegin: begin.toISOString(), dateEnd: end.toISOString(),
          dateBeginTime: begin.getTime(), dateEndTime: end.getTime(),
        },
        staff: { adminUser, headsetAttendees: [] },  // omitting this 500s the staff endpoint
        contactInfo: {
          name: `${contactStaff.first} ${contactStaff.last}`,
          email: ev.contact, phone: [SCHOOL.phone],
        },
        deviceSetup: ev.gear.map(([category, group, quantity, consumerUses]) => ({
          category, group, value: "0.00",
          description: `${group} — ${ev.name}`,
          company: SCHOOL.mongoId, isItSetAsContainerForEvent: false,
          quantity, ownership: "Permanent", container: false,
          createdBy: "bridges-seed",
          key: `ds_${ev.name.replace(/\W+/g, "_")}_${group.replace(/\W+/g, "_")}`,
          existing: true, consumerUses, startingNumber: null, endingNumber: null,
        })),
        extraServicesNeeded: false, extraServices: [],
        type: "event",
        active: end.getTime() >= Date.now(),
        contactName: `${contactStaff.first} ${contactStaff.last}`,
        qrCodeLink: `https://app.devitrak.net/?event=${eventId}&company=${SCHOOL.mongoId}`,
        company_id: SCHOOL.mongoId,
        logistic_inventory_status: ev.logistic,
        legal_contract: false, legal_documents_list: [],
        contract_for: "event", configuration: "completed", show: true,
      });

      // The quick-glance page reads event.sql.event_id for the spreadsheet,
      // allocation and end-event flows; without this row those throw.
      await conn.query(
        `INSERT INTO event_info (event_name, venue_name, street_address, city_address, state_address,
                                 zip_address, email_company, phone_number, company_assigned_event_id)
         SELECT ?,?,?,?,?,?,?,?,? FROM DUAL
         WHERE NOT EXISTS (SELECT 1 FROM event_info WHERE event_name=? AND company_assigned_event_id=?)`,
        [ev.name, venue, SCHOOL.address.street, "Washington", "DC", SCHOOL.address.postal_code,
          SCHOOL.main_email, SCHOOL.phone, CID, ev.name, CID]);

      // Device pools — without these every equipment card reads 0 in pool / 0%
      // and the device table is empty, which is the most obviously-unfinished
      // thing on the quick-glance screen.
      const pool = [];
      for (const [, group, quantity] of ev.gear) {
        const line = INVENTORY.find((i) => i.group === group);
        const filled = Math.max(1, Math.round(quantity * (0.7 + rand() * 0.25)));
        for (let i = 0; i < filled; i++) {
          const lost = chance(0.01);
          const broken = !lost && chance(0.03);
          pool.push({
            _id: new ObjectId(),
            device: `${line.prefix}-${line.start + i}`,
            type: group, provider: line.brand,
            status: lost ? "lost" : broken ? "Damaged" : "Operational",
            activity: chance(0.45),
            company: SCHOOL.mongoId,          // Mongo company _id, not the name
            eventSelected: [ev.name],
            event_id: String(eventId),
comment: "",
          });
        }
      }
      if (pool.length) await db.collection("receiverspools").insertMany(pool);
      console.log(`✓ event: ${ev.name} (${pool.length} pooled devices)`);
    }
  } else console.log(`• events already present (${existingEvents})`);

  /* ── 12. event attendees ─────────────────────────────────────────────── */
  // The events module counts Mongo `users` (consumers), NOT members_info — so
  // without these every event card reads "0 Students" even with 369 enrolled.
  // Building them from the real roster keeps the two populations the same
  // people, and groupName carries the homeroom through to event grouping.
  const attendeeCount = await db.collection("users").countDocuments({ company_providers: SCHOOL.mongoId });
  if (attendeeCount === 0) {
    const bridgeEvents = await db.collection("events")
      .find({ company: SCHOOL.name }, { projection: { _id: 1, "eventInfoDetail.eventName": 1 } }).toArray();
    const idByName = {};
    bridgeEvents.forEach((e) => { idByName[e.eventInfoDetail.eventName] = String(e._id); });

    const ALL_SCHOOL = ["Back-to-School Night 2026", "Fall Family Picnic", "Device Rollout & Family Tech Night", "Fall Family Conferences"];
    const K_TO_5 = ["STEAM Family Night", "Winter Arts Showcase"];
    const attendees = students.map((s, i) => {
      const grade = String(s.grade);
      const going = [...ALL_SCHOOL];
      if (!["PK3", "PK4"].includes(grade)) going.push(...K_TO_5);
      if (grade === "2") going.push("Grade 2 Field Trip — National Zoo");
      if (grade === "4") going.push("Grade 4 Trip — Kennedy Center Performance");
      if (chance(0.25)) going.push("Summer Learning Academy 2026");
      const selected = going.filter((n) => idByName[n]);
      return {
        name: s.first_name, lastName: s.last_name,
        email: `${s.first_name}.${s.last_name}.${i}@bridges-students.org`.toLowerCase().replace(/'/g, ""),
        phoneNumber: 2025550000 + (i % 9999),
        privacyPolicy: true,
        category: ["PK3", "PK4"].includes(grade) ? "Early Childhood" : "Regular",
        provider: [SCHOOL.name],
        eventSelected: selected,
        groupName: [s.homeroom],
        company_providers: [SCHOOL.mongoId],
        event_providers: selected.map((n) => idByName[n]),
        notes: [], __v: 0,
      };
    });
    await chunked(attendees, 200, (chunk) => db.collection("users").insertMany(chunk));
    console.log(`✓ ${attendees.length} student attendee records linked to events`);
  } else console.log(`• event attendees already present (${attendeeCount})`);

  /* ── 13. family communications ───────────────────────────────────────── */
  // Posts is in the main nav, so it is one click away during a walkthrough and
  // renders empty without these. Written for PK3–5 families rather than the
  // 1:1 high-school language the district seed uses.
  const POSTS = [
    { title: "Your Child's School Device — Family Guide", subtitle: "Device program",
      description: "Students in grades K–5 are issued a school device: an iPad in grades K–2 and a Chromebook in grades 3–5. Devices stay at school in PK3 and PK4, where classes share a classroom iPad cart. Please send your child's device to school charged each day, and keep it in the case it came in. Questions? Stop by the Technology Office or email tech@bridgespcs.org." },
    { title: "Care, Damage and Replacement", subtitle: "Taking care of school equipment",
      description: "Accidents happen — please tell your child's teacher within 48 hours if a device is damaged. The first accidental repair is covered by the school. Repeat damage may carry a fee: cracked screen $49, lost charger $25, replacement device $289 for a Chromebook and $349 for an iPad. Never attempt a repair at home." },
    { title: "Assistive Technology and Your Child's IEP", subtitle: "Student support services",
      description: "Communication devices, FM hearing systems, adapted switches and sensory equipment are assigned to individual students as part of their IEP. Each item is tracked to your child by serial number so it travels with them between classrooms, therapy sessions and field trips. To ask about equipment listed in your child's IEP, contact Student Support Services at studentsupport@bridgespcs.org." },
    { title: "Take-Home Internet: Hotspot Lending", subtitle: "Family connectivity",
      description: "Families who need reliable home internet can borrow a MiFi hotspot from the Family Resource Center at no cost. Hotspots are filtered under school policy and are returned at the end of the school year with your child's device. Ask the front office or email family@bridgespcs.org." },
    { title: "Responsible Use Policy — What You Are Signing", subtitle: "Guardian consent",
      description: "Because every Bridges student is under 13, federal law requires a parent or guardian to give consent before we issue school technology. You will receive a secure link by email; it is single-use and expires after seven days. If your link has expired, contact the front office and we will send a new one. Your consent covers the current school year's policy version." },
    { title: "Device Rollout & Family Tech Night", subtitle: "Upcoming event",
      description: "Join us for Device Rollout & Family Tech Night. Families pick up their child's device, sign the responsible use agreement if it is not already on file, and get help setting up logins at home. Bring a photo ID. Staff from the Technology Office and Student Support Services will be available, and interpretation is provided." },
  ];
  const existingPosts = await db.collection("posts").countDocuments({ company_id: SCHOOL.mongoId });
  if (existingPosts === 0) {
    const eventIds = (await db.collection("events")
      .find({ company: SCHOOL.name }, { projection: { _id: 1 } }).toArray()).map((e) => String(e._id));
    const stamp = daysFromNow(-21).toISOString();
    await db.collection("posts").insertMany(POSTS.map((p) => ({
      _id: new ObjectId(),
      title: p.title, subtitle: p.subtitle, description: p.description,
      displayed_in: eventIds,
      media: { cover: "", content: [] },
      company_id: SCHOOL.mongoId,
      published: true,
      published_at: stamp, created_at: stamp, updated_at: stamp,
      __v: 0,
    })));
    console.log(`✓ ${POSTS.length} family communications published`);
  } else console.log(`• posts already present (${existingPosts})`);

  /* ── 14. summary ─────────────────────────────────────────────────────── */
  const [[{ n: sc }]] = await conn.query("SELECT COUNT(*) AS n FROM members_info WHERE company_id=?", [CIDs]);
  const [[{ n: ic }]] = await conn.query("SELECT COUNT(*) AS n FROM item_inv WHERE company_id=?", [CIDs]);
  const [[{ n: lc }]] = await conn.query("SELECT COUNT(*) AS n FROM member_assigned_device_lease WHERE company_id=? AND returned=0", [CIDs]);
  const [[{ n: od }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM member_assigned_device_lease WHERE company_id=? AND returned=0 AND expected_return_date < NOW()", [CIDs]);
  const [[{ n: cg }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM school_consent WHERE company_id=? AND status='agreed' AND policy_version=?", [CID, POLICY_VERSION]);
  const ec = await db.collection("events").countDocuments({ company: SCHOOL.name });

  console.log(`
──────────────────────────────────────────────
 Bridges Public Charter School — SQL company_id ${CID}
 ${sc} students · ${ic} inventory items · ${lc} devices out (${od} overdue)
 ${employees.length} staff accounts · ${ec} events
 consent coverage ${Math.round((cg / sc) * 100)}% at policy v${POLICY_VERSION}
 login: head@bridgespcs.org / DemoPass123!
──────────────────────────────────────────────`);
  await mongo.close();
  await conn.end();
})().catch((e) => { console.error("SEED FAILED:", e.message, e.stack); process.exit(1); });
