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

const stripePaymentIntentUpdate = async (request, response) => {
  const { paymentIntentId, device } = request.body;
  console.log(paymentIntentId);
  const total = device * 20000;
  console.log("total", total);
  try {
    const updatePaymentIntent = await stripe.paymentIntents.update(
      paymentIntentId,
      { amount: total }
    );
    console.log({ ...updatePaymentIntent.amount });
    response.json({
      clientSecret: updatePaymentIntent.client_secret,
      id: updatePaymentIntent,
      amount: updatePaymentIntent.amount,
      updatePaymentIntent,
    });
  } catch (error) {
    console.log({ error });
  }
};

const listAllPaymentIntents = async (request, response) => {
  try {
    const paymentIntents = await stripe.paymentIntents.list({
      limit: 10,
    });

    console.log( paymentIntents )

    response.status(201).json({
      ok: true,
      paymentIntents
    })
    {/*const paymentIntent = await StripeTransaction.find().populate("user");

    return response.status(201).json({
      ok: true,
      paymentIntent,
    });*/}
  } catch (error) {
    console.log(error);
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
module.exports = {
  stripePaymentIntent,
  listAllPaymentIntents,
  stripePaymentIntentUpdate,
  saveStripeTransaction,
};
