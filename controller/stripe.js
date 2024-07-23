const { response, json, request } = require("express");
const { default: mongoose } = require("mongoose");
const Stripe = require("stripe");
const StripeCustomer = require("../models/StripeCustomer");
const StripeTransaction = require("../models/StripeTransaction");
// const Transaction = require("../models/Transaction");
const StripeCompany = require("../models/StripeCompany");
require("dotenv").config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const stripeCustomer = async (request, response) => {
  const { email, name, phoneNumber } = request.body;
  try {
    const customer = await stripe.customers.create({
      name: name,
      email: email,
      phone: phoneNumber,
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

const companyInformationAccountStripe = async (request, response) => {
  try {
    const { companyName, ownerEmail, ownerFirstName, ownerLastName } =
      request.body;
    const companyCustomer = await stripe.customers.create({
      name: `${ownerFirstName} ${ownerLastName} / company: ${companyName}`,
      email: ownerEmail,
    });

    const savingNewCompanyCustomer = new StripeCompany({
      companyName,
      ownerEmail,
      ownerFirstName,
      ownerLastName,
      stripeID: companyCustomer.id,
    });
    await savingNewCompanyCustomer.save();
    response.status(201).json({
      ok: true,
      companyCustomer: savingNewCompanyCustomer,
    });
  } catch (error) {
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: error.msg,
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
      // customer: customerId,
      receipt_email: customerEmail,
    });
    response.status(201).json({
      clientSecret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      paymentIntent,
    });
  } catch (error) {
    response.status(500).json({
      msg: error.message,
    });
  }
};

const stripePaymentIntentCustomized = async (request, response) => {
  const { receipt_email, total } = request.body;
  const customerEmail = receipt_email;
  const totalToCharge = parseInt(total) * 100;
  try {
    const paymentIntentCustomized = await stripe.paymentIntents.create({
      amount: totalToCharge,
      currency: "usd",
      payment_method_types: ["card"],
      capture_method: "manual",
      // customer: customerId,
      receipt_email: customerEmail,
    });
    response.status(201).json({
      clientSecret: paymentIntentCustomized.client_secret,
      payment_intent_id: paymentIntentCustomized.id,
      amount: paymentIntentCustomized.amount,
      paymentIntentCustomized,
    });
  } catch (error) {
    console.log(error.message);
    response.status(500).json({
      msg: error.message,
    });
  }
};

const stripePaymentIntentSubscription = async (request, response) => {
  const { total, customerEmail } = request.body;
  try {
    const paymentSubscription = await stripe.paymentIntents.create({
      amount: total,
      currency: "usd",
      automatic_payment_methods: {
        enabled: true,
      },
      receipt_email: customerEmail,
    });
    response.status(201).json({
      clientSecret: paymentSubscription.client_secret,
      payment_intent_id: paymentSubscription.id,
      amount: paymentSubscription.amount,
      paymentSubscription,
    });
  } catch (error) {
    response.status(500).json({
      msg: "Please contact administrator",
      error: error.message,
    });
  }
};

const creatingSubscription = async (request, response) => {
  try {
    const { stripeCustomerID, items, period } = request.body;
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 5);
    // Create a subscription with the specified contract duration
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerID,
      items: [
        {
          price: items[0].price,
        },
      ],
      cancel_at: endDate.getTime(),
      // billing_cycle_anchor: 'now',
      billing_cycle_anchor_config:
        period === "month"
          ? {
              day_of_month: endDate.getDate(),
            }
          : {
              month: endDate.getMonth() + 1,
              day_of_month: endDate.getDate(),
            },
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: ["card"],
      },
      trial_period_days: 30, //: trialPeriod.getTime(),
      expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
    });
    if (subscription.pending_setup_intent !== null) {
      response.status(201).json({
        ok: true,
        type: "setup",
        clientSecret: subscription.pending_setup_intent.client_secret,
        subscriptionId: subscription.id,
        data: subscription,
      });
    } else {
      response.status(201).json({
        ok: true,
        type: "payment",
        clientSecret: subscription.latest_invoice.payment_intent.client_secret,
        subscriptionId: subscription.id,
        data: subscription,
      });
    }
  } catch (error) {
    // Handle any errors
    response.status(500).json({
      ok: false,
      msg: error.message,
      error: error,
    });
  }
};

