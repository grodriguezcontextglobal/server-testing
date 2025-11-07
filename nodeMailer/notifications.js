const nodeMailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");
const fs = require("fs");
const path = require("path");
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
  liabilityContractStaffNotificationMessageHtml,
  returnedItemsToRenterNotificationMessageHtml,
  termsAndConditionsAcceptanceMessageHtml,
  documentSigningCompletionMessageHtml,
  loginActivityNotificationMessageHtml,
} = require("./returningDeviceMessage");
const User = require("../models/User");
const logger = require("../helpers/logger");
// const e = require("express");
const assingDeviceNotification = async (request, response) => {
  try {
    const info = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: `${request.body.consumer.firstName} ${request.body.consumer.lastName} <${request.body.consumer.email}>`,
      subject: "Assignment device notification",
      html: assigningDeviceMessageHtml(request.body),
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

const returningDeviceNotification = async (request, response) => {
  try {
    const info = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
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
    console.log(request.body)
    const msg = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to:request.body.consumer.email,
      subject: "Deposit returned notification",
      html: cancelingDepositMessageHtml(request.body),
    };

    sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email notification`,
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

const captureDepositNotification = async (request, response) => {
  try {
    const msg = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: request.body.consumer.email,
      subject: "Deposit captured",
      html: capturingDepositMessageHtml(request.body),
    };

    return sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email was sent.`,
        ok: true,
      })
    })

  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error,
    });
  }
};

