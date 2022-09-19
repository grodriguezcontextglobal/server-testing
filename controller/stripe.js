const { response } = require("express");
const Stripe = require("stripe")

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// console.log({...stripe._api})

const paymentIntent = async (req, res = response ) => {
  console.log("request", req.body);

  const { amount } = req.body

  try {
      // Create a PaymentIntent with the order amount and currency
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount,
    currency: "usd",
    payment_method_types: ["card"],
    capture_method: "manual",
  });
  res.status(201).send({
    ok: true,
    clientSecret: paymentIntent.client_secret,
    paymentIntent
  });

  } catch (error) {
    console.log( error )
    res.status(500).json({
      ok: false,
      msg: 'Contact to Admin'
    })
  }
}

module.exports = {
  paymentIntent
}
