const logger = require("../helpers/logger");

const assigningDeviceMessageHtml = (props) => {
  const rendering = (props) => {
    if (typeof props === "string") {
      return props;
    } else {
      if (props) {
        return "In-use";
      } else {
        return "Returned";
      }
    }
  };

  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Devices Returned Receipt</title>
    <style>
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

      a {
        display: block;
        text-align: center;
        margin: 20px auto;
        padding: 10px 20px;
        color: #fff;
        background-color: #155eef;
        text-decoration: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
      }

            .qr-code {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
      }


      .footer {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
      }

      /* Responsive Design */
      @media only screen and (max-width: 600px) {
        h1 {
          font-size: 20px;
        }

        p, th, td {
          font-size: 12px;
        }

        a {
          font-size: 14px;
          padding: 8px 16px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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

      <h1>Devices Assignment Receipt</h1>
      <p>
        Dear ${props.consumer.firstName} ${props.consumer.lastName
    }, this email confirms that all devices have been assigned successfully from the transaction below.
      </p>

      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Serial number</th>
            <th>Transaction ID</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${props.devices
      .map(
        (device) => `
            <tr>
              <td>${device.deviceType}</td>
              <td>${device.serialNumber}</td>
              <td>${device.paymentIntent}</td>
              <td>${new Date().toLocaleDateString()}</td>
            </tr>
          `
      )
      .join("")}
        </tbody>
      </table>

      <a href="${props.link
    }" target="_blank"><p style="font-size: 0.95rem; color: #fff; margin-bottom: 10px;">Open App</p></a>

      <div class="qr-code">
      </div>
      <div class="footer">
        <p>This email was sent from an unmonitored account. Do not reply to this email.</p>
      </div>
    </div>
  </body>
</html>
  `;
};

const returnConfirmationMessageHtml = (props) => {
  const rendering = (props) => {
    if (typeof props === "string") {
      return props;
    } else {
      if (props) {
        return "In-use";
      } else {
        return "Returned";
      }
    }
  };

  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Devices Returned Receipt</title>
    <style>
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

      a {
        display: block;
        text-align: center;
        margin: 20px auto;
        padding: 10px 20px;
        color: #fff;
        background-color: #155eef;
        text-decoration: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
      }

            .qr-code {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
      }


      .footer {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
      }
      
      .text-success {
        color: #155eef;
        font-weight: bold;
        padding:5px;
        background-color:#fff;
      }

      .text-danger {
        color: #ff0000;
        font-weight: bold;
        padding:5px;
        background-color:#fff;
      }


      /* Responsive Design */
      @media only screen and (max-width: 600px) {
        h1 {
          font-size: 20px;
        }

        p, th, td {
          font-size: 12px;
        }

        a {
          font-size: 14px;
          padding: 8px 16px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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

      <h1>Devices Returned Receipt</h1>
      <p>
        Dear ${props.consumer.firstName} ${props.consumer.lastName
    }, this email confirms that all devices shown have been returned successfully from the transaction below.
      </p>

      <table>
        <thead>
          <tr>
            <th>Device type</th>
            <th>Serial number</th>
            <th>Transaction ID</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${props.devices
      .map(
        (device) => `
            <tr>
              <td>${device.device.deviceType}</td>
              <td>${device.device.serialNumber}</td>
              <td>${device.paymentIntent}</td>
              <td>${new Date().toLocaleDateString()}</td>
            </tr>
          `
      )
      .join("")}
        </tbody>
      </table>

      <a href="${props.link
    }" target="_blank"><p style="font-size: 0.95rem; color: #fff; margin-bottom: 10px;">Open App</p></a>

      <div class="qr-code">
      </div>
      <div class="footer">
        <p>This email was sent from an unmonitored account. Do not reply to this email.</p>
      </div>
    </div>
  </body>
</html>
`;
};

const cancelingDepositMessageHtml = (props) => {
  logger.info(props);
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <!-- Ensures responsiveness on mobile devices -->
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>Deposit Released Confirmation</title>
    <style>
      /* Basic resets and responsive styles for email clients */
      body,
      table,
      td,
      p {
        margin: 0;
        padding: 0;
      }
      body {
        font-family: Arial, sans-serif;
        background-color: #ffffff;
        color: #333333;
      }
      a {
        text-decoration: none;
        color: inherit;
      }
      img {
        display: block;
        border: none;
        outline: none;
        text-decoration: none;
      }
      /* 
        Use tables for layout to ensure better compatibility across 
        email clients (e.g., Outlook).
      */
    </style>
  </head>
  <body>
    <!-- Preheader text (hidden) -->
    <div
      style="
        display: none;
        font-size: 0;
        line-height: 0;
        max-height: 0;
        max-width: 0;
        opacity: 0;
        overflow: hidden;
      "
    >
      Deposit released confirmation details inside
    </div>

    <!-- Outer container -->
    <table
      width="100%"
      border="0"
      cellspacing="0"
      cellpadding="0"
      style="margin: 0; padding: 0;"
    >
      <tr>
        <td align="center" style="padding: 20px 10px;">
          <!-- Inner container (max-width for desktop, fluid for mobile) -->
          <table
            width="600"
            border="0"
            cellspacing="0"
            cellpadding="0"
            style="max-width: 600px; width: 100%;"
          >
            <!-- Header row -->
            <tr>

              <td style="padding: 10px 0; text-align: right; vertical-align: middle;">
                <!-- "Powered by devitrak" (using provided devitrak_name_layer_1 image) -->
                <div
                  style="
                    display: inline-block;
                    vertical-align: middle;
                    margin-left: 5px;
                  "
                >
                  <div style="margin: 5px 0 0 0; line-height: 1.4;">
                  <em style="font-size: 12px; color: #888888; margin: 0; padding: 0;">Powered by</em>
                  <div style="display:flex">
                  <img
                    src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
                    alt="devitrak"
                    style="
                      height: 14px;
                      vertical-align: middle;
                      margin-left: 4px;
                    "
                  />
                  <img
                    src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
                    alt="devitrak"
                    style="max-width: 80px;"
                  />
                  </div>
                </div>

                </div>
              </td>
            </tr>

            <!-- Main content -->
            <tr>
              <td
                colspan="2"
                style="
                  background-color: #ffffff;
                  border-radius: 4px;
                  padding: 20px;
                "
              >
                <h1 style="font-size: 22px; margin-bottom: 12px;">
                  Deposit released confirmation
                </h1>
                <p style="font-size: 16px; line-height: 1.5; margin-bottom: 16px;">
                  This email confirms that the 
                  $<strong>${props.amount}</strong> 
                  deposit has been released and returned to you from the
                  transaction detailed below.
                </p>

                <!-- Transaction details -->
                <table
                  width="100%"
                  border="0"
                  cellspacing="0"
                  cellpadding="0"
                  style="
                    background-color: #f9f9f9;
                    border-radius: 4px;
                    margin: 20px 0;
                  "
                >
                  <tr>
                    <td style="padding: 15px;">
                      <p style="font-size: 14px; margin-bottom: 8px;">
                        <strong>Event:</strong> ${props.event}
                      </p>
                      <p style="font-size: 14px; margin-bottom: 8px;">
                        <strong>Company:</strong> ${props.company}
                      </p>
                      <p style="font-size: 14px; margin-bottom: 8px;">
                        <strong>Date:</strong> ${props.date}
                      </p>
                      <p style="font-size: 14px; margin-bottom: 8px;">
                        <strong>Time:</strong> ${props.time}
                      </p>
                      <p style="font-size: 14px; margin-bottom: 0;">
                        <strong>Transaction ID:</strong> ${props.transaction}
                      </p>
                    </td>
                  </tr>
                </table>

                <!-- What to expect section -->
                <h2 style="font-size: 18px; margin-bottom: 8px;">
                  What to expect
                </h2>
                <p style="font-size: 14px; line-height: 1.5; margin-bottom: 16px;">
                  In the application you will be able to request new devices,
                  review your transactions, request support, and get answers to
                  frequently asked questions. For any specific questions please
                  contact the staff at ${props.company}.
                </p>
              </td>
            </tr>

            <!-- Footer row -->
            <tr>
              <td
                colspan="2"
                align="center"
                style="padding: 20px; font-size: 12px; color: #888888;"
              >
                <p style="margin: 0; line-height: 1.4;">
                  &copy;${new Date().getFullYear()}. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
          <!-- End inner container -->
        </td>
      </tr>
    </table>
    <!-- End outer container -->
  </body>
</html>
  `;
};

const capturingDepositMessageHtml = (props) => {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <!-- Ensures responsiveness on mobile devices -->
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>Deposit Captured Confirmation</title>
    <style>
      /* Basic resets and responsive styles for email clients */
      body,
      table,
      td,
      p {
        margin: 0;
        padding: 0;
      }
      body {
        font-family: Arial, sans-serif;
        background-color: #ffffff;
        color: #333333;
      }
      a {
        text-decoration: none;
        color: inherit;
      }
      img {
        display: block;
        border: none;
        outline: none;
        text-decoration: none;
      }
      /* 
        Use tables for layout to ensure better compatibility across 
        email clients (e.g., Outlook).
      */
    </style>
  </head>
  <body>
    <!-- Preheader text (hidden) -->
    <div
      style="
        display: none;
        font-size: 0;
        line-height: 0;
        max-height: 0;
        max-width: 0;
        opacity: 0;
        overflow: hidden;
      "
    >
      Deposit captured confirmation details inside
    </div>

    <!-- Outer container -->
    <table
      width="100%"
      border="0"
      cellspacing="0"
      cellpadding="0"
      style="margin: 0; padding: 0;"
    >
      <tr>
        <td align="center" style="padding: 20px 10px;">
          <!-- Inner container (max-width for desktop, fluid for mobile) -->
          <table
            width="600"
            border="0"
            cellspacing="0"
            cellpadding="0"
            style="max-width: 600px; width: 100%;"
          >
            <!-- Header row -->
            <tr>
              <td style="padding: 10px 0; text-align: right; vertical-align: middle;">
                <!-- "Powered by devitrak" (using provided devitrak_name_layer_1 image) -->
                <!--<div style="display: inline-block; vertical-align: middle;">-->
                <!--  <p style="font-size: 12px; color: #888888; margin: 0; padding: 0;">-->
                <!--    Powered by-->
                <!--  </p>-->
                <!--</div>-->
                <div
                  style="
                    display: inline-block;
                    vertical-align: middle;
                    margin-left: 5px;
                  "
                >
                <p style="margin: 5px 0 0 0; line-height: 1.4;">
                  <em style="font-size: 12px; color: #888888; margin: 0; padding: 0;">Powered by</em>
                  <div style="display:flex;">
                  <img
                    src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
                    alt="devitrak"
                    style="
                      height: 14px;
                      vertical-align: middle;
                      margin-left: 4px;
                    "
                  />
                    <img
                    src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
                    alt="devitrak"
                    style="max-width: 80px;"
                  />
                  </div>
                </p>

                </div>
              </td>
            </tr>

            <!-- Main content -->
            <tr>
              <td
                colspan="2"
                style="
                  background-color: #ffffff;
                  border-radius: 4px;
                  padding: 20px;
                "
              >
                <h1 style="font-size: 22px; margin-bottom: 12px;">
                  Deposit captured confirmation
                </h1>
                <p style="font-size: 16px; line-height: 1.5; margin-bottom: 16px;">
                  This email confirms that 
                  $<strong>${props.amount}</strong> 
                  of your deposit has been charged due to the lost devices from
                  the transaction detailed below.
                </p>

                <!-- Transaction details -->
                <table
                  width="100%"
                  border="0"
                  cellspacing="0"
                  cellpadding="0"
                  style="
                    background-color: #f9f9f9;
                    border-radius: 4px;
                    margin: 20px 0;
                  "
                >
                  <tr>
                    <td style="padding: 15px;">
                      <p style="font-size: 14px; margin-bottom: 8px;">
                        <strong>Event:</strong> ${props.event}
                      </p>
                      <p style="font-size: 14px; margin-bottom: 8px;">
                        <strong>Company:</strong> ${props.company}
                      </p>
                      <p style="font-size: 14px; margin-bottom: 8px;">
                        <strong>Date:</strong> ${props.date}
                      </p>
                      <p style="font-size: 14px; margin-bottom: 8px;">
                        <strong>Time:</strong> ${props.time}
                      </p>
                      <p style="font-size: 14px; margin-bottom: 0;">
                        <strong>Transaction ID:</strong> ${props.transaction}
                      </p>
                    </td>
                  </tr>
                </table>

                <!-- What to expect section -->
                <h2 style="font-size: 18px; margin-bottom: 8px;">
                  What to expect
                </h2>
                <p style="font-size: 14px; line-height: 1.5; margin-bottom: 16px;">
                  In the application you will be able to request new devices,
                  review your transactions, request support, and get answers to
                  frequently asked questions. For any specific questions please
                  contact the staff at ${props.company}.
                </p>
              </td>
            </tr>

            <!-- Footer row -->
            <tr>
              <td
                colspan="2"
                align="center"
                style="padding: 20px; font-size: 12px; color: #888888;"
              >
                <p style="margin: 0; line-height: 1.4;">
                  &copy; ${new Date().getFullYear()}. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
          <!-- End inner container -->
        </td>
      </tr>
    </table>
    <!-- End outer container -->
  </body>
</html>  `;
};

const lostDeviceFeeCollectedMessageHtml = (props) => {
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
          border-radius: 12px;
          width: 100%;
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
                src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
                src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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
          Lost device fee receipt
          </h1>
          <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
          This email confirms that $${props.amount
    } has been charged due to the lost devices from the transaction detailed below.
        <div
            style="
              width: 100%;
              display: flex;
              flex-direction: column;
              margin: 1.5rem auto 0.5rem;
              color: #475467;
              font-size: 1rem;"
            "
          >
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Event: <strong>${props.event
    }</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Company: <strong>${props.company
    }</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Date and time: <strong>${props.date
    }</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Transaction ID: <strong>${props.transaction
    }</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Device: <strong>${props.device.deviceType ?? props.type
    } | ${props.device.serialNumber ?? props.device}</strong></p>
          </div>
          </div>
          </p>
      </div>
      <div style="margin-top: 2.5rem">
      <p style="font-size: 1rem; color: #475467">
      This email was sent from an unmonitored account. Do not reply to this email.    </p>
    </p>
      </div>
     </div>
    </body>
  </html>
`;
};

const lostDeviceFeeReceipt = (props = {}, normalizeLostFeePayload) => {
  const data = normalizeLostFeePayload(props);

  return `
<!DOCTYPE html>
<html lang="en">
  <body style="font-family: Arial, sans-serif; color:#333; background:#fff;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:20px;">
          <table width="600" style="max-width:600px;width:100%;">
            <tr>
              <td style="padding:20px;">
                <h1 style="font-size:22px;">Lost device fee payment receipt</h1>

                <p>Hello <strong>${data.consumerName}</strong>,</p>

                <p>
                  This email confirms that your lost device fee payment was collected
                  for <strong>${data.event}</strong> with 
                  <strong>${data.company}</strong>.
                </p>

                <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
                  <tr>
                    <td><strong>Device</strong></td>
                    <td>${data.deviceType}</td>
                  </tr>
                  <tr>
                    <td><strong>Serial number</strong></td>
                    <td>${data.serialNumber}</td>
                  </tr>
                  <tr>
                    <td><strong>Amount</strong></td>
                    <td>$${Number(data.amount).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td><strong>Transaction</strong></td>
                    <td>${data.transaction}</td>
                  </tr>
                  <tr>
                    <td><strong>Date</strong></td>
                    <td>${data.date} ${data.time}</td>
                  </tr>
                </table>

                ${
                  data.link && data.link !== "#"
                    ? `
                    <p style="margin-top:24px;">
                      <a href="${data.link}" style="background:#007bff;color:white;padding:12px 20px;text-decoration:none;border-radius:4px;">
                        View transaction
                      </a>
                    </p>`
                    : ""
                }

                <p style="font-size:12px;color:#888;margin-top:30px;">
                  This email was sent from an unmonitored account. Please do not reply.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
};
const confirmationNewConsumerAccountMessageHtml = (props) => {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <!-- Ensures responsiveness on mobile devices -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Please Confirm Your Account</title>
    <style>
      /* Basic resets and responsive styles for email clients */
      body,
      table,
      td,
      p {
        margin: 0;
        padding: 0;
      }
      body {
        font-family: Arial, sans-serif;
        background-color: #ffffff;
        color: #333333;
      }
      a {
        text-decoration: none;
        color: inherit;
      }
      img {
        display: block;
        border: none;
        outline: none;
        text-decoration: none;
      }
      /* 
        Use tables for layout to ensure better compatibility across 
        email clients (e.g., Outlook).
      */
    </style>
  </head>
  <body>
    <!-- Preheader text (hidden) -->
    <div
      style="
        display: none;
        font-size: 0;
        line-height: 0;
        max-height: 0;
        max-width: 0;
        opacity: 0;
        overflow: hidden;
      "
    >
      Please confirm your account
    </div>

    <!-- Outer container -->
    <table
      width="100%"
      border="0"
      cellspacing="0"
      cellpadding="0"
      style="margin: 0; padding: 0;"
    >
      <tr>
        <td align="center" style="padding: 20px 10px;">
          <!-- Inner container (max-width for desktop, fluid for mobile) -->
          <table
            width="600"
            border="0"
            cellspacing="0"
            cellpadding="0"
            style="max-width: 600px; width: 100%;"
          >
            <!-- Header row -->
            <tr>
              <!-- Devitrak (Right) -->
              <td style="display:flex; flex-direction:column; justify-content:flex-end">
                <div
                  style="
                    display: inline-block;
                    vertical-align: middle;
                    margin-left: 5px;
                  "
                >
                  <p style="font-size: 12px; color: #888888; margin: 0;">
                    Powered by
                  </p>
                </div>
                <div
                  style="
                    display: flex;
                    <!--vertical-align: middle;-->
                    <!--margin-left: 5px;-->
                  "
                >
                  <!-- Devitrak Logo + Name -->
                  <img
                    src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
                    alt="devitrak"
                    style="
                      height: 14px;
                      vertical-align: middle;
                      margin-right: 4px;
                    "
                  />
                  <img
                    src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
                    alt="devitrak"
                    style="max-width: 80px; vertical-align: middle;"
                  />
                </div>
              </td>
            </tr>

            <!-- Main content -->
            <tr>
              <td
                colspan="2"
                style="
                  background-color: #ffffff;
                  border-radius: 4px;
                  padding: 20px;
                "
              >
                <h1 style="font-size: 22px; margin-bottom: 12px;">
                  Please confirm your account
                </h1>
                <p style="font-size: 16px; line-height: 1.5; margin-bottom: 16px;">
                  Please click the button below to confirm your account and
                  manage your devices and transactions at
                  <strong>${props.event}</strong> with
                  <strong>${props.company}</strong>.
                </p>

                <!-- Confirm button -->
                <table
                  border="0"
                  cellspacing="0"
                  cellpadding="0"
                  align="center"
                  style="margin: 20px auto;"
                >
                  <tr>
                    <td
                      align="center"
                      style="
                        background-color: #007bff;
                        padding: 12px 24px;
                        border-radius: 4px;
                      "
                    >
                      <a
                        href="${props.link}"
                        style="
                          color: #ffffff;
                          font-size: 16px;
                          text-decoration: none;
                          display: inline-block;
                        "
                      >
                        Confirm account
                      </a>
                    </td>
                  </tr>
                </table>

                <!-- What to expect -->
                <h2 style="font-size: 18px; margin-bottom: 8px;">
                  What to expect
                </h2>
                <p style="font-size: 14px; line-height: 1.5; margin-bottom: 16px;">
                  In the application you will be able to request new devices,
                  review your transactions, request support, and get answers to
                  frequently asked questions. For any specific questions please
                  contact the staff at
                  <strong>${props.company}</strong>.
                </p>
              </td>
            </tr>

            <!-- Footer row -->
            <tr>
              <td
                colspan="2"
                align="center"
                style="padding: 20px; font-size: 12px; color: #888888;"
              >
                <p style="margin: 0 0 10px 0; line-height: 1.4;">
                  &copy; ${new Date().getFullYear()}. 
                  All rights reserved.
                </p>
                <p style="margin: 0; line-height: 1.4;">
                  This email was sent from an unmonitored account. 
                  Please do not reply to this email.
                </p>
              </td>
            </tr>
          </table>
          <!-- End inner container -->
        </td>
      </tr>
    </table>
    <!-- End outer container -->
  </body>
</html>
`;
};

const linkToLoginExistingConsumerMessageHtml = (props) => {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <!-- Ensures responsiveness on mobile devices -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Welcome Back</title>
    <style>
      /* Basic resets and responsive styles for email clients */
      body,
      table,
      td,
      p {
        margin: 0;
        padding: 0;
      }
      body {
        font-family: Arial, sans-serif;
        background-color: #ffffff;
        color: #333333;
      }
      a {
        text-decoration: none;
        color: inherit;
      }
      img {
        display: block;
        border: none;
        outline: none;
        text-decoration: none;
      }
      /* 
        Use tables for layout to ensure better compatibility across 
        email clients (e.g., Outlook).
      */
    </style>
  </head>
  <body>
    <!-- Preheader text (hidden) -->
    <div
      style="
        display: none;
        font-size: 0;
        line-height: 0;
        max-height: 0;
        max-width: 0;
        opacity: 0;
        overflow: hidden;
      "
    >
      Log in to the Devitrak app
    </div>

    <!-- Outer container -->
    <table
      width="100%"
      border="0"
      cellspacing="0"
      cellpadding="0"
      style="margin: 0; padding: 0;"
    >
      <tr>
        <td align="center" style="padding: 20px 10px;">
          <!-- Inner container (max-width for desktop, fluid for mobile) -->
          <table
            width="600"
            border="0"
            cellspacing="0"
            cellpadding="0"
            style="max-width: 600px; width: 100%;"
          >
            <!-- Header row -->
            <tr>
              <!-- Devitrak (Right) -->
              <td style="display:flex; flex-direction:column">
                <div
                  style="
                    display: inline-block;
                    vertical-align: middle;
                    margin-left: 5px;
                  "
                >
                  <p style="font-size: 12px; color: #888888; margin: 0;">
                    Powered by
                  </p>
                </div>
                <div
                  style="display:flex"
                >
                  <!-- Devitrak Logo + Name -->
                  <img
                    src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
                    alt="devitrak"
                    style="
                      height: 14px;
                      vertical-align: middle;
                      margin-right: 4px;
                    "
                  />
                  <img
                    src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
                    alt="devitrak"
                    style="max-width: 80px; vertical-align: middle;"
                  />
                </div>
              </td>
            </tr>

            <!-- Main content -->
            <tr>
              <td
                colspan="2"
                style="
                  background-color: #ffffff;
                  border-radius: 4px;
                  padding: 20px;
                "
              >
                <h1 style="font-size: 22px; margin-bottom: 12px;">
                  Welcome back!
                </h1>
                <p style="font-size: 16px; line-height: 1.5; margin-bottom: 16px;">
                  Please click the button below to log in to the Devitrak app
                  and manage your devices and transactions in ${props.event
      ? props.event.eventInfoDetail.eventName
      : "this event"
    } with
                  <strong>${props.company}</strong>.
                </p>

                <!-- Login button -->
                <table
                  border="0"
                  cellspacing="0"
                  cellpadding="0"
                  align="center"
                  style="margin: 20px auto; width:100%"
                >
                  <tr>
                    <td
                      align="center"
                      style="
                        background-color: #007bff;
                        padding: 12px 24px;
                        border-radius: 4px;
                        width:100%
                      "
                    >
                      <a
                        href="${props.link}"
                        style="
                          color: #ffffff;
                          font-size: 16px;
                          text-decoration: none;
                          display: inline-block;
                          width:100%
                        "
                      >
                        Log in
                      </a>
                    </td>
                  </tr>
                </table>

                <!-- What to expect -->
                <h2 style="font-size: 18px; margin-bottom: 8px;">
                  What to expect
                </h2>
                <p style="font-size: 14px; line-height: 1.5; margin-bottom: 16px;">
                  In the application you will be able to request new devices,
                  review your transactions, request support, and get answers to
                  frequently asked questions. For any specific questions please
                  contact the staff at <strong>${props.company}</strong>.
                </p>
              </td>
            </tr>

            <!-- Footer row -->
            <tr>
              <td
                colspan="2"
                align="center"
                style="padding: 20px; font-size: 12px; color: #888888;"
              >
                <p style="margin: 0 0 10px 0; line-height: 1.4;">
                  &copy; ${new Date().getFullYear()}. All rights reserved.
                </p>
                <p style="margin: 0; line-height: 1.4;">
                  This email was sent from an unmonitored account. 
                  Please do not reply to this email.
                </p>
              </td>
            </tr>
          </table>
          <!-- End inner container -->
        </td>
      </tr>
    </table>
    <!-- End outer container -->
  </body>
</html>  `;
};

const linkToResetUserPassword = (props) => {
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
        background-color:#fff;
        color: #1a202c;
        font-family: 'Inter', sans-serif;
        -webkit-text-size-adjust: 100%;
        -ms-text-size-adjust: 100%;
        margin: 0 auto;
        padding: 0;
        width: 320px;
      "
      >
        <div
          style="
          margin-left: auto;
          margin-right: auto;
          padding: 0;
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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
              Reset your password
            </h1>
            <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
              Please click the button below to reset your password to Devitrak.
            </p>

            <a
              href=${props.linkToResetPassword}
              target="_blank"
              style="
              display: flex;
              justify-content: center;
              align-items: center;
              align-self: stretch;
              border-radius: 8px;
              border: 1px solid #155eef;
              background: #155eef;
              box-shadow: 0px 1px 2px 0px rgba(16, 24, 40, 0.05);
              text-decoration: none;
              width:90%;
            "
            >
              <p
                style="
                color:#fff;
                font-size: 16px;
                font-style: normal;
                font-weight: 600;
                line-height: 24px;
                text-align: center;
                width: 100%;
              "
              >
                Reset password
              </p></a
            >
          </div>
          <div style="margin-top: 2.5rem; width:95%; padding:0">
          <p style="font-size: 1rem; color: #475467; text-wrap: pretty;">
          This email was sent from an unmonitored account. Do not reply to this email.    </p>
        </p>
          </div>
    
        </div>
      </body>    
      </html>
  `;
};

const newUserInvitationMessageHtml = (props) => {
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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
      Invitation to create a devitrak account
    </h1>
    <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
      You are invited to create a devitrak account. Please click the button to accept the invitation.
    </p>
    
        <a
          href="${props.link}"
          target="_blank"
          style="
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
            align-self: stretch;
            border-radius: 8px;
            border: 1px solid #155eef;
            background: #155eef;
            margin:auto;box-shadow: 0px 1px 2px 0px rgba(16, 24, 40, 0.05);
            text-decoration: none;
          "
          ><p
            style="
              margin:auto;
              color:#fff;
              text-align: center;
              font-size: 16px;
              font-style: normal;
              font-weight: 600;
              line-height: 24px; /* 150% */
              padding:8px 12px;
            "
          >
            Accept invitation
          </p>
        </a>
    <div style="margin-top: 2.5rem">
    <p style="font-size: 1rem; color: #475467">
    This email was sent from an unmonitored account. Do not reply to this email.    </p>
  </p>
    </div>

      </div>
    </div>
  </body>
</html>
`;
};

const customizedEmailMessageHtml = (props) => {
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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
      Message from ${props.company}
    </h1>
    <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
      This email was sent from ${props.company} related to the event ${props.eventSelected}.
    </p>
    <p
            style="
              border:1px solid #eaecf0;
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
            ${props.message}
          </p>
      <div style="margin-top: 2.5rem">
      <p style="font-size: 1rem; color: #475467">
      This email was sent from an unmonitored account. Do not reply to this email.    </p>
    </p>
      </div>
      </div>
    </div>
  </body>
</html>
  `;
};

const singleEmailMessageHtml = (props) => {
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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
      Message from ${props.company}
    </h1>
    <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
      This email was sent from ${props.company}${props.eventSelected && props.eventSelected.length > 0
      ? ` related to the event ${props.eventSelected}`
      : "."
    }.
    </p>
    <p
            style="
              border:1px solid #eaecf0;
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
            ${props.message}
          </p>
      <div style="margin-top: 2.5rem">
      <p style="font-size: 1rem; color: #475467">
      This email was sent from an unmonitored account. Do not reply to this email.    </p>
      </div>
      </div>
    </div>
  </body>
</html>
  `;
};

const staffNotificationMessageHtml = (props) => {
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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
      Device deleted from ${props.company} record.
    </h1>
    <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
      This email notification sent from ${props.company} .
    </p>
    <p
            style="
              border:1px solid #eaecf0;
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
            ${props.message}
          </p>
      <div style="margin-top: 2.5rem">
      <p style="font-size: 1rem; color: #475467">
      This email was sent from an unmonitored account. Do not reply to this email.    </p>
    </p>
      </div>
      </div>
    </div>
  </body>
</html>
  `;
};

const staffInternalNotificationMessageHtml = (props) => {
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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
      ${props.subject}.
    </h1>
    <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
      This email notification sent from ${props.company} .
    </p>
          <p
          style="
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
          Dear ${props.staffMember},
        </p>
        <br />
        <p
        style="
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
          We are pleased to inform you that you have been assigned as a staff
          member for the upcoming event, ${props.eventInfo.eventName},
          organized by ${props.company}. The event will take place on
          ${props.eventInfo.dateBegin} and will be held at
          ${props.eventInfo.address}. Your role will be integral to the
          success of this event, and we are confident in your abilities to
          contribute positively. Further details regarding your specific
          responsibilities and tasks will be provided soon.
        </p>
        <br />
        <p
        style="
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
          For any questions or additional information, please feel free to
          contact ${props.contactInfo.name}, who is overseeing the event, at
          ${props.contactInfo.email}. We look forward to your participation and
          collaboration.
        </p>
        <p
        style="
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
          Best regards
        </p>

      <div style="margin-top: 2.5rem">
      <p style="font-size: 1rem; color: #475467">
      This email was sent from an unmonitored account. Do not reply to this email.    </p>
    </p>
      </div>
      </div>
    </div>
  </body>
</html>
  `;
};

const eventBeginsReminderHtmlMessage = (props) => {
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
            Powered by
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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
          Upcoming Event Reminder
        </h1>
        <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
          Dear staff member,
        </p>
        <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
          This is a reminder that the event: ${props.event} is ${props.daysToEvent} days away.
        </p>
        <p
          style="
            border: 1px solid #eaecf0;
            border-radius: 12px;
            margin: auto;
            color: #475467;
            text-align: left;
            font-size: 16px;
            font-style: normal;
            font-weight: 400;
            line-height: 24px; /* 150% */
            padding: 12px 8px;
            word-wrap: break-word;
          "
        >
          ${props.message}
        </p>
        <div style="margin-top: 2.5rem">
          <p style="font-size: 1rem; color: #475467">
          This email was sent from an unmonitored account. Do not reply to this email.    </p>
          </p>
        </div>
      </div>
    </div>
  </body>
</html>
  `;
};

const editingDeviceAdminMessageHtml = (props) => {
  return ``;
};

const returnReminderMessageHtml = (props) => {
  return ``;
};

const reportBugMessageHtml = (props) => {
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
            Powered by
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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
          Bug email notification
        </h1>
        <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
          Dear development team,
        </p>
        <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
          This is a notification of a bug found and reported.
        </p>
        <p
          style="
            border: 1px solid #eaecf0;
            border-radius: 12px;
            margin: auto;
            color: #475467;
            text-align: left;
            font-size: 16px;
            font-style: normal;
            font-weight: 400;
            line-height: 24px; /* 150% */
            padding: 12px 8px;
            word-wrap: break-word;
          "
        >
          ${props.message}
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

const itemInfoStaffNotificationMessageHtml = (props) => {
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
                src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
                src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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
        ${props.subject}.
      </h1>
      <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
        This email notification sent from ${props.company} .
      </p>
          <p
          style="
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
      ${props.message}
          <br />
          <p
          style="
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
            For any questions or additional information, please feel free to
            contact ${props.contactInfo.staff}, at
            ${props.contactInfo.email}.
                      </p>
          <p
          style="
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
            Best regards
          </p>
  
        <div style="margin-top: 2.5rem">
        <p style="font-size: 1rem; color: #475467">
        This email was sent from an unmonitored account. Do not reply to this email.    </p>
      </p>
        </div>
        </div>
      </div>
    </body>
  </html>
    `;
};

const eventLinkEventHtml = (props) => {
  return `
<!DOCTYPE html>
<html lang="en-US" translate="no">
<head>
  <meta charset="UTF-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Get Started with the Devitrak Consumer App!</title>
    <style>
        * {
            padding:0;
            margin:0;
            }
    </style>
</head>
<body
  style="
    width: 320px;
    background-color: #fff;
    color: #1a202c;
    font-family: 'Inter', sans-serif;
    -webkit-text-size-adjust: 100%;
    -ms-text-size-adjust: 100%;
    margin: 0 auto;
    padding: 0;
  "
>
  <div
    style="
      <!--margin-left: auto;-->
      <!--margin-right: auto;-->
      padding: 2rem 0;
      width: 100%;
      border-radius: 12px;
    "
  >
    <div style="align-self: flex-start">
      <p
        style="
          text-align: left;
          color: #475467;
          font-size: 9px;
          font-weight: 500;
          line-height: 9px;
        "
      >
        Powered by Devitrak
      </p>
      <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-logo"/>
      <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-name"/>
    </div>

    <h3 style="font-size: 1.5rem; font-weight: 600; color: #101828; margin-bottom: 1rem;text-wrap:balance">
      Get Started with the Devitrak Consumer App!
    </h3>
    <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem;text-wrap:balance">
      The Devitrak Consumer App allows event participants to reserve and manage devices before the event starts (${props.eventName}). 
      Simply access the event link, explore available devices, and make your requests with ease.
    </p>

    <!-- Video Thumbnail with Link -->
    <div
      style="
        text-align: center;
        margin: 1.5rem 0;
      "
    >
      <a href="https://res.cloudinary.com/dpdzkhh07/image/upload/v1730138049/giphy_pbroif.gif" target="_blank" style="text-decoration: none;">
        <img
          src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1730138049/giphy_pbroif.gif"
          alt="Watch our Devitrak Consumer App overview video on YouTube"
          style="border-radius: 8px;width:100px; height100px;;"
        />
      </a>
      <p style="font-size: 0.9rem; color: #475467;text-wrap:balance">Click the image above to watch an introduction to the app.</p>
    </div>

    <p style="font-size: 16px; color: #475467; text-wrap:balance padding: 12px 8px;">
      See how our app can simplify your experience and give you control over device management at events.
    </p>

    <!-- Access Event Link Button -->
    <div style="text-align: center; margin: 2rem 0;">
      <a
        href="${props.buttonLink}"
        style="
          display: inline-block;
          text-decoration: none;
          padding: 12px 24px;
          background-color: #1a73e8;
          color: #ffffff;
          font-weight: 600;
          border-radius: 8px;
          width:fit-content
        "
      >
        Access Event Link
      </a>
    </div>

    <p style="font-size: 16px; color: #475467; text-align: left; padding: 12px 8px;text-wrap:balance">
      For questions or additional help, contact ${props.contactInfo.staff} at ${props.contactInfo.email}.
    </p>

    <p style="font-size: 1rem; color: #475467; margin-top: 2.5rem;text-wrap:balance;">
      This email was sent from an unmonitored account. Do not reply to this email.
    </p>
  </div>
</body>
</html>  `;
};

const serviceChargeInvoiceEmailHtml = (props) => {
  // <p
  //     style="font-size: 0.95rem; color: #475467; margin-bottom: 10px;"
  // >
  //     Payment Method: <strong style="text-transform: uppercase;">${props.method.last4} ${props.method.brand}</strong>
  // </p>

  return `
   <html lang="en" translate="no">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Payment Confirmation - Devitrak</title>
    <style>
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap");
    </style>
</head>
<body
    style="
        background-color: #fff;
        color: #1a202c;
        font-family: 'Inter', sans-serif;
        -webkit-text-size-adjust: 100%;
        -ms-text-size-adjust: 100%;
        margin: 0;
        padding: 0;
        width: 100%;
    "
>
    <div
        style="
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            border-radius: 12px;
            border: 1px solid #e0e0e0;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        "
    >
        <div
            style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 30px;
            "
        >
            <div style="flex: 1">
                <p
                    style="
                        text-align: left;
                        color: #475467;
                        font-size: 10px;
                        font-weight: 500;
                    "
                >
                    Powered by
                </p>
                <div
                    style="
                        display: flex;
                        align-items: center;
                        margin-top: 5px;
                    "
                >
                    <img
                        src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
                        alt="Devitrak Logo"
                        style="
                            height: 24px;
                            object-fit: contain;
                            margin-right: 5px;
                        "
                    />
                    <img
                        src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
                        alt="Devitrak Name"
                        style="
                            height: 24px;
                            object-fit: contain;
                        "
                    />
                </div>
            </div>
        </div>
        <div>
            <h1
                style="
                    font-size: 1.5rem;
                    font-weight: 600;
                    color: #101828;
                    margin-bottom: 20px;
                "
            >
                Payment Confirmation
            </h1>
            <p
                style="
                    font-size: 1rem;
                    color: #475467;
                    margin-bottom: 15px;
                "
            >
                We are pleased to confirm that your payment of <strong>$${props.amount}</strong> has been successfully processed on <strong>${props.date}</strong>.
            </p>
            <p style="font-size: 1rem; color: #475467; margin-bottom: 15px;">
                Below, you'll find the details of your payment for your records:
            </p>
            <div
                style="
                    border: 1px solid #e0e0e0;
                    padding: 15px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                "
            >
                <p
                    style="
                        font-size: 1rem;
                        font-weight: 600;
                        color: #101828;
                        margin-bottom: 10px;
                    "
                >
                    Payment Details
                </p>
                <p
                    style="font-size: 0.95rem; color: #475467; margin-bottom: 10px;"
                >
                    Confirmation Code: <strong>${props.paymentIntent}</strong>
                </p>
                <p
                    style="font-size: 0.95rem; color: #475467; margin-bottom: 10px;"
                >
                    Name: <strong>${props.customer}</strong>
                </p>
                <p
                    style="font-size: 0.95rem; color: #475467; margin-bottom: 10px;"
                >
                    Charge Applied: <strong>${props.service}</strong>
                </p>
            </div>
            <p
                style="font-size: 1rem; color: #475467; margin-bottom: 20px;"
            >
                Please keep this email for your personal records.
            </p>
        </div>
        <div
            style="
                border-top: 1px solid #e0e0e0;
                padding-top: 20px;
                margin-top: 30px;
            "
        >
            <p
                style="
                    font-size: 0.875rem;
                    color: #475467;
                    line-height: 1.5;
                    text-align: center;
                "
            >
                This email was sent from an unmonitored account. Please do not reply to this email.
            </p>
        </div>
    </div>
</body>
</html>

`;
};

const serviceRefundConfirmationEmailHtml = (props) => {
  return `
<!DOCTYPE html>
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <!-- Ensures responsiveness on mobile devices -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Refund Confirmation - ${props.company}</title>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap");
      /* Basic resets */
      body,
      table,
      td,
      p {
        margin: 0;
        padding: 0;
      }
      body {
        font-family: 'Inter', Arial, sans-serif;
        background-color: #fff;
        color: #1a202c;
        width: 100%;
      }
      /* Container */
      .container {
        max-width: 600px;
        width: 100%;
        margin: 0 auto;
        padding: 20px;
        border: 1px solid #e0e0e0;
        border-radius: 12px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      }
      /* Header */
      .header {
        text-align: right;
        color: #475467;
        font-size: 0.575rem;
        margin-bottom: 20px;
      }
      .header div {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        width:100%;
      }
      /* Main content */
      .content {
        color: #475467;
        font-size: 1rem;
        line-height: 1.5;
      }
      .title {
        font-size: 1.5rem;
        font-weight: 600;
        color: #101828;
        margin-bottom: 20px;
      }
      .details-box {
        border: 1px solid #e0e0e0;
        padding: 15px;
        border-radius: 8px;
        margin-top: 20px;
        font-size: 0.95rem;
      }
      .details-box .heading {
        font-weight: 600;
        color: #101828;
        margin-bottom: 10px;
      }
      .message-box {
        background-color: #f9f9f9;
        padding: 16px;
        border-radius: 8px;
        margin-top: 16px;
        font-size: 0.95rem;
      }
      /* Footer */
      .footer {
        text-align: center;
        color: #475467;
        font-size: 0.875rem;
        margin-top: 20px;
        border-top: 1px solid #e0e0e0;
        padding-top: 20px;
      }
    </style>
  </head>
  <body>
    <!-- Outer container -->
    <div class="container">
      <!-- Header with Devitrak Branding -->
      <div class="header">
        <p>Powered by</p>
        <div>
          <img
            src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
            alt="Devitrak Logo"
            style="height: 14px; margin-right: 4px;"
          />
          <img
            src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
            alt="Devitrak Name"
            style="max-width: 80px;"
          />
        </div>
      </div>
      <!-- Main Content -->
      <div class="content">
        <h1 class="title">Refund Confirmation</h1>
        <p>
          Message from <strong>${props.company}</strong>
        </p>
        <p>
          This email was sent from <strong>${props.company
    }</strong> regarding the refund for the event <strong>${props.event
    }</strong>.
        </p>
        <p>
          We are pleased to confirm that the amount of <strong>$${props.amount
    }</strong> has been successfully refunded on <strong>${props.date
    }</strong>.
        </p>
        <div class="details-box">
          <p class="heading">Refund Details</p>
          <p>Confirmation Code: <strong>${props.paymentIntent}</strong></p>
          <p>Name: <strong>${props.customer}</strong></p>
          <p>Refund Amount: <strong>$${props.amount}</strong></p>
        </div>
        <div class="message-box">
          ${props.message ? props.message : ""}
        </div>
        <p style="margin-top: 16px;">
          Please keep this email for your records.
        </p>
      </div>
      <!-- Footer -->
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()}. All rights reserved.</p>
        <p>
          This email was sent from an unmonitored account. Please do not reply to this email.
        </p>
      </div>
    </div>
  </body>
</html>
`;
};

const deviceReportPerTransactionMessageHtml = (props) => {
  const rendering = (props) => {
    if (typeof props === "string") {
      return props;
    } else {
      if (props) {
        return "In-use";
      } else {
        return "Returned";
      }
    }
  };
  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Devices Report Per Transaction/Consumer</title>
    <style>
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

      a {
        display: block;
        text-align: center;
        margin: 20px auto;
        padding: 10px 20px;
        color: #fff;
        background-color: #155eef;
        text-decoration: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
      }

            .qr-code {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
      }


      .footer {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
      }

      .text-success {
        color: #155eef;
        font-weight: bold;
        padding:5px;
        background-color:#fff;
      }

      .text-danger {
        color: #ff0000;
        font-weight: bold;
        padding:5px;
        background-color:#fff;
      }

      /* Responsive Design */
      @media only screen and (max-width: 600px) {
        h1 {
          font-size: 20px;
        }

        p, th, td {
          font-size: 12px;
        }

        a {
          font-size: 14px;
          padding: 8px 16px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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

      <h1>Devices Report Per Transaction</h1>
      <p>
        Dear ${props.consumer.firstName} ${props.consumer.lastName
    }, this email confirms that all devices shown have been assigned successfully to the transaction below.
      </p>

      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Serial number</th>
            <th>Status</th>
            <th>Transaction ID</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${props.devices
      .map(
        (device) => `
            <tr>
              <td>${device.device.deviceType}</td>
              <td>${device.device.serialNumber}</td>
              <td class="${device.device.status ? "text-danger" : "text-success"
          }">${rendering(device.device.status)}</td>
              <td>${device.paymentIntent}</td>
              <td>${new Date().toLocaleDateString()}</td>
            </tr>
          `
      )
      .join("")}
        </tbody>
      </table>

      <a href="${props.link
    }" target="_blank"><p style="font-size: 0.95rem; color: #fff; margin-bottom: 10px;">Open App</p></a>

      <div class="qr-code">
      </div>
      <div class="footer">
        <p>This email was sent from an unmonitored account. Do not reply to this email.</p>
      </div>
    </div>
  </body>
</html>
`;
};

const devitrakFeedbackEmailMessageHtml = ({ props }) => {
  return `
<!DOCTYPE html>
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Devitrak App | Manage Inventory Easily</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" />
    <style>
      body {
        max-width: 768px;
        background-color: #fff;
        color: #1a202c;
        font-family: 'Inter', sans-serif;
        margin: 0;
        padding: 0;
      }

      .container {
        margin: auto;
        padding: 2rem;
        width: 100%;
        border-radius: 12px;
      }

      .container_one {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2.5rem;
        width: 100%;
      }

      .container_one_title p {
        text-align: left;
        width: 100%;
        color: #475467;
        font-size: 9px;
        font-weight: 500;
        line-height: 9px;
      }

      .container_one_logo {
        display: flex;
        align-items: center;
        margin-top: 2.5px;
      }

      .container_one_logo img {
        /*object-fit: contain;*/
        /*object-position: center;*/
        align-self: flex-start;
        display: flex;
        align-items: center;
        max-width: 100px;
      }

      .content {
        max-width: 768px;
        min-width: 320px;
      }

      .heading {
        font-size: 1.5rem;
        font-weight: 600;
        color: #101828;
        margin-bottom: 1rem;
      }

      .text {
        font-size: 1rem;
        color: #475467;
        margin-bottom: 1.5rem;
      }

      .button {
        display: flex;
        justify-content: center;
        align-items: center;
        /*gap: 8px;*/
        border-radius: 8px;
        border: 1px solid #155eef;
        background: #155eef;
        box-shadow: 0px 1px 2px 0px rgba(16, 24, 40, 0.05);
        text-decoration: none;
        color: #fff;
        font-size: 16px;
        font-weight: 600;
        line-height: 24px;
        padding: 8px 12px;
        text-align: center;
        width: fit-content;
        margin: auto;
      }

      .footer {
        margin-top: 2.5rem;
        font-size: 1rem;
        color: #475467;
      }

      @media screen and (max-width: 425px) {
      body{
        margin:0;
        padding:0;
        width:95%;
      }

        .container {
        margin: 0;
        padding: 1.2rem;
        /*width: 50vw;*/
        border-radius: 12px;
        }

        .container_one {
          flex-direction: column;
          align-items: flex-start;
        }

        .container_one_logo {
          margin-top: 10px;
        }

        .container_one_logo img {
          max-width: 80px;
        }
        
        .button{
          width:60%;
          padding:5px 10px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="container_one">
        <div class="container_one_title">
          <p>Powered by</p>
          <div class="container_one_logo">
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-name" />
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-logo" />
          </div>
        </div>
      </div>
      <div class="content">
        <h1 class="heading">Hi,</h1>
        <p class="text">
          Thank you for using Devitrak to manage your devices! We’d love to hear about your
          experience. Your feedback helps us improve and ensure a seamless process for future events.
        </p>
        <p class="text">It only takes <strong>2 minutes</strong> to complete the survey!</p>
        <a href="${props.link}" target="_blank" class="button"><p style="color:white;width:100%;text-align:center;">Give feedback now</p></a>
        <div class="footer">
          <p>We appreciate your time and look forward to serving you even better next time.</p>
          <h4>– The Devitrak Team</h4>
        </div>
        <div class="footer">
          <p>This email was sent from an unmonitored account. Do not reply to this email.</p>
        </div>
      </div>
    </div>
  </body>
</html>
`;
};

const nrffInterpretationFeedbackEmailMessageHtml = () => {
  return `
<!DOCTYPE html>
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Interpretation Services | Survey Invitation</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" />
    <style>
      body {
        max-width: 760px;
        background-color: #fff;
        color: #1a202c;
        font-family: 'Inter', sans-serif;
        margin: 0;
        padding: 0;
      }
      .container {
        margin: auto 0;
        padding: 2rem 0;
        width: 100%;
        border-radius: 12px;
      }
      .container_one {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        margin-bottom: 2.5rem;
        width: 100%;
      }
      
      .container_one_title p {
        text-align: left;
        width: 100%;
        color: #475467;
        font-size: 9px;
        font-weight: 500;
        line-height: 9px;
      }
      .container_one_logo {
        display: flex;
        align-items: center;
        margin-top: 2.5px;
      }
      .container_one_logo img {
        align-self: flex-start;
        display: flex;
        align-items: center;
        max-width: 100px;
      }
      
      .content {
        max-width: 768px;
        min-width: 320px;
      }

      .heading {
        font-size: 1.5rem;
        font-weight: 600;
        color: #101828;
        margin-bottom: 1rem;
      }
        
      .text {
        font-size: 1rem;
        color: #475467;
        margin-bottom: 1.5rem;
      }

      .clickable-link-container {
        display:flex;
        flex-direction:column;
        justify-content:space-between;
        align-items:flex-start;
        gap:25px;
      }
      
      .footer {
        margin-top: 2.5rem;
        font-size: 1rem;
        color: #475467;
      }
      @media screen and (max-width: 425px) {
        body {
          margin: 0;
          padding: 0;
          width: 95%;
        }
        .container {
          margin: 0;
          padding: 1.2rem;
          border-radius: 12px;
        }
        .container_one {
          flex-direction: column;
          align-items: flex-start;
        }
        .container_one_logo {
          margin-top: 10px;
        }
        .container_one_logo img {
          max-width: 80px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="container_one">
        <div class="container_one_title">
          <p>Powered by</p>
          <div class="container_one_logo">
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-name" />
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-logo" />
          </div>
        </div>
      </div>
      <div class="content">
        <!-- Portuguese Content -->
        <h1 class="heading">Prezado usuário da NRFF e dos serviços de interpretação,</h1>
        <p class="text">
          Obrigado por utilizar os serviços de interpretação no Javits Center de 13 a 15 de janeiro. Elaboramos uma pesquisa para saber se você gostou dos serviços e como podemos oferecer serviços melhores nos próximos anos. Por favor, reserve um momento para preencher a pesquisa para que possamos usá-la para melhorar as ofertas de serviços. Como recompensa, estamos distribuindo dois cartões-presente da Amazon para duas pessoas que enviarem respostas à nossa pesquisa.
        </p>
        <p class="text">Obrigado por sua ajuda!</p>
        <p class="clickable-link-container">
          Clique no link para responder à pesquisa:<br/>
          <a href="https://forms.office.com/r/1L8bZ4XW6T" target="_blank" class="button">https://forms.office.com/r/1L8bZ4XW6T</a>
        </p>
        <hr style="margin: 2rem 0; border: none; border-top: 1px solid #e2e8f0;" />
        <!-- English Content -->
        <h1 class="heading">Dear NRFF and Interpretation Services user,</h1>
        <p class="text">
          Thank you for using interpretation services at the Javits Center from January 13-15. We have put together a survey to determine whether you enjoyed the services and how we can offer better services in the years to come. Please take a moment to fill out our survey so that we can use it to potentially improve the service offerings. As a reward, we are giving away two Amazon gift cards to two people who submit answers to our survey.
        </p>
        <p class="text">Thank you for your help!</p>
        <p class="clickable-link-container">
          Please click the link to take the survey:<br/>
          <a href="https://forms.office.com/r/1L8bZ4XW6T" target="_blank" class="button">https://forms.office.com/r/1L8bZ4XW6T</a>
        </p>
        <div class="footer">
          <p>We appreciate your time and look forward to serving you even better next time.</p>
          <h4>– Interpretation Services Team</h4>
        </div>
        <div class="footer">
          <p>This email was sent from an unmonitored account. Do not reply to this email.</p>
        </div>
      </div>
    </div>
  </body>
</html>
`;
};

const liabilityContractStaffNotificationMessageHtml = (props) => {
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

  const itemIds = Array.isArray(items)
    ? Array.from(
      new Set(
        items
          .map((it) => it.item_id ?? it.id ?? it.key ?? it.serial_number)
          .filter(Boolean)
      )
    )
    : [];

  const itemIdsParam = itemIds.length
    ? itemIds.map((id) => encodeURIComponent(id)).join(",")
    : "";

  const renderContractLinks = () => {
    return contract_list
      .map(
        (contract) => `
      <tr>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${contract.title
          }</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">
          <a href="https://admin.devitrak.net/display-contracts?company_id=${company_id}&staff_member_id=${staff.staff_member_id
          }&date_reference=${date_reference}&contract_url=${encodeURIComponent(
            contract.view_url
          )}&ver_id=${verification_id}&item_ids=${itemIdsParam}">View</a>
        </td>
      </tr>
    `
      )
      .join("");
  };

  const renderItemsTable = () => {
    return items
      .map(
        (item) => `
      <tr>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${item.serial_number}</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${item.type}</td>
      </tr>
    `
      )
      .join("");
  };

  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Device Liability Contract</title>
    <style>
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

      .container_one {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        margin-bottom: 2.5rem;
        width: 100%;
      }
      
      .container_one_title p {
        text-align: left;
        width: 100%;
        color: #475467;
        font-size: 9px;
        font-weight: 500;
        line-height: 9px;
      }
      
      .container_one_logo {
        display: flex;
        align-items: center;
        margin-top: 2.5px;
      }
      
      .container_one_logo img {
        align-self: flex-start;
        display: flex;
        align-items: center;
        max-width: 100px;
      }

      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #101828;
        margin-bottom: 16px;
      }

      h2 {
        font-size: 20px;
        font-weight: 600;
        color: #101828;
        margin: 24px 0 16px 0;
      }

      p {
        font-size: 16px;
        color: #475467;
        margin-bottom: 16px;
        line-height: 1.5;
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

      .download-link {
        color: #155eef;
        text-decoration: none;
        font-weight: 600;
        padding: 8px 16px;
        background-color: #f0f7ff;
        border-radius: 6px;
        display: inline-block;
        transition: background-color 0.2s;
      }

      .download-link:hover {
        background-color: #e0f0ff;
      }

      .info-section {
        background-color: #f8fafc;
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
      }

      .footer {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #e0e0e0;
      }

      .company-header {
        text-align: center;
        margin-bottom: 30px;
        padding-bottom: 20px;
        border-bottom: 2px solid #155eef;
      }

      .consumer-info {
        background-color: #fff7ed;
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
        border-left: 4px solid #f59e0b;
      }

      /* Action Required banner for contract signing */
      .action-required {
        background-color: #fff1f2; /* subtle red */
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
        border-left: 4px solid #ef4444; /* red accent */
      }
      .action-required h2 {
        margin-top: 0;
      }

      @media screen and (max-width: 425px) {
        body {
          margin: 0;
          padding: 0;
          width: 95%;
        }
        .container {
          margin: 0;
          padding: 1.2rem;
          border-radius: 12px;
        }
        .container_one {
          flex-direction: column;
          align-items: flex-start;
        }
        .container_one_logo {
          margin-top: 10px;
        }
        .container_one_logo img {
          max-width: 80px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="container_one">
        <div class="container_one_title">
          <p>Powered by</p>
          <div class="container_one_logo">
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-name" />
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-logo" />
          </div>
        </div>
      </div>
      
      <div class="company-header">
        <h1>${company_name}</h1>
        <p style="margin: 0; color: #155eef; font-weight: 600;">${email_admin}</p>
      </div>

      <h1>${subject}</h1>
      
      <div class="staff-info">
        <h2>Staff Member Information</h2>
        <p><strong>Name:</strong> ${staff.name}</p>
        <p><strong>Email:</strong> ${staff.email}</p>
      </div>

      <p>Dear ${staff.name},</p>

      <!-- Action Required: signing contracts is mandatory before device issuance -->
      <div class="action-required">
        <h2>Action Required</h2>
        <p>To receive your assigned device, you must sign the liability contracts linked in this email.</p>
        <ul style="color: #475467; line-height: 1.6; margin: 0;">
          <li>Open each contract using the "View" link provided.</li>
          <li>Complete the signature workflow for all contracts listed.</li>
          <li>Devices will not be issued until all contracts are signed.</li>
        </ul>
      </div>
      
      <p>This email contains important liability information for device assignments. You must sign all contracts before device pickup or usage.</p>

      <div class="info-section">
        <h2>Liability Contracts</h2>
        <p>You must open each link and complete the signature for every contract listed below:</p>
        
        <table>
          <thead>
            <tr>
              <th>Contract Title</th>
              <th>Sign & Open</th>
            </tr>
          </thead>
          <tbody>
            ${renderContractLinks()}
          </tbody>
        </table>
      </div>

      <div class="info-section">
        <h2>Assigned Device Information</h2>
        <p>The following devices have been assigned to you:</p>
        
        <table>
          <thead>
            <tr>
              <th>Serial Number</th>
              <th>Device Type</th>
            </tr>
          </thead>
          <tbody>
            ${renderItemsTable()}
          </tbody>
        </table>
      </div>

      <div class="info-section">
        <h2>Important Notes</h2>
        <ul style="color: #475467; line-height: 1.6;">
          <li>Devices will not be issued until all contracts are signed.</li>
          <li>Use each "View" link above to sign and retain a copy.</li>
          <li>Contact the administrator if you have any questions about the contracts or device assignments.</li>
          <li>Report any device issues immediately to avoid liability concerns.</li>
        </ul>
      </div>

      <p>If you have any questions or concerns regarding these contracts or device assignments, please contact the administrator at ${email_admin}.</p>
      
      <p>Thank you for your prompt attention to this matter.</p>
      
      <p>Best regards,<br/>
      ${company_name} Administration Team</p>

      <div class="footer">
        <p>This is an automated message from ${company_name}. Please do not reply to this email.</p>
        <p>For support, contact: ${email_admin}</p>
      </div>
    </div>
  </body>
</html>
  `;
};

const liabilityContractConsumerNotificationMessageHtml = (props) => {
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

  const itemIds = Array.isArray(items)
    ? Array.from(
      new Set(
        items
          .map((it) => it.item_id ?? it.id ?? it.key ?? it.serial_number)
          .filter(Boolean)
      )
    )
    : [];

  const itemIdsParam = itemIds.length
    ? itemIds.map((id) => encodeURIComponent(id)).join(",")
    : "";

  const renderContractLinks = () => {
    return contract_list
      .map(
        (contract) => `
      <tr>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${contract.title
          }</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">
          <a href="https://admin.devitrak.net/display-contracts?company_id=${company_id}&consumer_member_id=${consumer.consumer_member_id
          }&date_reference=${date_reference}&contract_url=${encodeURIComponent(
            contract.view_url
          )}&ver_id=${verification_id}&item_ids=${itemIdsParam}">View</a>
        </td>
      </tr>
    `
      )
      .join("");
  };

  const renderItemsTable = () => {
    return items
      .map(
        (item) => `
      <tr>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${item.serial_number}</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${item.type}</td>
      </tr>
    `
      )
      .join("");
  };

  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Device Liability Contract</title>
    <style>
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

      .container_one {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        margin-bottom: 2.5rem;
        width: 100%;
      }
      
      .container_one_title p {
        text-align: left;
        width: 100%;
        color: #475467;
        font-size: 9px;
        font-weight: 500;
        line-height: 9px;
      }
      
      .container_one_logo {
        display: flex;
        align-items: center;
        margin-top: 2.5px;
      }
      
      .container_one_logo img {
        align-self: flex-start;
        display: flex;
        align-items: center;
        max-width: 100px;
      }

      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #101828;
        margin-bottom: 16px;
      }

      h2 {
        font-size: 20px;
        font-weight: 600;
        color: #101828;
        margin: 24px 0 16px 0;
      }

      p {
        font-size: 16px;
        color: #475467;
        margin-bottom: 16px;
        line-height: 1.5;
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

      .download-link {
        color: #155eef;
        text-decoration: none;
        font-weight: 600;
        padding: 8px 16px;
        background-color: #f0f7ff;
        border-radius: 6px;
        display: inline-block;
        transition: background-color 0.2s;
      }

      .download-link:hover {
        background-color: #e0f0ff;
      }

      .info-section {
        background-color: #f8fafc;
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
      }

      .footer {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #e0e0e0;
      }

      .company-header {
        text-align: center;
        margin-bottom: 30px;
        padding-bottom: 20px;
        border-bottom: 2px solid #155eef;
      }

      .staff-info {
        background-color: #fff7ed;
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
        border-left: 4px solid #f59e0b;
      }

      /* Action Required banner for contract signing */
      .action-required {
        background-color: #fff1f2; /* subtle red */
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
        border-left: 4px solid #ef4444; /* red accent */
      }
      .action-required h2 {
        margin-top: 0;
      }

      @media screen and (max-width: 425px) {
        body {
          margin: 0;
          padding: 0;
          width: 95%;
        }
        .container {
          margin: 0;
          padding: 1.2rem;
          border-radius: 12px;
        }
        .container_one {
          flex-direction: column;
          align-items: flex-start;
        }
        .container_one_logo {
          margin-top: 10px;
        }
        .container_one_logo img {
          max-width: 80px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="container_one">
        <div class="container_one_title">
          <p>Powered by</p>
          <div class="container_one_logo">
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-name" />
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-logo" />
          </div>
        </div>
      </div>
      
      <div class="company-header">
        <h1>${company_name}</h1>
        <p style="margin: 0; color: #155eef; font-weight: 600;">${email_admin}</p>
      </div>

      <h1>${subject}</h1>
      
      <div class="consumer-info">
        <h2>Consumer Member Information</h2>
        <p><strong>Name:</strong> ${consumer.name}</p>
        <p><strong>Email:</strong> ${consumer.email}</p>
      </div>

      <p>Dear ${consumer.name},</p>

      <!-- Action Required: signing contracts is mandatory before device issuance -->
      <div class="action-required">
        <h2>Action Required</h2>
        <p>To receive your assigned device, you must sign the liability contracts linked in this email.</p>
        <ul style="color: #475467; line-height: 1.6; margin: 0;">
          <li>Open each contract using the "View" link provided.</li>
          <li>Complete the signature workflow for all contracts listed.</li>
          <li>Devices will not be issued until all contracts are signed.</li>
        </ul>
      </div>
      
      <p>This email contains important liability information for device assignments. You must sign all contracts before device pickup or usage.</p>

      <div class="info-section">
        <h2>Liability Contracts</h2>
        <p>You must open each link and complete the signature for every contract listed below:</p>
        
        <table>
          <thead>
            <tr>
              <th>Contract Title</th>
              <th>Sign & Open</th>
            </tr>
          </thead>
          <tbody>
            ${renderContractLinks()}
          </tbody>
        </table>
      </div>

      <div class="info-section">
        <h2>Assigned Device Information</h2>
        <p>The following devices have been assigned to you:</p>
        
        <table>
          <thead>
            <tr>
              <th>Serial Number</th>
              <th>Device Type</th>
            </tr>
          </thead>
          <tbody>
            ${renderItemsTable()}
          </tbody>
        </table>
      </div>

      <div class="info-section">
        <h2>Important Notes</h2>
        <ul style="color: #475467; line-height: 1.6;">
          <li>Devices will not be issued until all contracts are signed.</li>
          <li>Use each "View" link above to sign and retain a copy.</li>
          <li>Contact the administrator if you have any questions about the contracts or device assignments.</li>
          <li>Report any device issues immediately to avoid liability concerns.</li>
        </ul>
      </div>

      <p>If you have any questions or concerns regarding these contracts or device assignments, please contact the administrator at ${email_admin}.</p>
      
      <p>Thank you for your prompt attention to this matter.</p>
      
      <p>Best regards,<br/>
      ${company_name} Administration Team</p>

      <div class="footer">
        <p>This is an automated message from ${company_name}. Please do not reply to this email.</p>
        <p>For support, contact: ${email_admin}</p>
      </div>
    </div>
  </body>
</html>
  `;
};

const liabilityContractMemberNotificationMessageHtml = (props) => {
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

  const itemIds = Array.isArray(items)
    ? Array.from(
      new Set(
        items
          .map((it) => it.item_id ?? it.id ?? it.key ?? it.serial_number)
          .filter(Boolean)
      )
    )
    : [];

  const itemIdsParam = itemIds.length
    ? itemIds.map((id) => encodeURIComponent(id)).join(",")
    : "";

  const renderContractLinks = () => {
    return contract_list
      .map(
        (contract) => `
      <tr>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${contract.title
          }</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">
          <a href="https://admin.devitrak.net/display-contracts?company_id=${company_id}&staff_member_id=${member.member_id
          }&date_reference=${date_reference}&contract_url=${encodeURIComponent(
            contract.view_url
          )}&ver_id=${verification_id}&item_ids=${itemIdsParam}">View</a>
        </td>
      </tr>
    `
      )
      .join("");
  };

  const renderItemsTable = () => {
    return items
      .map(
        (item) => `
      <tr>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${item.serial_number}</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${item.type}</td>
      </tr>
    `
      )
      .join("");
  };

  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Device Liability Contract</title>
    <style>
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

      .container_one {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        margin-bottom: 2.5rem;
        width: 100%;
      }
      
      .container_one_title p {
        text-align: left;
        width: 100%;
        color: #475467;
        font-size: 9px;
        font-weight: 500;
        line-height: 9px;
      }
      
      .container_one_logo {
        display: flex;
        align-items: center;
        margin-top: 2.5px;
      }
      
      .container_one_logo img {
        align-self: flex-start;
        display: flex;
        align-items: center;
        max-width: 100px;
      }

      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #101828;
        margin-bottom: 16px;
      }

      h2 {
        font-size: 20px;
        font-weight: 600;
        color: #101828;
        margin: 24px 0 16px 0;
      }

      p {
        font-size: 16px;
        color: #475467;
        margin-bottom: 16px;
        line-height: 1.5;
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

      .download-link {
        color: #155eef;
        text-decoration: none;
        font-weight: 600;
        padding: 8px 16px;
        background-color: #f0f7ff;
        border-radius: 6px;
        display: inline-block;
        transition: background-color 0.2s;
      }

      .download-link:hover {
        background-color: #e0f0ff;
      }

      .info-section {
        background-color: #f8fafc;
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
      }

      .footer {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #e0e0e0;
      }

      .company-header {
        text-align: center;
        margin-bottom: 30px;
        padding-bottom: 20px;
        border-bottom: 2px solid #155eef;
      }

      .consumer-info {
        background-color: #fff7ed;
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
        border-left: 4px solid #f59e0b;
      }

      /* Action Required banner for contract signing */
      .action-required {
        background-color: #fff1f2; /* subtle red */
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
        border-left: 4px solid #ef4444; /* red accent */
      }
      .action-required h2 {
        margin-top: 0;
      }

      @media screen and (max-width: 425px) {
        body {
          margin: 0;
          padding: 0;
          width: 95%;
        }
        .container {
          margin: 0;
          padding: 1.2rem;
          border-radius: 12px;
        }
        .container_one {
          flex-direction: column;
          align-items: flex-start;
        }
        .container_one_logo {
          margin-top: 10px;
        }
        .container_one_logo img {
          max-width: 80px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="container_one">
        <div class="container_one_title">
          <p>Powered by</p>
          <div class="container_one_logo">
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-name" />
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-logo" />
          </div>
        </div>
      </div>
      
      <div class="company-header">
        <h1>${company_name}</h1>
        <p style="margin: 0; color: #155eef; font-weight: 600;">${email_admin}</p>
      </div>

      <h1>${subject}</h1>
      
      <div class="staff-info">
        <h2>Staff Member Information</h2>
        <p><strong>Name:</strong> ${member.name}</p>
        <p><strong>Email:</strong> ${member.email}</p>
      </div>

      <p>Dear ${member.name},</p>

      <!-- Action Required: signing contracts is mandatory before device issuance -->
      <div class="action-required">
        <h2>Action Required</h2>
        <p>To receive your assigned device, you must sign the liability contracts linked in this email.</p>
        <ul style="color: #475467; line-height: 1.6; margin: 0;">
          <li>Open each contract using the "View" link provided.</li>
          <li>Complete the signature workflow for all contracts listed.</li>
          <li>Devices will not be issued until all contracts are signed.</li>
        </ul>
      </div>
      
      <p>This email contains important liability information for device assignments. You must sign all contracts before device pickup or usage.</p>

      <div class="info-section">
        <h2>Liability Contracts</h2>
        <p>You must open each link and complete the signature for every contract listed below:</p>
        
        <table>
          <thead>
            <tr>
              <th>Contract Title</th>
              <th>Sign & Open</th>
            </tr>
          </thead>
          <tbody>
            ${renderContractLinks()}
          </tbody>
        </table>
      </div>

      <div class="info-section">
        <h2>Assigned Device Information</h2>
        <p>The following devices have been assigned to you:</p>
        
        <table>
          <thead>
            <tr>
              <th>Serial Number</th>
              <th>Device Type</th>
            </tr>
          </thead>
          <tbody>
            ${renderItemsTable()}
          </tbody>
        </table>
      </div>

      <div class="info-section">
        <h2>Important Notes</h2>
        <ul style="color: #475467; line-height: 1.6;">
          <li>Devices will not be issued until all contracts are signed.</li>
          <li>Use each "View" link above to sign and retain a copy.</li>
          <li>Contact the administrator if you have any questions about the contracts or device assignments.</li>
          <li>Report any device issues immediately to avoid liability concerns.</li>
        </ul>
      </div>

      <p>If you have any questions or concerns regarding these contracts or device assignments, please contact the administrator at ${email_admin}.</p>
      
      <p>Thank you for your prompt attention to this matter.</p>
      
      <p>Best regards,<br/>
      ${company_name} Administration Team</p>

      <div class="footer">
        <p>This is an automated message from ${company_name}. Please do not reply to this email.</p>
        <p>For support, contact: ${email_admin}</p>
      </div>
    </div>
  </body>
</html>
  `;
};


const returnedItemsToRenterNotificationMessageHtml = (props) => {
  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Returned Items to Rental Company Notification</title>
    <style>
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

      .header {
        text-align: center;
        margin-bottom: 30px;
        padding: 20px 0;
        border-bottom: 2px solid #e0e0e0;
      }

      .header img {
        max-width: 200px;
        height: auto;
        margin-bottom: 10px;
      }

      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #101828;
        margin-bottom: 16px;
        text-align: center;
      }

      p {
        font-size: 16px;
        color: #475467;
        margin-bottom: 24px;
        line-height: 1.5;
      }

      .alert-box {
        background-color: #fef3c7;
        border: 1px solid #f59e0b;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .alert-box h3 {
        color: #92400e;
        margin: 0 0 8px 0;
        font-size: 18px;
        font-weight: 600;
      }

      .alert-box p {
        color: #92400e;
        margin: 0;
        font-size: 14px;
      }

      .supplier-info {
        background-color: #f8fffe;
        border: 1px solid #10b981;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .supplier-info h3 {
        color: #065f46;
        margin: 0 0 12px 0;
        font-size: 18px;
        font-weight: 600;
      }

      .supplier-details {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-top: 12px;
      }

      .supplier-section {
        background-color: #ffffff;
        padding: 12px;
        border-radius: 6px;
        border: 1px solid #d1fae5;
      }

      .supplier-section h4 {
        color: #166534;
        margin: 0 0 8px 0;
        font-size: 14px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .supplier-section p {
        color: #374151;
        margin: 4px 0;
        font-size: 14px;
      }

      .summary {
        background-color: #f0f9ff;
        border: 1px solid #0ea5e9;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .summary h3 {
        color: #0c4a6e;
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }

      .summary p {
        color: #0c4a6e;
        margin: 4px 0;
        font-size: 14px;
      }

      .attachment-notice {
        background-color: #eff6ff;
        border: 1px solid #3b82f6;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
        text-align: center;
      }

      .attachment-notice h3 {
        color: #1e40af;
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }

      .attachment-notice p {
        color: #1e40af;
        margin: 0;
        font-size: 14px;
      }

      .footer {
        font-size: 12px;
        color: #6b7280;
        text-align: center;
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #e5e7eb;
      }

      @media (max-width: 600px) {
        .container {
          padding: 10px;
        }
        
        .supplier-details {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-name" style="max-width: 150px; height: auto;" />
        <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-logo"  style="max-width: 200px; height: auto; margin-left: 10px;" />
      </div>

      <h1>🔄 Items Returned to Rental Company</h1>
      
      <div class="alert-box">
        <h3>⚠️ Admin Notification</h3>
        <p>Rented items have been returned to the renter. Please review the attached spreadsheet for detailed information and take appropriate action if needed.</p>
      </div>

      <p>Dear Admin Team,</p>
      <p>This is an automated notification to inform you that rented items have been returned to the rental company. Please find the rental company details below and check the attached Excel file for the complete list of returned items.</p>

      ${props.supplierInfo
      ? `
      <div class="supplier-info">
        <h3>🏢 Rental Company Information</h3>
        <div style="background-color: #ffffff; padding: 12px; border-radius: 6px; border: 1px solid #d1fae5; margin-bottom: 12px;">
          <h4 style="color: #166534; margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">${props.supplierInfo.companyName
      }</h4>
          <p style="color: #374151; margin: 4px 0; font-size: 14px;"><strong>Industry:</strong> ${props.supplierInfo.industry
      }</p>
          ${props.supplierInfo.services &&
        props.supplierInfo.services.length > 0
        ? `<p style="color: #374151; margin: 4px 0; font-size: 14px;"><strong>Services:</strong> ${props.supplierInfo.services.join(
          ", "
        )}</p>`
        : ""
      }
        </div>
        
        <div class="supplier-details">
          <div class="supplier-section">
            <h4>📍 Address</h4>
            <p>${props.supplierInfo.address.street}</p>
            <p>${props.supplierInfo.address.city}, ${props.supplierInfo.address.state
      } ${props.supplierInfo.address.postalCode}</p>
            <p>${props.supplierInfo.address.country}</p>
          </div>
          
          <div class="supplier-section">
            <h4>📞 Contact Information</h4>
            <p><strong>Email:</strong> <a href="mailto:${props.supplierInfo.contactInfo.email
      }" style="color: #2563eb; text-decoration: none;">${props.supplierInfo.contactInfo.email
      }</a></p>
            <p><strong>Phone:</strong> <a href="tel:${props.supplierInfo.contactInfo.phone
      }" style="color: #2563eb; text-decoration: none;">${props.supplierInfo.contactInfo.phone
      }</a></p>
            ${props.supplierInfo.contactInfo.website
        ? `<p><strong>Website:</strong> <a href="https://${props.supplierInfo.contactInfo.website}" style="color: #2563eb; text-decoration: none;" target="_blank">${props.supplierInfo.contactInfo.website}</a></p>`
        : ""
      }
          </div>
        </div>
      </div>
      `
      : ""
    }

      <div class="summary">
        <h3>📊 Return Summary</h3>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleTimeString("en-US")}</p>
      </div>

      <div class="attachment-notice">
        <h3>📎 Returned Items Details</h3>
        <p>Please check the attached Excel spreadsheet for the complete list of returned items including serial numbers, item groups, and status information.</p>
      </div>

      <p style="font-size: 14px; color: #6b7280; font-style: italic;">This is an automated notification. Please do not reply to this email. For any questions or concerns, please contact the system administrator.</p>

      <div class="footer">
        <p>© 2025 Devitrak. All rights reserved.</p>
        <p>This email was sent to notify administrators of returned rental items.</p>
      </div>
    </div>
  </body>
</html>
  `;
};

const termsAndConditionsAcceptanceMessageHtml = (props) => {
  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Terms and Conditions Acceptance Confirmation</title>
    <style>
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

      .header {
        text-align: center;
        margin-bottom: 30px;
        padding: 20px 0;
        border-bottom: 2px solid #e0e0e0;
      }

      .header img {
        max-width: 200px;
        height: auto;
        margin-bottom: 10px;
      }

      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #101828;
        margin-bottom: 16px;
        text-align: center;
      }

      p {
        font-size: 16px;
        color: #475467;
        margin-bottom: 24px;
        line-height: 1.5;
      }

      .confirmation-box {
        background-color: #f0fdf4;
        border: 1px solid #22c55e;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .confirmation-box h3 {
        color: #15803d;
        margin: 0 0 8px 0;
        font-size: 18px;
        font-weight: 600;
      }

      .confirmation-box p {
        color: #15803d;
        margin: 0;
        font-size: 14px;
      }

      .event-info {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .event-info h3 {
        color: #1e293b;
        margin: 0 0 12px 0;
        font-size: 18px;
        font-weight: 600;
      }

      .event-details {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-top: 12px;
      }

      .detail-item {
        background-color: #ffffff;
        padding: 12px;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      }

      .detail-item h4 {
        color: #374151;
        margin: 0 0 4px 0;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .detail-item p {
        color: #1f2937;
        margin: 0;
        font-size: 14px;
        font-weight: 500;
      }

      .signature-info {
        background-color: #fffbeb;
        border: 1px solid #f59e0b;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .signature-info h3 {
        color: #92400e;
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }

      .signature-info p {
        color: #92400e;
        margin: 4px 0;
        font-size: 14px;
      }

      .next-steps {
        background-color: #eff6ff;
        border: 1px solid #3b82f6;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .next-steps h3 {
        color: #1e40af;
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }

      .next-steps ul {
        color: #1e40af;
        margin: 8px 0;
        padding-left: 20px;
      }

      .next-steps li {
        margin: 4px 0;
        font-size: 14px;
      }

      .footer {
        font-size: 12px;
        color: #6b7280;
        text-align: center;
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #e5e7eb;
      }

      @media (max-width: 600px) {
        .container {
          padding: 10px;
        }
        
        .event-details {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-name" style="max-width: 150px; height: auto;" />
        <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-logo"  style="max-width: 200px; height: auto; margin-left: 10px;" />
      </div>

      <h1>✅ Terms and Conditions Accepted</h1>
      
      <div class="confirmation-box">
        <h3>🎉 Confirmation Successful</h3>
        <p>Thank you for accepting the terms and conditions for the event. Your participation is now confirmed!</p>
      </div>

      <p>Dear ${props.consumer
      ? `${props.consumer.name} ${props.consumer.lastName}`
      : "Valued Participant"
    },</p>
      <p>This email confirms that you have successfully accepted the terms and conditions for the event. Your digital signature has been recorded and your participation is now officially confirmed.</p>

      ${props.event
      ? `
      <div class="event-info">
        <h3>📅 Event Information</h3>
        <div class="event-details">
          <div class="detail-item">
            <h4>Event Name</h4>
            <p>${props.event.eventInfoDetail?.eventName || "Event Name"}</p>
          </div>
          
          <div class="detail-item">
            <h4>Company</h4>
            <p>${props.company?.company_name || "Company Name"}</p>
          </div>
          
          <div class="detail-item">
            <h4>Event Date</h4>
            <p>${props.event.eventInfoDetail?.dateBegin
        ? new Date(
          props.event.eventInfoDetail.dateBegin
        ).toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
        : "Event Date"
      }</p>
          </div>
          
          <div class="detail-item">
            <h4>Location</h4>
            <p>${props.event.eventInfoDetail?.address || "Event Location"}</p>
          </div>
        </div>
      </div>
      `
      : ""
    }

      <div class="signature-info">
        <h3>📝 Signature Details</h3>
        <p><strong>Signature Date:</strong> ${props.signature?.date
      ? new Date(props.signature.date).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
      : new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    }</p>
        <p><strong>Signature Time:</strong> ${new Date().toLocaleTimeString(
      "en-US"
    )}</p>
        <p><strong>Status:</strong> ${props.signature?.accepted ? "Accepted" : "Pending"
    }</p>
      </div>

      <div class="next-steps">
        <h3>📋 What's Next?</h3>
        <ul>
          <li>You can now proceed with device rentals and event participation</li>
          <li>Keep this email as confirmation of your acceptance</li>
          <li>Contact event staff if you have any questions or need assistance</li>
          <li>Review the event details and prepare for your participation</li>
        </ul>
      </div>

      <p style="font-size: 14px; color: #6b7280; font-style: italic;">This is an automated confirmation email. Please keep this for your records. If you have any questions, please contact the event organizers.</p>

      <div class="footer">
        <p>© 2025 Devitrak. All rights reserved.</p>
        <p>This email confirms your acceptance of the event terms and conditions.</p>
      </div>
    </div>
  </body>
</html>
  `;
};

const documentSigningCompletionMessageHtml = (props) => {
  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Document Signing Completion Notification</title>
    <style>
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

      .header {
        text-align: center;
        margin-bottom: 30px;
        padding: 20px 0;
        border-bottom: 2px solid #e0e0e0;
      }

      .header img {
        max-width: 200px;
        height: auto;
        margin-bottom: 10px;
      }

      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #101828;
        margin-bottom: 16px;
        text-align: center;
      }

      p {
        font-size: 16px;
        color: #475467;
        margin-bottom: 24px;
        line-height: 1.5;
      }

      .success-box {
        background-color: #f0fdf4;
        border: 1px solid #22c55e;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .success-box h3 {
        color: #15803d;
        margin: 0 0 8px 0;
        font-size: 18px;
        font-weight: 600;
      }

      .success-box p {
        color: #15803d;
        margin: 0;
        font-size: 14px;
      }

      .staff-info {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .staff-info h3 {
        color: #1e293b;
        margin: 0 0 12px 0;
        font-size: 18px;
        font-weight: 600;
      }

      .staff-details {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-top: 12px;
      }

      .detail-item {
        background-color: #ffffff;
        padding: 12px;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      }

      .detail-item h4 {
        color: #374151;
        margin: 0 0 4px 0;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .detail-item p {
        color: #1f2937;
        margin: 0;
        font-size: 14px;
        font-weight: 500;
      }

      .contract-summary {
        background-color: #fffbeb;
        border: 1px solid #f59e0b;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .contract-summary h3 {
        color: #92400e;
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }

      .contract-list {
        list-style: none;
        padding: 0;
        margin: 8px 0;
      }

.contract-list li {
        background-color: #ffffff;
        padding: 8px 12px;
        margin: 4px 0;
        border-radius: 4px;
        border: 1px solid #e2e8f0;
        font-size: 14px;
        color: #374151;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .contract-list li::before {
        content: "✅";
        margin-right: 8px;
      }

      .contract-link {
        color: #3b82f6;
        text-decoration: none;
        font-weight: 500;
        padding: 4px 8px;
        border-radius: 4px;
        background-color: #eff6ff;
        border: 1px solid #3b82f6;
        font-size: 12px;
        transition: all 0.2s ease;
      }

      .contract-link:hover {
        background-color: #3b82f6;
        color: #ffffff;
        text-decoration: none;
      }

      .contract-info {
        flex: 1;
      }

      .contract-date {
        font-size: 12px;
        color: #6b7280;
        margin-top: 2px;
      }
        
      .next-steps {
        background-color: #eff6ff;
        border: 1px solid #3b82f6;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .next-steps h3 {
        color: #1e40af;
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }

      .next-steps ul {
        color: #1e40af;
        margin: 8px 0;
        padding-left: 20px;
      }

      .next-steps li {
        margin: 4px 0;
        font-size: 14px;
      }

      .footer {
        font-size: 12px;
        color: #6b7280;
        text-align: center;
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #e5e7eb;
      }

      @media (max-width: 600px) {
        .container {
          padding: 10px;
        }
        
        .staff-details {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-name" style="max-width: 150px; height: auto;" />
        <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-logo"  style="max-width: 200px; height: auto; margin-left: 10px;" />
      </div>

      <h1>📋 Agreed and checked All Documents Successfully</h1>
      
      <div class="success-box">
        <h3>🎉 Document Checking Complete</h3>
        <p>All required documents have been checked and signed by the staff member. Equipment delivery can now proceed.</p>
      </div>

      <p>Dear ${props.recipientType === "assigner"
      ? "Equipment Assigner"
      : "Team Member"
    },</p>
      <p>This email confirms that all required liability contracts and documents have been successfully checked and signed by the assigned staff member. ${props.recipientType === "assigner"
      ? "You can now proceed with equipment delivery."
      : "All your document signing requirements have been completed."
    }</p>

      <div class="staff-info">
        <h3>👤 Staff Member Information</h3>
        <div class="staff-details">
          <div class="detail-item">
            <h4>Staff Name</h4>
            <p>${props.staff?.name || "Staff Member"}</p>
          </div>
          
          <div class="detail-item">
            <h4>Email</h4>
            <p>${props.staff?.email || "staff@company.com"}</p>
          </div>
          
          <div class="detail-item">
            <h4>Signing Date</h4>
            <p>${new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })}</p>
          </div>
          
          <div class="detail-item">
            <h4>Checking Time</h4>
            <p>${new Date().toLocaleTimeString("en-US")}</p>
          </div>
        </div>
      </div>

<div class="contract-summary">
        <h3>📄 Checked Documents</h3>
        <p><strong>Total Documents:</strong> ${props.contract_list ? props.contract_list.length : 0
    }</p>
        <ul class="contract-list">
          ${props.contract_list
      ? props.contract_list
        .map(
          (contract) => `
            <li>
              <div class="contract-info">
                <div>${contract.document_name || "Document"}</div>
                <div class="contract-date">Signed on ${contract.date || new Date().toLocaleDateString()
            }</div>
              </div>
              ${contract.document_url
              ? `<a href="${contract.document_url}" class="contract-link" target="_blank">View Document</a>`
              : '<span class="contract-link" style="opacity: 0.5; cursor: not-allowed;">No Link Available</span>'
            }
            </li>
          `
        )
        .join("")
      : '<li><div class="contract-info">No contracts found</div></li>'
    }
        </ul>
      </div>
      <div class="next-steps">
        <h3>📋 Next Steps</h3>
        <ul>
          ${props.recipientType === "assigner"
      ? `
          <li>Proceed with equipment delivery to the staff member</li>
          <li>Update equipment assignment records in the system</li>
          <li>Provide equipment usage instructions and guidelines</li>
          <li>Schedule equipment return date if applicable</li>
          `
      : `
          <li>Await equipment delivery from the assigner</li>
          <li>Review equipment usage guidelines when received</li>
          <li>Contact the assigner if you have any questions</li>
          <li>Keep this email as confirmation of completed documentation</li>
          `
    }
        </ul>
      </div>

      <p style="font-size: 14px; color: #6b7280; font-style: italic;">This is an automated notification. Please keep this email for your records. For any questions, please contact the system administrator.</p>

      <div class="footer">
        <p>© 2025 Devitrak. All rights reserved.</p>
        <p>This email confirms the completion of document signing process.</p>
      </div>
    </div>
  </body>
</html>
  `;
};

const documentSigningCompletionConsumerLeaseMessageHtml = (props) => {
  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Document Signing Completion Notification</title>
    <style>
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

      .header {
        text-align: center;
        margin-bottom: 30px;
        padding: 20px 0;
        border-bottom: 2px solid #e0e0e0;
      }

      .header img {
        max-width: 200px;
        height: auto;
        margin-bottom: 10px;
      }

      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #101828;
        margin-bottom: 16px;
        text-align: center;
      }

      p {
        font-size: 16px;
        color: #475467;
        margin-bottom: 24px;
        line-height: 1.5;
      }

      .success-box {
        background-color: #f0fdf4;
        border: 1px solid #22c55e;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .success-box h3 {
        color: #15803d;
        margin: 0 0 8px 0;
        font-size: 18px;
        font-weight: 600;
      }

      .success-box p {
        color: #15803d;
        margin: 0;
        font-size: 14px;
      }

      .staff-info {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .staff-info h3 {
        color: #1e293b;
        margin: 0 0 12px 0;
        font-size: 18px;
        font-weight: 600;
      }

      .staff-details {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-top: 12px;
      }

      .detail-item {
        background-color: #ffffff;
        padding: 12px;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      }

      .detail-item h4 {
        color: #374151;
        margin: 0 0 4px 0;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .detail-item p {
        color: #1f2937;
        margin: 0;
        font-size: 14px;
        font-weight: 500;
      }

      .contract-summary {
        background-color: #fffbeb;
        border: 1px solid #f59e0b;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .contract-summary h3 {
        color: #92400e;
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }

      .contract-list {
        list-style: none;
        padding: 0;
        margin: 8px 0;
      }

.contract-list li {
        background-color: #ffffff;
        padding: 8px 12px;
        margin: 4px 0;
        border-radius: 4px;
        border: 1px solid #e2e8f0;
        font-size: 14px;
        color: #374151;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .contract-list li::before {
        content: "✅";
        margin-right: 8px;
      }

      .contract-link {
        color: #3b82f6;
        text-decoration: none;
        font-weight: 500;
        padding: 4px 8px;
        border-radius: 4px;
        background-color: #eff6ff;
        border: 1px solid #3b82f6;
        font-size: 12px;
        transition: all 0.2s ease;
      }

      .contract-link:hover {
        background-color: #3b82f6;
        color: #ffffff;
        text-decoration: none;
      }

      .contract-info {
        flex: 1;
      }

      .contract-date {
        font-size: 12px;
        color: #6b7280;
        margin-top: 2px;
      }
        
      .next-steps {
        background-color: #eff6ff;
        border: 1px solid #3b82f6;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .next-steps h3 {
        color: #1e40af;
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }

      .next-steps ul {
        color: #1e40af;
        margin: 8px 0;
        padding-left: 20px;
      }

      .next-steps li {
        margin: 4px 0;
        font-size: 14px;
      }

      .footer {
        font-size: 12px;
        color: #6b7280;
        text-align: center;
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #e5e7eb;
      }

      @media (max-width: 600px) {
        .container {
          padding: 10px;
        }
        
        .staff-details {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-name" style="max-width: 150px; height: auto;" />
        <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-logo"  style="max-width: 200px; height: auto; margin-left: 10px;" />
      </div>

      <h1>📋 Agreed and checked All Documents Successfully</h1>
      
      <div class="success-box">
        <h3>🎉 Document Checking Complete</h3>
        <p>All required documents have been checked and signed by the consumer. Equipment delivery can now proceed.</p>
      </div>

      <p>Dear ${props.recipientType === "assigner" ? "Equipment Assigner" : "Consumer"
    },</p>
      <p>This email confirms that all required liability contracts and documents have been successfully checked and signed by the assigned consumer. ${props.recipientType === "assigner"
      ? "You can now proceed with equipment delivery."
      : "All your document signing requirements have been completed."
    }</p>

      <div class="staff-info">
        <h3>👤 Consumer Information</h3>
        <div class="staff-details">
          <div class="detail-item">
            <h4>Consumer Name</h4>
            <p>${props.consumer?.name || "Consumer"}</p>
          </div>
          
          <div class="detail-item">
            <h4>Email</h4>
            <p>${props.consumer?.email || "consumer@company.com"}</p>
          </div>
          
          <div class="detail-item">
            <h4>Signing Date</h4>
            <p>${new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })}</p>
          </div>
          
          <div class="detail-item">
            <h4>Checking Time</h4>
            <p>${new Date().toLocaleTimeString("en-US")}</p>
          </div>
        </div>
      </div>

<div class="contract-summary">
        <h3>📄 Checked Documents</h3>
        <p><strong>Total Documents:</strong> ${props.contract_list ? props.contract_list.length : 0
    }</p>
        <ul class="contract-list">
          ${props.contract_list
      ? props.contract_list
        .map(
          (contract) => `
            <li>
              <div class="contract-info">
                <div>${contract.document_name || "Document"}</div>
                <div class="contract-date">Signed on ${contract.date || new Date().toLocaleDateString()
            }</div>
              </div>
              ${contract.document_url
              ? `<a href="${contract.document_url}" class="contract-link" target="_blank">View Document</a>`
              : '<span class="contract-link" style="opacity: 0.5; cursor: not-allowed;">No Link Available</span>'
            }
            </li>
          `
        )
        .join("")
      : '<li><div class="contract-info">No contracts found</div></li>'
    }
        </ul>
      </div>
      <div class="next-steps">
        <h3>📋 Next Steps</h3>
        <ul>
          ${props.recipientType === "assigner"
      ? `
          <li>Proceed with equipment delivery to the consumer</li>
          <li>Update equipment assignment records in the system</li>
          <li>Provide equipment usage instructions and guidelines</li>
          <li>Schedule equipment return date if applicable</li>
          `
      : `
          <li>Await equipment delivery from the assigner</li>
          <li>Review equipment usage guidelines when received</li>
          <li>Contact the assigner if you have any questions</li>
          <li>Keep this email as confirmation of completed documentation</li>
          `
    }
        </ul>
      </div>

      <p style="font-size: 14px; color: #6b7280; font-style: italic;">This is an automated notification. Please keep this email for your records. For any questions, please contact the system administrator.</p>

      <div class="footer">
        <p>© 2025 Devitrak. All rights reserved.</p>
        <p>This email confirms the completion of document signing process.</p>
      </div>
    </div>
  </body>
</html>
  `;
};

const loginActivityNotificationMessageHtml = (props) => {
  const { adminUser, loginInfo } = props;
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <title>Login Activity Alert</title>
  </head>
  <body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #ffffff; color: #1a202c; -webkit-text-size-adjust: none; -ms-text-size-adjust: none; line-height: 1.6;">
    
    <!-- Email Container -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0; padding: 0;">
      <tr>
        <td style="padding: 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; max-width: 600px; background-color: #ffffff;" align="center">
            
            <!-- Header -->
            <tr>
              <td style="text-align: center; padding: 32px 20px 24px; background-color: #ffffff;">
                <!-- Logo Container -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td style="text-align: right; padding-bottom: 16px;">
                      <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="Devitrak Logo" style="height: 20px; width: auto; max-width: 120px; vertical-align: middle; margin-right: 12px;" />
                      <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="Devitrak Name" style="height: 20px; width: auto; max-width: 120px; vertical-align: middle;" />
                    </td>
                  </tr>
                </table>
                <!-- Alert Badge -->
                <div style="display: inline-block; background-color: #dc2626; color: #ffffff; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 8px;">
                  🔐 Security Alert
                </div>
              </td>
            </tr>

            <!-- Content -->
            <tr>
              <td style="padding: 32px 24px;">
                
                <!-- Title -->
                <h1 style="font-family: 'Inter', Arial, sans-serif; font-size: 28px; font-weight: 700; color: #101828; margin: 0 0 8px 0; text-align: center; line-height: 1.2;">
                  Login Activity Detected
                </h1>
                
                <!-- Subtitle -->
                <p style="font-family: 'Inter', Arial, sans-serif; font-size: 16px; color: #6b7280; text-align: center; margin: 0 0 32px 0; font-weight: 400;">
                  We've detected a new login to your devitrak account
                </p>

                <!-- Greeting -->
                <div style="font-family: 'Inter', Arial, sans-serif; font-size: 16px; color: #374151; margin-bottom: 24px; line-height: 1.6;">
                  <p style="margin: 0 0 12px 0;">
                    <strong style="font-weight: 600; color: #111827;">Hello ${adminUser.name
    } ${adminUser.lastName},</strong>
                  </p>
                  <p style="margin: 0;">
                    We detected a new login to your Devitrak account. Please review the details below to ensure this activity is authorized.
                  </p>
                </div>

                <!-- Login Details -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin: 32px 0;">
                  <tr>
                    <td style="padding: 24px;">
                      
                      <!-- Details Title -->
                      <h3 style="font-family: 'Inter', Arial, sans-serif; font-size: 18px; font-weight: 600; color: #1f2937; margin: 0 0 16px 0;">
                        📊 Login Details
                      </h3>

                      <!-- Detail Rows -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                              <tr>
                                <td style="font-family: 'Inter', Arial, sans-serif; font-weight: 600; color: #374151; font-size: 14px; width: 30%; vertical-align: top;">
                                  Account Email:
                                </td>
                                <td style="font-family: 'Inter', Arial, sans-serif; color: #6b7280; font-size: 14px; text-align: right; word-break: break-word;">
                                  ${adminUser.email}
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                              <tr>
                                <td style="font-family: 'Inter', Arial, sans-serif; font-weight: 600; color: #374151; font-size: 14px; width: 30%; vertical-align: top;">
                                  Login Time:
                                </td>
                                <td style="font-family: 'Inter', Arial, sans-serif; color: #6b7280; font-size: 14px; text-align: right; word-break: break-word;">
                                  ${loginInfo.timestamp}
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                              <tr>
                                <td style="font-family: 'Inter', Arial, sans-serif; font-weight: 600; color: #374151; font-size: 14px; width: 30%; vertical-align: top;">
                                  IP Address:
                                </td>
                                <td style="font-family: 'Inter', Arial, sans-serif; color: #6b7280; font-size: 14px; text-align: right; word-break: break-word;">
                                  ${loginInfo.ipAddress}
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                              <tr>
                                <td style="font-family: 'Inter', Arial, sans-serif; font-weight: 600; color: #374151; font-size: 14px; width: 30%; vertical-align: top;">
                                  Location:
                                </td>
                                <td style="font-family: 'Inter', Arial, sans-serif; color: #6b7280; font-size: 14px; text-align: right; word-break: break-word;">
                                  ${loginInfo.location || "Unknown"}
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                              <tr>
                                <td style="font-family: 'Inter', Arial, sans-serif; font-weight: 600; color: #374151; font-size: 14px; width: 30%; vertical-align: top;">
                                  Device/Browser:
                                </td>
                                <td style="font-family: 'Inter', Arial, sans-serif; color: #6b7280; font-size: 14px; text-align: right; word-break: break-word;">
                                  ${loginInfo.userAgent}
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        ${loginInfo.timezone
      ? `
                        <tr>
                          <td style="padding: 12px 0 0 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                              <tr>
                                <td style="font-family: 'Inter', Arial, sans-serif; font-weight: 600; color: #374151; font-size: 14px; width: 30%; vertical-align: top;">
                                  Timezone:
                                </td>
                                <td style="font-family: 'Inter', Arial, sans-serif; color: #6b7280; font-size: 14px; text-align: right; word-break: break-word;">
                                  ${loginInfo.timezone}
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        `
      : ""
    }
                      </table>
                      
                    </td>
                  </tr>
                </table>

                <!-- Security Notice -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; border-left: 4px solid #dc2626; margin: 32px 0;">
                  <tr>
                    <td style="padding: 20px;">
                      <h3 style="font-family: 'Inter', Arial, sans-serif; color: #dc2626; font-size: 16px; font-weight: 600; margin: 0 0 12px 0;">
                        ⚠️ Security Notice
                      </h3>
                      <p style="font-family: 'Inter', Arial, sans-serif; color: #7f1d1d; font-size: 14px; margin: 0; line-height: 1.6;">
                        If this login was not authorized by you, please contact your system administrator immediately 
                        and consider changing your password. Unauthorized access to admin accounts can compromise 
                        sensitive company data and system security.
                      </p>
                    </td>
                  </tr>
                </table>

                <!-- Action Button -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td style="text-align: center; padding: 32px 0;">
                      <a href="mailto:support@devitrak.com?subject=Unauthorized%20Login%20Alert%20-%20${encodeURIComponent(
      adminUser.email
    )}&body=I%20received%20a%20login%20alert%20for%20unauthorized%20access%20to%20my%20account.%0A%0AAccount%3A%20${encodeURIComponent(
      adminUser.email
    )}%0ATime%3A%20${encodeURIComponent(
      loginInfo.timestamp
    )}%0AIP%3A%20${encodeURIComponent(loginInfo.ipAddress)}" 
                         style="display: inline-block; padding: 14px 28px; color: #ffffff; background-color: #dc2626; text-decoration: none; border-radius: 8px; font-family: 'Inter', Arial, sans-serif; font-size: 16px; font-weight: 600; text-align: center; max-width: 280px;">
                        Report Suspicious Activity
                      </a>
                    </td>
                  </tr>
                </table>

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
                <p style="font-family: 'Inter', Arial, sans-serif; font-size: 12px; color: #374151; margin: 0 0 4px 0; font-weight: 500;">
                  © 2025 Devitrak. All rights reserved.
                </p>
                <p style="font-family: 'Inter', Arial, sans-serif; font-size: 12px; color: #6b7280; margin: 4px 0; line-height: 1.5;">
                  This is an automated security notification for account: <strong>${adminUser.email
    }</strong>
                </p>
                <p style="font-family: 'Inter', Arial, sans-serif; font-size: 12px; color: #6b7280; margin: 4px 0; line-height: 1.5;">
                  If you have questions, contact support at <strong>support@devitrak.com</strong>
                </p>
                <p style="font-family: 'Inter', Arial, sans-serif; font-size: 12px; color: #6b7280; margin: 4px 0; line-height: 1.5;">
                  This email was sent from an unmonitored account. Please do not reply to this email.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>

  </body>
</html>
  `;
};

const consumerLeaseEndedDeviceReturnedNotificationMessageHtml = (
  propsOrAdminUser,
  loginInfo,
  deviceInfo
) => {
  // Support both object props signature and legacy positional args
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

  const normalizedDevices = Array.isArray(devices)
    ? devices
    : devices && typeof devices === "object"
      ? [devices]
      : [];

  const renderReturnedItemsTable = () => {
    if (!normalizedDevices.length) {
      return `<tr><td colspan="3" style="padding: 12px; border: 1px solid #e0e0e0; color: #475467;">No device details available.</td></tr>`;
    }
    return normalizedDevices
      .map(
        (item) => `
      <tr>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${item.serial_number || item.item_id || item.id || "Unknown"
          }</td>
        <td style="padding: 12px; border: 1px solid #e0e0e0;">${item.type || item.device_type || "Device"
          }</td>
      </tr>
    `
      )
      .join("");
  };

  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Device Return Confirmation</title>
    <style>
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

      .container_one {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        margin-bottom: 2.5rem;
        width: 100%;
      }
      
      .container_one_title p {
        text-align: left;
        width: 100%;
        color: #475467;
        font-size: 9px;
        font-weight: 500;
        line-height: 9px;
      }
      
      .container_one_logo {
        display: flex;
        align-items: center;
        margin-top: 2.5px;
      }
      
      .container_one_logo img {
        align-self: flex-start;
        display: flex;
        align-items: center;
        max-width: 100px;
      }

      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #101828;
        margin-bottom: 16px;
      }

      h2 {
        font-size: 20px;
        font-weight: 600;
        color: #101828;
        margin: 24px 0 16px 0;
      }

      p {
        font-size: 16px;
        color: #475467;
        margin-bottom: 16px;
        line-height: 1.5;
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

      .download-link {
        color: #155eef;
        text-decoration: none;
        font-weight: 600;
        padding: 8px 16px;
        background-color: #f0f7ff;
        border-radius: 6px;
        display: inline-block;
        transition: background-color 0.2s;
      }

      .download-link:hover {
        background-color: #e0f0ff;
      }

      .info-section {
        background-color: #f8fafc;
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
      }

      .footer {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #e0e0e0;
      }

      .company-header {
        text-align: center;
        margin-bottom: 30px;
        padding-bottom: 20px;
        border-bottom: 2px solid #155eef;
      }

      .consumer-info {
        background-color: #eef6ff;
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
        border-left: 4px solid #155eef;
      }

      .success-banner {
        background-color: #ecfdf5; /* green */
        padding: 16px;
        border-radius: 8px;
        margin: 20px 0;
        border-left: 4px solid #10b981;
      }

      @media screen and (max-width: 425px) {
        body {
          margin: 0;
          padding: 0;
          width: 95%;
        }
        .container {
          margin: 0;
          padding: 1.2rem;
          border-radius: 12px;
        }
        .container_one {
          flex-direction: column;
          align-items: flex-start;
        }
        .container_one_logo {
          margin-top: 10px;
        }
        .container_one_logo img {
          max-width: 80px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="container_one">
        <div class="container_one_title">
          <p>Powered by</p>
          <div class="container_one_logo">
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-name" />
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-logo" />
          </div>
        </div>
      </div>

      <div class="company-header">
        <h1>${company_name}</h1>
        <p style="margin: 0; color: #155eef; font-weight: 600;">${email_admin}</p>
      </div>

      <h1>${subject}</h1>

      <div class="consumer-info">
        <h2>Consumer Member Information</h2>
        <p><strong>Name:</strong> ${consumer.name || ""}</p>
        <p><strong>Email:</strong> ${consumer.email || ""}</p>
      </div>

      <div class="success-banner">
        <h2>Return Completed</h2>
        <p>We confirm the leased device has been returned successfully${email_admin ? ` received for <strong>${email_admin}</strong>` : ""
    }.</p>
        <ul style="color: #475467; line-height: 1.6; margin: 0;">
          <li>No further action is required from you.</li>
          <li>If you believe this is a mistake, contact the administrator immediately.</li>
          <li>Keep this email for your records.</li>
        </ul>
      </div>

      <p>Dear ${consumer.name || "Consumer"},</p>
      <p>Thank you for returning your leased device. Below are the details recorded for the returned device(s).</p>

      <div class="info-section">
        <h2>Returned Device Information</h2>
        <table>
          <thead>
            <tr>
              <th>Serial Number</th>
              <th>Device Type</th>
            </tr>
          </thead>
          <tbody>
            ${renderReturnedItemsTable()}
          </tbody>
        </table>
      </div>

      <div class="info-section">
        <h2>What’s Next</h2>
        <ul style="color: #475467; line-height: 1.6;">
          <li>If you have another device in lease, you will receive separate notifications.</li>
          <li>For any billing or deposit matters, please reach out to the administrator.</li>
          <li>Contact support if you need documentation for your records.</li>
        </ul>
      </div>

      <p>If you have any questions or concerns regarding this return, please contact the administrator at ${email_admin}.</p>
      
      <p>Best regards,<br/>
      ${company_name} Administration Team</p>

      <div class="footer">
        <p>This is an automated message from ${company_name}. Please do not reply to this email.</p>
        <p>For support, contact: ${email_admin}</p>
      </div>
    </div>
  </body>
</html>
  `;
};

const returnConfirmationLeaseMemberMessageHtml = (props) => {
  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Devices Returned Receipt</title>
    <style>
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

      a {
        display: block;
        text-align: center;
        margin: 20px auto;
        padding: 10px 20px;
        color: #fff;
        background-color: #155eef;
        text-decoration: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
      }

            .qr-code {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
      }


      .footer {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
      }
      
      .text-success {
        color: #155eef;
        font-weight: bold;
        padding:5px;
        background-color:#fff;
      }

      .text-danger {
        color: #ff0000;
        font-weight: bold;
        padding:5px;
        background-color:#fff;
      }


      /* Responsive Design */
      @media only screen and (max-width: 600px) {
        h1 {
          font-size: 20px;
        }

        p, th, td {
          font-size: 12px;
        }

        a {
          font-size: 14px;
          padding: 8px 16px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
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
              src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
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

      <h1>Devices Returned Receipt</h1>
      <p>
        Dear ${props.member.firstName} ${props.member.lastName
    }, this email confirms that all devices shown have been returned successfully.
      </p>

      <table>
        <thead>
          <tr>
            <th>Device type</th>
            <th>Serial number</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${props.devices
      .map(
        (device) => `
            <tr>
              <td>${device.device.deviceType}</td>
              <td>${device.device.serialNumber}</td>
              <td>${new Date().toLocaleDateString()}</td>
            </tr>
          `
      )
      .join("")}
        </tbody>
      </table>

      <div class="qr-code">
      </div>
      <div class="footer">
        <p>This email was sent from an unmonitored account. Do not reply to this email.</p>
      </div>
    </div>
  </body>
</html>
`;
};

const forceLogoutNotificationHtmlTemplate = (userEmail) => {
  const clientUrl = "https://admin.devitrak.net";
  const timestamp = new Date().getTime();
  const actionUrl = `${clientUrl}/force-logout?timestamp=${timestamp}`;
  return `
  <html lang="en" translate="no">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Force Logout Request</title>
      <style>
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap");
        body {
          margin: 0;
          padding: 0;
          font-family: 'Inter', sans-serif;
          background-color: #f4f4f7;
          color: #1a202c;
        }
        .container {
          margin: 0 auto;
          padding: 20px;
          max-width: 600px;
          background-color: #ffffff;
          border-radius: 8px;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2.5rem;
          width: 100%;
        }
        .logo-container {
          align-self: flex-start;
        }
        .powered-by {
          text-align: left;
          width: 100%;
          color: #475467;
          font-size: 9px;
          font-style: normal;
          font-weight: 500;
          line-height: 9px;
        }
        .logo {
          display: flex;
          align-items: center;
          margin-top: 2.5px;
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
          line-height: 1.5;
        }
        .form-container {
          margin-top: 24px;
        }
        .form-input {
          width: 100%;
          padding: 12px;
          border: 1px solid #d0d5dd;
          border-radius: 8px;
          font-size: 16px;
          margin-bottom: 16px;
          box-sizing: border-box;
        }
        .form-label {
          font-weight: 500;
          margin-bottom: 8px;
          display: block;
          color: #344054;
        }
        .submit-button {
          width: 100%;
          background-color: #155eef;
          color: white;
          padding: 12px 15px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 600;
        }
        .footer {
          font-size: 12px;
          color: #475467;
          text-align: center;
          margin-top: 40px;
        }
      </style>
    </head>
    <body>
      <div style="margin: 0 auto; padding: 20px; max-width: 600px;">
        <div class="container">
          <div class="header">
            <div class="logo-container">
              <p class="powered-by">Powered by</p>
              <div class="logo">
                <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="devitrak-logo" style="height: 14px; vertical-align: middle; margin-right: 4px;" />
                <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="devitrak-name" style="max-width: 80px;" />
              </div>
            </div>
          </div>
          <h1>Action Required: End Your Active Session</h1>
          <p>A login attempt was made for your account, but an active session was already in progress. If this was you, please enter your password below to end your other session and proceed.</p>
          <div class="form-container">
            <form action="${actionUrl}" method="GET">
              <div>
                <label for="email" class="form-label">Email:</label>
                <input type="email" id="email" name="email" value="${userEmail}" required readonly class="form-input" style="background-color: #f0f2f5; cursor: not-allowed;">
              </div>
              <div>
                <label for="cred" class="form-label">Password:</label>
                <input type="password" id="cred" name="cred" required class="form-input">
              </div>
              <div>
                <input type="hidden" name="timestamp" value="${timestamp}">
              </div>
              <button type="submit" class="submit-button">Revoke Active Session</button>
            </form>
          </div>
          <p style="margin-top: 24px; font-size: 14px;">If you did not initiate this request, you can ignore this email. Your account remains secure.</p>
          <div class="footer">
            <p>This email was sent from an unmonitored account. Do not reply to this email.</p>
            <p>&copy; ${new Date().getFullYear()} Devitrak. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
  </html>
  `;
};

const memberEmailNotificationHtml = (props) => {
  const subject = props?.subject || "Notification";
  const message = props?.message || "";

  return `
<html lang="en" translate="no">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Devitrak Notification</title>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap");

      body {
        margin: 0;
        padding: 0;
        font-family: 'Inter', sans-serif;
        background-color: #ffffff;
        color: #101828;
        max-width: 768px;
        min-width: 320px;
      }

      .container {
        margin: 0 auto;
        padding: 24px;
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
        line-height: 24px;
        margin-bottom: 20px;
      }

      .message-box {
        background-color: #f9fafb;
        border: 1px solid #eaecf0;
        border-radius: 12px;
        padding: 20px;
        margin: 24px 0;
      }

      .footer {
        font-size: 12px;
        color: #475467;
        text-align: center;
        margin-top: 40px;
      }

      @media only screen and (max-width: 600px) {
        h1 {
          font-size: 20px;
        }

        p {
          font-size: 14px;
        }

        .container {
          padding: 16px;
        }
      }
    </style>
  </head>

  <body>
    <div class="container">
      <div style="margin-bottom: 2.5rem;">
        <p style="
          text-align: left;
          color: #475467;
          font-size: 9px;
          font-weight: 500;
          line-height: 9px;
          margin-bottom: 4px;
        ">
          Powered by
        </p>

        <div style="display: flex; align-items: center;">
          <img
            src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png"
            alt="devitrak-logo"
            style="object-fit: contain;"
          />
          <img
            src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png"
            alt="devitrak-name"
            style="object-fit: contain;"
          />
        </div>
      </div>

      <h1>${subject}</h1>

      <p>
        Hello,
      </p>

      <p>
        You have received a notification from your staff/company through Devitrak.
      </p>

      <div class="message-box">
        <p style="margin: 0;">
          ${message}
        </p>
      </div>

      <p>
        Please contact your staff/company directly if you have any questions about this message.
      </p>

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
  memberEmailNotificationHtml
};
