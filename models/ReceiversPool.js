const { Schema, model } = require("mongoose");

const ReceiversPoolSchema = new Schema({
  eventSelected: {
    type: String,
    required: true,
  },
  device: {
    type: Object,
    required: true,
    unique: false,
  },
  type: {
    type: String,
    required: true,
    unique: false,
  },
  status: {
    type: String,
    required: true,
    default: "Operational",
    unique: false,
  },
  activity: {
    type: Boolean,
    require: true,
    default: false,
    unique: false,
  },
  comment: {
    type: String,
    required: false,
    default: "No comment",
    unique: false,
  },
  provider: {
    type: String,
    required: true,
    unique: false,
  },
  company: {
    type: String,
    required: true,
  },
  contract_type:{
    type: String,
    required: true,
    unique: false,
    default: "event",
  }
});

ReceiversPoolSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("ReceiversPool", ReceiversPoolSchema);
