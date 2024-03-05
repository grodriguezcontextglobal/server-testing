const { response } = require("express")

const assigningDeviceMessageHtml = (props) => {
    return `<h1 class="ql-align-center">Device Assignment Notification</h1>
<p class="ql-align-justify">Dear ${props.consumer.name},</p>
<p class="ql-align-justify">We are pleased to inform you that a new device has been successfully assigned to your account (Device #: ${props.device.serialNumber}, device type: ${props.device.deviceType}). This device provides various features and functionalities that enhance your experience.</p>
<p class="ql-align-justify">To make the most out of your device, please follow these instructions:</p>
<ul>
  <li class="ql-align-justify">Ensure that an earphone is connected to the receiver before switching it on.</li>
  <li class="ql-align-justify">Push the power switch button briefly to turn on the receiver.</li>
  <li class="ql-align-justify">The LCD will display the channel number, which can be adjusted using the channel selector. The channel configuration corresponds to that set up in the transmitter.</li>
  <li class="ql-align-justify">During operation, the LCD will show battery and signal status icons. If the battery is almost empty, a battery symbol will be displayed. Despite low battery levels, the device can still operate for 7-8 hours.</li>
  <li class="ql-align-justify">The device mutes the earphone output temporarily if the signal is interrupted briefly.</li>
  <li class="ql-align-justify">If an adequate IR signal is not received for over 1 minute (e.g., if a delegate leaves the conference room), the receiver will switch to standby mode automatically.</li>
  <li class="ql-align-justify">You can adjust the volume and view it on the LCD.</li>
  <li class="ql-align-justify">To manually switch the receiver to standby mode, press and hold the on/off button for over 2 seconds. The device will turn off automatically if the earphone is disconnected.</li>
  <li class="ql-align-justify">The device operates on disposable batteries (2xAA alkaline cells) or a rechargeable battery pack (HCS-5100BAT-16).</li>
  <li class="ql-align-justify">For the rechargeable battery pack, ensure proper polarity during installation. If using a battery pack, a separate connection cable is necessary. The charging circuitry won't work without this cable, preventing accidental charging of disposable batteries. The battery pack also features a temperature sensor to prevent overheating during charging.</li>
</ul>
<p class="ql-align-justify">If you have any questions or need further assistance with your device, please don't hesitate to contact our customer support team. We are here to help you make the most of your device and ensure a seamless experience.</p>
<p class="ql-align-justify">Thank you for choosing our service. We hope you enjoy your new device!</p>
<p>
<br>
</p>
<p class="ql-align-justify">Best regards,</p>
<p>
<br>
</p>
<p class="ql-align-justify">This service is provided by Devitrak. If you are interested in our service, please visit our website <a href="https://www.devitrak.com">www.devitrak.com</a> and/or email us at <a href="mailto:grodriguez@devitrak.com">grodriguez@devitrak.com</a>.</p>`
}
const returnConfirmationMessageHtml = (props) => {
    return `
<h1 class="ql-align-center">Return Confirmation</h1>
<p class="ql-align-justify">Dear ${props.consumer.name},</p>
<p class="ql-align-justify">We are pleased to inform you that your returned device has been successfully received and processed (Device #: ${props.device.serialNumber}, device type: ${props.device.deviceType}). Our team has carefully inspected the device to ensure its condition matches the return criteria.</p>
<p class="ql-align-justify">Please allow us some time to complete the necessary procedures. If any further action is required from your end, we will promptly reach out to you with detailed instructions.</p>
<p class="ql-align-justify">We appreciate your cooperation throughout this process. Your satisfaction is important to us, and we are committed to providing you with the best possible service.</p>
<p class="ql-align-justify">Should you have any questions or concerns, please don't hesitate to contact our customer support team. You can find our contact information on our website or in your purchase confirmation email.</p>
<p class="ql-align-justify">Thank you for choosing our products. We look forward to serving you again in the future.</p>
<p>
<br>
</p>
<p class="ql-align-justify">Best regards,</p>
<p class="ql-align-justify">This service is provided by Devitrak. If you are interested in our service, please visit our website <a href="https://www.devitrak.com">www.devitrak.com</a> and/or email us at <a href="mailto:grodriguez@devitrak.com">grodriguez@devitrak.com</a>.</p>`;
}
// You can now use the 'returnConfirmationMessageHtml' variable to display the return confirmation message to your consumers.


