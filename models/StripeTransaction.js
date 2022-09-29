const { Schema, model } = require("mongoose");

const StripeTransactionSchema = new Schema({
  device: {
    type: Number,
    required: true,
  },
  paymentIntent: {
    type: String,
    required: true,
    unique: true
  },
  clientSecret: {
    type: String,
    required: true ,
    unique: true
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
});

StripeTransactionSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("StripeTransaction", StripeTransactionSchema);
