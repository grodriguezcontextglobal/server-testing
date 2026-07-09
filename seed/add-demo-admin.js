/**
 * Add (or update) an admin in the local demo company.
 *
 * Usage (from server-testing/):
 *   node seed/add-demo-admin.js --email=you@company.com
 *   node seed/add-demo-admin.js --email=x@y.com --role=Editor --no-super --password=Secret123!
 *
 * Defaults: role=Ownership, super_user=true, password=DemoPass123!,
 *           uri=mongodb://127.0.0.1:27017/devitrak_demo
 * Idempotent: if the email already exists it is updated, not duplicated.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const AdminUser = require("../models/AdminUser");
const Company = require("../models/Company");

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const has = (k) => argv.includes(`--${k}`);

const DEMO_COMPANY_ID = "dededededededededededede";
const URI = getArg("uri", "mongodb://127.0.0.1:27017/devitrak_demo");
const email = (getArg("email", "") || "").trim().toLowerCase();
const role = getArg("role", "Ownership");
const password = getArg("password", "DemoPass123!");
const superUser = !has("no-super"); // default true; pass --no-super to disable

if (!email) {
  console.error("❌ --email=<address> is required.");
  process.exit(1);
}

(async () => {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`Connected to ${mongoose.connection.db.databaseName}`);

  const company = await Company.findById(DEMO_COMPANY_ID);
  if (!company) {
    console.error(`❌ Demo company ${DEMO_COMPANY_ID} not found — run the seed first.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const [namePart] = email.split("@");
  const first = namePart.split(/[.\-_]/)[0] || "Demo";
  const name = first.charAt(0).toUpperCase() + first.slice(1);
  const salt = bcrypt.genSaltSync();

  const fields = {
    name,
    lastName: "(you)",
    email,
    phone: "(415) 555-0000",
    password: bcrypt.hashSync(password, salt),
    question: "What is your demo word?",
    answer: bcrypt.hashSync("devitrak", salt),
    role,
    active: true,
    company: DEMO_COMPANY_ID,
    super_user: superUser,
    agreedPlatformConditions: true,
  };

  let admin = await AdminUser.findOne({ email });
  if (admin) {
    await AdminUser.updateOne({ _id: admin._id }, { $set: fields });
    admin = await AdminUser.findById(admin._id);
    console.log(`↻ Updated existing admin: ${email}`);
  } else {
    admin = await AdminUser.create(fields);
    console.log(`＋ Created admin: ${email}`);
  }

  // Reflect into Company.employees (replace any prior entry for this email)
  company.employees = (company.employees || []).filter((e) => e.email !== email);
  company.employees.push({
    user: email,
    firstName: name,
    lastName: fields.lastName,
    email,
    employee_id: `EMP-${String(company.employees.length + 1).padStart(3, "0")}`,
    status: "Active",
    super_user: superUser,
    role,
    active: true,
    userId: admin._id,
  });
  await company.save();

  console.log(`\n✅ ${email} is now a ${role}${superUser ? " (super_user)" : ""} in "${company.company_name}".`);
  console.log(`   Login password: ${password}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("❌ Failed:", e.message);
  process.exit(1);
});