const cancelingDepositMessageHtml = (props) => {

    return `
<h1 class="ql-align-center">Deposit Return Notice</h1>
<p class="ql-align-justify">Dear valued customer,</p>
<p class="ql-align-justify">We want to inform you that the previously authorized deposit $${props.amount} associated with your order ${props.paymentIntent} has been successfully returned. The amount will be credited back to your original payment method.</p>
<p class="ql-align-justify">Please note that it may take 7-10 business days for the refunded amount to appear in your bank or credit card statement. The exact timing of the credit may vary based on your financial institution's policies.</p>
<p class="ql-align-justify">We appreciate your patience and understanding during this process. If you have any concerns or if the refunded amount does not reflect in your statement after the specified period, please don't hesitate to reach out to our customer support team.</p>
<p class="ql-align-justify">Thank you for choosing us for your purchase. We value your business and look forward to serving you again in the future.</p>
<p>
<br>
</p>
<p class="ql-align-justify">Best regards,</p>
<p class="ql-align-justify">This service is provided by Devitrak. If you are interested in our service, please visit our website <a href="https://www.devitrak.com">www.devitrak.com</a> and/or email us at <a href="mailto:grodriguez@devitrak.com">grodriguez@devitrak.com</a>.</p>`};

// You can now use the 'returnDepositMessageHtml' variable to display the deposit return notice to your consumers.


const capturingDepositMessageHtml = (props) => {
    return `
<h1 class="ql-align-center">Capture Confirmation</h1>
<p class="ql-align-justify">Dear valued customer,</p>
<p class="ql-align-justify">We are pleased to inform you that the previously authorized amount $${props.amount} has been successfully captured. The payment process for your order is now complete, and the corresponding deposit has been successfully processed.</p>
<p class="ql-align-justify">Thank you for choosing our products and trusting us with your order. Your satisfaction is important to us, and we are committed to providing you with a seamless and reliable shopping experience.</p>
<p class="ql-align-justify">Should you have any questions or require further assistance regarding your order, please feel free to reach out to our dedicated customer support team. You can find our contact details on our website or in your order confirmation email.</p>
<p class="ql-align-justify">We greatly value your business and look forward to serving you again in the future.</p>
<p>
<br>
</p>
<p class="ql-align-justify">Best regards,</p>
<p class="ql-align-justify">This service is provided by Devitrak. If you are interested in our service, please visit our website <a href="https://www.devitrak.com">www.devitrak.com</a> and/or email us at <a href="mailto:grodriguez@devitrak.com">grodriguez@devitrak.com</a>.</p>`};

// You can now use the 'captureConfirmationMessageHtml' variable to display the capture confirmation message to your consumers.

const returnReminderMessageHtml = `
<h1 class="ql-align-center">Important Return Reminder</h1>
<p class="ql-align-justify">Dear event attendee,</p>
<p class="ql-align-justify">As the event comes to a close, we kindly remind you to return the devices you have borrowed before leaving the premises. Your cooperation in returning the devices promptly will help us ensure that all equipment is accounted for and can be prepared for future events.</p>
<p class="ql-align-justify">To return the devices, please follow the instructions provided by our staff or refer to any signage indicating the return area. If you have any questions or need assistance, feel free to approach our event support team at any time.</p>
<p class="ql-align-justify">We greatly appreciate your adherence to this process, as it helps us maintain the quality of our services and equipment. Your participation has been valuable to us, and we hope you've had a positive experience at the event.</p>
<p class="ql-align-justify">If you have already returned the devices, please disregard this message.</p>
<p>
<br>
</p>
<p class="ql-align-justify">Thank you for being a part of this event.</p>
<p class="ql-align-justify">Best regards,</p>
<p class="ql-align-justify">This service is provided by Devitrak. If you are interested in our service, please visit our website <a href="https://www.devitrak.com">www.devitrak.com</a> and/or email us at <a href="mailto:grodriguez@devitrak.com">grodriguez@devitrak.com</a>.</p>`;

// You can now use the 'returnReminderMessageHtml' variable to display the return reminder message to event attendees.

