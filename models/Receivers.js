const { Schema, model } = require("mongoose");

const ReceiversSchema = new Schema({
  device: {
    type: Object,
    required: true,
  },
  paymentIntent: {
    type: String,
    required: true,
  },
  user: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  eventSelected: [
    {
      type: String,
      required: true,
    },
  ],
  provider: [
    {
      type: String,
      required: true,
    },
  ],
  company: {
    type: String,
    required: true,
  },
  timeStamp: {
    type: Date,
    required: true,
  },
  event_id:{
    type: String,
    required: false,
    default: "",
  }
});

ReceiversSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("Receivers", ReceiversSchema);
