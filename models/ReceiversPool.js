const { Schema, model } = require("mongoose");

const ReceiversPoolSchema = new Schema({
  device: {
    type: Object,
    required: true,
    unique: true,
    dropDups: true
  },
  status: {
    type: String,
    required: true,
    default: "Operational",
  },
  activity: {
    type: String,
    require: true,
    default: "Stored",
  },
  comment: {
    type: String,
    required: false,
    default: "No comment",
  },

});

ReceiversPoolSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("ReceiversPool", ReceiversPoolSchema);
