'use strict';

const { DEVITRAK_EMAIL_ICON_URL, DEVITRAK_EMAIL_NAME_URL } = require("./branding");

const studentNameOf = (row) => `${row.first_name || ""} ${row.last_name || ""}`.trim();
const deviceLabelOf = (row) =>
  [row.device_brand, row.device_category_name].filter(Boolean).join(" ") || "a device";
const dueTextOf = (row) =>
  row.expected_return_date ? new Date(row.expected_return_date).toLocaleDateString() : "its expected return date";
const daysTextOf = (row) => {
  const n = Number(row.days_overdue);
  return Number.isFinite(n) && n > 0 ? `${n} day(s)` : "some time";
};
const classTextOf = (row) =>
  [row.grade && `grade ${row.grade}`, row.homeroom && `homeroom ${row.homeroom}`].filter(Boolean).join(", ");

/**
 * Overdue-device reminder email (school track). Guardian- or student-facing.
 * PURE: returns an HTML string from a plain props object (a row from the overdue
 * query + a `toGuardian` flag). No I/O, so it is trivially testable.
 *
 * `devices` (opcional): todas las filas vencidas del mismo destinatario en la
 * misma compañía — el scheduler manda UN correo por destinatario y día. Con una
 * sola fila (o sin `devices`) el correo es el de siempre; con varias, una tabla
 * con una fila por dispositivo.
 */
const overdueReminderMessageHtml = (props = {}) => {
  if (Array.isArray(props.devices) && props.devices.length > 1) {
    return overdueReminderListHtml(props);
  }
  return overdueReminderSingleHtml(props);
};

const shell = (body) => `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Overdue Device Reminder</title>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap");
      body { margin:0; padding:0; font-family:'Inter', sans-serif; background:#fff; color:#1a202c; max-width:768px; min-width:320px; }
      .container { margin:0 auto; padding:24px; width:100%; max-width:768px; }
      h1 { font-size:22px; font-weight:600; color:#101828; margin:0 0 12px; }
      p { font-size:15px; color:#475467; margin:0 0 16px; line-height:1.5; }
      table { width:100%; border-collapse:collapse; margin:16px 0; font-size:14px; }
      th, td { padding:10px 12px; border:1px solid #e0e0e0; text-align:left; }
      th { background:#f2f2f2; font-weight:600; color:#475467; }
      .pill { display:inline-block; background:#fef3f2; color:#b42318; font-weight:600; border-radius:6px; padding:2px 10px; font-size:13px; }
      .footer { font-size:12px; color:#98a2b3; text-align:center; margin-top:32px; }
    </style>
  </head>
  <body>
    <div class="container">
      <p style="font-size:9px; color:#475467; margin:0 0 4px;">Powered by</p>
      <div style="display:flex; align-items:center; margin-bottom:24px;">
        <img src="${DEVITRAK_EMAIL_ICON_URL}" width="26" height="12" alt="devitrak-logo" style="display:block; width:26px; height:12px; border:0; margin-right:4px;" />
        <img src="${DEVITRAK_EMAIL_NAME_URL}" width="57" height="12" alt="devitrak-name" style="display:block; width:57px; height:12px; border:0;" />
      </div>
${body}
      <div class="footer">
        <p>This email was sent from an unmonitored account. Do not reply to this email.</p>
      </div>
    </div>
  </body>
</html>`;

const overdueReminderListHtml = (props) => {
  const { devices, toGuardian = false, parent_guardian_first_name = "", first_name = "" } = props;
  const greetingName =
    toGuardian && parent_guardian_first_name ? parent_guardian_first_name : first_name || "there";
  const names = [...new Set(devices.map(studentNameOf).filter(Boolean))];
  const lead = toGuardian
    ? `This is a reminder that ${devices.length} devices assigned to <strong>${
        names.join(", ") || "your student(s)"
      }</strong> are overdue for return.`
    : `This is a reminder that ${devices.length} devices assigned to you are overdue for return.`;
  const rowsHtml = devices
    .map((d) => {
      const classText = classTextOf(d);
      return `          <tr><td>${studentNameOf(d) || "—"}${classText ? ` — ${classText}` : ""}</td><td>${deviceLabelOf(d)}${
        d.device_serial_number ? ` (serial <strong>${d.device_serial_number}</strong>)` : ""
      }</td><td>${dueTextOf(d)}</td><td><span class="pill">${daysTextOf(d)}</span></td></tr>`;
    })
    .join("\n");

  return shell(`
      <h1>Overdue device reminder</h1>
      <p>Dear ${greetingName}, ${lead}</p>

      <table>
        <thead>
          <tr><th>Student</th><th>Device</th><th>Expected return</th><th>Overdue</th></tr>
        </thead>
        <tbody>
${rowsHtml}
        </tbody>
      </table>

      <p>Please return the devices to the school as soon as possible. If any of them has already been returned, no further action is needed for it.</p>
`);
};

const overdueReminderSingleHtml = (props = {}) => {
  const {
    first_name = "",
    last_name = "",
    parent_guardian_first_name = "",
    toGuardian = false,
    grade = "",
    homeroom = "",
    device_serial_number = "",
    device_category_name = "",
    device_brand = "",
    expected_return_date,
    days_overdue,
    location = "",
  } = props;

  const studentName = `${first_name} ${last_name}`.trim() || "the student";
  const greetingName =
    toGuardian && parent_guardian_first_name ? parent_guardian_first_name : first_name || "there";
  const deviceLabel = [device_brand, device_category_name].filter(Boolean).join(" ") || "a device";
  const serialText = device_serial_number ? ` (serial <strong>${device_serial_number}</strong>)` : "";
  const dueText = expected_return_date
    ? new Date(expected_return_date).toLocaleDateString()
    : "its expected return date";
  const daysNum = Number(days_overdue);
  const daysText = Number.isFinite(daysNum) && daysNum > 0 ? `${daysNum} day(s)` : "some time";
  const classText = [grade && `grade ${grade}`, homeroom && `homeroom ${homeroom}`]
    .filter(Boolean)
    .join(", ");

  const lead = toGuardian
    ? `This is a reminder that a device assigned to <strong>${studentName}</strong>${
        classText ? ` (${classText})` : ""
      } is overdue for return.`
    : `This is a reminder that a device assigned to you is overdue for return.`;

  return shell(`
      <h1>Overdue device reminder</h1>
      <p>Dear ${greetingName}, ${lead} <span class="pill">${daysText} overdue</span></p>

      <table>
        <tbody>
          <tr><th>Student</th><td>${studentName}${classText ? ` — ${classText}` : ""}</td></tr>
          <tr><th>Device</th><td>${deviceLabel}${serialText}</td></tr>
          <tr><th>Expected return</th><td>${dueText}</td></tr>
          ${location ? `<tr><th>Location</th><td>${location}</td></tr>` : ""}
        </tbody>
      </table>

      <p>Please return the device to the school as soon as possible. If it has already been returned, no further action is needed.</p>
`);
};

module.exports = { overdueReminderMessageHtml };
