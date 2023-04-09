const { Schema, model } = require("mongoose");

const EventSchema = Schema({
  user: {
    type: String,
    required: true,
  },
  company:{
    type:String,
    required: true
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
});

EventSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("Event", EventSchema);
