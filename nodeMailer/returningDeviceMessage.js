const logger = require("../helpers/logger");
const {
  renderBrandedEmail,
  paragraph,
  sectionHeading,
  button,
  dataTable,
  summaryList,
  callout,
  divider,
  escapeHtml,
  safeUrl,
} = require("./emailLayout");
const { DEVITRAK_EMAIL_ICON_URL, DEVITRAK_EMAIL_NAME_URL } = require("./branding");

/**
 * Receipts are dated in en-US explicitly rather than by server locale: these
 * go to US schools and rental clients, and a receipt that reads 28/08/2026 on
 * one deploy and 8/28/2026 on the next is a support ticket.
 */
const receiptDate = () => new Date().toLocaleDateString("en-US");

/**
 * Whose account/app the copy is talking about. Unbranded companies still read
 * "a Devitrak account"; a branded one reads their own name.
 */
const brandName = (branding) =>
  branding && branding.isDefault === false && branding.displayName
    ? branding.displayName
    : "Devitrak";

/** Payload device lists arrive as an array, a bare object, or missing entirely. */
const asArray = (value) =>
  Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];

/**
 * Handed a device: the receipt the person who now holds it gets.
 */
const assigningDeviceMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: "Devices Assignment Receipt",
    greeting: `Dear ${props.consumer.firstName} ${props.consumer.lastName},`,
    intro:
      "This email confirms that all devices shown have been assigned successfully from the transaction below.",
    blocks: [
      dataTable({
        columns: [
          { header: "Device", key: "deviceType" },
          { header: "Serial number", key: "serialNumber" },
          { header: "Transaction ID", key: "transactionId" },
          { header: "Date", key: "date" },
        ],
        rows: asArray(props.devices).map((device) => ({
          deviceType: device.deviceType,
          serialNumber: device.serialNumber,
          transactionId: device.paymentIntent,
          date: receiptDate(),
        })),
      }),
    ],
    cta: { label: "Open app", href: props.link },
  });

/**
 * Devices came back, event/transaction flow. The consumer-side twin of
 * returnConfirmationLeaseMemberMessageHtml.
 */
const returnConfirmationMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: "Devices Returned Receipt",
    greeting: `Dear ${props.consumer.firstName} ${props.consumer.lastName},`,
    intro:
      "This email confirms that all devices shown have been returned successfully from the transaction below.",
    blocks: [
      dataTable({
        columns: [
          { header: "Device type", key: "deviceType" },
          { header: "Serial number", key: "serialNumber" },
          { header: "Transaction ID", key: "transactionId" },
          { header: "Date", key: "date" },
        ],
        rows: asArray(props.devices).map((device) => ({
          deviceType: device.device?.deviceType,
          serialNumber: device.device?.serialNumber,
          transactionId: device.paymentIntent,
          date: receiptDate(),
        })),
      }),
    ],
    cta: { label: "Open app", href: props.link },
  });

/** The hold on a card is let go. */
const cancelingDepositMessageHtml = (props, branding) => {
  logger.info(props);
  return renderBrandedEmail({
    branding,
    title: "Deposit released confirmation",
    preheader: "Deposit released confirmation details inside",
    intro: `This email confirms that the $${props.amount} deposit has been released and returned to you from the transaction detailed below.`,
    blocks: [
      summaryList([
        { label: "Event", value: props.event },
        { label: "Company", value: props.company },
        { label: "Date", value: props.date },
        { label: "Time", value: props.time },
        { label: "Transaction ID", value: props.transaction },
      ]),
      callout({
        tone: "info",
        title: "What to expect",
        body: `In the application you will be able to request new devices, review your transactions, request support, and get answers to frequently asked questions. For any specific questions please contact the staff at ${props.company}.`,
      }),
    ],
  });
};

/** The hold on a card is charged, because devices did not come back. */
const capturingDepositMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: "Deposit captured confirmation",
    preheader: "Deposit captured confirmation details inside",
    intro: `This email confirms that $${props.amount} of your deposit has been charged due to the lost devices from the transaction detailed below.`,
    blocks: [
      summaryList([
        { label: "Event", value: props.event },
        { label: "Company", value: props.company },
        { label: "Date", value: props.date },
        { label: "Time", value: props.time },
        { label: "Transaction ID", value: props.transaction },
      ]),
      callout({
        tone: "info",
        title: "What to expect",
        body: `In the application you will be able to request new devices, review your transactions, request support, and get answers to frequently asked questions. For any specific questions please contact the staff at ${props.company}.`,
      }),
    ],
  });

/** A fee was charged for a device that was not returned. */
const lostDeviceFeeCollectedMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: "Lost device fee receipt",
    intro: `This email confirms that $${props.amount} has been charged due to the lost devices from the transaction detailed below.`,
    blocks: [
      summaryList([
        { label: "Event", value: props.event },
        { label: "Company", value: props.company },
        { label: "Date and time", value: props.date },
        { label: "Transaction ID", value: props.transaction },
        {
          label: "Device",
          value: `${props.device?.deviceType ?? props.type} | ${props.device?.serialNumber ?? props.device
            }`,
        },
      ]),
    ],
  });

/**
 * Receipt for a lost-device fee that was actually paid. Takes the normalizer
 * as an argument because the payload shapes for this one are a museum — see
 * normalizeLostFeePayload in notifications.js.
 */
const lostDeviceFeeReceipt = (props = {}, normalizeLostFeePayload, branding) => {
  const data = normalizeLostFeePayload(props);

  return renderBrandedEmail({
    branding,
    title: "Lost device fee payment receipt",
    greeting: `Hello ${data.consumerName},`,
    intro: `This email confirms that your lost device fee payment was collected for ${data.event} with ${data.company}.`,
    blocks: [
      summaryList([
        { label: "Device", value: data.deviceType },
        { label: "Serial number", value: data.serialNumber },
        { label: "Amount", value: `$${Number(data.amount).toFixed(2)}` },
        { label: "Transaction", value: data.transaction },
        { label: "Date", value: `${data.date} ${data.time}` },
      ]),
    ],
    cta:
      data.link && data.link !== "#"
        ? { label: "View transaction", href: data.link }
        : undefined,
  });
};

