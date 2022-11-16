const { response } = require("express");
const webpush = require('web-push');

const publicKey = process.env.PUBLIC_VAPID_KEY
console.log("🚀 ~ file: webpush.js ~ line 5 ~ publicKey", publicKey)
const privateKey = process.env.PRIVATE_VAPID_KEY
console.log("🚀 ~ file: webpush.js ~ line 7 ~ privateKey", privateKey)

// VAPID keys should be generated only once.
const vapidKeys = webpush.generateVAPIDKeys();

// webpush.setGCMAPIKey('<Your GCM API Key Here>');
webpush.setVapidDetails(
  'mailto: grodriguez@contextglobal.com',
  publicKey,
  privateKey
);


const subscription = async (request, response) => {
    console.log(request.body)
    const pushSubscription = request.body
    console.log("🚀 ~ file: webpush.js ~ line 21 ~ subscription ~ pushSubscription", pushSubscription)
    try {

        response.status(201).json({
            ok:true,
            msg:"Subscripted"
        })
    } catch (error) {
        console.log("🚀 ~ file: webpush.js ~ line 8 ~ subscription ~ error", error)
        response.status(500).json({
            ok:false,
            msg:error.response
        })
    }
}


module.exports = {
    subscription
};