const staffNotificationMessageHtml = (props) => {
    return `
    <head>
    <style>
    .qr-code-link{
        display: flex,
        justicy-content: center,
        align-items: center,
        max-width: 60px;
        max-height: 60px,
        margin: 0 auto;
        padding: 5px;
        color: {
            dark:"#010599FF",
            light:"#FFBF60FF"
        },
        border: 1px solid #ccc;
        border-radius: 5px;
    }
</style>
</head>
<body>
<h1 class="ql-align-center">Staff Notification</h1>
<p class="ql-align-justify">Dear selected member,</p>
<p class="ql-align-justify">We are reaching out to inform you that you have been selected as staff for the upcoming event: <strong>${props.event}</strong>.</p>
<p class="ql-align-justify">Your role as staff is crucial in ensuring the smooth execution of the event and creating a positive experience for all participants.</p>
<p class="ql-align-justify">Please stay tuned for further communications from us regarding your responsibilities, schedule, and any necessary preparations. Your dedication to this event is greatly appreciated.</p>
<p>
<br>
</p>
<p class="ql-align-justify">Should you have any questions or require assistance, please don't hesitate to contact our event admin team at <a href="mailto:${props.eventContactEmail}">${props.eventContactEmail}</a>.</p>
<p class="ql-align-justify">Thank you for being an integral part of this event.</p>
<p class="ql-align-justify">Best regards,</p>
<p class="ql-align-justify">${props.company}</p>
<p class="ql-align-justify">This service is provided by Devitrak. If you are interested in our service, please visit our website <a href="https://www.devitrak.com">www.devitrak.com</a> and/or email us at <a href="mailto:grodriguez@devitrak.com">grodriguez@devitrak.com</a>.</p>
</body>
`
}

// You can now use the 'staffNotificationMessageHtml' function to generate the staff notification message by passing the appropriate props.

const editingDeviceAdminMessageHtml = (props) => {
    return `
    <head>
      <style>
        .qr-code-link {
          display: flex;
          justify-content: center;
          align-items: center;
          max-width: 60px;
          max-height: 60px;
          margin: 0 auto;
          padding: 5px;
          color: {
            dark: "#010599FF",
            light: "#FFBF60FF";
          }
          border: 1px solid #ccc;
          border-radius: 5px;
        }
      </style>
    </head>
    <body>
      <h1 class="ql-align-center">Device Update Notification</h1>
      <p class="ql-align-justify">Dear Admin Member,</p>
      <p class="ql-align-justify">We would like to inform you that a device has been updated for a staff member:</p>
      <ul>
        <li><strong>Staff Name:</strong> ${props.staffEditingDevice.firstName} ${props.staffEditingDevice.lastName}</li>
        <li><strong>Staff Email:</strong> ${props.staffEditingDevice.email}</li>
        <li><strong>Original Serial Number:</strong> ${props.originalSerialNumber}</li>
        <li><strong>Original Type:</strong> ${props.originalType}</li>
        <li><strong>New Serial Number:</strong> ${props.newSerialNumber}</li>
        <li><strong>New Type:</strong> ${props.newType}</li>
        <li><strong>Time:</strong> ${props.time}</li>
      </ul>
      <p class="ql-align-justify">This update ensures that the correct device is assigned to the staff member, contributing to the success of the event.</p>
      <p class="ql-align-justify">Thank you for your attention to detail and dedication to the event's success.</p>
      <p class="ql-align-justify">Best regards,</p>
      <p class="ql-align-justify">${props.company}</p>
      <p class="ql-align-justify">This service is provided by Devitrak. If you are interested in our service, please visit our website <a href="https://www.devitrak.com">www.devitrak.com</a> and/or email us at <a href="mailto:grodriguez@devitrak.com">grodriguez@devitrak.com</a>.</p>
    </body>
  `;
};

// You can now use the 'staffNotificationMessageHtml' function to generate the staff notification message by passing the appropriate props.


const lostDeviceFeeCollectedMessageHtml = (props) => {
    return `
<h1 class="ql-align-center">Lost Device Fee Collection</h1>
<p class="ql-align-justify">Dear ${props.consumer.name},</p>
<p class="ql-align-justify">We want to inform you that a lost device fee of has been collected. This fee was processed due to the non-return of a device associated with your recent order.</p>
<p class="ql-align-justify">Your satisfaction is important to us, and we strive to ensure the availability of our products for all customers. We kindly remind you to keep track of the equipment provided and return them as specified to avoid such fees in the future.</p>
<p class="ql-align-justify">If you have any questions or concerns about the fee or the process, please don't hesitate to contact our customer support team. We are here to assist you and provide any necessary information.</p>
<p class="ql-align-justify">Thank you for your understanding and cooperation. We appreciate your business and look forward to continuing to serve you.</p>
<p>
<br>
</p>
<p class="ql-align-justify">Best regards,</p>
<p class="ql-align-justify">This service is provided by Devitrak. If you are interested in our service, please visit our website <a href="https://www.devitrak.com">www.devitrak.com</a> and/or email us at <a href="mailto:grodriguez@devitrak.com">grodriguez@devitrak.com</a>.</p>
`;
}

