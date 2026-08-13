const sgMail = require("@sendgrid/mail");
const fs = require("fs");
const path = require("path");
sgMail.setApiKey(process.env.SENDGRID_API_KEY_PAID);
const { createQueuedEmailController } = require("./queueEmail");
const { createQueuedJobController } = require("../helpers/queuedController");
const { enqueue } = require("../helpers/queue");

const {
  assigningDeviceMessageHtml,
  cancelingDepositMessageHtml,
  capturingDepositMessageHtml,
  returnConfirmationMessageHtml,
  returnReminderMessageHtml,
  staffNotificationMessageHtml,
  lostDeviceFeeCollectedMessageHtml,
  linkToLoginExistingConsumerMessageHtml,
  linkToResetUserPassword,
  editingDeviceAdminMessageHtml,
  confirmationNewConsumerAccountMessageHtml,
  customizedEmailMessageHtml,
  singleEmailMessageHtml,
  newUserInvitationMessageHtml,
  eventBeginsReminderHtmlMessage,
  staffInternalNotificationMessageHtml,
  itemInfoStaffNotificationMessageHtml,
  eventLinkEventHtml,
  serviceChargeInvoiceEmailHtml,
  serviceRefundConfirmationEmailHtml,
  deviceReportPerTransactionMessageHtml,
  nrffInterpretationFeedbackEmailMessageHtml,
  lostDeviceFeeReceipt,
  liabilityContractStaffNotificationMessageHtml,
  returnedItemsToRenterNotificationMessageHtml,
  termsAndConditionsAcceptanceMessageHtml,
  documentSigningCompletionMessageHtml,
  loginActivityNotificationMessageHtml,
  liabilityContractConsumerNotificationMessageHtml,
  consumerLeaseEndedDeviceReturnedNotificationMessageHtml,
  documentSigningCompletionConsumerLeaseMessageHtml,
  liabilityContractMemberNotificationMessageHtml,
  returnConfirmationLeaseMemberMessageHtml,
  memberDeviceIncidentMessageHtml,
  memberDeviceFeeReceiptMessageHtml,
  forceLogoutNotificationHtmlTemplate,
  memberEmailNotificationHtml,
  customizeMessageHtml,
} = require("./returningDeviceMessage");
const User = require("../models/User");
const logger = require("../helpers/logger");

const normalizeLostFeePayload = (body = {}) => {
  const consumer = body.consumer || body.consumerInfo || body.client || {};

  const rawDevice =
    body.device ||
    body.deviceInfo ||
    body.transactionData ||
    body.item ||
    {};

  const deviceText =
    typeof rawDevice === "string"
      ? rawDevice
      : rawDevice.type ||
      rawDevice.deviceType ||
      rawDevice.item_group ||
      rawDevice.category_name ||
      "";

  const serialNumber =
    rawDevice.serialNumber ||
    rawDevice.serial_number ||
    rawDevice.deviceSerialNumber ||
    rawDevice.key ||
    "";

  return {
    consumerName:
      consumer.name ||
      `${consumer.firstName || ""} ${consumer.lastName || ""}`.trim() ||
      body.consumerName ||
      "Customer",

    consumerEmail:
      consumer.email ||
      body.email ||
      body.consumerEmail ||
      "",

    deviceType: deviceText,
    serialNumber:
      serialNumber ||
      String(deviceText).match(/serialNumber:\s*([^,]+)/i)?.[1] ||
      "N/A",

    amount: body.amount || body.total || body.value || "0.00",
    event: body.event || body.eventName || body.eventSelected || "Event",
    company: body.company || body.companyName || "Devitrak",
    date: body.date || new Date().toDateString(),
    time: body.time || new Date().toLocaleTimeString(),
    transaction:
      body.transaction ||
      body.paymentIntent ||
      body.payment_intent ||
      "N/A",

    link: body.link || body.url || body.confirmationLink || "#",
  };
};
// const e = require("express");
const buildAssignDeviceMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `${body.consumer.firstName} ${body.consumer.lastName} <${body.consumer.email}>`,
  subject: "Assignment device notification",
  html: assigningDeviceMessageHtml(body),
});
const assingDeviceNotification = createQueuedEmailController(buildAssignDeviceMessage);

const buildReturningDeviceMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `${body.consumer.firstName} ${body.consumer.lastName} <${body.consumer.email}>`,
  subject: "Returned device notification",
  html: returnConfirmationMessageHtml(body),
});
const returningDeviceNotification = createQueuedEmailController(buildReturningDeviceMessage);

const buildReturningDeviceLeaseMemberMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `${body.member.firstName} ${body.member.lastName} <${body.member.email}>`,
  subject: "Returned device notification",
  html: returnConfirmationLeaseMemberMessageHtml(body),
});
const returningDeviceLeaseMemberNotification = createQueuedEmailController(buildReturningDeviceLeaseMemberMessage);