/** First contact: confirm the account we just created for you. */
const confirmationNewConsumerAccountMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: "Please confirm your account",
    intro: `Please click the button below to confirm your account and manage your devices and transactions at ${props.event} with ${props.company}.`,
    cta: { label: "Confirm account", href: props.link },
    blocks: [
      callout({
        tone: "info",
        title: "What to expect",
        body: `In the application you will be able to request new devices, review your transactions, request support, and get answers to frequently asked questions. For any specific questions please contact the staff at ${props.company}.`,
      }),
    ],
  });

/** Passwordless return visit. */
const linkToLoginExistingConsumerMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: "Welcome back!",
    intro: `Please click the button below to log in and manage your devices and transactions in ${props.event ? props.event.eventInfoDetail.eventName : "this event"
      } with ${props.company}.`,
    cta: { label: "Log in", href: props.link },
    blocks: [
      callout({
        tone: "info",
        title: "What to expect",
        body: `In the application you will be able to request new devices, review your transactions, request support, and get answers to frequently asked questions. For any specific questions please contact the staff at ${props.company}.`,
      }),
    ],
  });

/**
 * Password reset for an admin-dashboard account. Devitrak's own mail.
 * The dashboard posts the URL as `linkToResetPassword`; `link` is kept because
 * it is what every other chassis template reads.
 */
const linkToResetUserPassword = (props) =>
  renderBrandedEmail({
    title: "Reset your password",
    intro: "Please click the button below to reset your password to Devitrak.",
    cta: { label: "Reset password", href: props.linkToResetPassword ?? props.link },
  });

const newUserInvitationMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: `Invitation to create a ${brandName(branding)} account`,
    intro: `You are invited to create a ${brandName(
      branding
    )} account. Please click the button to accept the invitation.`,
    cta: { label: "Accept invitation", href: props.link },
  });

/** Free-text blast to every consumer on an event. */
const customizedEmailMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: `Message from ${props.company}`,
    intro: `This email was sent from ${props.company} related to the event ${props.eventSelected}.`,
    blocks: [paragraph(props.message)],
  });

/** The same, to one recipient. */
const singleEmailMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: `Message from ${props.company}`,
    intro: `This email was sent from ${props.company}${props.eventSelected && props.eventSelected.length > 0
      ? ` related to the event ${props.eventSelected}`
      : ""
      }.`,
    blocks: [paragraph(props.message)],
  });

/** A device was deleted from the record; the company's admins are told. */
const staffNotificationMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: `Device deleted from ${props.company} record.`,
    intro: `This email notification was sent from ${props.company}.`,
    blocks: [paragraph(props.message)],
  });

/** Somebody has been put on the staff list for an event. */
const staffInternalNotificationMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: `${props.subject}.`,
    greeting: `Dear ${props.staffMember},`,
    intro: [
      `This email notification was sent from ${props.company}.`,
      `We are pleased to inform you that you have been assigned as a staff member for the upcoming event, ${props.eventInfo.eventName}, organized by ${props.company}. The event will take place on ${props.eventInfo.dateBegin} and will be held at ${props.eventInfo.address}. Your role will be integral to the success of this event, and we are confident in your abilities to contribute positively. Further details regarding your specific responsibilities and tasks will be provided soon.`,
    ],
    blocks: [
      paragraph(
        `For any questions or additional information, please feel free to contact ${props.contactInfo.name}, who is overseeing the event, at ${props.contactInfo.email}. We look forward to your participation and collaboration.`
      ),
      paragraph("Best regards"),
    ],
  });

/** Countdown nudge to the staff working an event. */
const eventBeginsReminderHtmlMessage = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: "Upcoming Event Reminder",
    greeting: "Dear staff member,",
    intro: `This is a reminder that the event: ${props.event} is ${props.daysToEvent} days away.`,
    blocks: [paragraph(props.message)],
  });

const editingDeviceAdminMessageHtml = (props) => {
  return ``;
};

const returnReminderMessageHtml = (props) => {
  return ``;
};

/** A bug report on its way to Devitrak's own development team. */
const reportBugMessageHtml = (props) =>
  renderBrandedEmail({
    title: "Bug email notification",
    greeting: "Dear development team,",
    intro: "This is a notification of a bug found and reported.",
    blocks: [paragraph(props.message)],
  });

const itemInfoStaffNotificationMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: `${props.subject}.`,
    intro: `This email notification was sent from ${props.company}.`,
    blocks: [
      paragraph(props.message),
      paragraph(
        `For any questions or additional information, please feel free to contact ${props.contactInfo.staff}, at ${props.contactInfo.email}.`
      ),
      paragraph("Best regards"),
    ],
  });

const eventLinkEventHtml = (props, branding) => {
  const walkthrough =
    "https://res.cloudinary.com/dpdzkhh07/image/upload/v1730138049/giphy_pbroif.gif";

  return renderBrandedEmail({
    branding,
    title: "Get Started with the Devitrak Consumer App!",
    intro: `The Devitrak Consumer App allows event participants to reserve and manage devices before the event starts (${props.eventName}). Simply access the event link, explore available devices, and make your requests with ease.`,
    blocks: [
      paragraph(
        `<a href="${walkthrough}" target="_blank" style="text-decoration: none;"><img src="${walkthrough}" alt="Watch the Devitrak Consumer App overview" width="160" style="display: block; border: 0; border-radius: 8px; max-width: 160px;" /></a>`,
        { html: true }
      ),
      paragraph("Click the image above to watch an introduction to the app.", {
        muted: true,
      }),
      paragraph(
        "See how our app can simplify your experience and give you control over device management at events."
      ),
      paragraph(
        `For questions or additional help, contact ${props.contactInfo.staff} at ${props.contactInfo.email}.`
      ),
    ],
    cta: { label: "Access Event Link", href: props.buttonLink },
  });
};

const serviceChargeInvoiceEmailHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: "Payment Confirmation",
    intro: [
      `We are pleased to confirm that your payment of $${props.amount} has been successfully processed on ${props.date}.`,
      "Below, you'll find the details of your payment for your records:",
    ],
    blocks: [
      summaryList([
        { label: "Confirmation Code", value: props.paymentIntent },
        { label: "Name", value: props.customer },
        { label: "Charge Applied", value: props.service },
      ]),
      paragraph("Please keep this email for your personal records."),
    ],
  });

/** Money going back the other way. */
const serviceRefundConfirmationEmailHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: "Refund Confirmation",
    intro: [
      `This email was sent from ${props.company} regarding the refund for the event ${props.event}.`,
      `We are pleased to confirm that the amount of $${props.amount} has been successfully refunded on ${props.date}.`,
    ],
    blocks: [
      summaryList([
        { label: "Confirmation Code", value: props.paymentIntent },
        { label: "Name", value: props.customer },
        { label: "Refund Amount", value: `$${props.amount}` },
      ]),
      props.message ? paragraph(props.message) : "",
      paragraph("Please keep this email for your records."),
    ],
  });

