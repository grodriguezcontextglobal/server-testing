const { Schema, model } = require("mongoose");

const ImageSchema = Schema({
  source: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  item_group: {
    type: String,
    required: true,
  },
  company: {
    type: String,
    required: true,
  },
  time: {
    type: String,
    required: true,
    default: new Date().toDateString()
  }
});

ImageSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("Image", ImageSchema);