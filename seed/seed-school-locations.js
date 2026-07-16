/* eslint-disable no-console */
/**
 * Restructure the district's inventory geography (run AFTER the other seeds):
 *
 *   Locations        = the schools (+ District Office)
 *   Sub-locations    = rooms within each school (library, classrooms, gym,
 *                      theater, storage, IT closet), with NESTED sub-locations
 *                      (shelves/racks/booths) via sub_locations.parent_id
 *   Containers       = serialized cases/carts that hold other devices
 *                      (charging carts with Chromebooks, AV road cases with
 *                      wireless mics) via item_inv.container/container_id and
 *                      the container_items table
 *
 * Every item gets full structured linkage (location_id + sub_location_id) so
 * the inventory "Group by location" view counts correctly.
 *
 * Idempotent: node seed/seed-school-locations.js
 */
const mysql = require("mysql2/promise");

const SQL = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DB || "devitrak_db",
};
const DISTRICT = "Summit Unified School District";

// location -> sub-locations (nested children indented via parent)
const GEOGRAPHY = {
  "Lincoln Middle School": {
    subs: [
      { name: "Library" },
      { name: "Room 101 — Rivera" },
      { name: "Room 102 — Okafor" },
      { name: "Room 103 — Bennett" },
      { name: "AV Storage", children: ["Shelf 1", "Shelf 2"] },
      { name: "Front Office" },
    ],
  },
  "Roosevelt High School": {
    subs: [
      { name: "Media Center" },
      { name: "Theater", children: ["Sound Booth", "Backstage Storage"] },
      { name: "Gym — Equipment Room" },
      { name: "Science Wing — Room 210" },
      { name: "IT Closet" },
    ],
  },
  "District Office": {
    subs: [
      { name: "IT Office" },
      { name: "Warehouse", children: ["Rack A", "Rack B"] },
    ],
  },
};

// serial prefix -> [location, sub-location] placement
const PLACEMENT = [
  // Lincoln
  [/^LMS-CB-/, "Lincoln Middle School", "Library"],
  [/^LMS-IPD-/, "Lincoln Middle School", "Room 102 — Okafor"],
  [/^LMS-PRJ-500[1-5]$/, "Lincoln Middle School", "AV Storage>Shelf 1"],
  [/^LMS-PRJ-/, "Lincoln Middle School", "AV Storage>Shelf 2"],
  [/^CHR-/, "Lincoln Middle School", "Library"],          // original base-seed fleet
  [/^IPD-/, "Lincoln Middle School", "Room 101 — Rivera"],
  // Roosevelt
  [/^RHS-CB-/, "Roosevelt High School", "Media Center"],
  [/^RHS-IPD-/, "Roosevelt High School", "Science Wing — Room 210"],
  [/^RHS-CAL-/, "Roosevelt High School", "Media Center"],
  [/^CAL-/, "Roosevelt High School", "Media Center"],
  [/^RHS-PRJ-/, "Roosevelt High School", "IT Closet"],
  [/^RHS-MIC-/, "Roosevelt High School", "Theater>Sound Booth"],
  [/^RHS-LGT-/, "Roosevelt High School", "Theater>Backstage Storage"],
  [/^RHS-SND-/, "Roosevelt High School", "Theater>Sound Booth"],
  [/^RHS-TIM-/, "Roosevelt High School", "Gym — Equipment Room"],
  [/^RHS-CASE-/, "Roosevelt High School", "Theater>Backstage Storage"],
  // District
  [/^SUSD-HSP-/, "District Office", "IT Office"],
  [/^SUSD-PA-/, "District Office", "Warehouse>Rack A"],
  [/^SUSD-CAM-/, "District Office", "IT Office"],
  [/^HSP-/, "District Office", "IT Office"],
  [/^CRT-/, "District Office", "Warehouse>Rack B"],
];