const deviceReportPerTransactionMessageHtml = (props, branding) => {
  const renderStatus = (status) => {
    if (typeof status === "string") return status;
    return status ? "In-use" : "Returned";
  };

  return renderBrandedEmail({
    branding,
    title: "Devices Report Per Transaction",
    greeting: `Dear ${props.consumer.firstName} ${props.consumer.lastName},`,
    intro:
      "This email confirms that all devices shown have been assigned successfully to the transaction below.",
    blocks: [
      dataTable({
        columns: [
          { header: "Device", key: "deviceType" },
          { header: "Serial number", key: "serialNumber" },
          { header: "Status", key: "status" },
          { header: "Transaction ID", key: "transactionId" },
          { header: "Date", key: "date" },
        ],
        rows: asArray(props.devices).map((device) => ({
          deviceType: device.device?.deviceType,
          serialNumber: device.device?.serialNumber,
          status: renderStatus(device.device?.status),
          transactionId: device.paymentIntent,
          date: receiptDate(),
        })),
      }),
    ],
    cta: { label: "Open app", href: props.link },
  });
};

/** Devitrak asking a consumer how it went. Devitrak's own mail, by definition. */
const devitrakFeedbackEmailMessageHtml = ({ props }) =>
  renderBrandedEmail({
    title: "Hi,",
    intro: [
      "Thank you for using Devitrak to manage your devices! We’d love to hear about your experience. Your feedback helps us improve and ensure a seamless process for future events.",
      "It only takes 2 minutes to complete the survey!",
    ],
    cta: { label: "Give feedback now", href: props.link },
    blocks: [
      paragraph(
        "We appreciate your time and look forward to serving you even better next time."
      ),
      paragraph("– The Devitrak Team"),
    ],
  });

/**
 * One-off bilingual survey for NRFF interpretation services at the Javits
 * Center. Portuguese first, then English, as it shipped — the audience reads
 * Portuguese and the English is the courtesy translation.
 */
const nrffInterpretationFeedbackEmailMessageHtml = () => {
  const surveyUrl = "https://forms.office.com/r/1L8bZ4XW6T";
  const surveyLink = (label) =>
    `${label}<br/><a href="${surveyUrl}" target="_blank" style="color: #155eef; font-weight: 600;">${surveyUrl}</a>`;

  return renderBrandedEmail({
    title: "Prezado usuário da NRFF e dos serviços de interpretação,",
    preheader: "Pesquisa de satisfação / Satisfaction survey",
    intro:
      "Obrigado por utilizar os serviços de interpretação no Javits Center de 13 a 15 de janeiro. Elaboramos uma pesquisa para saber se você gostou dos serviços e como podemos oferecer serviços melhores nos próximos anos. Por favor, reserve um momento para preencher a pesquisa para que possamos usá-la para melhorar as ofertas de serviços. Como recompensa, estamos distribuindo dois cartões-presente da Amazon para duas pessoas que enviarem respostas à nossa pesquisa.",
    blocks: [
      paragraph("Obrigado por sua ajuda!"),
      paragraph(surveyLink("Clique no link para responder à pesquisa:"), { html: true }),
      divider(),
      paragraph("Dear NRFF and Interpretation Services user,"),
      paragraph(
        "Thank you for using interpretation services at the Javits Center from January 13-15. We have put together a survey to determine whether you enjoyed the services and how we can offer better services in the years to come. Please take a moment to fill out our survey so that we can use it to potentially improve the service offerings. As a reward, we are giving away two Amazon gift cards to two people who submit answers to our survey."
      ),
      paragraph("Thank you for your help!"),
      paragraph(surveyLink("Please click the link to take the survey:"), { html: true }),
      paragraph(
        "We appreciate your time and look forward to serving you even better next time."
      ),
      paragraph("– Interpretation Services Team"),
    ],
  });
};

const liabilityContractStaffNotificationMessageHtml = (props, branding) => {
  const {
    company_name,
    email_admin,
    staff,
    contract_list,
    items,
    subject,
    company_id,
    date_reference,
    verification_id,
  } = props;

  return renderLiabilityContractEmail({
    branding,
    subject,
    company_name,
    email_admin,
    contract_list,
    items,
    recipient: staff,
    recipientHeading: "Staff member information",
    contractLinkParams: {
      company_id,
      date_reference,
      verification_id,
      staff_member_id: staff.staff_member_id,
    },
  });
};

const renderLiabilityContractEmail = ({
  branding,
  subject,
  company_name,
  email_admin,
  contract_list,
  items,
  recipient,
  recipientHeading,
  contractLinkParams,
}) => {
  const itemList = asArray(items);

  const itemIdsParam = Array.from(
    new Set(
      itemList
        .map((item) => item.item_id ?? item.id ?? item.key ?? item.serial_number)
        .filter(Boolean)
    )
  )
    .map((id) => encodeURIComponent(id))
    .join(",");

  const contractHref = (contract) => {
    const query = Object.entries({
      ...contractLinkParams,
      contract_url: contract.view_url,
      item_ids: itemIdsParam,
    })
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    return `https://admin.devitrak.net/display-contracts?${query}`;
  };

  return renderBrandedEmail({
    branding,
    title: subject,
    preheader: "Action required: sign your liability contracts before device pickup.",
    greeting: `Dear ${recipient.name},`,
    blocks: [
      callout({
        tone: "warning",
        title: "Action required",
        html: true,
        body: `<p style="margin: 0 0 8px 0;">To receive your assigned device, you must sign the liability contracts linked in this email.</p>
                  <ul style="margin: 0; padding-left: 18px;">
                    <li>Open each contract using the "View" link provided.</li>
                    <li>Complete the signature workflow for all contracts listed.</li>
                    <li>Devices will not be issued until all contracts are signed.</li>
                  </ul>`,
      }),
      paragraph(
        "This email contains important liability information for device assignments. You must sign all contracts before device pickup or usage."
      ),
      sectionHeading(recipientHeading),
      summaryList([
        { label: "Name", value: recipient.name },
        { label: "Email", value: recipient.email },
      ]),
      sectionHeading("Liability contracts"),
      paragraph(
        "You must open each link and complete the signature for every contract listed below:"
      ),
      dataTable({
        columns: [
          { header: "Contract title", key: "title" },
          { header: "Sign & open", key: "link", html: true },
        ],
        rows: asArray(contract_list).map((contract) => ({
          title: contract.title,
          link: `<a href="${safeUrl(
            contractHref(contract)
          )}" target="_blank" style="color: #155eef; font-weight: 600;">View</a>`,
        })),
      }),
      sectionHeading("Assigned device information"),
      paragraph("The following devices have been assigned to you:"),
      dataTable({
        columns: [
          { header: "Serial number", key: "serialNumber" },
          { header: "Device type", key: "deviceType" },
        ],
        rows: itemList.map((item) => ({
          serialNumber: item.serial_number,
          deviceType: item.type,
        })),
      }),
      callout({
        tone: "info",
        title: "Important notes",
        html: true,
        body: `<ul style="margin: 0; padding-left: 18px;">
                    <li>Devices will not be issued until all contracts are signed.</li>
                    <li>Use each "View" link above to sign and retain a copy.</li>
                    <li>Contact the administrator if you have any questions about the contracts or device assignments.</li>
                    <li>Report any device issues immediately to avoid liability concerns.</li>
                  </ul>`,
      }),
      paragraph(
        email_admin
          ? `If you have any questions or concerns regarding these contracts or device assignments, please contact the administrator at ${email_admin}.`
          : "If you have any questions or concerns regarding these contracts or device assignments, please contact the administrator."
      ),
      paragraph("Thank you for your prompt attention to this matter."),
      paragraph(
        company_name ? `Best regards,\n${company_name} Administration Team` : "Best regards"
      ),
    ],
  });
};