const createSubscriptionNoTrialPeriod = async (request, response) => {
  try {
    const { stripeCustomerID, items, period } = request.body;
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 12);
    // Create a subscription with the specified contract duration
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerID,
      items: [
        {
          price: items[0].price,
        },
      ],
      cancel_at: Math.floor(endDate.getTime() / 1000), // Set billing cycle based on contract duration
      billing_cycle_anchor_config:
        period === "month"
          ? {
              day_of_month: endDate.getDate(),
            }
          : {
              month: endDate.getMonth() + 1,
              day_of_month: endDate.getDate(),
            },
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: ["card"],
      },
      expand: ["latest_invoice.payment_intent"],
    });
    // Prepare the response
    response.status(201).json({
      ok: true,
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      data: subscription,
    });
  } catch (error) {
    // Handle any errors
    response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const findSubscriptionIdBySetUpId = async (request, response) => {
  const { setupId } = request.body;
  const setupIntentId = setupId;
  try {
    // Retrieve the SetupIntent object
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    if (!setupIntent.payment_method) {
      throw new Error("No payment method found for this setup intent.");
    }

    // Retrieve the PaymentMethod object
    const paymentMethod = await stripe.paymentMethods.retrieve(
      setupIntent.payment_method
    );

    if (!paymentMethod.customer) {
      throw new Error("No customer found for this payment method.");
    }

    // List all subscriptions for the customer
    const subscriptions = await stripe.subscriptions.list({
      customer: paymentMethod.customer,
    });

    // Find the subscription that uses this payment method
    const subscription = subscriptions.data.find(
      (sub) => sub.default_payment_method === setupIntent.payment_method
    );

    if (subscription) {
      return response.status(201).json({
        ok: true,
        subscription: subscription,
      });
    } else {
      return response.status(404).json({
        ok: false,
        subscription: null,
        msg: "No subscription found for this payment method.",
      });
    }
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact administrator.",
      error: error,
    });
  }
};
const searchSubscriptions = async (request, response) => {
  try {
    const id = request.params.id;
    const subscription = await stripe.subscriptions.retrieve(id);
    response.status(201).json({
      ok: true,
      subscriptionInfo: subscription,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateSubcriptionInCompanyAccount = async (request, response) => {
  try {
    const storedSubcriptionID = request.params.id;
    const newInfo = request.body;
    const updatingStoredSubscriptionInfo =
      await StripeCompany.findByIdAndUpdate(storedSubcriptionID, newInfo, {
        new: true,
      });
    response.status(201).json({
      ok: true,
      companyCustomer: updatingStoredSubscriptionInfo,
    });
  } catch (error) {
    response.status().json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateCancelSubscription = async (request, response) => {
  try {
    const { cancelAtPeriodEnd, cancellationComment } = request.body;
    const subscriptionID = request.params.id;
    const updateSubscription = await stripe.subscriptions.update(
      subscriptionID,
      {
        cancel_at_period_end: cancelAtPeriodEnd,
        cancellation_details: [{ comment: cancellationComment }],
      }
    );
    response.status(201).json({
      ok: true,
      msg: "Subscription updated.",
      subscription: updateSubscription,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};
const cancelSubscriptionCompany = async (request, response) => {
  try {
    const subscriptionID = request.params.id;
    const cancelSubscription = await stripe.subscriptions.cancel(
      subscriptionID
    );
    response.status(201).json({
      ok: true,
      msg: "Subscription cancelled.",
      subscription: cancelSubscription,
    });
  } catch (error) {
    response.status().json({
      ok: false,
      msg: error.message,
    });
  }
};

const displayAllPaidInvoicesPerSubscription = async (request, response) => {
  try {
    const { subscriptionID } = request.body;
    const invoices = await stripe.invoices.list({
      limit: 100,
      status: "paid",
      subscription: subscriptionID,
    });
    response.status(201).json({
      ok: true,
      invoices,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateDefaultPaymentMethodInSubscription = async (request, response) => {
  try {
    const newPaymentMethodID = request.body;
    const subscriptionID = request.params.id;
    const paymentMethodUpdated = await stripe.subscriptions.update(
      subscriptionID,
      { default_payment_method: `${newPaymentMethodID}` }
    );
    response.status(201).json({
      ok: true,
      card: paymentMethodUpdated,
    });
  } catch (error) {
    console.log(error);
    response.status(error.statusCode ?? 500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateDefaultPaymentMethodInCustomer = async (request, response) => {
  try {
    const { customerID } = request.body;
    const newPaymentMethodID = request.params.id;
    const customerUpdated = await stripe.paymentMethods.attach(
      newPaymentMethodID,
      { customer: `${customerID}` }
    );
    response.status(201).json({
      ok: true,
      customer: customerUpdated,
    });
  } catch (error) {
    console.log(error);
    response.status(error.statusCode ?? 500).json({
      ok: false,
      msg: error.message,
    });
  }
};
const searchStripeTransaction = async (request, response) => {
  try {
    const paymentIntent = await stripe.paymentIntents.search({
      query: "status:'requires_capture'",
    });
    response.status(201).json({
      paymentIntent,
    });
  } catch (error) {
    response.status(500).json({
      msg: "Please contact administrator",
      error: error.message,
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
    const customerEmail = request._parsedUrl.search.split("=").at(-1);
    const customer = await stripe.customers.search({
      query: `email:\'${customerEmail}\'`,
    });
    response.status(201).json({
      ok: true,
      customer,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error,
    });
  }
};
const saveStripeTransaction = async (request, response) => {
  const stripeTransaction = new StripeTransaction(request.body);
  try {
    // stripeTransaction.user = request.uid;
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
      msg: error,
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
      error: error
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
      error: error
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
    response.status(500).json({
      error,
    });
  }
};

const retrieveSubscriptionID = async (request, response) => {
  try {
    // Retrieve the Payment Intent
    const paymentIntentId = request.params.id;
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    // Step 2: Check for an associated Invoice ID
    const invoiceId = paymentIntent.invoice;

    // Check if the Payment Intent is associated with a Subscription
    if (invoiceId) {
      // Step 3: Retrieve the Invoice
      const invoice = await stripe.invoices.retrieve(invoiceId);

      // Step 4: Extract the subscription ID from the Invoice
      const subscriptionId = invoice.subscription;

      // Retrieve the Subscription
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      response.status(201).json({
        ok: true,
        subscription,
      });
    } else {
      throw new Error("Payment Intent is not associated with a Subscription.");
    }
  } catch (error) {
    response.status(500).json({
      error,
    });
  }
};

const getListOfAllSavedStripeTransaction = async (request, response) => {
  try {
    const listOfStripeTransactionsSaved = await StripeTransaction.find(
      request.body
    ).populate("user");
    response.status(201).json({
      ok: true,
      list: listOfStripeTransactionsSaved,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const stripeCompanyAccountFound = async (request, response) => {
  try {
    const companyAccountStripeFound = await StripeCompany.findOne({
      companyName: request.body.company,
    });
    return response.status(201).json({
      ok: true,
      companyAccountStripeFound,
    });
  } catch (error) {
    console.log("🚀 ~ stripeCompanyAccountFound ~ error:", error);
    return response.status(500).json({
      ok: false,
      message: error.message,
    });
  }
};

const searchingSubscriptionInStripe = async (request, response) => {
  try {
    const subs_id = request.params.id;
    const subscriptions = await stripe.subscriptions.retrieve(`${subs_id}`);
    response.status(201).json({
      ok: true,
      subscriptions,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message,
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
  retrieveSubscriptionID,
  saveStripeTransaction,
  saveStripeTransactionAdmin,
  saveStripeTransactionTemplateForNoRegularUser,
  searchStripeTransaction,
  searchCustomerId,
  stripeCustomer,
  stripePaymentIntent,
  stripePaymentIntentCustomized,
  stripePaymentIntentSubscription,
  getListOfAllSavedStripeTransaction,
  companyInformationAccountStripe,
  creatingSubscription,
  createSubscriptionNoTrialPeriod,
  stripeCompanyAccountFound,
  searchSubscriptions,
  updateSubcriptionInCompanyAccount,
  cancelSubscriptionCompany,
  displayAllPaidInvoicesPerSubscription,
  updateCancelSubscription,
  updateDefaultPaymentMethodInSubscription,
  updateDefaultPaymentMethodInCustomer,
  searchingSubscriptionInStripe,
  findSubscriptionIdBySetUpId,
};
