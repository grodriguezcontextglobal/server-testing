const { Schema, model } = require("mongoose");

const StripeTransactionSchema = new Schema({
  device: {
    type: Number,
    required: true,
  },
  paymentIntent: {
    type: String,
    required: true,
  },
  clientSecret: {
    type: String,
    required: true,
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  eventSelected: {
    type: String,
    required: true,
  },
  provider: {
    type: String,
    required: true,
  },
  company: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
    default: "event",
  },
});

StripeTransactionSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("StripeTransaction", StripeTransactionSchema);
