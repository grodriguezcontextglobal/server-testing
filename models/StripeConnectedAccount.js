const { Schema, model } = require("mongoose");

const StripeConnectedAccountSchema = Schema({
  business_type: {
    type: String,
    require: true,
  },
  business_profile: {
    type: String,
    require: true,
  },
  company: {
    address: {
      country: { type: String, require: true },
      city: { type: String, require: true },
      line1: { type: String, require: true },
      line2: { type: String, require: false },
      postal_code: { type: String, require: true },
      state: { type: String, require: true },
    },
    name: { type: String, require: true },
    phone: { type: String, require: true },
    registration_number: { type: String, require: true },
    tax_id: { type: String, require: true },
  },
  individual: {
    address: {
      country: { type: String, require: true },
      city: { type: String, require: true },
      line1: { type: String, require: true },
      line2: { type: String, require: false },
      postal_code: { type: String, require: true },
      state: { type: String, require: true },
    },
    dob: {
      day: { type: String, require: true },
      month: { type: String, require: true },
      year: { type: String, require: true },
    },
    email: { type: String, require: true },
    first_name: { type: String, require: true },
    last_name: { type: String, require: true },
    phone: { type: String, require: true },
    id_number: { type: String, require: true },
    relationship: {
      director: { type: Boolean, require: false, default: false },
      owner: { type: Boolean, require: false, default: false },
      executive: { type: Boolean, require: false, default: false },
    },
    ssn_last_4: { type: String, require: true },
  },
  email: { type: String, require: true },
  country: { type: String, require: true },
  business_profile: {
    annual_revenue: {
      amount: { type: String, require: true },
      currency: { type: String, require: true, default: ["USD"] },
      fiscal_year_end: { type: String, require: true }, //ISO 8601 format. 2023-12-31
    },
    name: { type: String, require: true },
    mcc: mcc,
    product_description: { type: String, require: true },
    support_email: { type: String, require: true },
    support_phone: { type: String, require: true },
    url: { type: String, require: true },
  },
  settings: {
    payouts: {
      schedule: {
        interval: { type: String, require: true, default: "manual" },
        delay_days: { type: String, require: true, default: "minimum" },
      },
    },
  },
  accountID: { type: String, require: true, default: "" },
});

StripeConnectedAccountSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("StripeConnectedAccount", StripeConnectedAccountSchema);
