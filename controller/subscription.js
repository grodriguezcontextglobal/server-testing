const express = require("express");
const Subscription = require("../models/Subscription");
const Company = require("../models/Company");

const createSubscription = async (request, response = express.response) => {
  try {
    let subscription = new Subscription(request.body);
    await subscription.save();
    return response.status(201).json({
      ok: true,
      subscription: subscription,
    });
  } catch (error) {
    console.log(error);
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
    let subscription = await Subscription.findOneAndUpdate(
      { _id: subscriptionID },
      { $set: newSubscriptionData },
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
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact the administrator",
    });
  }
};

const searchSubscription = async (request, response) => {
  try {
    // Find the subscription by company name and update it
    let subscription = await Subscription.findOne(request.body);
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
    console.log(error);
    response.status(500).json({
      ok: false,
      msg: "Please contact the administrator",
    });
  }
};
const populateSubscriptionCompany = async (request, response) => {
  try {
    // Find the subscription by company name and update it
    let subscription = await Subscription.findOne(request.body);
    let companyInfo = await Company.findOne({ company: request.body });
    console.log(companyInfo);
    console.log(subscription);
    if (!subscription) {
      return response.status(404).json({
        ok: false,
        msg: "Subscription not found",
      });
    }

    response.status(200).json({
      ok: true,
      subscription: { subscription, companyInfo },
    });
  } catch (error) {
    console.log(error);
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
