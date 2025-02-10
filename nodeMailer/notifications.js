const nodeMailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY_PAID);

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
  devitrakFeedbackEmailMessageHtml,
} = require("./returningDeviceMessage");
const User = require("../models/User");
const e = require("express");
const assingDeviceNotification = async (request, response) => {
  try {
    const info = {
      from: "devitrak.testing@outlook.com",
      to: `${request.body.consumer.firstName} ${request.body.consumer.lastName} <${request.body.consumer.email}>`,
      subject: "Returned device notification",
      html: assigningDeviceMessageHtml(request.body),
    };
    return sgMail.send(info).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const returningDeviceNotification = async (request, response) => {
  try {
    const info = {
      from: "devitrak.testing@outlook.com",
      to: `${request.body.consumer.firstName} ${request.body.consumer.lastName} <${request.body.consumer.email}>`,
      subject: "Returned device notification",
      html: returnConfirmationMessageHtml(request.body),
    };
    return sgMail.send(info).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const deviceReportPerTransaction = async (request, response) => {
  try {
    const info = {
      from: "devitrak.testing@outlook.com",
      to: `${request.body.consumer.firstName} ${request.body.consumer.lastName} <${request.body.consumer.email}>`,
      subject: "Device Report Per Transaction",
      html: deviceReportPerTransactionMessageHtml(request.body),
    };
    return sgMail.send(info).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const cancelDepositNotification = async (request, response) => {
  try {
    const msg = {
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      to: `${request.body.consumer.email}>`,
      subject: "Deposit returned notification",
      html: cancelingDepositMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const captureDepositNotification = async (request, response) => {
  try {
    const msg = {
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      to: `${request.body.consumer.email}>`,
      subject: "Deposit captured",
      html: capturingDepositMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const earlierReturningNotification = async (request, response) => {
  try {
    const transport = await nodeMailer.createTransport({
      service: "Outlook365",
      host: "smtp.office365.com",
      port: "587",
      tls: {
        ciphers: "SSLv3",
        rejectUnauthorized: false,
      },
      auth: {
        user: "devitrak.testing@outlook.com",
        pass: "@dmin.Devitr@k",
      },
      // tls: {
      //   ciphers: "SSLv3",
      // },
    });

    const info = await transport.sendMail({
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      to: `<${request.body.consumer}>`,
      subject: "Returning device reminder",
      html: returnReminderMessageHtml,
    });

    response.status(201).json({
      notification: info.messageId,
      acceptedEmails: info.accepted,
      rejectedEmails: info.rejected,
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const eventStaffNotification = async (request, response) => {
  try {
    const msg = {
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      to: request.body.staff,
      subject: "Staff event",
      html: staffNotificationMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const editingDeviceAdminNotification = async (request, response) => {
  try {
    const msg = {
      to: `${request.body.contactAdminEmail}`,
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      subject: "Device edited notification",
      html: editingDeviceAdminMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const lostDeviceFeeCollectedNotification = async (request, response) => {
  try {
    const msg = {
      to: `${request.body.consumer.email}`,
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      subject: "Lost device fee payment receipt",
      html: lostDeviceFeeCollectedMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const confirmationLinkNewConsumerNotification = async (request, response) => {
  try {
    const msg = {
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      to: `${request.body.consumer.email}`,
      subject: "Confirmation link account",
      html: confirmationNewConsumerAccountMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const loginLinkExistingConsumerNotification = async (request, response) => {
  try {
    const msg = {
      to: `${request.body.consumer.email}`,
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      subject: "Link to login",
      html: linkToLoginExistingConsumerMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};
const linkToResetPassword = async (request, response) => {
  try {
    const msg = {
      to: `${request.body.contactInfo.email}`,
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      subject: "Devitrak Notification - Reset Password Link",
      html: linkToResetUserPassword(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.error("Error fetching access token:", error.response.data);
  }
};

const customizedEmailNotification = (request, response) => {
  try {
    const msg = {
      to: `${request.body.consumersList}`,
      from: "devitrak.testing@outlook.com",
      subject: `Devitrak Notification - ${request.body.subject}`,
      html: customizedEmailMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const singleEmailNotification = async (request, response) => {
  try {
    const msg = {
      to: request.body.consumer,
      from: "devitrak.testing@outlook.com",
      subject: `Devitrak Notification - ${request.body.subject}`,
      html: singleEmailMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const newUserInvitationNotification = (request, response) => {
  try {
    const msg = {
      to: request.body.consumer,
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      subject: `Devitrak Notification - ${request.body.subject}`,
      html: newUserInvitationMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log(`read the following error: ${error}`);
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const internalNotification = async (request, response) => {
  try {
    const msg = {
      to: request.body.staff,
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      subject: `Devitrak Notification - ${request.body.subject}`,
      html: staffNotificationMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log("🚀 ~ internalNotification ~ error:", error);
    response.status(500).json({
      ok: false,
      message: error.message,
    });
  }
};

const eventBeginsReminderNotification = async (request, response) => {
  try {
    const msg = {
      to: request.body.staff,
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      subject: `Devitrak Notification - ${request.body.subject}`,
      html: eventBeginsReminderHtmlMessage(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log("🚀 ~ internalNotification ~ error:", error);
    response.status(500).json({
      ok: false,
      message: error.message,
    });
  }
};

const staffInternalNotification = async (request, response) => {
  try {
    const msg = {
      to: request.body.staff,
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      subject: `Devitrak Notification - ${request.body.subject}`,
      html: staffInternalNotificationMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log("🚀 ~ internalNotification ~ error:", error);
    response.status(500).json({
      ok: false,
      message: error.message,
    });
  }
};

const itemInfoStaffNotification = async (request, response) => {
  try {
    const msg = {
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      to: request.body.staff,
      subject: `Devitrak Notification - ${request.body.subject}`,
      html: itemInfoStaffNotificationMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log("🚀 ~ internalNotification ~ error:", error);
    response.status(500).json({
      ok: false,
      message: error.message,
    });
  }
};

const eventLinkEvent = async (request, response) => {
  try {
    const msg = {
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      to: request.body.list,
      subject: `Devitrak Notification - Event Link.`,
      html: eventLinkEventHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log("🚀 ~ internalNotification ~ error:", error);
    response.status(500).json({
      ok: false,
      message: error.message,
    });
  }
};

const chargeInvoice = async (request, response) => {
  try {
    const msg = {
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      to: request.body.email,
      subject: `Devitrak Notification - Payment confirmation.`,
      html: serviceChargeInvoiceEmailHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log("🚀 ~ internalNotification ~ error:", error);
    response.status(500).json({
      ok: false,
      message: error.message,
    });
  }
};
const refundInvoice = async (request, response) => {
  try {
    const msg = {
      from: "Devitrak Notifications <devitrak.testing@outlook.com>",
      to: request.body.email,
      subject: `Devitrak Notification - Refund confirmation.`,
      html: serviceRefundConfirmationEmailHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    console.log("🚀 ~ internalNotification ~ error:", error);
    response.status(500).json({
      ok: false,
      message: error.message,
    });
  }
};

const massiveEventCustomerNotification = async (request, response) => {
  try {
    const { eventID, eventSelected, subject } = request.body;
    const consumerEventList = await User.find(
      {
        event_providers: eventID,
      },
      "email"
    ).lean();
    if (consumerEventList.length > 0) {
      const msg = {
        from: "Devitrak Notifications <devitrak.testing@outlook.com>",
        to: [...consumerEventList],
        subject: `Event ${eventSelected} - ${subject}`,
        html: customizedEmailMessageHtml(request.body),
      };
      sgMail.sendMultiple(msg).then(() => {
        response.status(201).json({
          notification: `Email sent to ${consumerEventList.length} consumers`,
          ok: true,
        });
      });
    } else {
      response.status(201).json({
        notification: `No email sent to any consumers`,
        ok: true,
      });
    }
  } catch (error) {
    console.log(error);
  }
};

const devitrakFeedbackEmailNotification = async (request, response) => {
  try {
    const { eventID, eventSelected } = request.body;
    const consumerEventList = await User.find(
      {
        event_providers: eventID,
      },
      { email: 1, name: 1, lastName: 1, _id: 0 }
    ).lean();
    console.log(consumerEventList);
    if (consumerEventList.length > 0) {
      const msg = {
        from: "Devitrak Notifications <devitrak.testing@outlook.com>",
        to: [...consumerEventList],
        subject: `Share Your Feedback – Help Us Improve Your Experience!`,
        html: devitrakFeedbackEmailMessageHtml({
          props: {
            eventName: eventSelected,
            link: `https://devitrak-app-survey.pages.dev/?event=${eventSelected}&eventID=${eventID}`,
          },
        }),
      };
      sgMail.sendMultiple(msg).then(() => {
        response.status(201).json({
          notification: `Email sent to ${consumerEventList.length} consumers`,
          ok: true,
        });
      });
    } else {
      response.status(201).json({
        notification: `No email sent to any consumers`,
        ok: true,
      });
    }
  } catch (error) {
    console.log(error);
  }
};

module.exports = {
  assingDeviceNotification,
  returningDeviceNotification,
  cancelDepositNotification,
  captureDepositNotification,
  earlierReturningNotification,
  eventStaffNotification,
  lostDeviceFeeCollectedNotification,
  confirmationLinkNewConsumerNotification,
  loginLinkExistingConsumerNotification,
  linkToResetPassword,
  editingDeviceAdminNotification,
  customizedEmailNotification,
  singleEmailNotification,
  newUserInvitationNotification,
  internalNotification,
  eventBeginsReminderNotification,
  staffInternalNotification,
  itemInfoStaffNotification,
  eventLinkEvent,
  chargeInvoice,
  refundInvoice,
  massiveEventCustomerNotification,
  deviceReportPerTransaction,
  devitrakFeedbackEmailNotification,
};
