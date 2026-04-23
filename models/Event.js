const { Schema, model } = require("mongoose");

const EventSchema = Schema({
  user: {
    type: String,
    required: true,
  },
  company: {
    type: String,
    required: true,
  },
  subscription: {
    type: Object,
    required: true,
  },
  eventInfoDetail: {
    type: Object,
    required: true,
  },
  staff: {
    type: Object,
    required: true,
  },
  contactInfo: {
    type: Object,
    required: true,
  },
  deviceSetup: [
    {
      type: Object,
      required: true,
    },
  ],
  extraServicesNeeded: {
    type: Boolean,
    required: true,
    default: false,
  },
  extraServices: [
    {
      type: Object,
      required: false,
    },
  ],
  active: {
    type: Boolean,
    required: true,
  },
  qrCodeLink: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
    default: "event",
  },
  show: {
    type: Boolean,
    required: true,
    default: true,
  },
  company_id: {
    type: String,
    required: true,
    default: null,
  },
  legal_contract: {
    type: Boolean,
    required: true,
    default: false,
  },
  legal_documents_list:{
    type: Array,
    required: false,
    default: []
  },
  logistic_inventory_status:{
    type: String,
    required: true,
    default: "in_idle",
  },
  contract_for:{
    type: String,
    required: false,
    default: "event"
  }
});

EventSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("Event", EventSchema);