/**
 * Contracts a consumer must sign.
 *
 * The consumer and member variants differ only in which id the contract link
 * carries (`consumer_member_id` vs `staff_member_id`) and in the recipient
 * heading; everything else is shared through renderLiabilityContractEmail.
 */
const liabilityContractConsumerNotificationMessageHtml = (props, branding) => {
  const {
    company_name,
    email_admin,
    consumer,
    contract_list,
    items,
    subject,
    company_id,
    date_reference,
    verification_id,
  } = props;

  return renderLiabilityContractEmail({
    branding,
    subject,
    company_name,
    email_admin,
    contract_list,
    items,
    recipient: consumer,
    recipientHeading: "Consumer member information",
    contractLinkParams: {
      company_id,
      date_reference,
      verification_id,
      consumer_member_id: consumer.consumer_member_id,
    },
  });
};

/**
 * Contracts a staff member must sign.
 *
 * The consumer and member variants differ only in which id the contract link
 * carries (`consumer_member_id` vs `staff_member_id`) and in the recipient
 * heading; everything else is shared through renderLiabilityContractEmail.
 */
const liabilityContractMemberNotificationMessageHtml = (props, branding) => {
  const {
    company_name,
    email_admin,
    member,
    contract_list,
    items,
    subject,
    company_id,
    date_reference,
    verification_id,
  } = props;

  return renderLiabilityContractEmail({
    branding,
    subject,
    company_name,
    email_admin,
    contract_list,
    items,
    recipient: member,
    recipientHeading: "Member information",
    contractLinkParams: {
      company_id,
      date_reference,
      verification_id,
      staff_member_id: member.member_id,
    },
  });
};

/**
 * Rented gear went back to the supplier; the company's admins get the record.
 * The item list itself travels as an Excel attachment (see the S3 note in
 * notifications.js), so this email carries only the supplier and the summary.
 */
const returnedItemsToRenterNotificationMessageHtml = (props, branding) => {
  const supplier = props.supplierInfo;
  const longDate = () =>
    new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  return renderBrandedEmail({
    branding,
    title: "Items returned to rental company",
    preheader: "Rented items have gone back to the supplier. Details attached.",
    greeting: "Dear Admin Team,",
    intro:
      "This is an automated notification to inform you that rented items have been returned to the rental company. Please find the rental company details below and check the attached Excel file for the complete list of returned items.",
    blocks: [
      callout({
        tone: "warning",
        title: "Admin notification",
        body: "Rented items have been returned to the renter. Please review the attached spreadsheet for detailed information and take appropriate action if needed.",
      }),
      supplier ? sectionHeading("Rental company information") : "",
      supplier
        ? summaryList([
          { label: "Company", value: supplier.companyName },
          { label: "Industry", value: supplier.industry },
          {
            label: "Services",
            value: Array.isArray(supplier.services) ? supplier.services.join(", ") : "",
          },
          {
            label: "Address",
            value: [
              supplier.address?.street,
              [supplier.address?.city, supplier.address?.state, supplier.address?.postalCode]
                .filter(Boolean)
                .join(" "),
              supplier.address?.country,
            ]
              .filter(Boolean)
              .join(", "),
          },
          { label: "Email", value: supplier.contactInfo?.email },
          { label: "Phone", value: supplier.contactInfo?.phone },
          { label: "Website", value: supplier.contactInfo?.website },
        ])
        : "",
      summaryList([
        { label: "Date", value: longDate() },
        { label: "Time", value: new Date().toLocaleTimeString("en-US") },
      ]),
      callout({
        tone: "info",
        title: "Returned items details",
        body: "Please check the attached Excel spreadsheet for the complete list of returned items including serial numbers, item groups, and status information.",
      }),
      paragraph(
        "This is an automated notification. Please do not reply to this email. For any questions or concerns, please contact the system administrator.",
        { muted: true }
      ),
    ],
  });
};

