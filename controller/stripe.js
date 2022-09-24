const { response } = require("express");
const Stripe = require("stripe");
require("dotenv").config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const stripeSetupIntent = async (req, res) => {
  const setupIntent = await stripe.setupIntent.create({
    payment_method_types: ["card"],
  });

  console.log(setupIntent);
};
const stripePaymentIntent = async (req, res) => {
  const { amount } = req.body;
  console.log(amount);

  if (amount > 0) {
    try {
      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount:amount,
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
  }
};

const listAllPaymentIntents = async (request, response) => {
  const allPaymentIntents = await stripe.paymentIntents.list({
    limit: 100,
  });
};

module.exports = {
  stripePaymentIntent,
  listAllPaymentIntents,
  stripeSetupIntent,
};
