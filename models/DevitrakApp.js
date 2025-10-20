const { Schema, model } = require("mongoose");

const DevitrakAppSchema = new Schema({
  signature: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
    default: Date.now,
  },
  staff_id: {
    type: Schema.Types.ObjectId,
    ref: "AdminUser",
    required: false,
  },
  email: {
    type: String,
    required: true,
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
