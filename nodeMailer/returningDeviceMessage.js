const { response } = require("express")

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
          Devices assigned confirmation
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
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Event: <strong>${props.event}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Company: <strong>${props.company}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Date: <strong>${props.date}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Time: <strong>${props.time}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">Transaction ID: <strong>${props.transaction}</strong></div>
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
      <div style="margin-top: 2.5rem">
        <h2
          style="
            font-size: 1.25rem;
            font-weight: 600;
            color: #101828;
            margin-bottom: 1rem;
          "
        >
          What to expect
        </h2>
        <p style="font-size: 1rem; color: #475467">
          In the application you will be able to request new devices, review
          your transactions, request support, and get answers to frequently
          asked questions. For any specific questions please contact the staff
          at ${props.company}.
        </p>
      </div>
      </div>
      </div>
  </body>
</html>
  `
}

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
      margin: 0;
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
        Devices returned confirmation
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
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Event: <strong>${props.event}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Company: <strong>${props.company}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Date: <strong>${props.date}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Time: <strong>${props.time}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">Transaction ID: <strong>${props.transaction}</strong></div>
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
              font-family: Inter;
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
       <div style="margin-top: 2.5rem">
        <h2
          style="
            font-size: 1.25rem;
            font-weight: 600;
            color: #101828;
            margin-bottom: 1rem;
          "
        >
          What to expect
        </h2>
        <p style="font-size: 1rem; color: #475467">
          In the application you will be able to request new devices, review
          your transactions, request support, and get answers to frequently
          asked questions. For any specific questions please contact the staff
          at ${props.company}.
        </p>
      </div>
      </div>
    </div>
  </body>
</html>
`;
}

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
        margin: 0;
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
                font-family: 'Inter', sans-serif;
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
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Event: <strong>${props.event}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Company: <strong>${props.company}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Date: <strong>${props.date}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Time: <strong>${props.time}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">Transaction ID: <strong>${props.transaction}</strong></div>
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
                font-family: Inter;
                font-size: 16px;
                font-style: normal;
                font-weight: 600;
                line-height: 24px; /* 150% */
              "
            >
              Open app
            </p>
          </a>
          <div style="margin-top: 2.5rem">
          <h2
            style="
              font-size: 1.25rem;
              font-weight: 600;
              color: #101828;
              margin-bottom: 1rem;
            "
          >
            What to expect
          </h2>
          <p style="font-size: 1rem; color: #475467">
            In the application you will be able to request new devices, review
            your transactions, request support, and get answers to frequently
            asked questions. For any specific questions please contact the staff
            at ${props.company}.
          </p>
        </div>       
        </div>
        </div>
    </body>
  </html>
  `};

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
        margin: 0;
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
                font-family: 'Inter', sans-serif;
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
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Date: <strong>${props.date}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto; width: 100%; text-align: left">Time: <strong>${props.time}</strong></div>
              <br/>
            <div style="margin: 0.3rem auto 1.5rem; width: 100%; text-align: left">Transaction ID: <strong>${props.transaction}</strong></div>
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
                font-size: 16px;
                font-style: normal;
                font-weight: 600;
                line-height: 24px; /* 150% */
              "
            >
              Open app
            </p>
          </a>
        <div style="margin-top: 2.5rem">
          <h2
            style="
              font-size: 1.25rem;
              font-weight: 600;
              color: #101828;
              margin-bottom: 1rem;
            "
          >
            What to expect
          </h2>
          <p style="font-size: 1rem; color: #475467">
            In the application you will be able to request new devices, review
            your transactions, request support, and get answers to frequently
            asked questions. For any specific questions please contact the staff
            at ${props.company}.
          </p>
        </div>
      </div>
      </div>
    </body>
  </html>
  `};

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
        margin: 0;
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
          Lost device fee
          </h1>
          <p style="font-size: 1rem; color: #475467; margin-bottom: 1.5rem">
          This email confirms that $${props.amount} has been charged due to the lost devices from the transaction detailed below.
            <span
              style="
                width: 100%;
                display: flex;
                flex-direction: column;
                margin: 1.5rem auto 0.5rem;
              "
            >
              <span style="margin: 0.3rem auto; width: 100%; text-align: left"
                >Event: <strong>${props.event}</strong></span
              ><br/>
              <span style="margin: 0.3rem auto; width: 100%; text-align: left"
                >Company: <strong>${props.company}</strong></span
              ><br/>
              <span style="margin: 0.3rem auto; width: 100%; text-align: left"
                >Date: <strong>${props.date}</strong></span
              ><br/>
              <span style="margin: 0.3rem auto; width: 100%; text-align: left">
                Time: <strong>${props.time}</strong></span
              ><br/>
              <span style="margin: 0.3rem auto; width: 100%; text-align: left"
                >Transaction ID: <strong>${props.transaction}</strong></span
              >
            </span>
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
              Open app
            </p>
          </a>
          <div style="margin-top: 2.5rem">
          <h2
            style="
              font-size: 1.25rem;
              font-weight: 600;
              color: #101828;
              margin-bottom: 1rem;
            "
          >
            What to expect
          </h2>
          <p style="font-size: 1rem; color: #475467">
            In the application you will be able to request new devices, review
            your transactions, request support, and get answers to frequently
            asked questions. For any specific questions please contact the staff
            at ${props.company}.
          </p>
        </div>
      </div>
     </div>
    </body>
  </html>
`;
}

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
      margin: 0;
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
              font-family: 'Inter', sans-serif;
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
        <div style="margin-top: 2.5rem">
        <h2
          style="
            font-size: 1.25rem;
            font-weight: 600;
            color: #101828;
            margin-bottom: 1rem;
          "
        >
          What to expect
        </h2>
        <p style="font-size: 1rem; color: #475467">
          In the application you will be able to request new devices, review
          your transactions, request support, and get answers to frequently
          asked questions. For any specific questions please contact the staff
          at ${props.company}.
        </p>
      </div>
      </div>
    </div>
  </body>
</html>

`;
}
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
        margin: 0;
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
          <div style="margin-top: 2.5rem">
            <h2
              style="
              font-size: 1.25rem;
              font-weight: 600;
              color: #101828;
              margin-bottom: 1rem;
            "
            >
              What to expect
            </h2>
            <p style="font-size: 1rem; color: #475467">
              In the application you will be able to request new devices, review
              your transactions, request support, and get answers to frequently
              asked questions. For any specific questions please contact the staff
              at ${props.company}.
            </p>
          </div>
        </div>
      </div>
    </body>
  </html>
  `
}

const linkToResetUserPassword = (props) => {
  return `
    < html lang = "en" translate = "no" >
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
        margin: 0;
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
                font-family: 'Inter', sans-serif;
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
            <div style="margin-top: 2.5rem">
              <h2
                style="
              font-size: 1.25rem;
              font-weight: 600;
              color: #101828;
              margin-bottom: 1rem;
            "
              >
                What to expect
              </h2>
              <p style="font-size: 1rem; color: #475467">
                In the application you will be able to request new devices, review
                your transactions, request support, and get answers to frequently
                asked questions. For any specific questions please contact the staff
                at ${props.company}.
              </p>
            </div>
          </div>
        </div>
      </body>
    </ >
  `
}

const customizedEmailMessageHtml = (props) => {
  return ``
}

const singleEmailMessageHtml = (props) => {
  return ``
}

const returnReminderMessageHtml = ``;

const staffNotificationMessageHtml = (props) => {
  return ``
}

const editingDeviceAdminMessageHtml = (props) => {
  return ``;
};

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
