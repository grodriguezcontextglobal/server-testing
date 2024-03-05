const { Schema, model } = require("mongoose");

const AdminUserSchema = Schema({
  name: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  phone: {
    type: String,
    required: false,
    unique: false,
  },
  password: {
    type: String,
    required: true,
    unique: true,
  },
  question: {
    type: String,
    required: true,
  },
  answer: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    default: "Editor",
  },
  active: {
    type: Boolean,
    default: true,
  },
  company: {
    type: String,
    required: true,
  },
  imageProfile: {
    type: String,
  },
  emailNotifications:{
    type:Object,
    default:{
      newsAndUpdates:false,
      tipsAndTutorials:false,
      userResearch:false
    }
  },
  dailySummaries:{
    type: String,
    default:"do not notify me"
  },
  eventReminder: {
    type: String,
    default: "do not notify me"
  },
  subscriptionRenewals: {
    type: String,
    default: "do not notify me"
  },
  online: {
    type:Boolean,
    default: false
  }
});

AdminUserSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("AdminUser", AdminUserSchema);
