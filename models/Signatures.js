const { Schema, model } = require("mongoose");

const SignatureSchema = new Schema({
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
});

module.exports = model("Signature", SignatureSchema);
