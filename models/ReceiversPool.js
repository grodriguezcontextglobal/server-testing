const { Schema, model } = require("mongoose");

const ReceiversPoolSchema = new Schema({
  eventSelected:
  {
    type: String,
    required: true,
    unique: true,
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
    type: String,
    require: true,
    default: "No",
    unique: false,
  },
  comment: {
    type: String,
    required: false,
    default: "No comment",
    unique: false,
  },
  provider:
  {
    type: String,
    required: true,
    unique: false,
  },
});

ReceiversPoolSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("ReceiversPool", ReceiversPoolSchema);