// --- School track: lost/damaged device, and the receipt for the fee ---------
//
// Split off from buildReturningDeviceLeaseMemberMessage above because all three
// outcomes used to share it: a student declared their laptop lost and the
// guardian received "the devices have been returned successfully" — written
// confirmation of a return that never happened.
//
// `member.email` is used AS GIVEN. The caller has already resolved it (guardian
// for a minor, and it refuses to send when a minor has no guardian on file), so
// re-resolving it here could only get it wrong. It is also passed bare, without
// a display name: the address frequently belongs to the guardian, and labelling
// their mailbox with the student's name is the same mistake as greeting them by
// it.
const MEMBER_DEVICE_INCIDENT_OUTCOMES = new Set(["lost", "damaged"]);

const validateMemberDeviceIncident = (body = {}) => {
  if (!body.member || !body.member.email) {
    return { status: 400, body: { ok: false, message: "member.email is required" } };
  }
  if (!MEMBER_DEVICE_INCIDENT_OUTCOMES.has(String(body.outcome || "").toLowerCase())) {
    return {
      status: 400,
      body: { ok: false, message: "outcome must be 'lost' or 'damaged'" },
    };
  }
  return null;
};

const buildMemberDeviceIncidentMessage = (body) => {
  const studentName = `${body.member.firstName || ""} ${body.member.lastName || ""}`.trim();
  const isLost = String(body.outcome).toLowerCase() === "lost";
  return {
    from: "Devitrak Notifications <noreply@devitrak.com>",
    to: body.member.email,
    subject: isLost
      ? `Device reported lost — ${studentName}`
      : `Device returned damaged — ${studentName}`,
    html: memberDeviceIncidentMessageHtml(body),
  };
};
const memberDeviceIncidentNotification = createQueuedEmailController(
  buildMemberDeviceIncidentMessage,
  { validate: validateMemberDeviceIncident }
);

const validateMemberDeviceFeeReceipt = (body = {}) => {
  if (!body.member || !body.member.email) {
    return { status: 400, body: { ok: false, message: "member.email is required" } };
  }
  return null;
};

const buildMemberDeviceFeeReceiptMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: body.member.email,
  subject: `Payment receipt — ${body.company || "device fee"}`,
  html: memberDeviceFeeReceiptMessageHtml(body),
});
const memberDeviceFeeReceiptNotification = createQueuedEmailController(
  buildMemberDeviceFeeReceiptMessage,
  {
    validate: validateMemberDeviceFeeReceipt,
    // The money moved exactly once; a retried request must not mail a second
    // receipt for the same charge.
    idempotencyKeyFn: (body) =>
      body.paymentIntent ? `member-fee-receipt:${body.paymentIntent}` : undefined,
  }
);

const buildDeviceReportPerTransactionMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `${body.consumer.firstName} ${body.consumer.lastName} <${body.consumer.email}>`,
  subject: "Device Report Per Transaction",
  html: deviceReportPerTransactionMessageHtml(body),
});
const deviceReportPerTransaction = createQueuedEmailController(buildDeviceReportPerTransactionMessage);

const buildCancelDepositMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: body.consumer.email,
  subject: "Deposit returned notification",
  html: cancelingDepositMessageHtml(body),
});
const cancelDepositNotification = createQueuedEmailController(buildCancelDepositMessage);

const buildCaptureDepositMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: body.consumer.email,
  subject: "Deposit captured",
  html: capturingDepositMessageHtml(body),
});
const captureDepositNotification = createQueuedEmailController(buildCaptureDepositMessage);

// NOTA: el original tenía dos bugs preexistentes (ReferenceError: `msg` no
// definido — usaba `info`; y `returnReminderMessageHtml` pasado como referencia
// de función en vez de invocarlo) que hacían este endpoint 100% roto. Se
// corrigen aquí porque son inherentes a extraer un builder correcto; el
// template en sí (returnReminderMessageHtml) sigue siendo un stub que devuelve
// "" — no se inventa contenido nuevo, fuera de alcance de esta migración.
const buildEarlierReturningMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `<${body.consumer}>`,
  subject: "Returning device reminder",
  html: returnReminderMessageHtml(body),
});
const earlierReturningNotification = createQueuedEmailController(buildEarlierReturningMessage);

const buildEventStaffMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: body.staff,
  subject: "Staff event",
  html: staffNotificationMessageHtml(body),
});
const eventStaffNotification = createQueuedEmailController(buildEventStaffMessage);

const buildEditingDeviceAdminMessage = (body) => ({
  to: `${body.contactAdminEmail}`,
  from: "Devitrak Notifications <noreply@devitrak.com>",
  subject: "Device edited notification",
  html: editingDeviceAdminMessageHtml(body),
});
const editingDeviceAdminNotification = createQueuedEmailController(buildEditingDeviceAdminMessage);

