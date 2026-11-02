const express = require("express");
const Subscription = require("../models/Subscription");
const Company = require("../models/Company");
const logger = require("../helpers/logger");

const createSubscription = async (request, response = express.response) => {
  try {
    let subscription = new Subscription(request.body);
    await subscription.save();
    return response.status(201).json({
      ok: true,
      subscription: subscription,
    });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
    });
  }
};
const updateSubscription = async (request, response) => {
  try {
    const { newSubscriptionData } = request.body;
    const subscriptionID = request.params.id;
    // Find the subscription by company name and update it
    let subscription = await Subscription.findByIdAndUpdate(
      subscriptionID,
      newSubscriptionData,
      { new: true } // Return the updated subscription
    );
    if (!subscription) {
      return response.status(404).json({
        ok: false,
        msg: "Subscription not found",
      });
    }
    response.status(200).json({
      ok: true,
      subscription: subscription,
    });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact the administrator",
    });
  }
};

const searchSubscription = async (request, response) => {
  try {
    // Solo por `company` (string). Antes el body entero era el filtro: cualquier
    // campo, y cualquier operador. El dashboard manda solo { company }.
    const company = request.body?.company ?? request.query?.company;
    if (typeof company !== "string" || !company.trim()) {
      return response.status(400).json({ ok: false, msg: "company must be a non-empty string" });
    }
    let subscription = await Subscription.findOne({ company });
    if (!subscription) {
      return response.status(404).json({
        ok: false,
        msg: "Subscription not found",
      });
    }

    response.status(200).json({
      ok: true,
      subscription: subscription,
    });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact the administrator",
    });
  }
};
const populateSubscriptionCompany = async (request, response) => {
  try {
    // Find the subscription by company name and update it
    const { companyName } = request.body;
    if (typeof companyName !== "string" || !companyName.trim()) {
      return response.status(400).json({ ok: false, msg: "companyName must be a non-empty string" });
    }
    let subscription = await Subscription.findOne({
      company: companyName,
    });
    let companyInfo = await Company.findOne({ company: companyName });
    if (companyInfo && subscription === null) {
      return response.status(201).json({
        ok: true,
        msg: "Subscription not found",
        subscription: { subscription, companyInfo },
      });
    } else if (subscription && companyInfo) {
      response.status(201).json({
        ok: true,
        subscription: { subscription, companyInfo },
      });
    }
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact the administrator",
    });
  }
};

module.exports = {
  createSubscription,
  updateSubscription,
  searchSubscription,
  populateSubscriptionCompany,
};
