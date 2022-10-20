const { Schema, model } = require("mongoose");

const ReceiversSchema = new Schema({
  device: [{
    type: Object,
    required: true,
  }],
  paymentIntent: {
    type: String,
    required: true,
  },
  user: {
    type: String,
    required: true
  },
  active: {
    type: Boolean,
    default: true
  }
});

ReceiversSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("Receivers", ReceiversSchema);