const validateLostDeviceFee = (body) => {
  const data = normalizeLostFeePayload(body);
  if (!data.consumerEmail) {
    return { status: 400, body: { ok: false, message: "Consumer email is required" } };
  }
  return null;
};
const buildLostDeviceFeeMessage = (body) => {
  const data = normalizeLostFeePayload(body);
  return {
    to: data.consumerEmail,
    from: "Devitrak Notifications <noreply@devitrak.com>",
    subject: `Lost device fee receipt - ${data.company}`,
    html: lostDeviceFeeReceipt(data, normalizeLostFeePayload),
  };
};
const lostDeviceFeeCollectedNotification = createQueuedEmailController(buildLostDeviceFeeMessage, {
  validate: validateLostDeviceFee,
});
const buildConfirmationLinkNewConsumerMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `${body.consumer.email}`,
  subject: "Confirmation link account",
  html: confirmationNewConsumerAccountMessageHtml(body),
});
const confirmationLinkNewConsumerNotification = createQueuedEmailController(buildConfirmationLinkNewConsumerMessage);

const buildLoginLinkExistingConsumerMessage = (body) => ({
  to: `${body.consumer.email}`,
  from: "Devitrak Notifications <noreply@devitrak.com>",
  subject: "Link to login",
  html: linkToLoginExistingConsumerMessageHtml(body),
});
const loginLinkExistingConsumerNotification = createQueuedEmailController(buildLoginLinkExistingConsumerMessage);

// NOTA: el original tenía un bug preexistente — si sgMail.send fallaba, el
// catch solo logueaba y NUNCA respondía, dejando al cliente colgado hasta el
// timeout de 30s. La factory genérica siempre responde (200/500), así que esta
// migración corrige ese cuelgue de paso.
const buildLinkToResetPasswordMessage = (body) => ({
  to: `${body.contactInfo.email}`,
  from: "Devitrak Notifications <noreply@devitrak.com>",
  subject: "Devitrak Notification - Reset Password Link",
  html: linkToResetUserPassword(body),
});
const linkToResetPassword = createQueuedEmailController(buildLinkToResetPasswordMessage);

const buildCustomizedEmailMessage = (body) => ({
  to: `${body.consumersList}`,
  from: "Devitrak Notifications <noreply@devitrak.com>",
  subject: `Devitrak Notification - ${body.subject}`,
  html: customizedEmailMessageHtml(body),
});
const customizedEmailNotification = createQueuedEmailController(buildCustomizedEmailMessage);

const buildSingleEmailMessage = (body) => ({
  to: body.consumer,
  from: "Devitrak Notifications <noreply@devitrak.com>", // "notification@devitrak.net",
  subject: `Devitrak Notification - ${body.subject}`,
  html: singleEmailMessageHtml(body),
});
const singleEmailNotification = createQueuedEmailController(buildSingleEmailMessage);

const buildNewUserInvitationMessage = (body) => ({
  to: body.consumer,
  from: "Devitrak Notifications <noreply@devitrak.com>",
  subject: `Devitrak Notification - ${body.subject}`,
  html: newUserInvitationMessageHtml(body),
});
const newUserInvitationNotification = createQueuedEmailController(buildNewUserInvitationMessage);

const buildInternalNotificationMessage = (body) => ({
  to: body.staff,
  from: "Devitrak Notifications <noreply@devitrak.com>",
  subject: `Devitrak Notification - ${body.subject}`,
  html: staffNotificationMessageHtml(body),
});
const internalNotification = createQueuedEmailController(buildInternalNotificationMessage);

const buildEventBeginsReminderMessage = (body) => ({
  to: body.staff,
  from: "Devitrak Notifications <noreply@devitrak.com>",
  subject: `Devitrak Notification - ${body.subject}`,
  html: eventBeginsReminderHtmlMessage(body),
});
const eventBeginsReminderNotification = createQueuedEmailController(buildEventBeginsReminderMessage);

const buildStaffInternalMessage = (body) => ({
  to: body.staff,
  from: "Devitrak Notifications <noreply@devitrak.com>",
  subject: `Devitrak Notification - ${body.subject}`,
  html: staffInternalNotificationMessageHtml(body),
});
const staffInternalNotification = createQueuedEmailController(buildStaffInternalMessage);

const buildItemInfoStaffMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: body.staff,
  subject: `Devitrak Notification - ${body.subject}`,
  html: itemInfoStaffNotificationMessageHtml(body),
});
const itemInfoStaffNotification = createQueuedEmailController(buildItemInfoStaffMessage);

const buildEventLinkEventMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: body.list,
  subject: `Devitrak Notification - Event Link.`,
  html: eventLinkEventHtml(body),
});
const eventLinkEvent = createQueuedEmailController(buildEventLinkEventMessage);

const buildChargeInvoiceMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: body.email,
  subject: `Devitrak Notification - Payment confirmation.`,
  html: serviceChargeInvoiceEmailHtml(body),
});
const chargeInvoice = createQueuedEmailController(buildChargeInvoiceMessage);

const buildRefundInvoiceMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: body.email,
  subject: `Devitrak Notification - Refund confirmation.`,
  html: serviceRefundConfirmationEmailHtml(body),
});
const refundInvoice = createQueuedEmailController(buildRefundInvoiceMessage);

