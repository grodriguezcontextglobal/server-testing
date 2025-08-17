const { Schema, model } = require("mongoose");

const VerificationSchema = new Schema({
  staff_member_id: {
    type: Schema.Types.ObjectId,
    ref: "Admin",
    required: true,
  },
  assigner_staff_member_id: {
    type: Schema.Types.ObjectId,
    ref: "Admin",
    required: true,
  },
  date: {
    type: String,
    required: true,
    default: Date.now().toLocaleString(),
  },
  contract_list: [
    {
      document_url: {
        type: String,
        required: true,
      },
      signature: {
        type: Boolean,
        required: true,
        default: false,
      },
      date: {
        type: String,
        required: true,
        default: Date.now().toLocaleString(),
      },
    },
  ],
  company_id: {
    type: Schema.Types.ObjectId,
    ref: "Company",
    required: true,
  },
});

module.exports = model("Verification", VerificationSchema);
