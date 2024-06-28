const assigningDeviceMessageHtml = (props) => {
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
              src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
              src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
          Devices assigned receipt
        </h1>
        <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
          This email confirms that you have been assigned a set of devices.
          Please see the details below.
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
            <p style="width: 100%; text-align: left">Date and time: <strong>${props.date}</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Transaction ID: <strong>${props.transaction}</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Device: <strong>${props.device.deviceType} | ${props.device.serialNumber}</strong></p>
          </div>
          </div>
        <a
          href="${props.link}"
          target="_blank"
          style="
            display: flex;
            justify-content: center;
            align-items: center;
            margin:auto;
            gap: 8px;
            align-self: stretch;
            border-radius: 8px;
            border: 1px solid #155eef;
            background: #155eef;
            box-shadow: 0px 1px 2px 0px rgba(16, 24, 40, 0.05);
            text-decoration: none;
          "
          ><p
            style="
              color:#fff;
              margin:auto;
              font-size: 16px;
              font-style: normal;
              font-weight: 600;
              line-height: 24px;
              padding:8px 12px;
            "
          >
            Open app
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

const returnConfirmationMessageHtml = (props) => {
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
              src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
              src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
        Devices returned receipt
        </h1>
        <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
        This email confirms that you have returned all of the devices from transaction detailed below.
          
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
            <p style="width: 100%; text-align: left">Date and time: <strong>${props.date}</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Transaction ID: <strong>${props.transaction}</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Device: <strong>${props.device.deviceType} | ${props.device.serialNumber}</strong></p>
          </div>
          </div>
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
            Open app
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
                src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
                src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
                src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
                src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
                src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
                src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
          This email confirms that $${props.amount} has been charged due to the lost devices from the transaction detailed below.
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
            <p style="width: 100%; text-align: left">Date and time: <strong>${props.date}</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Transaction ID: <strong>${props.transaction}</strong></p>
          </div>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">
            <p style="width: 100%; text-align: left">Device: <strong>${props.device.deviceType} | ${props.device.serialNumber}</strong></p>
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
              src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
              src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
                src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
                src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
        margin: auto;
        padding: 0;
      "
      >
        <div
          style="
          margin-left: auto;
          margin-right: auto;
          padding: 2rem;
          max-width: 768px;
          min-width: 320px;
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
              src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
              src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
              href="${props.linkToResetPassword}"
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
              box-shadow: 0px 1px 2px 0px rgba(16, 24, 40, 0.05);
              text-decoration: none;
            "
            >
              <p
                style="
                color:#fff;
                font-size: 16px;
                font-style: normal;
                font-weight: 600;
                line-height: 24px;
              "
              >
                Reset password
              </p></a
            >
          </div>
          <div style="margin-top: 2.5rem">
          <p style="font-size: 1rem; color: #475467">
          This email was sent from an unmonitored account. Do not reply to this email.    </p>
        </p>
          </div>
    
        </div>
      </body>
    </ >
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
              src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
              src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
              src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
              src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
              src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
              src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
              src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
              src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
              src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
              src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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
              src="https://i.ibb.co/WHcvqrG/devitrak-logo.png"
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
              src="https://i.ibb.co/HDpZ60p/devitrak-name.png"
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

const returnReminderMessageHtml = ``;

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
};