const termsAndConditionsAcceptanceMessageHtml = (props, branding) => {
  const longDate = (value) =>
    new Date(value).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  return renderBrandedEmail({
    branding,
    title: "Terms and Conditions Accepted",
    preheader: "Your acceptance has been recorded. Keep this email for your records.",
    greeting: `Dear ${props.consumer
      ? `${props.consumer.name} ${props.consumer.lastName}`
      : "Valued Participant"
      },`,
    intro:
      "This email confirms that you have successfully accepted the terms and conditions for the event. Your digital signature has been recorded and your participation is now officially confirmed.",
    blocks: [
      callout({
        tone: "success",
        title: "Confirmation successful",
        body: "Thank you for accepting the terms and conditions for the event. Your participation is now confirmed!",
      }),
      props.event
        ? summaryList([
          { label: "Event name", value: props.event.eventInfoDetail?.eventName || "Event Name" },
          { label: "Company", value: props.company?.company_name || "Company Name" },
          {
            label: "Event date",
            value: props.event.eventInfoDetail?.dateBegin
              ? longDate(props.event.eventInfoDetail.dateBegin)
              : "Event Date",
          },
          { label: "Location", value: props.event.eventInfoDetail?.address || "Event Location" },
        ])
        : "",
      summaryList([
        {
          label: "Signature date",
          value: longDate(props.signature?.date ?? Date.now()),
        },
        { label: "Signature time", value: new Date().toLocaleTimeString("en-US") },
        { label: "Status", value: props.signature?.accepted ? "Accepted" : "Pending" },
      ]),
      callout({
        tone: "info",
        title: "What's next?",
        html: true,
        body: `<ul style="margin: 0; padding-left: 18px;">
                    <li>You can now proceed with device rentals and event participation.</li>
                    <li>Keep this email as confirmation of your acceptance.</li>
                    <li>Contact event staff if you have any questions or need assistance.</li>
                    <li>Review the event details and prepare for your participation.</li>
                  </ul>`,
      }),
      paragraph(
        "This is an automated confirmation email. Please keep this for your records. If you have any questions, please contact the event organizers.",
        { muted: true }
      ),
    ],
  });
};

/**
 * "Everything is signed, the equipment can move."
 *
 * Sent twice per completion with a different `recipientType`: once to whoever
 * hands the equipment over, once to the person who signed. The consumer-lease
 * and staff variants differ only in what the signer is called and in the
 * next-steps list, so both go through here.
 */
const renderDocumentSigningCompletionEmail = ({
  branding,
  isAssigner,
  signerLabel,
  signerHeading,
  signer,
  contract_list,
  completionNote,
  assignerNextSteps,
  signerNextSteps,
}) => {
  const longDate = (value = Date.now()) =>
    new Date(value).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const nextSteps = isAssigner ? assignerNextSteps : signerNextSteps;

  return renderBrandedEmail({
    branding,
    title: "All documents agreed and checked successfully",
    preheader: "Document checking complete. Equipment delivery can proceed.",
    greeting: `Dear ${isAssigner ? "Equipment Assigner" : signerLabel},`,
    intro: `This email confirms that all required liability contracts and documents have been successfully checked and signed by the assigned ${signerLabel.toLowerCase()}. ${isAssigner
      ? "You can now proceed with equipment delivery."
      : "All your document signing requirements have been completed."
      }`,
    blocks: [
      callout({
        tone: "success",
        title: "Document checking complete",
        body: completionNote,
      }),
      summaryList([
        { label: signerHeading, value: signer?.name || signerLabel },
        { label: "Email", value: signer?.email },
        { label: "Signing date", value: longDate() },
        { label: "Checking time", value: new Date().toLocaleTimeString("en-US") },
        {
          label: "Total documents",
          value: String(contract_list ? contract_list.length : 0),
        },
      ]),
      dataTable({
        columns: [
          { header: "Document", key: "name" },
          { header: "Signed on", key: "date" },
        ],
        rows: asArray(contract_list).map((contract) => ({
          name: contract.document_name || "Document",
          date: contract.date || new Date().toLocaleDateString("en-US"),
        })),
      }),
      callout({
        tone: "info",
        title: "Next steps",
        html: true,
        body: `<ul style="margin: 0; padding-left: 18px;">${nextSteps
          .map((step) => `<li>${escapeHtml(step)}</li>`)
          .join("")}</ul>`,
      }),
      paragraph(
        "This is an automated notification. Please keep this email for your records. For any questions, please contact the system administrator.",
        { muted: true }
      ),
    ],
  });
};

/** Staff-lease variant. */
const documentSigningCompletionMessageHtml = (props, branding) =>
  renderDocumentSigningCompletionEmail({
    branding,
    isAssigner: props.recipientType === "assigner",
    signerLabel: "Staff Member",
    signerHeading: "Staff name",
    signer: props.staff,
    contract_list: props.contract_list,
    completionNote:
      "All required documents have been checked and signed by the staff member. Equipment delivery can now proceed.",
    assignerNextSteps: [
      "Proceed with equipment delivery to the staff member.",
      "Update equipment assignment records in the system.",
      "Provide equipment usage instructions and guidelines.",
      "Schedule equipment return date if applicable.",
    ],
    signerNextSteps: [
      "Await equipment delivery from the assigner.",
      "Review equipment usage guidelines when received.",
      "Contact the assigner if you have any questions.",
      "Keep this email as confirmation of completed documentation.",
    ],
  });

/** Consumer-lease variant. */
const documentSigningCompletionConsumerLeaseMessageHtml = (props, branding) =>
  renderDocumentSigningCompletionEmail({
    branding,
    isAssigner: props.recipientType === "assigner",
    signerLabel: "Consumer",
    signerHeading: "Consumer name",
    signer: props.consumer,
    contract_list: props.contract_list,
    completionNote:
      "All required documents have been checked and signed by the consumer. Equipment delivery can now proceed.",
    assignerNextSteps: [
      "Proceed with equipment delivery to the consumer.",
      "Update equipment assignment records in the system.",
      "Provide equipment usage instructions and guidelines.",
      "Schedule equipment return date if applicable.",
    ],
    signerNextSteps: [
      "Await equipment delivery from the assigner.",
      "Review equipment usage guidelines when received.",
      "Contact the assigner if you have any questions.",
      "Keep this email as confirmation of completed documentation.",
    ],
  });

/**
 * Security notice: somebody signed in to a Devitrak admin account. Stays
 * Devitrak-branded — this is a platform security alert, and a recipient has to
 * be able to tell it from mail their own organization sends.
 */
const loginActivityNotificationMessageHtml = (props) => {
  const { adminUser, loginInfo } = props;

  return renderBrandedEmail({
    title: "Login Activity Detected",
    preheader: "We've detected a new login to your Devitrak account",
    greeting: `Hello ${adminUser.name} ${adminUser.lastName},`,
    intro:
      "We detected a new login to your Devitrak account. Please review the details below to ensure this activity is authorized.",
    blocks: [
      summaryList([
        { label: "Account email", value: adminUser.email },
        { label: "Login time", value: loginInfo.timestamp },
        { label: "IP address", value: loginInfo.ipAddress },
        { label: "Location", value: loginInfo.location || "Unknown" },
        { label: "Device/browser", value: loginInfo.userAgent },
        { label: "Timezone", value: loginInfo.timezone },
      ]),
      callout({
        tone: "warning",
        title: "Security notice",
        body: "If this login was not authorized by you, please contact your system administrator immediately and consider changing your password. Unauthorized access to admin accounts can compromise sensitive company data and system security.",
      }),
    ],
    cta: {
      label: "Report Suspicious Activity",
      href: `mailto:support@devitrak.com?subject=${encodeURIComponent(
        `Unauthorized Login Alert - ${adminUser.email}`
      )}`,
    },
  });
};