// Ambas dependen de una consulta a DB (User.find) para armar la lista de
// destinatarios, y usan sgMail.sendMultiple — fan-out por PERSONALIZACIÓN (cada
// destinatario recibe su propio correo sin ver a los demás), que no es
// intercambiable con `.send()` de un array de mensajes distintos (el que sí
// usan documentSigningCompletionNotification y similares). Por eso se registra
// un type nuevo 'send-email-multiple' (queue/handlers/index.js) en vez de
// reusar 'send-email'.
//
// El builder es async y hace la consulta DENTRO de buildPayload (parametrizada
// por findFn para poder testear sin Mongo). Si no hay destinatarios, devuelve
// null: createQueuedJobController no encola nada y responde con
// buildSkippedBody en vez de crear un job vacío.
function createBuildMassiveEventCustomerMessage(
  findConsumerEmails = (eventID) => User.find({ event_providers: eventID }, "email").lean()
) {
  return async (body) => {
    const { eventID, eventSelected, subject } = body;
    const consumerEventList = await findConsumerEmails(eventID);
    if (!consumerEventList.length) return null;

    return {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: [...consumerEventList],
      subject: `Event ${eventSelected} - ${subject}`,
      html: customizedEmailMessageHtml(body),
    };
  };
}
const buildMassiveEventCustomerMessage = createBuildMassiveEventCustomerMessage();
const massiveEventCustomerNotification = createQueuedJobController(
  "send-email-multiple",
  buildMassiveEventCustomerMessage,
  {
    buildSkippedBody: () => ({ ok: true, notification: "No email sent to any consumers" }),
    buildSuccessBody: (job) => ({ ok: true, notification: `Email queued for ${job.payload.to.length} consumers`, jobId: job.id }),
  }
);

function createBuildDevitrakFeedbackMessage(
  findConsumers = (eventID) => User.find({ event_providers: eventID }, { email: 1, name: 1, lastName: 1, _id: 0 }).lean()
) {
  return async (body) => {
    const { eventID } = body;
    const consumerEventList = await findConsumers(eventID);
    if (!consumerEventList.length) return null;

    return {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: [...consumerEventList],
      subject: `Share Your Feedback – Help Us Improve Your Experience!`,
      html: nrffInterpretationFeedbackEmailMessageHtml(),
    };
  };
}
const buildDevitrakFeedbackMessage = createBuildDevitrakFeedbackMessage();
const devitrakFeedbackEmailNotification = createQueuedJobController(
  "send-email-multiple",
  buildDevitrakFeedbackMessage,
  {
    buildSkippedBody: () => ({ ok: true, notification: "No email sent to any consumers" }),
    buildSuccessBody: (job) => ({ ok: true, notification: `Email queued for ${job.payload.to.length} consumers`, jobId: job.id }),
  }
);

