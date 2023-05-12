require("dotenv").config(); //connect with dotenv file

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require("twilio")(accountSid, authToken);

const whatsappNotification = async (request, response) => {
  const {body, to } = request.body
  try {
    client.messages
      .create({
        body: body,
        from: "whatsapp:+16076227183",
        to: `whatsapp:+${to}`,
      })
      .then((message) => console.log(message.sid))
      .done();
      response.status(201).json({
        ok:true,
        msg:"Notification sent successfully"
      })
  } catch (error) {
    console.log(
      "🚀 ~ file: twilio.js:18 ~ whatsappNotification ~ error",
      error
    );
    response.status(500).json({
      ok:false,
      msg:`There was an error at the moment to send the notification, plase try later.`
    })
  }
};

const SMSNotification = async (request, response) => {
  const {body, to } = request.body
  try {
    client.messages 
      .create({ 
         body: body,  
         from:"+16076227183",      
         to: `+${to}` 
       }) 
      .then(message => console.log(message.sid)) 
      .done();
      response.status(201).json({
        ok:true,
        msg:"Notification sent successfully"
      })
  } catch (error) {
    console.log(
      "🚀 ~ file: twilio.js:18 ~ whatsappNotification ~ error",
      error
    );
    response.status(500).json({
      ok:false,
      msg:`There was an error at the moment to send the notification, plase try later.`
    })
  }
};

module.exports = {
  whatsappNotification,
  SMSNotification
};