const consumerLeaseEndedDeviceReturnedNotificationMessageHtml = (
  propsOrAdminUser,
  loginInfo,
  deviceInfo,
  branding
) => {
  const props =
    typeof propsOrAdminUser === "object" && !Array.isArray(propsOrAdminUser)
      ? propsOrAdminUser
      : {
        company_name: (loginInfo && loginInfo.company_name) || "",
        email_admin: (loginInfo && loginInfo.email_admin) || "",
        consumer: propsOrAdminUser || {},
        subject:
          (loginInfo && loginInfo.subject) ||
          "Lease: Device Returned Confirmation",
        devices: deviceInfo ? [deviceInfo] : [],
        returned_at: (loginInfo && loginInfo.returned_at) || undefined,
        return_location:
          (loginInfo && loginInfo.return_location) || undefined,
      };

  const {
    company_name = "",
    email_admin = "",
    consumer = {},
    devices = [],
    subject = "Lease: Device Returned",
  } = props;

  const normalizedDevices = asArray(devices);
  const administrator = email_admin || branding?.replyTo || "";
  const organization = company_name || branding?.displayName || "";

  return renderBrandedEmail({
    branding,
    title: subject,
    preheader: "The leased device has been returned. No further action is required.",
    greeting: `Dear ${consumer.name || "Consumer"},`,
    intro:
      "Thank you for returning your leased device. Below are the details recorded for the returned device(s).",
    blocks: [
      callout({
        tone: "success",
        title: "Return completed",
        html: true,
        body: `<p style="margin: 0 0 8px 0;">We confirm the leased device has been returned successfully${administrator ? ` and recorded by <strong>${escapeHtml(administrator)}</strong>` : ""
          }.</p>
                  <ul style="margin: 0; padding-left: 18px;">
                    <li>No further action is required from you.</li>
                    <li>If you believe this is a mistake, contact the administrator immediately.</li>
                    <li>Keep this email for your records.</li>
                  </ul>`,
      }),
      sectionHeading("Consumer member information"),
      summaryList([
        { label: "Name", value: consumer.name },
        { label: "Email", value: consumer.email },
      ]),
      sectionHeading("Returned device information"),
      dataTable({
        columns: [
          { header: "Serial number", key: "serialNumber" },
          { header: "Device type", key: "deviceType" },
        ],
        rows: normalizedDevices.map((item) => ({
          serialNumber: item.serial_number || item.item_id || item.id || "Unknown",
          deviceType: item.type || item.device_type || "Device",
        })),
      }),
      callout({
        tone: "info",
        title: "What's next",
        html: true,
        body: `<ul style="margin: 0; padding-left: 18px;">
                    <li>If you have another device in lease, you will receive separate notifications.</li>
                    <li>For any billing or deposit matters, please reach out to the administrator.</li>
                    <li>Contact support if you need documentation for your records.</li>
                  </ul>`,
      }),
      paragraph(
        administrator
          ? `If you have any questions or concerns regarding this return, please contact the administrator at ${administrator}.`
          : "If you have any questions or concerns regarding this return, please contact the administrator."
      ),
      paragraph(
        organization ? `Best regards,\n${organization} Administration Team` : "Best regards"
      ),
    ],
  });
};

/**
 * The receipt in Fredrik's 2026-08-28 forward: a leased device came back, and
 * the guardian of the student who had it is told so. First template branded for
 * the client, and the reference for the rest.
 */
const returnConfirmationLeaseMemberMessageHtml = (props, branding) =>
  renderBrandedEmail({
    branding,
    title: "Devices Returned Receipt",
    greeting: `Dear ${props.member.firstName} ${props.member.lastName},`,
    intro:
      "This email confirms that all devices shown have been returned successfully.",
    blocks: [
      dataTable({
        columns: [
          { header: "Device type", key: "deviceType" },
          { header: "Serial number", key: "serialNumber" },
          { header: "Date", key: "date" },
        ],
        rows: asArray(props.devices).map((device) => ({
          deviceType: device.device?.deviceType,
          serialNumber: device.device?.serialNumber,
          date: receiptDate(),
        })),
      }),
    ],
  });

/**
 * Somebody tried to sign in while another session was already live.
 *
 * The link carries the account's email and a timestamp, and nothing else. The
 * password is collected on the /force-logout page and travels in a POST body
 * to /staff/force-logout.
 *
 * This used to be a `<form method="GET">` with a password field inside the
 * email itself, which put the plaintext password into the URL — and so into
 * browser history, server access logs and any Referer header — for every
 * person who used it. (Most clients strip <form> from email outright, so for
 * many recipients it did not work at all.) See ForceLogout.jsx, which still
 * accepts a `cred` parameter so links already sitting in inboxes keep working.
 */
const forceLogoutNotificationHtmlTemplate = (userEmail) => {
  const clientUrl = "https://admin.devitrak.net";
  const timestamp = new Date().getTime();
  const actionUrl = `${clientUrl}/force-logout?email=${encodeURIComponent(
    userEmail
  )}&timestamp=${timestamp}`;

  return renderBrandedEmail({
    title: "Action Required: End Your Active Session",
    preheader: "An active session is already in progress for your account.",
    intro:
      "A login attempt was made for your account, but an active session was already in progress. If this was you, use the button below to end your other session. You will be asked to confirm your password on our site.",
    blocks: [
      button({ label: "Revoke Active Session", href: actionUrl }),
      summaryList([{ label: "Account", value: userEmail }]),
      paragraph(
        "If you did not initiate this request, you can ignore this email. Your account remains secure."
      ),
    ],
  });
};

const memberEmailNotificationHtml = (props, branding) => {
  const subject = props?.subject || "Notification";
  const message = props?.message || "";

  return renderBrandedEmail({
    branding,
    title: subject,
    greeting: "Hello,",
    intro: "You have received a notification from your staff/company through Devitrak.",
    blocks: [
      paragraph(message),
      paragraph(
        "Please contact your staff/company directly if you have any questions about this message."
      ),
    ],
  });
};