// Único llamador: controller/errorLog.js (createErrorFeed), que ahora encola
// esto como 'send-email' en vez de enviarlo inline. Antes era una función
// async que armaba Y enviaba (con sgMail.sendMultiple, aunque `to` es un solo
// destinatario fijo — no había necesidad real de sendMultiple); ahora es un
// builder puro, igual que el resto de las plantillas migradas.
const buildErrorFeedbackMessage = (props) => {
  const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Error Notification</title>
          <style>
            /* Basic styling to make the email more readable */
            body {
              font-family: Arial, sans-serif;
              background-color: #f7f7f7;
              margin: 0;
              padding: 0;
            }
            .container {
              max-width: 600px;
              margin: 20px auto;
              background-color: #ffffff;
              padding: 20px;
              border-radius: 5px;
              box-shadow: 0 0 5px rgba(0, 0, 0, 0.1);
            }
            h1 {
              margin-top: 0;
              color: #333333;
            }
            .error-details {
              background-color: #f9f9f9;
              border: 1px solid #e0e0e0;
              padding: 10px;
              margin: 15px 0;
            }
            .error-details p {
              margin: 6px 0;
            }
            .error-details pre {
              background: #efefef;
              padding: 10px;
              white-space: pre-wrap;
              word-wrap: break-word;
              border-radius: 4px;
            }
            .footer {
              font-size: 12px;
              color: #999999;
              margin-top: 20px;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Devitrak Error Notification</h1>
            <p>Hello,</p>
            <p>We encountered the following error in our application. Your feedback helps us improve your experience. Please review the details below and let us know if you have any additional information or questions.</p>

            <div class="error-details">
              <h2>Error Details</h2>
              <p><strong>Error ID:</strong> ${props.errorId}</p>
              <p><strong>Error Message:</strong> ${props.error}</p>
              <p><strong>Component Stack:</strong></p>
              <pre>${props.componentStack}</pre>
            </div>

            <p>If you have any suggestions or more details about this error, please reply to this email. Thank you for helping us make Devitrak better!</p>

            <div class="footer">
              <p>Devitrak Notifications</p>
              <p>&copy; 2025 Devitrak Inc.</p>
            </div>
          </div>
        </body>
      </html>
    `;

  return {
    from: "Devitrak Notifications <notification@devitrak.net>",
    to: "Gustavo Rodriguez <grodriguez@contextglobal.com>",
    subject: `Error Log - Devitrak Admin Dashboard.`,
    html: htmlContent,
  };
};

// Las 3 notificaciones de contrato de responsabilidad (member/consumer/staff)
// comparten exactamente la misma forma de validación — solo cambia el campo
// del sujeto (member/consumer/staff) y el template.
const validateLiabilityContractParty = (party, partyLabel) => {
  if (!party || !party.email || !party.name) {
    return { status: 400, body: { ok: false, msg: `${partyLabel} information (name and email) is required` } };
  }
  return null;
};
const validateLiabilityContractShared = (contract_list, items) => {
  if (!contract_list || contract_list.length === 0) {
    return { status: 400, body: { ok: false, msg: "At least one contract is required" } };
  }
  if (!items || items.length === 0) {
    return { status: 400, body: { ok: false, msg: "At least one item is required" } };
  }
  return null;
};

const validateLiabilityContractMember = (body) =>
  validateLiabilityContractParty(body.member, "Member") || validateLiabilityContractShared(body.contract_list, body.items);
const buildLiabilityContractMemberMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `${body.member.name} <${body.member.email}>`,
  subject: body.subject || "Device Liability Contract",
  html: liabilityContractMemberNotificationMessageHtml(body),
});
const liabilityContractMemberNotification = createQueuedEmailController(buildLiabilityContractMemberMessage, {
  validate: validateLiabilityContractMember,
});

const validateLiabilityContractConsumer = (body) =>
  validateLiabilityContractParty(body.consumer, "Consumer") || validateLiabilityContractShared(body.contract_list, body.items);
const buildLiabilityContractConsumerMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `${body.consumer.name} <${body.consumer.email}>`,
  subject: body.subject || "Device Liability Contract",
  html: liabilityContractConsumerNotificationMessageHtml(body),
});
const liabilityContractConsumerNotification = createQueuedEmailController(buildLiabilityContractConsumerMessage, {
  validate: validateLiabilityContractConsumer,
});

const validateLiabilityContractStaff = (body) =>
  validateLiabilityContractParty(body.staff, "Staff") || validateLiabilityContractShared(body.contract_list, body.items);
const buildLiabilityContractStaffMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `${body.staff.name} <${body.staff.email}>`,
  subject: body.subject || "Device Liability Contract",
  html: liabilityContractStaffNotificationMessageHtml(body),
});
const liabilityContractStaffNotification = createQueuedEmailController(buildLiabilityContractStaffMessage, {
  validate: validateLiabilityContractStaff,
});

// Adjuntos grandes (esta ruta tiene límite de 100MB de body en index.js): se
// suben a S3 ANTES de encolar (createBuildReturnedItemsToRenterMessage) en vez
// de guardar el base64 en el documento del job — evita acercarse al límite de
// 16MB por documento de Mongo. El worker resuelve las referencias de vuelta a
// base64 justo antes de enviar (queue/handlers/emailWithAttachments.js) y
// limpia S3 después de un envío exitoso. Ver DESIGN_task_queue.md § Fase 1
// (cierre) y test/returnedItemsToRenterQueue.test.js.
//
// La validación es IDÉNTICA a la original — mismos mensajes y status 400.
const validateReturnedItemsToRenter = (body) => {
  const { subject, staffEmails, attachments } = body;

  if (!subject) {
    return { status: 400, body: { ok: false, msg: "Subject is required" } };
  }

  if (!Array.isArray(staffEmails) || staffEmails.length === 0) {
    return {
      status: 400,
      body: { ok: false, msg: "Staff emails array is required and must contain at least one email" },
    };
  }

  const invalidEmails = staffEmails.filter((email) => !EMAIL_REGEX.test(email));
  if (invalidEmails.length > 0) {
    return { status: 400, body: { ok: false, msg: `Invalid email format(s): ${invalidEmails.join(", ")}` } };
  }

  if (attachments !== undefined) {
    if (!Array.isArray(attachments)) {
      return { status: 400, body: { ok: false, msg: "Attachments must be an array" } };
    }

    for (const file of attachments) {
      if (file.content && file.filename) continue;
      if (file.path && file.filename) {
        if (!fs.existsSync(path.resolve(file.path))) {
          return { status: 400, body: { ok: false, msg: `Attachment file not found: ${file.filename}` } };
        }
        continue;
      }
      return { status: 400, body: { ok: false, msg: "Invalid attachment object: missing content or filename" } };
    }
  }

  return null;
};

// uploadAttachment se inyecta para testear sin tocar S3 real; en producción
// usa helpers/s3Upload.js.
function createBuildReturnedItemsToRenterMessage(
  uploadAttachment = require("../helpers/s3Upload").uploadNotificationAttachment
) {
  return async (body) => {
    const { subject, staffEmails, supplierInfo, attachments } = body;

    const msg = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: staffEmails,
      subject: subject,
      html: returnedItemsToRenterNotificationMessageHtml({ supplierInfo }),
    };

    if (attachments && attachments.length) {
      msg.attachmentRefs = await Promise.all(
        attachments.map(async (file) => {
          const content = file.content || fs.readFileSync(path.resolve(file.path)).toString("base64");
          const uploaded = await uploadAttachment({
            content,
            filename: file.filename,
            contentType: file.type,
          });
          return { key: uploaded.key, filename: file.filename, type: file.type || "application/octet-stream" };
        })
      );
    }

    return msg;
  };
}
const buildReturnedItemsToRenterMessage = createBuildReturnedItemsToRenterMessage();

const returnedItemsToRenterNotification = createQueuedJobController(
  "send-email-multiple-with-attachments",
  buildReturnedItemsToRenterMessage,
  {
    validate: validateReturnedItemsToRenter,
    buildSuccessBody: (job) => ({
      ok: true,
      notification: `Email queued for ${job.payload.to.length} staff member(s)`,
      recipients: job.payload.to,
      attachmentsCount: job.payload.attachmentRefs ? job.payload.attachmentRefs.length : 0,
      jobId: job.id,
    }),
  }
);

// Compartido por las rutas de Batch B que validan formato de email.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validateTermsAndConditionsAcceptance = (body) => {
  const { consumer } = body;
  if (!consumer || !consumer.email) {
    return { status: 400, body: { ok: false, msg: "Consumer information with email is required" } };
  }
  if (!consumer.name || !consumer.lastName) {
    return { status: 400, body: { ok: false, msg: "Consumer first name and last name are required" } };
  }
  if (!EMAIL_REGEX.test(consumer.email)) {
    return { status: 400, body: { ok: false, msg: "Invalid email format" } };
  }
  return null;
};
const buildTermsAndConditionsAcceptanceMessage = (body) => {
  const { consumer, event, company, signature } = body;
  return {
    from: "Devitrak Notifications <noreply@devitrak.com>",
    to: `${consumer.name} ${consumer.lastName} <${consumer.email}>`,
    subject: "Terms and Conditions Acceptance Confirmation",
    html: termsAndConditionsAcceptanceMessageHtml({ consumer, event, company, signature }),
  };
};
const termsAndConditionsAcceptanceNotification = createQueuedEmailController(buildTermsAndConditionsAcceptanceMessage, {
  validate: validateTermsAndConditionsAcceptance,
});

// NOTA: el payload de estos dos es un ARRAY de 2 mensajes (assigner + otro
// destinatario). El handler genérico 'send-email' (queue/handlers/email.js)
// reenvía el payload tal cual a sgMail.send(), que acepta un array para enviar
// varios mensajes distintos en una sola llamada — equivalente al
// Promise.all([send(msg1), send(msg2)]) original, sin necesidad de un handler
// nuevo.
const validateDocumentSigningCompletion = (body) => {
  const { assigner, staff, contract_list } = body;
  if (!assigner || !assigner.email || !staff || !staff.email) {
    return { status: 400, body: { ok: false, msg: "Both assigner and staff information with emails are required" } };
  }
  if (!contract_list || contract_list.length === 0) {
    return { status: 400, body: { ok: false, msg: "Contract list is required" } };
  }
  if (!EMAIL_REGEX.test(assigner.email) || !EMAIL_REGEX.test(staff.email)) {
    return { status: 400, body: { ok: false, msg: "Invalid email format" } };
  }
  return null;
};
const buildDocumentSigningCompletionMessages = (body) => {
  const { assigner, staff, contract_list, verification_id } = body;
  return [
    {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: `${assigner.name || "Assigner"} <${assigner.email}>`,
      subject: "Document Signing Complete - Equipment Ready for Delivery",
      html: documentSigningCompletionMessageHtml({ recipientType: "assigner", staff, contract_list, verification_id }),
    },
    {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: `${staff.name || "Staff Member"} <${staff.email}>`,
      subject: "Document Signing Complete - Awaiting Equipment Delivery",
      html: documentSigningCompletionMessageHtml({ recipientType: "staff", staff, contract_list, verification_id }),
    },
  ];
};
const documentSigningCompletionNotification = createQueuedEmailController(buildDocumentSigningCompletionMessages, {
  validate: validateDocumentSigningCompletion,
});

const validateConsumerDocumentSigningCompletion = (body) => {
  const { assigner, consumer, contract_list } = body;
  if (!assigner || !assigner.email || !consumer || !consumer.email) {
    return { status: 400, body: { ok: false, msg: "Both assigner and consumer information with emails are required" } };
  }
  if (!contract_list || contract_list.length === 0) {
    return { status: 400, body: { ok: false, msg: "Contract list is required" } };
  }
  if (!EMAIL_REGEX.test(assigner.email) || !EMAIL_REGEX.test(consumer.email)) {
    return { status: 400, body: { ok: false, msg: "Invalid email format" } };
  }
  return null;
};
const buildConsumerDocumentSigningCompletionMessages = (body) => {
  const { assigner, consumer, contract_list, verification_id } = body;
  return [
    {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: `${assigner.name || "Assigner"} <${assigner.email}>`,
      subject: "Document Signing Complete - Equipment Ready for Delivery",
      html: documentSigningCompletionConsumerLeaseMessageHtml({ recipientType: "assigner", consumer, contract_list, verification_id }),
    },
    {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: `${consumer.name || "Consumer"} <${consumer.email}>`,
      subject: "Document Signing Complete - Awaiting Equipment Delivery",
      html: documentSigningCompletionConsumerLeaseMessageHtml({ recipientType: "consumer", consumer, contract_list, verification_id }),
    },
  ];
};
const consumerDocumentSigningCompletionNotification = createQueuedEmailController(buildConsumerDocumentSigningCompletionMessages, {
  validate: validateConsumerDocumentSigningCompletion,
});

const buildLoginActivityMessage = (adminUser, loginInfo) => {
  // Sanitiza componentes del mensaje (evita inyección de markup en el HTML del correo).
  const sanitizedName = (adminUser.name || "").replace(/[<>]/g, "");
  const sanitizedLastName = (adminUser.lastName || "").replace(/[<>]/g, "");
  const sanitizedEmail = adminUser.email.trim();
  const sanitizedAdminUser = {
    ...adminUser,
    name: sanitizedName,
    lastName: sanitizedLastName,
    email: sanitizedEmail,
    company: (adminUser.company || "Unknown").replace(/[<>]/g, ""),
    role: (adminUser.role || "Admin").replace(/[<>]/g, ""),
  };

  return {
    from: "Devitrak Notifications <noreply@devitrak.com>",
    bcc: "grodriguez@devitrak.com",
    to: sanitizedEmail, // Use just the email address to avoid formatting issues
    subject: `Login Activity Alert - ${sanitizedAdminUser.email}`, // Remove emoji that might cause issues
    html: loginActivityNotificationMessageHtml({
      adminUser: sanitizedAdminUser,
      loginInfo: { ...loginInfo },
    }),
  };
};

// Función interna (no HTTP) invocada desde controller/admin.js dentro de un
// setImmediate — ya es fire-and-forget respecto a la respuesta de login. Se
// encola en vez de enviar inline; el contrato para el caller no cambia: nunca
// lanza, siempre devuelve {success, message, ...}. Sin `context` de auditoría:
// adminUser ya es el sujeto del mensaje (mismo criterio que logStaffActivity).
const loginActivityNotification = async (adminUser, loginInfo, { enqueueFn = enqueue } = {}) => {
  try {
    if (!adminUser || !adminUser.email) {
      throw new Error("Admin user email is required");
    }
    if (!loginInfo) {
      throw new Error("Login info is required");
    }

    const msg = buildLoginActivityMessage(adminUser, loginInfo);
    const job = await enqueueFn("send-email", msg);

    return {
      success: true,
      message: `Login activity notification queued for ${msg.to}`,
      jobId: job.id,
    };
  } catch (error) {
    logger.error("Error queuing login activity notification:", error);
    return {
      success: false,
      message: "Failed to queue login activity notification",
      error: error.message,
      details: error.response?.body || null,
    };
  }
};

const validateConsumerLeaseEndedDeviceReturned = (body) => {
  const { consumer, devices, returnDate } = body;
  if (!consumer || !consumer.email || !devices || !returnDate) {
    return { status: 400, body: { ok: false, msg: "Consumer, devices, and return date are required" } };
  }
  if (!EMAIL_REGEX.test(consumer.email)) {
    return { status: 400, body: { ok: false, msg: "Invalid email format" } };
  }
  return null;
};
const buildConsumerLeaseEndedDeviceReturnedMessage = (body) => {
  const { consumer, devices, returnDate } = body;
  return {
    from: "Devitrak Notifications <noreply@devitrak.com>",
    to: `${consumer.name || "Consumer"} <${consumer.email}>`,
    subject: "Lease - Device Returned Notification",
    html: consumerLeaseEndedDeviceReturnedNotificationMessageHtml({ consumer, devices, returnDate }),
  };
};
const consumerLeaseEndedDeviceReturnedNotification = createQueuedEmailController(buildConsumerLeaseEndedDeviceReturnedMessage, {
  validate: validateConsumerLeaseEndedDeviceReturned,
});

const buildCompletedTaskMessage = () => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `grodriguez@devitrak.com`,
  subject: "Task - Completed Notification",
  html: `<p>SUCCESS</p>`,
});
const completedTask = createQueuedEmailController(buildCompletedTaskMessage);

const buildFailedTaskMessage = () => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `grodriguez@devitrak.com`,
  subject: "Task - Failed Notification",
  html: `<p>FAILED</p>`,
});
const failedTask = createQueuedEmailController(buildFailedTaskMessage);

const buildForcingRevokingActiveSessionMessage = (body) => ({
  from: "Devitrak Notifications <noreply@devitrak.com>",
  to: `${body.email}`,
  subject: "Action Required: End Your Active Session",
  html: forceLogoutNotificationHtmlTemplate(body.email),
});
const forcingRevokingActiveSession = createQueuedEmailController(buildForcingRevokingActiveSessionMessage);

const buildMemberEmailMessage = (body) => ({
  to: body.consumer,
  from: "Devitrak Notifications <noreply@devitrak.com>",
  subject: `${body.subject} - Power by Devitrak`,
  html: memberEmailNotificationHtml(body),
});
const memberEmailNotification = createQueuedEmailController(buildMemberEmailMessage);

const buildCustomizeMessage = (body) => ({
  to: body.staff,
  from: "Devitrak Notifications <noreply@devitrak.com>",
  subject: `Devitrak Notification - ${body.subject}`,
  html: customizeMessageHtml(body),
});
const customizeMessage = createQueuedEmailController(buildCustomizeMessage);


module.exports = {
  assingDeviceNotification,
  buildAssignDeviceMessage,
  buildLoginActivityMessage,
  buildErrorFeedbackMessage,
  createBuildMassiveEventCustomerMessage,
  createBuildDevitrakFeedbackMessage,
  validateReturnedItemsToRenter,
  createBuildReturnedItemsToRenterMessage,
  buildCancelDepositMessage,
  buildCaptureDepositMessage,
  buildChargeInvoiceMessage,
  buildCompletedTaskMessage,
  buildConfirmationLinkNewConsumerMessage,
  buildCustomizedEmailMessage,
  buildDeviceReportPerTransactionMessage,
  buildEarlierReturningMessage,
  buildEditingDeviceAdminMessage,
  buildEventBeginsReminderMessage,
  buildEventLinkEventMessage,
  buildEventStaffMessage,
  buildFailedTaskMessage,
  buildForcingRevokingActiveSessionMessage,
  buildInternalNotificationMessage,
  buildItemInfoStaffMessage,
  buildLinkToResetPasswordMessage,
  buildLoginLinkExistingConsumerMessage,
  buildMemberEmailMessage,
  buildNewUserInvitationMessage,
  buildRefundInvoiceMessage,
  buildReturningDeviceLeaseMemberMessage,
  buildMemberDeviceIncidentMessage,
  buildMemberDeviceFeeReceiptMessage,
  validateMemberDeviceIncident,
  validateMemberDeviceFeeReceipt,
  memberDeviceIncidentNotification,
  memberDeviceFeeReceiptNotification,
  buildReturningDeviceMessage,
  buildSingleEmailMessage,
  buildStaffInternalMessage,
  buildConsumerDocumentSigningCompletionMessages,
  buildConsumerLeaseEndedDeviceReturnedMessage,
  buildDocumentSigningCompletionMessages,
  buildLiabilityContractConsumerMessage,
  buildLiabilityContractMemberMessage,
  buildLiabilityContractStaffMessage,
  buildLostDeviceFeeMessage,
  buildTermsAndConditionsAcceptanceMessage,
  validateConsumerDocumentSigningCompletion,
  validateConsumerLeaseEndedDeviceReturned,
  validateDocumentSigningCompletion,
  validateLiabilityContractConsumer,
  validateLiabilityContractMember,
  validateLiabilityContractStaff,
  validateLostDeviceFee,
  validateTermsAndConditionsAcceptance,
  cancelDepositNotification,
  captureDepositNotification,
  chargeInvoice,
  completedTask,
  confirmationLinkNewConsumerNotification,
  consumerDocumentSigningCompletionNotification,
  consumerLeaseEndedDeviceReturnedNotification,
  customizedEmailNotification,
  deviceReportPerTransaction,
  devitrakFeedbackEmailNotification,
  documentSigningCompletionNotification,
  earlierReturningNotification,
  editingDeviceAdminNotification,
  eventBeginsReminderNotification,
  eventLinkEvent,
  eventStaffNotification,
  failedTask,
  forcingRevokingActiveSession,
  internalNotification,
  itemInfoStaffNotification,
  liabilityContractConsumerNotification,
  liabilityContractMemberNotification,
  liabilityContractStaffNotification,
  linkToResetPassword,
  loginActivityNotification,
  loginLinkExistingConsumerNotification,
  lostDeviceFeeCollectedNotification,
  massiveEventCustomerNotification,
  memberEmailNotification,
  newUserInvitationNotification,
  refundInvoice,
  returnedItemsToRenterNotification,
  returningDeviceLeaseMemberNotification,
  returningDeviceNotification,
  singleEmailNotification,
  staffInternalNotification,
  termsAndConditionsAcceptanceNotification,
  buildCustomizeMessage,
  customizeMessage,
};
