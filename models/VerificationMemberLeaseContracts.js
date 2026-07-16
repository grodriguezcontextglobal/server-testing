const { Schema, model } = require("mongoose");

const VerificationMemberContractLeaseSchema = new Schema({
  member_id: {
    type: Number,
    required: true,
  },
  assigner_staff_member_id: {
    type: Number,
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
    type:Number,
    required: true,
  },
});

module.exports = model("VerificationMemberContractLease", VerificationMemberContractLeaseSchema);