/**
 * Free-form notification: the caller supplies the subject and the body.
 *
 * `message` is interpolated as HTML on purpose — that is what makes the message
 * "customizable" — so whatever reaches this function can put arbitrary markup in
 * the email. Keep that in mind before exposing it to any caller that isn't
 * trusted; see the note on the route in routes/nodeMailer.js.
 */
const customizeMessageHtml = (props) => {
  const subject = props?.subject || "Notification";
  const message = props?.message || "";
  const company = props?.company || "Devitrak";
  return `
  <html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>
      Devitrak App | Easy way to manage inventory. A good solution for your
      business no matter the size of your organization.
    </title>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap");
    </style>
  </head>
  <body
    style="
      max-width: 768px;
      min-width: 320px;
      background-color:#fff;
      color: #1a202c;
      font-family: 'Inter', sans-serif;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
      margin: auto;
      padding: 0;
    "
  >
    <div
      style="
        margin-left: auto;
        margin-right: auto;
        padding: 2rem;
        width: 100%;
        border-radius: 12px;
      "
    >
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2.5rem;
          width: 100%;
        "
      >
        <div style="align-self: flex-start">
          <p
            style="
              text-align: left;
              width: 100%;
              color: #475467;
              font-size: 9px;
              font-style: normal;
              font-weight: 500;
              line-height: 9px;
            "
          >
            Power by
          </p>
          <div
            style="
              display: flex;
              justify-content: flex-end;
              align-items: center;
              margin-top: 2.5px;
            "
          >
            <img
              src="${DEVITRAK_EMAIL_ICON_URL}" width="26" height="12"
              alt="devitrak-logo"
              style="
                object-fit: contain;
                object-position: 50% 50%;
                align-self: flex-start;
                display: flex;
                align-items: center;
              "
            />
            <img
              src="${DEVITRAK_EMAIL_NAME_URL}" width="57" height="12"
              alt="devitrak-name"
              style="
                object-fit: contain;
                object-position: 50% 50%;
                align-self: flex-start;
                display: flex;
                align-items: center;
              "
            />
          </div>
        </div>
      </div>
      <div style="max-width: 768px; min-width: 320px">
      <h1
      style="
        font-size: 1.5rem;
        font-weight: 600;
        color: #101828;
        margin-bottom: 1rem;
      "
    >
      ${subject}
    </h1>
    <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
      This email notification sent from ${company}.
    </p>
    <p
            style="
              border-radius: 12px;
              margin:auto;
              color: #475467;
              text-align: left;
              font-size: 16px;
              font-style: normal;
              font-weight: 400;
              line-height: 24px; /* 150% */
              padding:12px 8px;
              text-wrap: pretty
            "
          >
            ${message}
          </p>
      <div style="margin-top: 2.5rem">
      <p style="font-size: 1rem; color: #475467">
        This email was sent from an unmonitored account. Do not reply to this email.
      </p>
      </div>
      </div>
    </div>
  </body>
</html>
  `;

};

// ---------------------------------------------------------------------------
// School track — a device declared lost or damaged, and the receipt for the fee
// charged over it.
//
// These exist because ALL THREE outcomes (returned / damaged / lost) used to
// post to /member-lease-return-device-notification, so the guardian of a laptop
// that was never coming back received written confirmation of a return that did
// not happen. Neither template below may ever state that the device came back.
// ---------------------------------------------------------------------------

// The condition note is staff free text and the reason lines are typed by hand;
// both land inside markup. Escaped so an apostrophe or an angle bracket cannot
// break the email — or inject into it.
//
// `escapeHtml` ya no se define acá: viene de nodeMailer/emailLayout.js (ver el
// import arriba), que es de donde lo toma el chasis de plantillas. Las dos
// implementaciones eran identicas --mismo manejo de null, los mismos cinco
// caracteres y el & primero-- asi que unificar no cambia lo que se envia.

// Dollars in, dollars on the page. Cents never reach this layer.
const formatUsd = (amount) =>
  `$${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const devitrakEmailHeader = `
          <div style="margin-bottom: 2.5rem; width: 100%">
            <p
              style="
                text-align: left;
                width: 100%;
                color: #475467;
                font-size: 9px;
                font-style: normal;
                font-weight: 500;
                line-height: 9px;
              "
            >
              Power by
            </p>
            <div style="margin-top: 2.5px">
              <img
                src="${DEVITRAK_EMAIL_ICON_URL}" width="26" height="12"
                alt="devitrak-logo"
                style="object-fit: contain; object-position: 50% 50%"
              />
              <img
                src="${DEVITRAK_EMAIL_NAME_URL}" width="57" height="12"
                alt="devitrak-name"
                style="object-fit: contain; object-position: 50% 50%"
              />
            </div>
          </div>`;

const memberDeviceEmailStyles = `
      @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap");

      body {
        margin: 0;
        padding: 0;
        font-family: 'Inter', sans-serif;
        background-color: #ffffff;
        color: #1a202c;
        -webkit-text-size-adjust: none;
        -ms-text-size-adjust: none;
        max-width: 768px;
        min-width: 320px;
      }

      .container {
        margin: 0 auto;
        padding: 20px;
        width: 100%;
        max-width: 768px;
      }

      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #101828;
        margin-bottom: 16px;
      }

      p {
        font-size: 16px;
        color: #475467;
        margin-bottom: 24px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin: 20px 0;
        font-size: 14px;
      }

      th, td {
        padding: 12px;
        border: 1px solid #e0e0e0;
        text-align: left;
      }

      th {
        background-color: #f2f2f2;
        font-weight: 600;
        color: #475467;
      }

      .callout {
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 12px 16px;
        margin: 20px 0;
      }

      .footer {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
      }

      @media only screen and (max-width: 600px) {
        h1 { font-size: 20px; }
        p, th, td { font-size: 12px; }
      }`;

/**
 * B3.1 — a device was declared lost or damaged.
 *
 * The recipient is frequently the guardian, not the student, so the student's
 * name identifies the SUBJECT of the notice and is never used as a greeting.
 * `feeAmount: null` prints nothing about money at all: the school often has not
 * decided the amount yet, and a "$0.00 due" line reads as "you owe nothing".
 */
const memberDeviceIncidentMessageHtml = (props = {}) => {
  const member = props.member || {};
  const studentName = escapeHtml(
    `${member.firstName || ""} ${member.lastName || ""}`.trim()
  );
  const outcome = String(props.outcome || "").toLowerCase();
  const isLost = outcome === "lost";
  const heading = isLost ? "Device reported lost" : "Device returned damaged";
  const lead = isLost
    ? `Our records show that a device assigned to <strong>${studentName}</strong> has been reported lost and has not been recovered.`
    : `Our records show that a device assigned to <strong>${studentName}</strong> was returned damaged.`;
  const devices = Array.isArray(props.devices) ? props.devices : [];

  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${heading}</title>
    <style>${memberDeviceEmailStyles}</style>
  </head>
  <body>
    <div class="container">
${devitrakEmailHeader}

      <h1>${heading}</h1>
      <p>Hello,</p>
      <p>${lead}</p>
      <p><strong>${escapeHtml(props.outcomeLabel || heading)}</strong></p>

      <table>
        <thead>
          <tr>
            <th>Device type</th>
            <th>Serial number</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${devices
            .map((entry) => {
              const device = (entry && entry.device) || {};
              return `
            <tr>
              <td>${escapeHtml(device.deviceType || "Device")}</td>
              <td>${escapeHtml(device.serialNumber || "N/A")}</td>
              <td>${new Date().toLocaleDateString()}</td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>

      ${
        props.conditionNote
          ? `<div class="callout">
        <p style="margin-bottom: 4px"><strong>Note from school staff</strong></p>
        <p style="margin-bottom: 0">${escapeHtml(props.conditionNote)}</p>
      </div>`
          : ""
      }

      ${
        props.feeAmount !== null && props.feeAmount !== undefined
          ? `<div class="callout">
        <p style="margin-bottom: 4px"><strong>Replacement fee: ${formatUsd(
          props.feeAmount
        )}</strong></p>
        <p style="margin-bottom: 0">
          Please contact the school office to arrange payment. This notice is not a receipt.
        </p>
      </div>`
          : ""
      }

      <p>If you believe this is a mistake, please contact the school office.</p>

      <div class="footer">
        <p>This email was sent from an unmonitored account. Do not reply to this email.</p>
      </div>
    </div>
  </body>
