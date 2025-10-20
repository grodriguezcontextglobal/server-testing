const { Schema, model } = require("mongoose");

const DevitrakAppSchema = new Schema({
  signature: {
    type: String,
    required: true,
  },
  date: {
    type: String,
    required: true,
  },
  staff_id:{
        type: Schema.Types.ObjectId,
        ref: "AdminUser",
        required: false,
  },
  documentsAndPolicies: [
    {
      documentName: {
        type: String,
        required: true,
      },
      url: {
        type: String,
        required: true,
      },
    },
  ],
});

DevitrakAppSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("DevitrakApp", DevitrakAppSchema);
