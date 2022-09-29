const { response } = require("express");
const Stripe = require("stripe");
const StripeTransaction = require("../models/StripeTransaction");
require("dotenv").config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const stripePaymentIntent = async (req, res) => {
  const { device } = req.body;
  const total = device * 200 * 100;
  console.log({ total });

  try {
    // Create a PaymentIntent with the order amount and currency
    const paymentIntent = await stripe.paymentIntents.create({
      amount: total,
      currency: "usd",
      payment_method_types: ["card"],
      capture_method: "manual",
    });
    console.log({ paymentIntent });
    res.send({
      clientSecret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      paymentIntent,
    });
  } catch (error) {
    console.log(error);
  }
};

const listAllPaymentIntents = async (request, response) => {
  try {
    const paymentIntents = await stripe.paymentIntents.list({
      limit: 10,
    });

    if( paymentIntents.status === "require_capture"){
      response.status(201).json({
      ok: true,
      paymentIntents,
    });
    }
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error
    })
  }
};

const saveStripeTransaction = async (request, response) => {
  const stripeTransaction = new StripeTransaction(request.body);

  try {
    stripeTransaction.user = request.uid;
    console.log("transaction ", stripeTransaction.user);

    const stripeTransactionSaved = await stripeTransaction.save();

    console.log("transaction saved", stripeTransactionSaved);

    response.status(201).json({
      ok: true,
      msg: "Transaction saved",
      stripeTransaction: stripeTransactionSaved,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact adminitrator",
    });
  }
};

const captureStripePaymentIntent = async (request, response) => {
  const { id } = request.body
  console.log( id )
  try {
    const paymentIntent = await stripe.paymentIntents.capture( id );
    response.status(201).json({
      ok: true,
      paymentIntent
    })
  } catch (error) {
    console.log(error);
    response.status(404).json({
      ok: false,
      msg:"Transaction failed"
    })
  }
};

const cancelStripePaymentIntent = async (request, response) => {
  const { id } = request.body

  console.log( id )
  try {
    const paymentIntent = await stripe.paymentIntents.cancel("pi_3Ln7W5A4UM3TTNMj1LcHzwU9");
    response.status(201).json({
      ok: true,
      paymentIntent,
      status: paymentIntent.status 
    })
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Contact Administrator"
    })
  }
};
module.exports = {
  stripePaymentIntent,
  listAllPaymentIntents,
  saveStripeTransaction,
  captureStripePaymentIntent,
  cancelStripePaymentIntent,
};
