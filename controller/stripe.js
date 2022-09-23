const { response } = require("express");
const Stripe = require("stripe");
require("dotenv").config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

console.log("stripe SK", process.env.STRIPE_SECRET_KEY);

const stripePaymentIntent = async (req, res) => {

  const { amount } = req.body

  try {
    // Create a PaymentIntent with the order amount and currency
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "usd",
      payment_method_types: ["card"],
      capture_method: "manual",
    });
    console.log({ paymentIntent });
    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.log(error);
  }
};

module.exports = {
  stripePaymentIntent,
};

/**
 * Payment Intent
 *   const { amount } = req.body;
  console.log( 'amount',amount )
  try {
    // Create a PaymentIntent with the order amount and currency
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "usd",
      payment_method_types: ["card"],
      capture_method: "manual",
    });
    console.log({ paymentIntent });
    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.log(error);
  }

 */
