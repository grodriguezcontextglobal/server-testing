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
  nrffInterpretationFeedbackEmailMessageHtml,
  lostDeviceFeeReceipt,
} = require("./returningDeviceMessage");
const User = require("../models/User");
const e = require("express");
const assingDeviceNotification = async (request, response) => {
  try {
    const info = {
      from: "noreply@devitrak.com",
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
      from: "noreply@devitrak.com",
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
      from: "noreply@devitrak.com",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
        user: "noreply@devitrak.com",
        pass: "@dmin.Devitr@k",
      },
      // tls: {
      //   ciphers: "SSLv3",
      // },
    });

    const info = await transport.sendMail({
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
      subject: "Lost device fee payment receipt",
      html: lostDeviceFeeReceipt(request.body),
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "noreply@devitrak.com",
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
      from:"noreply@devitrak.com", // "notification@devitrak.net",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
        from: "Devitrak Notifications <noreply@devitrak.com>",
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
    const { eventID } = request.body;
    const consumerEventList = await User.find(
      {
        event_providers: eventID,
      },
      { email: 1, name: 1, lastName: 1, _id: 0 }
    ).lean();
    console.log(consumerEventList);
    if (consumerEventList.length > 0) {
      const msg = {
        from: "Devitrak Notifications <noreply@devitrak.com>",
        to: [...consumerEventList],
        subject: `Share Your Feedback – Help Us Improve Your Experience!`,
        html: nrffInterpretationFeedbackEmailMessageHtml(),
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
    return response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const errorFeedbackEmailNotification = async (props) => {
  try {
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

    const msg = {
      from: "Devitrak Notifications <notification@devitrak.net>",
      to: "Gustavo Rodriguez <grodriguez@contextglobal.com>",
      subject: `Error Log - Devitrak Admin Dashboard.`,
      html: htmlContent,
    };

    return sgMail.sendMultiple(msg).then(() => {
      return {
        notification: `Email sent successfully`,
        ok: true,
      };
    });
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
  errorFeedbackEmailNotification,
};
