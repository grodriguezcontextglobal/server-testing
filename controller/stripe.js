const { response, json, request } = require("express");
const { default: mongoose } = require("mongoose");
const StripeCustomer = require("../models/StripeCustomer");
const StripeTransaction = require("../models/StripeTransaction");
// const Transaction = require("../models/Transaction");
const StripeCompany = require("../models/StripeCompany");
require("dotenv").config();
const logger = require("../helpers/logger");

// Cliente Stripe endurecido (Fase 3, DESIGN_task_queue.md): trae retry
// idempotente (maxNetworkRetries del SDK) + circuit breaker compartido vía
// runStripeMutation. Mismo objeto `stripe` que antes, así que las llamadas
// existentes no cambian; las mutaciones sensibles se envuelven con
// runStripeMutation para que un Stripe caído falle rápido.
const { stripe, runStripeMutation } = require("../helpers/stripeClient");

// A qué cuenta se cobra. Ver helpers/stripeConnectedAccount.js: mientras
// ninguna compañía tenga `acct_` guardado esto no cambia nada, y el día que lo
// tenga es un cambio de dato y no de código.
const Company = require("../models/Company");
const { resolveCompanyContext } = require("../helpers/companyContext");
const {
  persistConnectedAccountId,
  resolveConnectedAccountId,
  stripeOptionsFor,
} = require("../helpers/stripeConnectedAccount");

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

    return response.status(201).json({
      ok: true,
      fullName: customer.name,
      email: customer.email,
      phone: customer.phone,
      id: customer.id,
      customer,
    });
  } catch (error) {
    logger.error(error);
    return response.status(400).json({
      ok: false,
      msg: error,
    });
  }
};

const stripeAccountCreate = async (request, response) => {
  try {
    const { email, country } = request.body;
    const account = await stripe.accounts.create({
      country: country,
      email: email,
      controller: {
        fees: {
          payer: "application",
        },
        losses: {
          payments: "application",
        },
        requirement_collection: "stripe",
        stripe_dashboard: {
          type: "express",
        },
      },
      capabilities: {
        card_payments: {
          requested: true,
        },
        transfers: {
          requested: true,
        },
      },
    });

    // Guardar el mapa compañía → acct_. Hasta ahora el identificador se
    // devolvía al cliente y NO se guardaba en ningún sitio, así que el servidor
    // no sabía qué cuenta conectada era de quién — y sin ese mapa no se puede
    // enrutar un cobro sin fiarse de lo que mande el cliente, que en rutas
    // públicas sería cobrar contra la cuenta de cualquiera.
    //
    // Es best-effort a propósito: la cuenta YA existe en Stripe en este punto.
    // Si no se puede guardar, se registra y se devuelve igual, porque un error
    // aquí haría que el cliente creara una segunda cuenta.
    const companyId = resolveCompanyContext(request);
    if (companyId) {
      await persistConnectedAccountId(Company, companyId, account.id, { logger });
    } else {
      logger.warn(
        `stripe: cuenta conectada ${account.id} creada sin contexto de compañía; no se guardó el mapa`
      );
    }

    return response.status(201).json({
      ok: true,
      account: account,
    });
  } catch (error) {
    console.error(
      "An error occurred when calling the Stripe API to create an account",
      error
    );
    return response.status(500).send({ ok: false, error: error.message });
  }
};