// You can now use the 'lostDeviceFeeCollectedMessageHtml' function to generate the message by passing the appropriate props.


const confirmationNewConsumerAccountMessageHtml = (props) => {
    return `<style>
    .email-container {
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
        font-family: Arial, sans-serif;
        border: 1px solid #ccc;
        border-radius: 5px;
    }

    .header {
        text-align: center;
        margin-bottom: 20px;
    }

    .instructions {
        margin-bottom: 20px;
    }

    .login-link {
        display: inline-block;
        padding: 10px 20px;
        background-color: #007BFF;
        color: #fff;
        text-decoration: none;
        border-radius: 5px;
    }

    .link-to-be-copied {
        display: inline-block;
        padding: 10px 20px;
        background-color: #ddd;
        color: #333;
        text-decoration: none;
        cursor: pointer;
        text-wrap: balance;
        text-align: justify;
        margin: 0 auto 10px;
    }

    .footer {
        margin-top: 20px;
        text-align: center;
    }

    #consumer-name {
        text-transform: capitalize;
    }
</style>
</head>
<body>

<div class="email-container">
    <div class="header">
        <h1>Welcome to Devitrak</h1>
    </div>
    <div class="instructions">
        <p id="consumer-name">Dear ${props.consumer.name} ${props.consumer.lastName},</p>
        <p>We're excited to have you as a part of our community. To get started, please confirm your account using the link below:</p>
        <p>
            <a class="login-link" href="${props.link}" target="_self" id="linkToBeCopied">Confirm Account</a>
        </p>
        <p>If you have trouble opening the link, you can also copy and paste it directly into your browser's address bar.</p>
        <p class="link-to-be-copied">${props.link}</p>
    </div>
    <div class="footer">
        <p>If you have any questions or need assistance, please contact our support team at <a href="mailto:${props.contactInfo}">${props.contactInfo}</a>.</p>
        <p>Thank you for choosing our service.</p>
        <p>This email is sent by Devitrak, which powers this service.</p>
    </div>
</div>

</body>
</html>
`;
}
const linkToLoginExistingConsumerMessageHtml = (props) => {
    return `<style>
    .email-container {
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
        font-family: Arial, sans-serif;
        border: 1px solid #ccc;
        border-radius: 5px;
    }

    .header {
        text-align: center;
        margin-bottom: 20px;
    }

    .instructions {
        margin-bottom: 20px;
    }

    .login-link {
        display: inline-block;
        padding: 10px 20px;
        background-color: #007BFF;
        color: #fff;
        text-decoration: none;
        border-radius: 5px;
    }
    

    .link-to-be-copied {
        display: inline-block;
        padding: 10px 20px;
        background-color: #ddd;
        color: #333;
        text-decoration: none;
        cursor: pointer;
        text-wrap:balance;
        text-align: justify;
        margin: 0 auto 10px;
    }

    .footer {
        margin-top: 20px;
        text-align: center;
    }
    #consumer-name {
        text-transform: capitalize
    }
</style>
</head>
<body>

<div class="email-container">
    <div class="header">
        <h1>Welcome back</h1>
    </div>
    <div class="instructions">
        <p id="consumer-name">Dear ${props.consumer.name} ${props.consumer.lastName},</p>
        <p>We're excited to have you as a part of our community. To get started, please log in to your account using the link below:</p>
        <p>
            <a class="login-link" href="${props.link}" target="_self" id="linkToBeCopied">Log In to Your Account</a>
            
        </p>
        <p>If you have trouble opening the link, you can also copy and paste it directly into your browser's address bar.</p>
        <p class="link-to-be-copied">${props.link}</p>
       
    </div>
    <div class="footer">
        <p>If you have any questions or need assistance, please contact our support team at <a href="mailto:${props.contactInfo}">${props.contactInfo}</a>.</p>
        <p>Thank you for choosing our service.</p>
        <p>This email is sent by Devitrak, which powers this service.</p>
    </div>
</div>

</body>

</html>
`;
}

// You can now use the 'lostDeviceFeeCollectedMessageHtml' function to generate the message by passing the appropriate props.


