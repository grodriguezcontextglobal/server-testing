const { Router } = require("express");
const { assingDeviceNotification, returningDeviceNotification, cancelDepositNotification, captureDepositNotification, earlierReturningNotification,
    eventStaffNotification, lostDeviceFeeCollectedNotification, loginLinkExistingConsumerNotification, linkToResetPassword, editingDeviceAdminNotification,
    confirmationLinkNewConsumerNotification, customizedEmailNotification, singleEmailNotification, newUserInvitationNotification, internalNotification, 
    eventBeginsReminderNotification,
    staffInternalNotification,
    itemInfoStaffNotification,
    chargeInvoice,
    eventLinkEvent,
    refundInvoice} = require("../nodeMailer/notifications");
const router = Router();

//*email notification to inform about devices assigned to consumer
router.post("/assignig-device-notification", assingDeviceNotification);

//*email notification to inform about devices returned to consumer
router.post("/confirm-returned-device-notification", returningDeviceNotification);

//*email notification to inform about deposit returned/cancelled
router.post("/deposit-return-notification", cancelDepositNotification);

//*email notification to inform about deposit captured
router.post("/deposit-collected-notification", captureDepositNotification);

//*email notification to remind consumer about returning devices before to the event ends
router.post("/early-remind-notification", earlierReturningNotification)

//*email notification to remind consumer about returning devices before to the event ends
router.post("/event-staff-notification", eventStaffNotification);

//*email notification to inform consumer about the lost device fee collected
router.post("/lost-device-fee-notification", lostDeviceFeeCollectedNotification);

//*email notification to confirm new consumer account
router.post('/confirmation-account', confirmationLinkNewConsumerNotification)

//*email notification to login to existing consumer
router.post('/login-existing-consumer', loginLinkExistingConsumerNotification)

//*email to reset admin password
router.post("/reset-admin-password", linkToResetPassword)

//*notify admin when staff edit device
router.post('/edit-device-admin', editingDeviceAdminNotification)

//*notify all consumers of event
router.post('/customized-notification', customizedEmailNotification)

//*single email notification
router.post('/single-email-notification', singleEmailNotification)

//*invitation for new user in company
router.post('/new_invitation', newUserInvitationNotification)

//*internal notification
router.post('/internal-single-email-notification', internalNotification)

//*event begins notification
router.post('/events-begin-reminder', eventBeginsReminderNotification)

//*event begins notification
router.post('/staff_internal_notification', staffInternalNotification)

//email leased equipment to staff
router.post("/leased-equip-staff-notification", itemInfoStaffNotification);

//payment confirmation invoice email notification
router.post('/invoice-notification', chargeInvoice)
///staff_internal_notification

//redunf confirmation invoice email notification
router.post('/refund-notification', refundInvoice)
//payment confirmation invoice email notification
router.post('/send-consumer-app-instructions', eventLinkEvent)

module.exports = router;