const stripeAccountLink = async (request, response) => {
  try {
    const { connectedAccountId, origin } = request.body;
    const accountLink = await stripe.accountLinks.create({
      account: connectedAccountId,
      refresh_url: `${origin}/reauth`,
      return_url: `${origin}/return`,
      type: "account_onboarding",
      collection_options: {
        fields: "eventually_due",
      },
    });
    return response.status(201).json({
      ok: true,
      account: accountLink,
    });
  } catch (error) {
    logger.error(error.message);
    return response.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

const stripeAccountSession = async (request, response) => {
  try {
    const { connectedAccountId } = request.body;
    const accountSession = await stripe.accountSessions.create({
      account: connectedAccountId,
      components: {
        payment_details: {
          enabled: true,
        },
        payments: {
          enabled: true,
          features: {
            refund_management: true,
            dispute_management: true,
            capture_payments: true,
          },
        },
        account_management: {
          enabled: true,
        },
        notification_banner: {
          enabled: true,
        },
        payouts_list: {
          enabled: true,
        },
      },
    });
    return response.status(201).json({
      ok: true,
      client_secret: accountSession.client_secret,
    });
  } catch (error) {
    console.error(
      "An error occurred when calling the Stripe API to create an account session",
      error
    );
    return response.status(500).send({ ok: false, error: error.message });
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
    return response.status(201).json({
      ok: true,
      companyCustomer: savingNewCompanyCustomer,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: error.msg,
    });
  }
};

const updateStripeCompanyAccount = async (connectedAccountId, dataToUpdate) => {
  const stripePayload = {};

  // Direct mapping for top-level properties
  if (dataToUpdate.company_email) {
    stripePayload.email = dataToUpdate.company_email;
  }
  if (dataToUpdate.company_name) {
    stripePayload.company = { ...stripePayload.company, name: dataToUpdate.company_name };
  }
  if (dataToUpdate.company_phone) {
    stripePayload.company = { ...stripePayload.company, phone: dataToUpdate.company_phone };
  }

  // Business Profile mapping
  if (dataToUpdate.website) {
    stripePayload.business_profile = { ...stripePayload.business_profile, url: dataToUpdate.website };
  }

  // Address mapping - assuming 'address' is an object in dataToUpdate
  if (dataToUpdate.address && typeof dataToUpdate.address === 'object') {
    const { street, city, state, postal_code, country } = dataToUpdate.address;
    stripePayload.company = {
      ...stripePayload.company,
      address: {
        line1: street,
        city,
        state,
        postal_code,
        country: country || 'US', // Defaulting country to US if not provided
      },
    };
  }

  if (Object.keys(stripePayload).length === 0) {
    logger.info("No fields to update on Stripe for account:", connectedAccountId);
    return null; // Or return a message indicating nothing was updated
  }

  try {
    const account = await stripe.accounts.update(connectedAccountId, stripePayload);
    logger.info(`Stripe connected account ${connectedAccountId} updated successfully.`);
    return account;
  } catch (error) {
    logger.error(
      `Failed to update Stripe account ${connectedAccountId}:`,
      error
    );
    // Re-throw the error to be caught by the calling function
    throw error;
  }
};

const stripeCompanyAccountUpdate = async (request, response) => {
  try {
    const { connectedAccountId, ...updateData } = request.body;
    console.log("🚀 ~ stripeCompanyAccountUpdate ~ updateData:", request.body);
    const accountId = connectedAccountId && typeof connectedAccountId === "object"
      ? connectedAccountId.id
      : connectedAccountId;

    if (!accountId) {
      return response.status(400).json({ ok: false, error: "Connected account ID is required." });
    }

    const account = await updateStripeCompanyAccount(accountId, updateData);
    
    if (account) {
      return response.status(200).json({
        ok: true,
        account: account,
      });
    } else {
      return response.status(200).json({
        ok: true,
        message: "No updatable Stripe fields were provided."
      });
    }

  } catch (error) {
    return response.status(500).send({ ok: false, error: error.message });
  }
};

const stripePaymentIntent = async (request, response) => {
  const { customerEmail, customerId, device } = request.body;
  const total = Number(device) * 100;
  const idempotencyKey = request.idempotencyKey;

  try {
    // A qué cuenta se cobra, resuelto en el SERVIDOR desde la compañía. Hoy
    // devuelve `{}` para todo el mundo —ninguna compañía tiene `acct_` guardado
    // todavía— así que el comportamiento es idéntico al de siempre: la cuenta
    // madre. Ver helpers/stripeConnectedAccount.js.
    const { options: accountOptions, companyId } = await resolveStripeContextForRequest(request, {
      Company,
      resolveCompany: resolveCompanyContext,
      logger,
    });

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: total,
        currency: "usd",
        payment_method_types: ["card"],
        capture_method: "manual",
        receipt_email: customerEmail,
        // Mientras TODOS los cobros caigan en la misma cuenta, esto es lo único
        // que permite saber después de quién era cada uno. Barato, y sirve
        // aunque las cuentas conectadas no se activen nunca.
        ...(companyId ? { metadata: { company_id: String(companyId) } } : {}),
      },
      { ...(idempotencyKey ? { idempotencyKey } : {}), ...accountOptions }
    );

    logger.info("public_payment_intent_created", {
      type: "public_payment_intent_created",
      route: request.originalUrl,
      lane: request.authContext?.lane || "public",
      customerId,
      customerEmail,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      idempotencyKey: idempotencyKey ? "present" : "absent",
    });

    return response.status(201).json({
      clientSecret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      paymentIntent,
    });
  } catch (error) {
    logger.error("public_payment_intent_failed", {
      type: "public_payment_intent_failed",
      route: request.originalUrl,
      lane: request.authContext?.lane || "public",
      customerId,
      customerEmail,
      message: error.message,
      idempotencyKey: idempotencyKey ? "present" : "absent",
    });

    return response.status(500).json({
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
      receipt_email: customerEmail,
    });
    return response.status(201).json({
      clientSecret: paymentIntentCustomized.client_secret,
      payment_intent_id: paymentIntentCustomized.id,
      amount: paymentIntentCustomized.amount,
      paymentIntentCustomized,
    });
  } catch (error) {
    logger.error(error.message);
    return response.status(500).json({
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
    return response.status(201).json({
      clientSecret: paymentSubscription.client_secret,
      payment_intent_id: paymentSubscription.id,
      amount: paymentSubscription.amount,
      paymentSubscription,
    });
  } catch (error) {
    return response.status(500).json({
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

    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerID,
      items: [
        {
          price: items[0].price,
        },
      ],
      cancel_at: endDate.getTime(),
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
      trial_period_days: 30,
      expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
    });

    if (subscription.pending_setup_intent !== null) {
      return response.status(201).json({
        ok: true,
        type: "setup",
        clientSecret: subscription.pending_setup_intent.client_secret,
        subscriptionId: subscription.id,
        data: subscription,
      });
    } else {
      return response.status(201).json({
        ok: true,
        type: "payment",
        clientSecret: subscription.latest_invoice.payment_intent.client_secret,
        subscriptionId: subscription.id,
        data: subscription,
      });
    }
  } catch (error) {
    return response.status(500).json({
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

    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerID,
      items: [
        {
          price: items[0].price,
        },
      ],
      cancel_at: Math.floor(endDate.getTime() / 1000),
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

    return response.status(201).json({
      ok: true,
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      data: subscription,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const findSubscriptionIdBySetUpId = async (request, response) => {
  const { setupId } = request.body;
  const setupIntentId = setupId;
  try {
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    if (!setupIntent.payment_method) {
      throw new Error("No payment method found for this setup intent.");
    }

    const paymentMethod = await stripe.paymentMethods.retrieve(
      setupIntent.payment_method
    );

    if (!paymentMethod.customer) {
      throw new Error("No customer found for this payment method.");
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: paymentMethod.customer,
    });

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
    return response.status(201).json({
      ok: true,
      subscriptionInfo: subscription,
    });
  } catch (error) {
    return response.status(500).json({
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
    return response.status(201).json({
      ok: true,
      companyCustomer: updatingStoredSubscriptionInfo,
    });
  } catch (error) {
    return response.status(500).json({
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
    return response.status(201).json({
      ok: true,
      msg: "Subscription updated.",
      subscription: updateSubscription,
    });
  } catch (error) {
    return response.status(500).json({
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
    return response.status(201).json({
      ok: true,
      msg: "Subscription cancelled.",
      subscription: cancelSubscription,
    });
  } catch (error) {
    return response.status(500).json({
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
    return response.status(201).json({
      ok: true,
      invoices,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updatePaymentMethodFromAdminDashboard = async (request, response) => {
  try {
    const { paymentIntentId, newPaymentMethodID } = request.body;
    const paymentIntentUpdated = await stripe.paymentIntents.update(
      paymentIntentId,
      {
        payment_method: newPaymentMethodID,
      }
    );
    return response.status(201).json({
      ok: true,
      paymentIntentUpdated,
    });
  } catch (error) {
    return response.status(500).json({
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
    return response.status(201).json({
      ok: true,
      card: paymentMethodUpdated,
    });
  } catch (error) {
    return response.status(error.statusCode ?? 500).json({
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
    return response.status(201).json({
      ok: true,
      customer: customerUpdated,
    });
  } catch (error) {
    return response.status(error.statusCode ?? 500).json({
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
    return response.status(201).json({
      paymentIntent,
    });
  } catch (error) {
    return response.status(500).json({
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
    return response.status(201).json({
      ok: true,
      paymentIntents,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const listAllCustomers = async (request, response) => {
  try {
    const stripeCustomerSaved = await StripeCustomer.find(request.body);
    return response.status(201).json({
      ok: true,
      stripeCustomerSaved,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
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
    return response.status(201).json({
      ok: true,
      customer,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error,
    });
  }
};

const saveStripeTransaction = async (request, response) => {
  const stripeTransaction = new StripeTransaction(request.body);
  try {
    const stripeTransactionSaved = await stripeTransaction.save();
    return response.status(201).json({
      ok: true,
      msg: "Transaction saved",
      stripeTransaction: stripeTransactionSaved,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact administrator",
    });
  }
};

const saveStripeTransactionAdmin = async (request, response) => {
  const stripeTransaction = new StripeTransaction(request.body);
  try {
    const stripeTransactionSaved = await stripeTransaction.save();
    return response.status(201).json({
      ok: true,
      msg: "Transaction saved",
      stripeTransaction: stripeTransactionSaved,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const captureStripePaymentIntent = async (request, response) => {
  const { id, amount_to_capture } = request.body;
  const totalToCapture = amount_to_capture * 100;
  try {
    const paymentIntent = await runStripeMutation(() =>
      stripe.paymentIntents.capture(
        id,
        { amount_to_capture: totalToCapture },
        request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : undefined
      )
    );
    return response.status(201).json({
      ok: true,
      paymentIntent,
    });
  } catch (error) {
    logger.error(error);
    return response.status(404).json({
      ok: false,
      msg: "Transaction failed",
      error: error,
    });
  }
};

const cancelStripePaymentIntent = async (request, response) => {
  const { id } = request.body;
  try {
    const paymentIntent = await runStripeMutation(() =>
      stripe.paymentIntents.cancel(
        id,
        request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : undefined
      )
    );
    return response.status(201).json({
      ok: true,
      paymentIntent,
      status: paymentIntent.status,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
      error: error,
    });
  }
};

const refundStripePaymentIntent = async (request, response) => {
  try {
    const { paymentIntent } = request.body;
    const refund = await runStripeMutation(() =>
      stripe.refunds.create(
        { payment_intent: paymentIntent },
        request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : undefined
      )
    );
    return response.status(201).json({
      ok: true,
      refund,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const partialRefundStripePaymentIntent = async (request, response) => {
  try {
    const { paymentIntent, total } = request.body;
    const refund = await runStripeMutation(() =>
      stripe.refunds.create(
        { payment_intent: paymentIntent, amount: Number(total) * 100 },
        request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : undefined
      )
    );
    return response.status(201).json({
      ok: true,
      refund,
    });
  } catch (error) {
    return response.status(500).json({
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
    return response.status(201).json({
      ok: true,
      msg: "Transaction saved",
      stripeTransaction: stripeTransactionSaved,
    });
  } catch (error) {
    logger.error(error);
    return response.status(500).json({
      ok: false,
      msg: "Please contact administrator",
    });
  }
};

const removeDuplicateEntries = async (request, response) => {
  try {
    const duplicateEntryId = request.params.id;
    const duplicateEntry = await StripeTransaction.findByIdAndDelete(
      duplicateEntryId
    );
    if (duplicateEntry) {
      return response.status(201).json({
        ok: true,
        msg: `Duplicate entry ID ${duplicateEntryId} removed`,
      });
    }
  } catch (error) {
    return response.status(500).json({
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
      return response.status(201).json({
        ok: true,
        paymentIntent,
      });
    }
  } catch (error) {
    return response.status(500).json({
      error,
    });
  }
};

const retrieveSubscriptionID = async (request, response) => {
  try {
    const paymentIntentId = request.params.id;
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    const invoiceId = paymentIntent.invoice;

    if (invoiceId) {
      const invoice = await stripe.invoices.retrieve(invoiceId);

      const subscriptionId = invoice.subscription;

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return response.status(201).json({
        ok: true,
        subscription,
      });
    } else {
      throw new Error("Payment Intent is not associated with a Subscription.");
    }
  } catch (error) {
    return response.status(500).json({
      error,
    });
  }
};

const getListOfAllSavedStripeTransaction = async (request, response) => {
  try {
    const listOfStripeTransactionsSaved = await StripeTransaction.find(
      request.body
    ).populate("user");
    return response.status(201).json({
      ok: true,
      list: listOfStripeTransactionsSaved,
    });
  } catch (error) {
    return response.status(500).json({
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
    logger.error("🚀 ~ stripeCompanyAccountFound ~ error:", error);
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
    return response.status(201).json({
      ok: true,
      subscriptions,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

const searchCustomerByParameters = async (request, response) => {
  const parameters = request._parsedUrl.query.split("=");
  const customerEmail = parameters[1].split("&")[0];
  const customerName = parameters.at(-1);
  try {
    const customer = await stripe.customers.search({
      query: `email:\'${customerEmail}\' AND name:\'${customerName.replaceAll(
        "%20",
        " "
      )}\'`,
    });
    return response.status(201).json({
      ok: true,
      customer: customer,
      customerName: customerName,
      customerEmail: customerEmail,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error,
      customerName: customerName,
      customerEmail: customerEmail,
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
  updatePaymentMethodFromAdminDashboard,
  searchingSubscriptionInStripe,
  findSubscriptionIdBySetUpId,
  searchCustomerByParameters,
  stripeAccountCreate,
  stripeAccountSession,
  stripeAccountLink,
  partialRefundStripePaymentIntent,
  stripeCompanyAccountUpdate,
};