const earlierReturningNotification = async (request, response) => {
  try {
    const info = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: `<${request.body.consumer}>`,
      subject: "Returning device reminder",
      html: returnReminderMessageHtml,
    };
    return sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email notification was sent.`,
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

const eventStaffNotification = async (request, response) => {
  try {
    const msg = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: request.body.staff,
      subject: "Staff event",
      html: staffNotificationMessageHtml(request.body),
    };

    return sgMail.send(msg).then(() => {
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

const editingDeviceAdminNotification = async (request, response) => {
  try {
    const msg = {
      to: `${request.body.contactAdminEmail}`,
      from: "Devitrak Notifications <noreply@devitrak.com>",
      subject: "Device edited notification",
      html: editingDeviceAdminMessageHtml(request.body),
    };

    return sgMail.send(msg).then(() => {
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

const lostDeviceFeeCollectedNotification = async (request, response) => {
  try {
    const msg = {
      to: `${request.body.consumer.email}`,
      from: "Devitrak Notifications <noreply@devitrak.com>",
      subject: "Lost device fee payment receipt",
      html: lostDeviceFeeReceipt(request.body),
    };

    return sgMail.send(msg).then(() => {
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

const confirmationLinkNewConsumerNotification = async (request, response) => {
  try {
    const msg = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: `${request.body.consumer.email}`,
      subject: "Confirmation link account",
      html: confirmationNewConsumerAccountMessageHtml(request.body),
    };

    return sgMail.send(msg).then(() => {
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

const loginLinkExistingConsumerNotification = async (request, response) => {
  try {
    const msg = {
      to: `${request.body.consumer.email}`,
      from: "Devitrak Notifications <noreply@devitrak.com>",
      subject: "Link to login",
      html: linkToLoginExistingConsumerMessageHtml(request.body),
    };

    return sgMail.send(msg).then(() => {
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
const linkToResetPassword = async (request, response) => {
  try {
    const msg = {
      to: `${request.body.contactInfo.email}`,
      from: "Devitrak Notifications <noreply@devitrak.com>",
      subject: "Devitrak Notification - Reset Password Link",
      html: linkToResetUserPassword(request.body),
    };

    return sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    logger.error("Error fetching access token:", error.response.data);
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

    return sgMail.send(msg).then(() => {
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

const singleEmailNotification = async (request, response) => {
  try {
    const msg = {
      to: request.body.consumer,
      from: "Devitrak Notifications <noreply@devitrak.com>", // "notification@devitrak.net",
      subject: `Devitrak Notification - ${request.body.subject}`,
      html: singleEmailMessageHtml(request.body),
    };

    return sgMail.send(msg).then(() => {
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

const newUserInvitationNotification = (request, response) => {
  try {
    const msg = {
      to: request.body.consumer,
      from: "Devitrak Notifications <noreply@devitrak.com>",
      subject: `Devitrak Notification - ${request.body.subject}`,
      html: newUserInvitationMessageHtml(request.body),
    };

    return sgMail.send(msg).then(() => {
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

const internalNotification = async (request, response) => {
  try {
    const msg = {
      to: request.body.staff,
      from: "Devitrak Notifications <noreply@devitrak.com>",
      subject: `Devitrak Notification - ${request.body.subject}`,
      html: staffNotificationMessageHtml(request.body),
    };

    return sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
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

    return sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
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

    return sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
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

    return sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    logger.error("🚀 ~ internalNotification ~ error:", error);
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

    return sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    logger.error("🚀 ~ internalNotification ~ error:", error);
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

    return sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    logger.error("🚀 ~ internalNotification ~ error:", error);
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

    return sgMail.send(msg).then(() => {
      response.status(201).json({
        notification: `Email sent`,
        ok: true,
      });
    });
  } catch (error) {
    logger.error("🚀 ~ internalNotification ~ error:", error);
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
      return sgMail.sendMultiple(msg).then(() => {
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
    logger.error(error);
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
    if (consumerEventList.length > 0) {
      const msg = {
        from: "Devitrak Notifications <noreply@devitrak.com>",
        to: [...consumerEventList],
        subject: `Share Your Feedback – Help Us Improve Your Experience!`,
        html: nrffInterpretationFeedbackEmailMessageHtml(),
      };
      return sgMail.sendMultiple(msg).then(() => {
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
    logger.error(error);
  }
};

const liabilityContractStaffNotification = async (request, response) => {
  try {
    const { staff, contract_list, subject, items } = request.body;

    // Validate required fields
    if (!staff || !staff.email || !staff.name) {
      return response.status(400).json({
        ok: false,
        msg: "Staff information (name and email) is required",
      });
    }

    if (!contract_list || contract_list.length === 0) {
      return response.status(400).json({
        ok: false,
        msg: "At least one contract is required",
      });
    }

    if (!items || items.length === 0) {
      return response.status(400).json({
        ok: false,
        msg: "At least one item is required",
      });
    }

    const info = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: `${staff.name} <${staff.email}>`,
      subject: subject || "Device Liability Contract",
      html: liabilityContractStaffNotificationMessageHtml(request.body),
    };

    return sgMail.send(info).then(() => {
      response.status(201).json({
        notification: `Liability contract email sent to ${staff.name} (${staff.email})`,
        ok: true,
      });
    });
  } catch (error) {
    logger.log(`Error sending liability contract email: ${error}`);
    response.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

const returnedItemsToRenterNotification = async (request, response) => {
  try {
    const { subject, staffEmails, supplierInfo, attachments } = request.body;

    // Validate subject
    if (!subject) {
      return response.status(400).json({
        ok: false,
        msg: "Subject is required",
      });
    }

    // Validate email list
    if (!Array.isArray(staffEmails) || staffEmails.length === 0) {
      return response.status(400).json({
        ok: false,
        msg: "Staff emails array is required and must contain at least one email",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = staffEmails.filter(
      (email) => !emailRegex.test(email)
    );
    if (invalidEmails.length > 0) {
      return response.status(400).json({
        ok: false,
        msg: `Invalid email format(s): ${invalidEmails.join(", ")}`,
      });
    }

    // Build base email
    const msg = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: staffEmails,
      subject: subject,
      html: returnedItemsToRenterNotificationMessageHtml({ supplierInfo }),
    };

    // Validate and attach files
    if (attachments && Array.isArray(attachments)) {
      const formattedAttachments = [];

      for (const file of attachments) {
        // Either: file.content is already base64
        // Or: file.path is a full path to local file (optional support)
        if (file.content && file.filename) {
          formattedAttachments.push({
            content: file.content,
            filename: file.filename,
            type: file.type || "application/octet-stream",
            disposition: "attachment",
          });
        } else if (file.path && file.filename) {
          const filePath = path.resolve(file.path);
          if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath).toString("base64");
            formattedAttachments.push({
              content: fileContent,
              filename: file.filename,
              type: file.type || "application/octet-stream",
              disposition: "attachment",
            });
          } else {
            return response.status(400).json({
              ok: false,
              msg: `Attachment file not found: ${file.filename}`,
            });
          }
        } else {
          return response.status(400).json({
            ok: false,
            msg: `Invalid attachment object: missing content or filename`,
          });
        }
      }

      msg.attachments = formattedAttachments;
    } else if (attachments && !Array.isArray(attachments)) {
      return response.status(400).json({
        ok: false,
        msg: "Attachments must be an array",
      });
    }

    // Send email
    await sgMail.sendMultiple(msg);

    return response.status(201).json({
      ok: true,
      notification: `Email sent to ${staffEmails.length} staff member(s)`,
      recipients: staffEmails,
      attachmentsCount: msg.attachments ? msg.attachments.length : 0,
    });
  } catch (error) {
    logger.error("Error sending returned items notification:", error);

    return response.status(500).json({
      ok: false,
      msg: "Failed to send notification email",
      error: error.response?.body || error.message,
    });
  }
};

const termsAndConditionsAcceptanceNotification = async (request, response) => {
  try {
    const { consumer, event, company, signature } = request.body;

    // Validate required fields
    if (!consumer || !consumer.email) {
      return response.status(400).json({
        ok: false,
        msg: "Consumer information with email is required",
      });
    }

    if (!consumer.name || !consumer.lastName) {
      return response.status(400).json({
        ok: false,
        msg: "Consumer first name and last name are required",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(consumer.email)) {
      return response.status(400).json({
        ok: false,
        msg: "Invalid email format",
      });
    }

    const msg = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: `${consumer.name} ${consumer.lastName} <${consumer.email}>`,
      subject: "Terms and Conditions Acceptance Confirmation",
      html: termsAndConditionsAcceptanceMessageHtml({
        consumer,
        event,
        company,
        signature,
      }),
    };

    await sgMail.send(msg);

    return response.status(201).json({
      ok: true,
      notification: "Terms and conditions acceptance email sent successfully",
      recipient: consumer.email,
    });
  } catch (error) {
    logger.error(
      "Error sending terms and conditions acceptance notification:",
      error
    );
    return response.status(500).json({
      ok: false,
      msg: "Failed to send notification email",
      error: error.message,
    });
  }
};

const documentSigningCompletionNotification = async (request, response) => {
  try {
    const { assigner, staff, contract_list, verification_id } = request.body;

    // Validate required fields
    if (!assigner || !assigner.email || !staff || !staff.email) {
      return response.status(400).json({
        ok: false,
        msg: "Both assigner and staff information with emails are required",
      });
    }

    if (!contract_list || contract_list.length === 0) {
      return response.status(400).json({
        ok: false,
        msg: "Contract list is required",
      });
    }

    // Validate email formats
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(assigner.email) || !emailRegex.test(staff.email)) {
      return response.status(400).json({
        ok: false,
        msg: "Invalid email format",
      });
    }

    // Send email to assigner
    const assignerMsg = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: `${assigner.name || "Assigner"} <${assigner.email}>`,
      subject: "Document Signing Complete - Equipment Ready for Delivery",
      html: documentSigningCompletionMessageHtml({
        recipientType: "assigner",
        staff,
        contract_list,
        verification_id,
      }),
    };

    // Send email to staff member
    const staffMsg = {
      from: "Devitrak Notifications <noreply@devitrak.com>",
      to: `${staff.name || "Staff Member"} <${staff.email}>`,
      subject: "Document Signing Complete - Awaiting Equipment Delivery",
      html: documentSigningCompletionMessageHtml({
        recipientType: "staff",
        staff,
        contract_list,
        verification_id,
      }),
    };

    // Send both emails
    await Promise.all([sgMail.send(assignerMsg), sgMail.send(staffMsg)]);

    return response.status(201).json({
      ok: true,
      notification: "Document signing completion emails sent successfully",
      recipients: [assigner.email, staff.email],
    });
  } catch (error) {
    logger.error(
      "Error sending document signing completion notifications:",
      error
    );
    return response.status(500).json({
      ok: false,
      msg: "Failed to send notification emails",
      error: error.message,
    });
  }
};

const loginActivityNotification = async (adminUser, loginInfo) => {
  try {
    // Validate required data
    if (!adminUser || !adminUser.email) {
      throw new Error("Admin user email is required");
    }
    if (!loginInfo) {
      throw new Error("Login info is required");
    }
    // Sanitize and validate email components
    const sanitizedName = (adminUser.name || "").replace(/[<>]/g, "");
    const sanitizedLastName = (adminUser.lastName || "").replace(/[<>]/g, "");
    const sanitizedEmail = adminUser.email.trim();
    // Sanitize admin user data
    const sanitizedAdminUser = {
      ...adminUser,
      name: sanitizedName,
      lastName: sanitizedLastName,
      email: sanitizedEmail,
      company: (adminUser.company || "Unknown").replace(/[<>]/g, ""),
      role: (adminUser.role || "Admin").replace(/[<>]/g, ""),
    };

    // Create email info object
    const info = {
      from: "noreply@devitrak.com",
      bcc: "grodriguez@devitrak.com",
      to: sanitizedEmail, // Use just the email address to avoid formatting issues
      subject: `Login Activity Alert - ${sanitizedAdminUser.email}`, // Remove emoji that might cause issues
      html: loginActivityNotificationMessageHtml({
        adminUser: sanitizedAdminUser,
        loginInfo: { ...loginInfo },
      }),
    };
    const result = await sgMail.send(info);
    return {
      success: true,
      message: `Login activity notification sent to ${sanitizedEmail}`,
      result,
    };
  } catch (error) {
    logger.error("Error sending login activity notification:", error);
    return {
      success: false,
      message: "Failed to send login activity notification",
      error: error.message,
      details: error.response?.body || null,
    };
  }
};

module.exports = {
  assingDeviceNotification,
  cancelDepositNotification,
  captureDepositNotification,
  chargeInvoice,
  confirmationLinkNewConsumerNotification,
  customizedEmailNotification,
  deviceReportPerTransaction,
  devitrakFeedbackEmailNotification,
  documentSigningCompletionNotification,
  earlierReturningNotification,
  editingDeviceAdminNotification,
  errorFeedbackEmailNotification,
  eventBeginsReminderNotification,
  eventLinkEvent,
  eventStaffNotification,
  internalNotification,
  itemInfoStaffNotification,
  liabilityContractStaffNotification,
  linkToResetPassword,
  loginActivityNotification,
  loginLinkExistingConsumerNotification,
  lostDeviceFeeCollectedNotification,
  massiveEventCustomerNotification,
  newUserInvitationNotification,
  refundInvoice,
  returnedItemsToRenterNotification,
  returningDeviceNotification,
  singleEmailNotification,
  staffInternalNotification,
  termsAndConditionsAcceptanceNotification,
};
