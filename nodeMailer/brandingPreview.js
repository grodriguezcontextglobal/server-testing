'use strict';

/**
 * Renders a notification email with branding that has not been saved yet, so
 * the settings page can show the client what their mail will actually look
 * like before they commit to it. Nothing is sent and nothing is queued.
 *
 * Answers with the finished HTML plus the From line, because the from-name is
 * half of what a recipient sees and is not visible anywhere in the body.
 */

const { DEVITRAK_BRANDING, normalizeBranding, formatSender } = require("./branding");
const {
  returnConfirmationLeaseMemberMessageHtml,
  assigningDeviceMessageHtml,
  confirmationNewConsumerAccountMessageHtml,
  lostDeviceFeeCollectedMessageHtml,
  liabilityContractMemberNotificationMessageHtml,
  staffInternalNotificationMessageHtml,
} = require("./returningDeviceMessage");
const logger = require("../helpers/logger");

/**
 * Sample payloads for the previewable templates. Deliberately generic — the
 * preview must never reach into a real transaction, which would leak one
 * family's device history into another admin's settings screen.
 */
const SAMPLES = {
  device_returned: {
    label: "Device returned receipt",
    subject: "Returned device notification",
    render: (branding) =>
      returnConfirmationLeaseMemberMessageHtml(
        {
          member: { firstName: "Jordan", lastName: "Reyes", email: "guardian@example.com" },
          devices: [
            { device: { deviceType: "Laptops", serialNumber: "SAMPLE-0001" } },
            { device: { deviceType: "Chargers", serialNumber: "SAMPLE-0002" } },
          ],
        },
        branding
      ),
  },
  device_assigned: {
    label: "Device assignment receipt",
    subject: "Assignment device notification",
    render: (branding) =>
      assigningDeviceMessageHtml(
        {
          consumer: { firstName: "Jordan", lastName: "Reyes", email: "guardian@example.com" },
          devices: [
            { deviceType: "Laptops", serialNumber: "SAMPLE-0001", paymentIntent: "SAMPLE-TX-01" },
          ],
          link: "https://admin.devitrak.net",
        },
        branding
      ),
  },
  account_confirmation: {
    label: "Account confirmation",
    subject: "Confirmation link account",
    render: (branding) =>
      confirmationNewConsumerAccountMessageHtml(
        {
          event: "Fall term",
          company: branding.isDefault ? "Devitrak" : branding.displayName,
          link: "https://admin.devitrak.net",
        },
        branding
      ),
  },
  contract_to_sign: {
    label: "Liability contract to sign",
    subject: "Device Liability Contract",
    render: (branding) =>
      liabilityContractMemberNotificationMessageHtml(
        {
          company_name: branding.isDefault ? "Devitrak" : branding.displayName,
          email_admin: branding.replyTo,
          member: { name: "Jordan Reyes", email: "guardian@example.com", member_id: "SAMPLE-M1" },
          contract_list: [
            { title: "Device liability agreement", view_url: "https://example.com/sample-contract.pdf" },
          ],
          items: [{ serial_number: "SAMPLE-0001", type: "Laptop", item_id: "SAMPLE-I1" }],
          subject: "Device Liability Contract",
          company_id: "SAMPLE",
          date_reference: new Date().toISOString().slice(0, 10),
          verification_id: "SAMPLE-V1",
        },
        branding
      ),
  },
  staff_assignment: {
    label: "Staff event assignment",
    subject: "Staff assignment notification",
    render: (branding) =>
      staffInternalNotificationMessageHtml(
        {
          subject: "You have been assigned to an event",
          company: branding.isDefault ? "Devitrak" : branding.displayName,
          staffMember: "Jordan Reyes",
          eventInfo: {
            eventName: "Fall term device handout",
            dateBegin: new Date().toLocaleDateString("en-US"),
            address: "Main campus",
          },
          contactInfo: { name: "the event coordinator", email: branding.replyTo || "staff@example.com" },
        },
        branding
      ),
  },
  lost_device_fee: {
    label: "Lost device fee",
    subject: "Lost device fee receipt",
    render: (branding) =>
      lostDeviceFeeCollectedMessageHtml(
        {
          amount: "250.00",
          event: "Fall term",
          company: branding.isDefault ? "Devitrak" : branding.displayName,
          date: new Date().toLocaleDateString("en-US"),
          transaction: "SAMPLE-TX-01",
          device: { deviceType: "Laptops", serialNumber: "SAMPLE-0001" },
        },
        branding
      ),
  },
};

const previewBranding = async (request, response) => {
  try {
    const { branding: draft, template = "device_returned" } = request.body ?? {};

    const sample = SAMPLES[template];
    if (!sample) {
      return response.status(400).json({
        ok: false,
        msg: `Unknown template '${template}'`,
        templates: Object.keys(SAMPLES),
      });
    }

    // The draft arrives in the shape the settings form holds, which is the
    // shape Company.email_branding stores — so it goes through exactly the same
    // normalizer a real send uses. A preview built any other way would be a
    // second implementation, free to drift from the mail people receive.
    const branding =
      draft && draft.enabled
        ? normalizeBranding({
            _id: request.body?.company_id,
            company_name: request.body?.company_name,
            company_logo: request.body?.company_logo,
            main_email: request.body?.main_email,
            website: request.body?.website,
            email_branding: draft,
          })
        : DEVITRAK_BRANDING;

    return response.status(200).json({
      ok: true,
      template,
      label: sample.label,
      subject: sample.subject,
      from: branding.isDefault
        ? "Devitrak Notifications <noreply@devitrak.com>"
        : formatSender(branding.displayName),
      replyTo: branding.replyTo || null,
      html: sample.render(branding),
    });
  } catch (error) {
    logger.error("previewBranding failed", { error: error.message });
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

const listPreviewTemplates = (_request, response) =>
  response.status(200).json({
    ok: true,
    templates: Object.entries(SAMPLES).map(([key, { label }]) => ({ key, label })),
  });

module.exports = { previewBranding, listPreviewTemplates, SAMPLES };
