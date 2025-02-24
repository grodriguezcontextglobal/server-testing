const { Schema, model } = require("mongoose");

const ErrorLogSchema = new Schema({
  componentStack: {
    type: String,
    required: true,
  },
  error: {
    type: String,
    required: true,
  },
  created_at:{
    type: Date,
    default: Date.now
  }
});

ErrorLogSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("ErrorLog", ErrorLogSchema);
