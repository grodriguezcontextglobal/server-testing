const { response } = require("express")
require('dotenv').config()
const Stripe = require("stripe")

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// console.log({...stripe._api})

const publicKey = async (request, response = response) => {
    response.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY})
}

const paymentIntent = async ( request, response) => {

    console.log('stripe',request.body)

    const { device } = request.body

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: 1 * 200 * 100,
            currency: "usd",
            payment_method_types: ["card"],
        })

        console.log({paymentIntent})
        
        response.status(201).json({
            ok: true,
            clientSecret: paymentIntent.client_secret,
            id: paymentIntent.id,
            url: paymentIntent.charges.url
        })
    
    } catch (error) {
        console.log(error)
        response.status(500).json({
            ok: false,
            msg: "Contact Administrator"
        })
    }
 }

module.exports = {
    publicKey,
    paymentIntent
  };
