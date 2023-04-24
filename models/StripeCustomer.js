const { Schema, model } = require("mongoose");

const StripeCustomerSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: false,
  },
  email: {
    type: String,
    required: true,
    unique: false,
  },
  phone: {
    type: String,
    required: true,
  },
  stripeid: {
    type: String,
    required: true,
    unique: false,
  },
});

StripeCustomerSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("StripeCustomer", StripeCustomerSchema);
