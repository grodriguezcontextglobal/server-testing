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
        Dear ${props.consumer.firstName} ${
    props.consumer.lastName
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

      <a href="${
        props.link
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
        Dear ${props.consumer.firstName} ${
    props.consumer.lastName
  }, this email confirms that all devices shown have been returned successfully from the transaction below.
      </p>

      <table>
        <thead>
          <tr>
            <th>Device type</th>
            <th>Serial number</th>
            <th>Device status</th>
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
              <td class="${
                device.device.status ? "text-danger" : "text-success"
              }">${rendering(device.device.status)}</td>
              <td>${device.paymentIntent}</td>
              <td>${new Date().toLocaleDateString()}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>

      <a href="${
        props.link
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
          Deposit released confirmation
          </h1>
          <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
          This email confirms that the $${props.amount} deposit has been released and returned to you from the transaction detailed below.
          </p>
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
            <p style="width: 100%; text-align: left">Event: <strong>${props.event}</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Company: <strong>${props.company}</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Date and time: <strong>${props.date} ${props.time}</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Transaction ID: <strong>${props.transaction}</strong></p>
          </div>
          </div>
          </div>
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

const capturingDepositMessageHtml = (props) => {
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
          width: 100%;
          padding: 2rem;
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
          Deposit captured confirmation
          </h1>
          <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
          This email confirms that $${props.amount} of your deposit has been charged due to the lost devices from the transaction detailed below.
          </p>
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
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Event: <strong>${props.event}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Company: <strong>${props.company}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Date: <strong>${props.date} ${props.time}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Time: <strong>${props.time}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">Transaction ID: <strong>${props.transaction}</strong></div>
          </div>
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
          This email confirms that $${
            props.amount
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
            <p style="width: 100%; text-align: left">Event: <strong>${
              props.event
            }</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Company: <strong>${
              props.company
            }</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Date and time: <strong>${
              props.date
            }</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Transaction ID: <strong>${
              props.transaction
            }</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Device: <strong>${
              props.device.deviceType ?? props.type
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

const confirmationNewConsumerAccountMessageHtml = (props) => {
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
          Please confirm your account
        </h1>
        <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
          Please click the button below to confirm your account in the Devitrak
          app and manage your devices and transactions at ${props.event} with
          ${props.company}.
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
            background:#155eef;
            -shadow: 0px 1px 2px 0px rgba(16, 24, 40, 0.05);
            text-decoration: none;
          "
          ><p
            style="
              color:#fff;
              font-size: 16px;
              font-style: normal;
              font-weight: 600;
              line-height: 24px; /* 150% */
            "
          >
            Confirm account
          </p>
        </a>
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

const linkToLoginExistingConsumerMessageHtml = (props) => {
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
            Welcome back!
          </h1>
          <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
            Please click the button below to log in to the Devitrak app and manage
            your devices and transactions with ${props.company}.
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
              background:#155eef;
              box-shadow: 0px 1px 2px 0px rgba(16, 24, 40, 0.05);
              text-decoration: none;
            "
          ><p
            style="
                color:#fff;
                font-size: 16px;
                font-style: normal;
                font-weight: 600;
                line-height: 24px; /* 150% */
                text-align: center;
                width: 100%;
              "
          >
              Log in
            </p>
            </a>
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
<html lang="en" translate="no">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Refund Confirmation - Devitrak</title>
    <style>
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap");
        body {
            background-color: #fff;
            color: #1a202c;
            font-family: 'Inter', sans-serif;
            margin: 0;
            padding: 0;
            width: 100%;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            border-radius: 12px;
            border: 1px solid #e0e0e0;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }
        .header {
            text-align: right;
            color: #475467;
            font-size: 0.575rem;
            margin: 20px 0;
        } 
        
        .footer {
            text-align: center;
            color: #475467;
            font-size: 0.875rem;
            margin: 20px 0;
        }
        .footer {
            border-top: 1px solid #e0e0e0;
            padding-top: 20px;
        }
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
            margin-bottom: 20px;
        }
        .details-box p {
            font-size: 0.95rem;
            color: #475467;
            margin-bottom: 10px;
        }
        .details-box .heading {
            font-weight: 600;
            color: #101828;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <p>Powered by</p>
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_logo_layer_1_h5n4tc.png" alt="Devitrak Logo" />
            <img src="https://res.cloudinary.com/dpdzkhh07/image/upload/v1737544399/devitrak_name_layer_1_wxctt1.png" alt="Devitrak Name" />
        </div>
        <div class="content">
            <h1 class="title">Refund Confirmation</h1>
            <p>We are pleased to confirm that the amount of <strong>$${props.amount}</strong> has been successfully refunded on <strong>${props.date}</strong>.</p>
            <p>Below, you'll find the details of your refund for your records:</p>
            <div class="details-box">
                <p class="heading">Refund Details</p>
                <p>Confirmation Code: <strong>${props.paymentIntent}</strong></p>
                <p>Name: <strong>${props.customer}</strong></p>
                <p>Refund Amount: <strong>$${props.amount}</strong></p>
            </div>
            <p>Please keep this email for your personal records.</p>
        </div>
        <div class="footer">
            <p>This email was sent from an unmonitored account. Please do not reply to this email.</p>
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
        Dear ${props.consumer.firstName} ${
    props.consumer.lastName
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
              <td class="${
                device.device.status ? "text-danger" : "text-success"
              }">${rendering(device.device.status)}</td>
              <td>${device.paymentIntent}</td>
              <td>${new Date().toLocaleDateString()}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>

      <a href="${
        props.link
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
          Thank you for using Devitrak to manage your devices at ${props.eventName}! We’d love to hear about your
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

module.exports = {
  returnConfirmationMessageHtml,
  assigningDeviceMessageHtml,
  cancelingDepositMessageHtml,
  capturingDepositMessageHtml,
  staffNotificationMessageHtml,
  staffInternalNotificationMessageHtml,
  editingDeviceAdminMessageHtml,
  lostDeviceFeeCollectedMessageHtml,
  linkToLoginExistingConsumerMessageHtml,
  linkToResetUserPassword,
  returnReminderMessageHtml,
  confirmationNewConsumerAccountMessageHtml,
  customizedEmailMessageHtml,
  singleEmailMessageHtml,
  newUserInvitationMessageHtml,
  eventBeginsReminderHtmlMessage,
  reportBugMessageHtml,
  itemInfoStaffNotificationMessageHtml,
  eventLinkEventHtml,
  serviceChargeInvoiceEmailHtml,
  serviceRefundConfirmationEmailHtml,
  deviceReportPerTransactionMessageHtml,
  devitrakFeedbackEmailMessageHtml,
};