const linkToResetUserPassword = (props) => {
    return `
    <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Password Reset Email</title>
    <link
      href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600&display=swap"
      rel="stylesheet"
    />
    <style>
      body {
        font-family: "Open Sans", sans-serif;
        background-color: #ffffff; /* Light theme background */
        color: #333333; /* Darker text for better contrast on light background */
        padding: 20px;
        max-width: 400px;
        margin: 0 auto;
        border: 1px solid #ccc;
        border-radius: 5px;
      }
      h1 {
        text-align: center;
        margin-bottom: 1em;
        text-wrap: balance;
      }
      p,
      li {
        text-align: justify;
        margin-bottom: 1em;
      }
      .logo {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        margin: 0 20px 20px 0;
        max-width: 150px;
      }
      a {
        font-weight: 800;
        color: #0066cc; /* Adjusted link color for better visibility on light theme */
        text-decoration: none; /* No underline for cleaner look */
      }
      a:hover {
        text-decoration: underline; /* Underline on hover for better user interaction */
      }
      ol {
        padding-left: 20px; /* Proper indentation for ordered list */
      }
    </style>
  </head>
  <body>
  <img
      src=https://i.ibb.co/kKktFyw/maskable-icon.png
      alt="Company Logo"
      class="logo"
    />
    <h1 class="ql-align-center">Password Reset Instructions</h1>
<p class="ql-align-justify">Dear <span>${props.adminUser.firstName} ${props.adminUser.lastName}</span>,</p>
<p class="ql-align-justify">If you have forgotten your password or need to reset it for any reason, we've got you covered. Follow these simple steps to reset your password:</p>
<ol>
    <li class="ql-align-justify">Visit our password reset page by clicking on the link below:</li>
</ol>
<p class="ql-align-center"><a href="${props.linkToResetPassword}" target="_blank">Reset Your Password</a></p>
<ol start="2">
    <li class="ql-align-justify">Enter your email address associated with your account.</li>
    <li class="ql-align-justify">Check your email inbox for a password reset link.</li>
    <li class="ql-align-justify">Click on the link in the email to create a new password for your account.</li>
</ol>
<p class="ql-align-justify">If you didn't request a password reset or have any questions, please contact our support team at <a href="mailto:support@devitrak.com">support@devitrak.com</a>. We're here to assist you!</p>
<p class="ql-align-justify">Thank you for choosing ${props.contactInfo.company}.</p>
<p class="ql-align-justify">Best regards,</p>
<p class="ql-align-justify">This email is sent by ${props.contactInfo.company}.</p>
</body>`
}

const customizedEmailMessageHtml = (props) => {
    return `
     <html>
      <head>
        <style>
          body{
            max-width:600px,
            display: flex,
            justify-content: flex-start,
            align-items: center
          }
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            font-family: Inter, sans-serif;
            border: 1px solid #ccc;
            border-radius: 5px;
            overflow: hidden,
            text-wrap: balance
        }
          h1{
            display: flex,
            justify-content: flex-start,
            align-items: center,
            font-family: Inter,
            font-weight: 600,
            font-size:26px,
            line-height:38px,
            color:#000
          }
          p{
            display: flex,
            justify-content: flex-start,
            align-items: center,
            font-family: Inter,
            font-weight: 400,
            font-size:18px,
            line-height:26px,
            color:#000
          }
        </style>
      </head>
      <body>
      <div class="email-container">
        <h1>${props.subject}</h1>
        <p>${props.message}</p>
    </div>
      </body>
    </html>
    `
}

const singleEmailMessageHtml = (props) => {
    return `
     <html>
      <head>
        <style>
          body{
            max-width:600px,
            display: flex,
            justify-content: flex-start,
            align-items: center
          }
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            font-family: Inter, sans-serif;
            border: 1px solid #ccc;
            border-radius: 5px;
            overflow: hidden,
            text-wrap: balance
        }
          h1{
            display: flex,
            justify-content: flex-start,
            align-items: center,
            font-family: Inter,
            font-weight: 600,
            font-size:26px,
            line-height:38px,
            color:#000
          }
          p{
            display: flex,
            justify-content: flex-start,
            align-items: center,
            font-family: Inter,
            font-weight: 400,
            font-size:18px,
            line-height:26px,
            color:#000
          }
        </style>
      </head>
      <body>
      <div class="email-container">
        <h1>${props.subject}</h1>
        <p>${props.message}</p>
    </div>
      </body>
    </html>
    `
}

module.exports = {
    returnConfirmationMessageHtml,
    assigningDeviceMessageHtml,
    cancelingDepositMessageHtml,
    capturingDepositMessageHtml,
    staffNotificationMessageHtml,
    editingDeviceAdminMessageHtml,
    lostDeviceFeeCollectedMessageHtml,
    linkToLoginExistingConsumerMessageHtml,
    linkToResetUserPassword,
    returnReminderMessageHtml,
    confirmationNewConsumerAccountMessageHtml,
    customizedEmailMessageHtml,
    singleEmailMessageHtml
};