(async () => {
  const conn = await mysql.createConnection(SQL);
  const [[co]] = await conn.query(
    "SELECT company_id FROM company_info WHERE company_name=?", [DISTRICT]);
  if (!co) throw new Error("Run seed-school-demo.js first");
  const CID = co.company_id;
  const CIDs = String(CID);

  // ── 1. locations: the schools ────────────────────────────────────────────
  const locIds = {};
  for (const locName of Object.keys(GEOGRAPHY)) {
    let [[row]] = await conn.query(
      "SELECT location_id FROM locations WHERE company_id=? AND location_name=?",
      [CID, locName]);
    if (!row) {
      const [r] = await conn.query(
        "INSERT INTO locations (company_id, location_name) VALUES (?,?)",
        [CID, locName]);
      row = { location_id: r.insertId };
    }
    locIds[locName] = row.location_id;
  }
  console.log("✓ school locations:", JSON.stringify(locIds));

  // retire the old room-level location rows (rooms are sub-locations now)
  const oldRooms = ["Lincoln Middle Library", "Roosevelt High Media Center", "District IT Office",
    "Lincoln Middle AV Storage", "Roosevelt High Theater", "Roosevelt High Gym"];
  await conn.query(
    `DELETE FROM locations WHERE company_id=? AND location_name IN (${oldRooms.map(() => "?").join(",")})`,
    [CID, ...oldRooms]);
  console.log("✓ old room-level locations retired");

  // ── 2. sub-locations (with nesting) + path registry ──────────────────────
  const subIds = {}; // "Location>Sub" or "Location>Sub>Child" -> sub_location_id
  const ensureSub = async (locationId, name, parentId) => {
    let [[row]] = await conn.query(
      `SELECT sub_location_id FROM sub_locations
       WHERE location_id=? AND name=? AND ${parentId ? "parent_id=?" : "parent_id IS NULL"}`,
      parentId ? [locationId, name, parentId] : [locationId, name]);
    if (!row) {
      const [r] = await conn.query(
        "INSERT INTO sub_locations (location_id, name, parent_id, active) VALUES (?,?,?,1)",
        [locationId, name, parentId ?? null]);
      row = { sub_location_id: r.insertId };
    }
    return row.sub_location_id;
  };
  for (const [locName, def] of Object.entries(GEOGRAPHY)) {
    const locId = locIds[locName];
    for (const sub of def.subs) {
      const subId = await ensureSub(locId, sub.name, null);
      subIds[`${locName}>${sub.name}`] = subId;
      const path = [sub.name];
      await conn.query(
        `INSERT INTO company_sub_location_paths (company_id, location_id, path_json, path_key, created_by)
         SELECT ?,?,?,?,'school-locations-seed' FROM DUAL
         WHERE NOT EXISTS (SELECT 1 FROM company_sub_location_paths WHERE company_id=? AND location_id=? AND path_key=?)`,
        [CID, locId, JSON.stringify(path), path.join(">"), CID, locId, path.join(">")]);
      for (const child of sub.children ?? []) {
        const childId = await ensureSub(locId, child, subId);
        subIds[`${locName}>${sub.name}>${child}`] = childId;
        const childPath = [sub.name, child];
        await conn.query(
          `INSERT INTO company_sub_location_paths (company_id, location_id, path_json, path_key, created_by)
           SELECT ?,?,?,?,'school-locations-seed' FROM DUAL
           WHERE NOT EXISTS (SELECT 1 FROM company_sub_location_paths WHERE company_id=? AND location_id=? AND path_key=?)`,
          [CID, locId, JSON.stringify(childPath), childPath.join(">"), CID, locId, childPath.join(">")]);
      }
    }
  }
  console.log(`✓ ${Object.keys(subIds).length} sub-locations (incl. nested shelves/booths/racks)`);

  // ── 3. containers: AV road cases (new items) ─────────────────────────────
  for (const serial of ["RHS-CASE-9701", "RHS-CASE-9702"]) {
    await conn.query(
      `INSERT INTO item_inv
        (category_name,item_group,cost,brand,descript_item,ownership,serial_number,warehouse,
         location,current_location,company_id,display_item,enableAssignFeature,status,logistic_status,
         container,containerSpotLimit)
       SELECT 'AV Equipment','AV Road Case 12-slot',350,'Demo Ed','Wireless mic road case','Owned',?,1,
         'Roosevelt High School','Roosevelt High School',?,1,1,'Operational','in-stock',1,12
       FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM item_inv WHERE serial_number=? AND company_id=?)`,
      [serial, CIDs, serial, CIDs]);
  }
  console.log("✓ AV road cases created");

  // mark charging carts as containers (30 bays)
  await conn.query(
    `UPDATE item_inv SET container=1, containerSpotLimit=30
     WHERE company_id=? AND item_group='30-bay Charging Cart'`, [CIDs]);

  // ── 4. place every item into its school + sub-location ──────────────────
  const [items] = await conn.query(
    "SELECT item_id, serial_number FROM item_inv WHERE company_id=?", [CIDs]);
  const buckets = new Map(); // "loc||sub" -> item_ids
  for (const it of items) {
    const rule = PLACEMENT.find(([re]) => re.test(it.serial_number || ""));
    if (!rule) continue;
    const key = `${rule[1]}||${rule[2]}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(it.item_id);
  }
  for (const [key, ids] of buckets) {
    const [locName, subPath] = key.split("||");
    const subKey = `${locName}>${subPath.replace(">", ">")}`;
    const subId = subIds[subKey] ?? null;
    // JSON path array — the location tree and sub-location filters parse this
    const subDisplay = JSON.stringify(subPath.split(">"));
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      await conn.query(
        `UPDATE item_inv SET location=?, current_location=?, location_id=?, sub_location=?, sub_location_id=?
         WHERE item_id IN (${chunk.map(() => "?").join(",")})`,
        [locName, locName, locIds[locName], subDisplay, subId, ...chunk]);
    }
    console.log(`  placed ${ids.length} → ${locName} / ${subDisplay}`);
  }

  // charging carts live in classrooms/media center (they're containers there)
  const cartHomes = [
    ["CRT-7001", "Lincoln Middle School", "Room 101 — Rivera"],
    ["CRT-7002", "Roosevelt High School", "Media Center"],
  ];
  for (const [serial, locName, sub] of cartHomes) {
    await conn.query(
      `UPDATE item_inv SET location=?, current_location=?, location_id=?, sub_location=?, sub_location_id=?
       WHERE company_id=? AND serial_number=?`,
      [locName, locName, locIds[locName], JSON.stringify(sub.split(">")), subIds[`${locName}>${sub}`] ?? null, CIDs, serial]);
  }

  // ── 5. fill the containers ────────────────────────────────────────────────
  const fillContainer = async (containerSerial, childWhereSql, childParams, capacity) => {
    const [[cont]] = await conn.query(
      "SELECT item_id, location, location_id, sub_location, sub_location_id FROM item_inv WHERE company_id=? AND serial_number=?",
      [CIDs, containerSerial]);
    if (!cont) return console.log(`  ! no container ${containerSerial}`);
    const [kids] = await conn.query(
      `SELECT item_id, serial_number, item_group, category_name FROM item_inv
       WHERE company_id=? AND isItInContainer=0 AND warehouse=1 AND ${childWhereSql}
       ORDER BY serial_number LIMIT ${capacity}`,
      [CIDs, ...childParams]);
    if (!kids.length) return console.log(`  ! nothing to fill ${containerSerial}`);
    const ids = kids.map((k) => k.item_id);
    // child flags + co-locate with the container
    await conn.query(
      `UPDATE item_inv SET isItInContainer=1, container_id=?, display_item=0,
        location=?, current_location=?, location_id=?, sub_location=?, sub_location_id=?
       WHERE item_id IN (${ids.map(() => "?").join(",")})`,
      [cont.item_id, cont.location, cont.location, cont.location_id, cont.sub_location, cont.sub_location_id, ...ids]);
    // container_items registry table (modern) + JSON column (legacy readers)
    await conn.query("DELETE FROM container_items WHERE container_item_id=?", [cont.item_id]);
    await conn.query(
      "INSERT INTO container_items (container_item_id, child_ids) VALUES (?, ?)",
      [cont.item_id, JSON.stringify(ids)]);
    await conn.query("UPDATE item_inv SET container_items=? WHERE item_id=?",
      [JSON.stringify(kids), cont.item_id]);
    console.log(`  ✓ ${containerSerial} now holds ${ids.length} device(s)`);
  };

  await fillContainer("CRT-7001", "item_group='Chromebook Gen 11 (LMS)'", [], 30);
  await fillContainer("CRT-7002", "item_group='Chromebook Gen 11 (RHS)'", [], 30);
  await fillContainer("RHS-CASE-9701", "item_group='Wireless Mic (RHS Theater)'", [], 12);
  await fillContainer("RHS-CASE-9702", "item_group='Wireless Mic (RHS Theater)'", [], 12);

  // ── summary ───────────────────────────────────────────────────────────────
  const [sum] = await conn.query(
    `SELECT l.location_name, COUNT(ii.item_id) AS items
     FROM locations l LEFT JOIN item_inv ii ON ii.location_id = l.location_id
     WHERE l.company_id=? GROUP BY l.location_id ORDER BY l.location_name`, [CID]);
  console.log("\nInventory by school:");
  sum.forEach((r) => console.log(`  ${r.location_name}: ${r.items}`));
  await conn.end();
})().catch((e) => { console.error("SEED FAILED:", e.message); process.exit(1); });
