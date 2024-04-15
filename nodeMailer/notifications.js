const nodeMailer = require('nodemailer')
const { response } = require("express");
const { assigningDeviceMessageHtml, cancelingDepositMessageHtml,
    capturingDepositMessageHtml, returnConfirmationMessageHtml,
    returnReminderMessageHtml, staffNotificationMessageHtml,
    lostDeviceFeeCollectedMessageHtml, linkToLoginExistingConsumerMessageHtml,
    linkToResetUserPassword, editingDeviceAdminMessageHtml, confirmationNewConsumerAccountMessageHtml, customizedEmailMessageHtml, singleEmailMessageHtml, newUserInvitationMessageHtml } = require('./returningDeviceMessage');

const assingDeviceNotification = async (request, response) => {
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
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })

        const info = await transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: `${request.body.consumer.name} <${request.body.consumer.email}>`,
            subject: 'Assigned device notification',
            html: assigningDeviceMessageHtml(request.body)
        })

        response.status(201).json({
            notification: info.messageId

        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}

const returningDeviceNotification = async (request, response) => {
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
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })

        const info = await transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: `${request.body.consumer.name} <${request.body.consumer.email}>`,
            subject: 'Returned device notification',
            html: returnConfirmationMessageHtml(request.body)
        })

        response.status(201).json({
            notification: info.messageId

        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}

const cancelDepositNotification = async (request, response) => {
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
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })

        const info = await transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: `${request.body.consumer.name} <${request.body.consumer.email}>`,
            subject: 'Deposit returned notification',
            html: cancelingDepositMessageHtml(request.body)
        })

        response.status(201).json({
            notification: info.messageId

        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}

const captureDepositNotification = async (request, response) => {
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
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })

        const info = await transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: `${request.body.consumer.name} <${request.body.consumer.email}>`,
            subject: 'Deposit captured',
            html: capturingDepositMessageHtml(request.body)
        })

        response.status(201).json({
            notification: info.messageId

        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}

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
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })

        const info = await transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: `<${request.body.consumer}>`,
            subject: 'Returning device reminder',
            html: returnReminderMessageHtml
        })

        response.status(201).json({
            notification: info.messageId,
            acceptedEmails: info.accepted,
            rejectedEmails: info.rejected

        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}

const eventStaffNotification = async (request, response) => {
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
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })

        const info = await transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: request.body.staff,
            subject: 'Staff event',
            html: staffNotificationMessageHtml(request.body),
        })

        response.status(201).json({
            notification: info.messageId,
            acceptedEmails: info.accepted,
            rejectedEmails: info.rejected

        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}

const editingDeviceAdminNotification = async (request, response) => {
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
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })

        const info = await transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: request.body.contactAdminEmail,
            subject: 'Device edited notification',
            html: editingDeviceAdminMessageHtml(request.body),
        })

        response.status(201).json({
            notification: info.messageId,
            acceptedEmails: info.accepted,
            rejectedEmails: info.rejected

        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}


const lostDeviceFeeCollectedNotification = async (request, response) => {
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
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })

        const info = await transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: `${request.body.consumer.name} <${request.body.consumer.email}>`,
            subject: 'Lost device fee collected',
            html: lostDeviceFeeCollectedMessageHtml(request.body)
        })

        response.status(201).json({
            notification: info.messageId
        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}
const confirmationLinkNewConsumerNotification = async (request, response) => {

    try {
        const transport = nodeMailer.createTransport({
            service: "Outlook365",
            host: "smtp.office365.com",
            port: "587",
            tls: {
                ciphers: "SSLv3",
                rejectUnauthorized: false,
            },
            auth: {
                user: "devitrak.testing@outlook.com",
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })

        const info = await transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: `${request.body.consumer.name} <${request.body.consumer.email}>`,
            subject: 'Confirmation link account',
            html: confirmationNewConsumerAccountMessageHtml(request.body)
        })

        response.status(201).json({
            notification: info.messageId
        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}


const loginLinkExistingConsumerNotification = async (request, response) => {

    try {
        const transport = nodeMailer.createTransport({
            service: "Outlook365",
            host: "smtp.office365.com",
            port: "587",
            tls: {
                ciphers: "SSLv3",
                rejectUnauthorized: false,
            },
            auth: {
                user: "devitrak.testing@outlook.com",
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })

        const info = await transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: `${request.body.consumer.name} <${request.body.consumer.email}>`,
            subject: 'Link to login',
            html: linkToLoginExistingConsumerMessageHtml(request.body)
        })

        response.status(201).json({
            notification: info.messageId
        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}

const linkToResetPassword = (request, response) => {
    try {
        const transport = nodeMailer.createTransport({
            service: "Outlook365",
            host: "smtp.office365.com",
            port: "587",
            tls: {
                ciphers: "SSLv3",
                rejectUnauthorized: false,
            },
            auth: {
                user: "devitrak.testing@outlook.com",
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })
        const userName = `${request.body.adminUser.firstName} ${request.body.adminUser.lastName}`
        const info = transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: `${userName} <${request.body.contactInfo.email}>`,
            subject: 'Link to reset password',
            html: linkToResetUserPassword(request.body)
        })

        response.status(201).json({
            notification: info.messageId,
            ok: true
        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}

const customizedEmailNotification = (request, response) => {
    try {
        const transport = nodeMailer.createTransport({
            service: "Outlook365",
            host: "smtp.office365.com",
            port: "587",
            tls: {
                ciphers: "SSLv3",
                rejectUnauthorized: false,
            },
            auth: {
                user: "devitrak.testing@outlook.com",
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })
        const info = transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: request.body.consumersList,
            subject: `Devitrak Notification - ${request.body.subject}`,
            html: customizedEmailMessageHtml(request.body)
        })

        response.status(201).json({
            notification: info.messageId,
            ok: true
        })

    } catch (error) {
        console.log(`read the following error: ${error}`)
        response.status(500).json("failed")
    }
}

const singleEmailNotitifaction = (request, response) => {
    try {
        const transport = nodeMailer.createTransport({
            service: "Outlook365",
            host: "smtp.office365.com",
            port: "587",
            tls: {
                ciphers: "SSLv3",
                rejectUnauthorized: false,
            },
            auth: {
                user: "devitrak.testing@outlook.com",
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })
        const info = transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: request.body.consumer,
            subject: `Devitrak Notification - ${request.body.subject}`,
            html: singleEmailMessageHtml(request.body)
        })

        response.status(201).json({
            notification: info.messageId,
            ok: true
        })

    } catch (error) {
        console.log(`read the following error: ${error.message}`)
        response.status(500).json("failed")
    }
}

const newUserInvitationNotitifaction = (request, response) => {
    try {
        const transport = nodeMailer.createTransport({
            service: "Outlook365",
            host: "smtp.office365.com",
            port: "587",
            tls: {
                ciphers: "SSLv3",
                rejectUnauthorized: false,
            },
            auth: {
                user: "devitrak.testing@outlook.com",
                pass: "@dmin.Devitr@k"
            },
            tls: {
                ciphers: 'SSLv3'
            }
        })
        const info = transport.sendMail({
            from: 'Devitrak Notifications <devitrak.testing@outlook.com>',
            to: request.body.consumer,
            subject: `Devitrak Notification - ${request.body.subject}`,
            html: newUserInvitationMessageHtml(request.body)
        })

        response.status(201).json({
            notification: info.messageId,
            ok: true
        })

    } catch (error) {
        console.log(`read the following error: ${error.message}`)
        response.status(500).json("failed")
    }
}
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
    singleEmailNotitifaction,
    newUserInvitationNotitifaction
};
