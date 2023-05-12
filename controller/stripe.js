const { response, json } = require("express");
const { default: mongoose } = require("mongoose");
const Stripe = require("stripe");
const StripeCustomer = require("../models/StripeCustomer");
const StripeTransaction = require("../models/StripeTransaction");
require("dotenv").config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const stripeCustomer = async (request, response) => {
  const { email, name, phone } = request.body;
  try {
    const customer = await stripe.customers.create({
      name: name,
      email: email,
      phone: phone,
    });

    const customerProfile = new StripeCustomer({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      stripeid: customer.id,
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
  const { customerEmail, customerId, device } = request.body;
  const total = device * 100;
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: total,
      currency: "usd",
      payment_method_types: ["card"],
      capture_method: "manual",
      customer: customerId,
      receipt_email: customerEmail,
    });
    console.log(paymentIntent);
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

const stripePaymentIntentCustomized = async (request, response) => {
  const { receipt_email, total, customerId } = request.body;
  const customerEmail = receipt_email;
  const totalToCharge = parseInt(total) * 100;
  console.log(request.body);
  try {
    const paymentIntentCustomized = await stripe.paymentIntents.create({
      amount: totalToCharge,
      currency: "usd",
      payment_method_types: ["card"],
      capture_method: "manual",
      customer: customerId,
      receipt_email: customerEmail,
    });
    console.log("paymentIntentCustomized", paymentIntentCustomized);
    response.status(201).json({
      paymentIntentCustomized,
      msg: "Transaction done",
    });
    {
      // clientSecret: paymentIntentCustomized.client_secret,
      // payment_intent_id: paymentIntentCustomized.id,
      // amount: paymentIntentCustomized.amount,
    }
  } catch (error) {
    console.log("stripe payment intent error", error);
    response.status(500).json({
      msg: error,
    });
  }
};

const stripePaymentIntentSubscription = async (request, response) => {
  const { total, customerEmail } = request.body;
  console.log("request body", request.body);
  try {
    const paymentSubscription = await stripe.paymentIntents.create({
      amount: total,
      currency: "usd",
      automatic_payment_methods: {enabled: true},
      receipt_email: customerEmail,
    });
    console.log("paymentSubscription", paymentSubscription);
    response.status(201).json({
      clientSecret: paymentSubscription.client_secret,
      paymentSubscription,
    });
  } catch (error) {
    console.log(
      "🚀 ~ file: stripe.js:107 ~ stripePaymentIntentSubscription ~ error:",
      error
    );
    response.status(500).json({
      msg: "Please contact administrator",
      error: error,
    });
  }
};

const listAllPaymentIntents = async (request, response) => {
  try {
    const paymentIntents = await stripe.paymentIntents.list({
      limit: 1000,
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
    const stripeCustomerSaved = await StripeCustomer.find();
    response.status(201).json({
      ok: true,
      stripeCustomerSaved,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const searchCustomerId = async (request, response) => {
  try {
    console.log("request.body email", request.body);

    const customer = await stripe.customers.search({
      query: `email:\'${request.body.email}\'`,
    });
    console.log(
      "🚀 ~ file: stripe.js:138 ~ searchCustomerId ~ customer",
      customer
    );

    response.status(201).json({
      ok: true,
      customer,
    });
  } catch (error) {
    console.log("🚀 ~ file: stripe.js:147 ~ searchCustomerId ~ error", error);
    response.status(500).json({
      ok: false,
      error,
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

const saveStripeTransactionAdmin = async (request, response) => {
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

const refundStripePaymentIntent = async (request, response) => {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: `pi_3MQMDTJAluu3aB960pdOekJF`,
    });
    response.status(201).json({
      ok: true,
      refund,
    });
  } catch (error) {
    console.log(
      "🚀 ~ file: stripe.js:237 ~ refundStripePaymentIntent ~ error",
      error
    );
    response.status(500).json({
      ok: false,
      msg: error,
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
    console.log("🚀 ~ file: stripe.js:309 ~ removeDuplicateEntries ~ duplicateEnrtyId:", duplicateEnrtyId)
  
    const duplicateEnrty = await StripeTransaction.findByIdAndDelete(
      duplicateEnrtyId
    );
    console.log("🚀 ~ file: stripe.js:314 ~ removeDuplicateEntries ~  duplicateEnrty:",  duplicateEnrty)
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

const retrievePaymentIntent = async (request, response) => {
  try {
    if (request.params.id.length > 15) {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        `${request.params.id}`
      );
      response.status(201).json({
        ok: true,
        paymentIntent,
      });
    }
  } catch (error) {
    console.log(
      "🚀 ~ file: stripe.js:286 ~ retrievePaymentIntent ~ error",
      error
    );
    response.status(500).json({
      error,
    });
  }
}; 
module.exports = {
  cancelStripePaymentIntent,
  captureStripePaymentIntent,
  listAllCustomers,
  listAllPaymentIntents,
  refundStripePaymentIntent,
  removeDuplicateEntries,
  retrievePaymentIntent,
  saveStripeTransaction,
  saveStripeTransactionAdmin,
  saveStripeTransactionTemplateForNoRegularUser,
  searchCustomerId,
  stripeCustomer,
  stripePaymentIntent,
  stripePaymentIntentCustomized,
  stripePaymentIntentSubscription,
};
