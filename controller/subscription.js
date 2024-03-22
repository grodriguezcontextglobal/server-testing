const express = require("express");
const Subscription = require("../models/Subscription");

const createSubscription = async (request, response = express.response) => {
    try {
       let subscription = new Subscription(request.body);
        await subscription.save()
        return response.status(201).json({
            ok: true,
            subscription: subscription
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
        const { company, newSubscriptionData } = request.body;
        // Find the subscription by company name and update it
        let subscription = await Subscription.findOneAndUpdate(
            { company: company },
            { $set: newSubscriptionData },
            { new: true } // Return the updated subscription
        );
        if (!subscription) {
            return response.status(404).json({
                ok: false,
                msg: 'Subscription not found',
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
            msg: 'Please contact the administrator',
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
                msg: 'Subscription not found',
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
            msg: 'Please contact the administrator',
        });
    }
};

module.exports = {
    createSubscription,
    updateSubscription,
    searchSubscription
};
