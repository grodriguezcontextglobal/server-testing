const { Schema, model } = require("mongoose");

const UserSchema = Schema({
  name: {
    type: String,
    required: true,
    unique: false,
  },
  lastName: {
    type: String,
    required: true,
    unique: false,
  },
  email: {
    type: String,
    required: true,
    unique: false,
  },
  phoneNumber: {
    type: Number,
    required: true,
    unique: false,
  },
  privacyPolicy: {
    type: Boolean,
    required: true,
  },
  category: {
    type: String,
    required: true,
    default: "Regular",
  },
  provider: [
    {
      type: String,
      unique: false,
      required: true,
    },
  ],

  eventSelected: [
    {
      type: String,
      required: true,
      unique: false,
    },
  ],
  groupName: [
    {
      type: String,
      required: false,
      default: "unknown",
    },
  ],
  company_providers: [
    {
      type: String,
      required: true,
    },
  ],
  event_providers: [
    {
      type: String,
      required: false,
    },
  ],
  notes: [
    {
      company: {
        type: String,
        required: true,
        default: "",
      },
      date: {
        type: Date,
        required: true,
        default: new Date().getTime(),
      },
      notes: {
        type: String,
        required: true,
        default: "",
      },
    },
  ],
  profile_picture: {
    type: String,
    required: false,
  },
});

//to return an id instead of _id

UserSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("User", UserSchema);
