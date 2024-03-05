const { Schema, model } = require("mongoose");

const StripeCompanySchema = Schema({
    companyName: {
        type: String,
        required: true,
    },
    stripeID: {
        type: String,
        required: true,
    },
    ownerEmail: {
        type: String,
        required: true,
        unique: true,
    },
    ownerFirstName: {
        type: String,
        required: true,
    },
    ownerLastName: {
        type: String,
        required: true,
    },
    subscriptionHistory: [{
        type: Object,
    }]
});

StripeCompanySchema.method("toJSON", function () {
    const { _id, __v, ...object } = this.toObject();

    object.id = _id;
    return object;
});

module.exports = model("StripeCompany", StripeCompanySchema);
