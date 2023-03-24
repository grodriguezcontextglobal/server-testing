const { Schema, model } = require("mongoose");

const EventLogSchema = Schema({
  user: {
    type: String,
    required: true,
  },
  actionTaken: {
    type: String,
    required: true,
  },
  time: {
    type: String,
    required: true,
  }
});

EventLogSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("EventLog", EventLogSchema);