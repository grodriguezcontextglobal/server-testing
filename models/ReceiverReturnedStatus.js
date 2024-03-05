const { Schema, model } = require("mongoose");

const ReceiverReturnedStatusSchema = new Schema({
  device: {
    type: Object,
    required: true,
    dropDups: true
  },
  status: {
    type: String,
    required: true,
  },
  activity: {
    type: String,
    required: true,
    default: "Stored",
  },
  comment: {
    type: String,
    required: false,
    default: "No comment",
  },
  user: {
    type: String,
    required: true
  },
  provider: {
    type: String,
    required: true
  },
  eventSelected: {
    type: String,
    required: true,
  },
  admin: {
    type: String,
    required: true,
  },
  timeStamp: {
    type: Date,
    required: true
  }
});

ReceiverReturnedStatusSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("ReceiverReturnedStatus", ReceiverReturnedStatusSchema);
