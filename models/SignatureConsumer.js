const { Schema, model } = require("mongoose");

const SignatureConsumerSchema = new Schema({
  signature: {
    type: String,
    required: true,
  },
  date: {
    type: String,
    required: true,
  },
  contract_url: {
    type: String,
    required: true,
  },
  company_id: {
    type: Schema.Types.ObjectId,
    ref: "Company",
    required: true,
  },
  consumer_member_id: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  item_ids: {
    type: [String],
    required: true,
    default: [],
  },
  verification_id: {
    type: Schema.Types.ObjectId,
    ref: "Verification",
    required: true,
  },
  device_signature: {
    type: Object,
    device_agent: {
      type: String,
      default: "Unknown Agent",
    },
    device_browser: {
      type: String,
      default: "Unknown Browser",
    },
    device_location: {
      type: String,
      default: "Unknown Location",
    },
    device_timezone: {
      type: String,
      default: "UTC",
    },
    device_ip_address: {
      type: String,
      default: "Unknown IP Address",
    },
  },
});

module.exports = model("SignatureConsumer", SignatureConsumerSchema);
