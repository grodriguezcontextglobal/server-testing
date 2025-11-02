const { Schema, model } = require("mongoose");

const EventSignatureSchema = new Schema({
  signature: {
    type: String,
    required: true,
  },
  date: {
    type: String,
    required: true,
  },
  contract_url: [
    {
      id: {
        type: String,
        required: true,
      },
      title: { type: String, required: true },
      view_url: { type: String, required: true },
    },
  ],
  company_id: {
    type: Schema.Types.ObjectId,
    ref: "Company",
    required: true,
  },
  event_id: {
    type: Schema.Types.ObjectId,
    ref: "Event",
    required: true,
  },
  accepted: {
    type: Boolean,
    required: true,
  },
  consumer_id: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  transaction_id: {
    type: String,
    required: false,
  },
});

module.exports = model("EventSignature", EventSignatureSchema);
