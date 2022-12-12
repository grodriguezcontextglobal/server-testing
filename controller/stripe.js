const { response } = require("express");
const { default: mongoose } = require("mongoose");
const Stripe = require("stripe");
const StripeCustomer = require("../models/StripeCustomer");
const StripeTransaction = require("../models/StripeTransaction");
require("dotenv").config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const stripeCustomer = async (request, response) => {
  try {
    const customer = await stripe.customers.create({
      name: request.body.name,
      email: request.body.email,
      phone: request.body.phone,
    });

    const customerProfile = new StripeCustomer({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      id: customer.id,
    });

    await customerProfile.save();

    response.status(201).json({
      ok: true,
      fullName: customer.name,
      email: customer.email,
      phone: customer.phone,
      id: customer.id,
      customer,
    });
  } catch (error) {
    console.log(error);
    response.status(400).json({
      ok: false,
      msg: error,
    });
  }
};

const stripePaymentIntent = async (request, response) => {
  const { customerId, device } = request.body;
  console.log("🚀 ~ file: stripe.js:46 ~ stripePaymentIntent ~ customerId", customerId)
  const total = device * 200 * 100;
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: total,
      currency: "usd",
      payment_method_types: ["card"],
      capture_method: "manual",
      customer: customerId
    });
    response.status(201).json({
      clientSecret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      paymentIntent,
    });
  } catch (error) {
    console.log("stripe payment intent error", error);
    response.status(500).json({
      msg: error,
    });
  }
};
const listAllPaymentIntents = async (request, response) => {
  try {
    const paymentIntents = await stripe.paymentIntents.list({
      limit: 10,
    });
    response.status(201).json({
      ok: true,
      paymentIntents,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const listAllCustomers = async (request, response) => {
  try {
    const { email } = request.body
    const customers = await stripe.customers.list({email: email});
    console.log("🚀 ~ file: stripe.js:91 ~ listAllCustomers ~ customers", customers)
    response.status(201).json({
      customer: customers.data,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};
const saveStripeTransaction = async (request, response) => {
  const stripeTransaction = new StripeTransaction(request.body);
  try {
    stripeTransaction.user = request.uid;
    const stripeTransactionSaved = await stripeTransaction.save();
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
  const { id, amount_to_capture } = request.body;
  const totalToCapture = amount_to_capture * 100;
  try {
    const paymentIntent = await stripe.paymentIntents.capture(id, {
      amount_to_capture: totalToCapture,
    });
    response.status(201).json({
      ok: true,
      paymentIntent,
    });
  } catch (error) {
    console.log(error);
    response.status(404).json({
      ok: false,
      msg: "Transaction failed",
    });
  }
};

const cancelStripePaymentIntent = async (request, response) => {
  const { id } = request.body;
  try {
    const paymentIntent = await stripe.paymentIntents.cancel(id);
    response.status(201).json({
      ok: true,
      paymentIntent,
      status: paymentIntent.status,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

const saveStripeTransactionTemplateForNoRegularUser = async (
  request,
  response
) => {
  const stripeTransaction = new StripeTransaction(request.body);
  try {
    const stripeTransactionSaved = await stripeTransaction.save();
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

const removeDuplicateEntries = async (request, response) => {
  try {
    const duplicateEnrtyId = request.params.id;
    const duplicateEnrty = await StripeTransaction.findByIdAndDelete(
      duplicateEnrtyId
    );
    if (duplicateEnrty) {
      response.status(201).json({
        ok: true,
        msg: `duplicate entry id ${duplicateEnrtyId} removed`,
      });
    }
  } catch (error) {
    console.log(
      "🚀 ~ file: stripe.js ~ line 159 ~ removeDuplicateEntries ~ error",
      error
    );
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

module.exports = {
  stripeCustomer,
  stripePaymentIntent,
  listAllPaymentIntents,
  listAllCustomers,
  saveStripeTransaction,
  captureStripePaymentIntent,
  cancelStripePaymentIntent,
  saveStripeTransactionTemplateForNoRegularUser,
  removeDuplicateEntries,
};
