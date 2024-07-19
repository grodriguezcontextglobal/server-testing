const { response, json, request } = require("express");
const { default: mongoose } = require("mongoose");
const Stripe = require("stripe");
const StripeCustomer = require("../models/StripeCustomer");
const StripeTransaction = require("../models/StripeTransaction");
const Transaction = require("../models/Transaction");
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
    const { companyName, ownerEmail, ownerFirstName, ownerLastName } = request.body
    const companyCustomer = await stripe.customers.create({
      name: `${ownerFirstName} ${ownerLastName} / company: ${companyName}`,
      email: ownerEmail,
    });

    const savingNewCompanyCustomer = new StripeCompany({
      companyName,
      ownerEmail,
      ownerFirstName,
      ownerLastName,
      stripeID: companyCustomer.id
    })
    await savingNewCompanyCustomer.save()
    response.status(201).json({
      ok: true,
      companyCustomer: savingNewCompanyCustomer
    })

  } catch (error) {
    console.log(error)
    response.status(500).json({
      ok: false,
      msg: error.msg
    })

  }
}
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
      payment_method_types: ['card'],
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
    endDate.setMonth(endDate.getMonth() + 12);
    // Create a subscription with the specified contract duration
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerID,
      items: items,
      cancel_at: Math.floor(endDate.getTime() / 1000), // Set billing cycle based on contract duration
      billing_cycle_anchor: period === 'month' ? Math.floor(new Date().getTime() / 1000) : Math.floor(endDate.getTime() / 1000),
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],
      },
      expand: ['latest_invoice.payment_intent'],
    });

    // Prepare the response
    response.status(201).json({
      ok: true,
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      data: subscription
    });
  } catch (error) {
    // Handle any errors
    response.status(500).json({
      ok: false,
      msg: error.message
    });
  }
};

const searchSubscriptions = async (request, response) => {
  try {
    const id = request.params.id
    const subscription = await stripe.subscriptions.retrieve(id);
    response.status(201).json({
      ok: true,
      subscriptionInfo: subscription
    })
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error.message
    })
  }
}

const updateSubcriptionInCompanyAccount = async (request, response) => {
  try {
    const storedSubcriptionID = request.params.id
    const newInfo = request.body
    const updatingStoredSubscriptionInfo = await StripeCompany.findByIdAndUpdate(
      storedSubcriptionID,
      newInfo,
      {
        new: true,
      })
    response.status(201).json({
      ok: true,
      companyCustomer: updatingStoredSubscriptionInfo
    })
  } catch (error) {
    response.status().json({
      ok: false,
      msg: error.message
    })
  }
}

const updateCancelSubscription = async (request, response) => {
  try {
    const { cancelAtPeriodEnd, cancellationComment } = request.body
    const subscriptionID = request.params.id
    const updateSubscription = await stripe.subscriptions.update(subscriptionID, {
      cancel_at_period_end: cancelAtPeriodEnd,
      cancellation_details: [
        { comment: cancellationComment }
      ]
    })
    response.status(201).json({
      ok: true,
      msg: 'Subscription updated.',
      subscription: updateSubscription
    })
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error.message
    })
  }
}
const cancelSubscriptionCompany = async (request, response) => {
  try {
    const subscriptionID = request.params.id
    const cancelSubscription = await stripe.subscriptions.cancel(subscriptionID)
    response.status(201).json({
      ok: true,
      msg: 'Subscription cancelled.',
      subscription: cancelSubscription
    })
  } catch (error) {
    response.status().json({
      ok: false,
      msg: error.message
    })
  }
}

const displayAllPaidInvoicesPerSubscription = async (request, response) => {
  try {
    const { subscriptionID } = request.body
    const invoices = await stripe.invoices.list({
      limit: 100,
      status: 'paid',
      subscription: subscriptionID
    });
    response.status(201).json({
      ok: true,
      invoices
    })
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error.message
    })
  }
}

const updateDefaultPaymentMethodInSubscription = async (request, response) => {
  try {
    const newPaymentMethodID = request.body
    const subscriptionID = request.params.id
    const paymentMethodUpdated = await stripe.subscriptions.update(
      subscriptionID,
      { default_payment_method: `${newPaymentMethodID}` }
    );
    response.status(201).json({
      ok: true,
      card: paymentMethodUpdated
    })
  } catch (error) {
    console.log(error)
    response.status(error.statusCode ?? 500).json({
      ok: false,
      msg: error.message
    })
  }
}

const updateDefaultPaymentMethodInCustomer = async (request, response) => {
  try {
    const { customerID } = request.body
    const newPaymentMethodID = request.params.id
    const customerUpdated = await stripe.paymentMethods.attach(
      newPaymentMethodID,
      { customer: `${customerID}` }
    );
    response.status(201).json({
      ok: true,
      customer: customerUpdated
    })
  } catch (error) {
    console.log(error)
    response.status(error.statusCode ?? 500).json({
      ok: false,
      msg: error.message
    })
  }
}
const searchStripeTransaction = async (request, response) => {
  try {
    const paymentIntent = await stripe.paymentIntents.search({
      query: 'status:\'requires_capture\'',
    });
    response.status(201).json({
      paymentIntent
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
    const customer = await stripe.customers.search({
      query: `email:\'${request.body.email}\'`,
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

const getListOfAllSavedStripeTransaction = async (request, response) => {
  try {
    const listOfStripeTransactionsSaved = await StripeTransaction.find(request.body).populate('user')
    response.status(201).json({
      ok: true,
      list: listOfStripeTransactionsSaved
    })
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error
    })
  }
}

const stripeCompanyAccountFound = async (request, response) => {
  try {
    const companyAccountStripeFound = await StripeCompany.findOne({ companyName: request.body.company })
    console.log("🚀 ~ stripeCompanyAccountFound ~ companyAccountStripeFound:", companyAccountStripeFound)

    return response.status(201).json({
      ok: true,
      companyAccountStripeFound
    })

  } catch (error) {
    console.log("🚀 ~ stripeCompanyAccountFound ~ error:", error)
    return response.status(500).json({
      ok: false,
      message: error.message
    })
  }
}

const searchingSubscriptionInStripe = async (request, response) => {
  try {
    const subs_id = request.params.id
    const subscriptions = await stripe.subscriptions.retrieve(`${subs_id}`);
    response.status(201).json({
      ok: true,
      subscriptions
    })
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    })
  }
}
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
  searchStripeTransaction,
  searchCustomerId,
  stripeCustomer,
  stripePaymentIntent,
  stripePaymentIntentCustomized,
  stripePaymentIntentSubscription,
  getListOfAllSavedStripeTransaction,
  companyInformationAccountStripe,
  creatingSubscription,
  stripeCompanyAccountFound,
  searchSubscriptions,
  updateSubcriptionInCompanyAccount,
  cancelSubscriptionCompany,
  displayAllPaidInvoicesPerSubscription,
  updateCancelSubscription,
  updateDefaultPaymentMethodInSubscription,
  updateDefaultPaymentMethodInCustomer,
  searchingSubscriptionInStripe
};
