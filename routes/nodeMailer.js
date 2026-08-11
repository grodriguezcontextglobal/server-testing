const { Router } = require("express");
const {
  assingDeviceNotification,
  returningDeviceNotification,
  cancelDepositNotification,
  captureDepositNotification,
  earlierReturningNotification,
  eventStaffNotification,
  lostDeviceFeeCollectedNotification,
  loginLinkExistingConsumerNotification,
  linkToResetPassword,
  editingDeviceAdminNotification,
  confirmationLinkNewConsumerNotification,
  customizedEmailNotification,
  singleEmailNotification,
  newUserInvitationNotification,
  internalNotification,
  eventBeginsReminderNotification,
  staffInternalNotification,
  itemInfoStaffNotification,
  chargeInvoice,
  eventLinkEvent,
  refundInvoice,
  massiveEventCustomerNotification,
  deviceReportPerTransaction,
  devitrakFeedbackEmailNotification,
  liabilityContractStaffNotification,
  returnedItemsToRenterNotification,
  termsAndConditionsAcceptanceNotification,
  liabilityContractConsumerNotification,
  consumerLeaseEndedDeviceReturnedNotification,
  liabilityContractMemberNotification,
  returningDeviceLeaseMemberNotification,
  completedTask,
  failedTask,
  forcingRevokingActiveSession,
  memberEmailNotification,
  customizeMessage
} = require("../nodeMailer/notifications");
const router = Router();

//*email notification to inform about devices assigned to consumer
router.post("/assignig-device-notification", assingDeviceNotification);

//*email notification to inform about devices returned to consumer
router.post(
  "/confirm-returned-device-notification",
  returningDeviceNotification
);

//*email notification to inform about deposit returned/cancelled
router.post("/deposit-return-notification", cancelDepositNotification);

//*email notification to inform about deposit captured
router.post("/deposit-collected-notification", captureDepositNotification);

//*email notification to remind consumer about returning devices before to the event ends
router.post("/early-remind-notification", earlierReturningNotification);

//*email notification to remind consumer about returning devices before to the event ends
router.post("/event-staff-notification", eventStaffNotification);

//*email notification to inform consumer about the lost device fee collected
router.post(
  "/lost-device-fee-notification",
  lostDeviceFeeCollectedNotification
);

//*email notification to confirm new consumer account
router.post("/confirmation-account", confirmationLinkNewConsumerNotification);

//*email notification to login to existing consumer
router.post("/login-existing-consumer", loginLinkExistingConsumerNotification);

//*email to reset admin password
router.post("/reset-admin-password", linkToResetPassword);

//*notify admin when staff edit device
router.post("/edit-device-admin", editingDeviceAdminNotification);

//*notify all consumers of event
router.post("/customized-notification", customizedEmailNotification);

//*single email notification
router.post("/single-email-notification", singleEmailNotification);

//*invitation for new user in company
router.post("/new_invitation", newUserInvitationNotification);

//*internal notification
router.post("/internal-single-email-notification", internalNotification);

//*event begins notification
router.post("/events-begin-reminder", eventBeginsReminderNotification);

//*event begins notification
router.post("/staff_internal_notification", staffInternalNotification);

//email leased equipment to staff
router.post("/leased-equip-staff-notification", itemInfoStaffNotification);

//payment confirmation invoice email notification
router.post("/invoice-notification", chargeInvoice);
///staff_internal_notification

//redunf confirmation invoice email notification
router.post("/refund-notification", refundInvoice);
//payment confirmation invoice email notification
router.post("/send-consumer-app-instructions", eventLinkEvent);

//send massive event customer notification
router.post(
  "/massive-event-customer-notification",
  massiveEventCustomerNotification
);

//send device report per transaction
router.post("/device-report-per-transaction", deviceReportPerTransaction);

//feedback email notification
router.post("/feedback-email-notification", devitrakFeedbackEmailNotification);

//send liability contract email notification
router.post(
  "/liability-contract-email-notification",
  liabilityContractStaffNotification
);

//send liability contract email notification to consumers
router.post(
  "/liability-contract-consumer-email-notification",
  liabilityContractConsumerNotification
);

//send liability contract email notification to consumers
router.post(
  "/liability-contract-member-email-notification",
  liabilityContractMemberNotification
);

//send email notification to staff about returned items to renter
router.post("/returned-items-to-renter-notification", returnedItemsToRenterNotification);

//terms and condition in event accepted for consumer
router.post("/terms-and-conditions-acceptance", termsAndConditionsAcceptanceNotification);

//notification for returned device in consumer lease
router.post("/consumer-lease-return-device-notification", consumerLeaseEndedDeviceReturnedNotification)

//notification for returned device in member lease
router.post("/member-lease-return-device-notification", returningDeviceLeaseMemberNotification)

//notification for completed task
router.post("/completed-task-notification", completedTask)

//notification for failed task
router.post("/failed-task-notification", failedTask)

//notification for revoking active session
router.post("/forcing-revoking-active-session", forcingRevokingActiveSession)

//member email notification
router.post("/member-email-notification", memberEmailNotification);

// Free-form notification: the caller chooses the recipient, the subject AND the
// HTML body, which is interpolated into the template verbatim.
//
// Every route in this file is unauthenticated, so this one is consistent with
// the rest — but it is not equivalent in what that costs. The others are
// template-driven: a caller controls the data, while the template constrains
// the shape. This one lets a caller send arbitrary markup to an arbitrary
// address from noreply@devitrak.com, which is a ready-made phishing primitive.
// Gate it (validateJWT + checkTokenVersion) before it becomes load-bearing.
router.post("/customize-message-notification", customizeMessage);

module.exports = router;