</html>
`;
};

/**
 * B3.2 — the fee has ALREADY been captured. This is a receipt, never a request
 * for payment; nothing in it may read like an invoice. `paymentIntent` is the
 * reference the family quotes in a dispute — the same id on the paper receipt.
 */
const memberDeviceFeeReceiptMessageHtml = (props = {}) => {
  const member = props.member || {};
  const studentName = escapeHtml(
    `${member.firstName || ""} ${member.lastName || ""}`.trim()
  );
  const lines = Array.isArray(props.lines) ? props.lines : [];
  const paidOn = props.date ? new Date(props.date) : new Date();
  const paidOnLabel = isNaN(paidOn.getTime())
    ? new Date().toLocaleDateString()
    : paidOn.toLocaleDateString();

  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Payment receipt</title>
    <style>${memberDeviceEmailStyles}</style>
  </head>
  <body>
    <div class="container">
${devitrakEmailHeader}

      <h1>Payment receipt</h1>
      <p>Hello,</p>
      <p>
        This is a receipt for a device fee paid${
          props.billedGuardian ? ` on behalf of <strong>${studentName}</strong>` : ""
        } at ${escapeHtml(props.company || "your school")} on ${paidOnLabel}.
        ${
          props.billedGuardian
            ? "No further action is needed."
            : `This covers the device fee for <strong>${studentName}</strong>. No further action is needed.`
        }
      </p>

      <table>
        <thead>
          <tr>
            <th>Serial number</th>
            <th>Reason</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${lines
            .map(
              (line) => `
            <tr>
              <td>${escapeHtml((line && line.serialNumber) || "N/A")}</td>
              <td>${escapeHtml((line && line.reason) || "")}</td>
              <td>${formatUsd((line && line.amount) || 0)}</td>
            </tr>`
            )
            .join("")}
          <tr>
            <td colspan="2"><strong>Total paid</strong></td>
            <td><strong>${formatUsd(props.total || 0)}</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="callout">
        <p style="margin-bottom: 0">
          Reference: <strong>${escapeHtml(props.paymentIntent || "N/A")}</strong>
        </p>
      </div>

      <p>Keep this receipt for your records. Quote the reference above if you have any question about this payment.</p>

      <div class="footer">
        <p>This email was sent from an unmonitored account. Do not reply to this email.</p>
      </div>
    </div>
  </body>
</html>
`;
};

module.exports = {
  assigningDeviceMessageHtml,
  cancelingDepositMessageHtml,
  capturingDepositMessageHtml,
  confirmationNewConsumerAccountMessageHtml,
  consumerLeaseEndedDeviceReturnedNotificationMessageHtml,
  customizedEmailMessageHtml,
  deviceReportPerTransactionMessageHtml,
  devitrakFeedbackEmailMessageHtml,
  documentSigningCompletionConsumerLeaseMessageHtml,
  documentSigningCompletionMessageHtml,
  editingDeviceAdminMessageHtml,
  eventBeginsReminderHtmlMessage,
  eventLinkEventHtml,
  forceLogoutNotificationHtmlTemplate,
  itemInfoStaffNotificationMessageHtml,
  liabilityContractConsumerNotificationMessageHtml,
  liabilityContractMemberNotificationMessageHtml,
  liabilityContractStaffNotificationMessageHtml,
  linkToLoginExistingConsumerMessageHtml,
  linkToResetUserPassword,
  loginActivityNotificationMessageHtml,
  lostDeviceFeeCollectedMessageHtml,
  lostDeviceFeeReceipt,
  memberDeviceIncidentMessageHtml,
  memberDeviceFeeReceiptMessageHtml,
  newUserInvitationMessageHtml,
  nrffInterpretationFeedbackEmailMessageHtml,
  reportBugMessageHtml,
  returnConfirmationLeaseMemberMessageHtml,
  returnConfirmationMessageHtml,
  returnedItemsToRenterNotificationMessageHtml,
  returnReminderMessageHtml,
  serviceChargeInvoiceEmailHtml,
  serviceRefundConfirmationEmailHtml,
  singleEmailMessageHtml,
  staffInternalNotificationMessageHtml,
  staffNotificationMessageHtml,
  termsAndConditionsAcceptanceMessageHtml,
  memberEmailNotificationHtml,
  customizeMessageHtml
};
