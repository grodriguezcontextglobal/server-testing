const { Schema, model } = require("mongoose");

const ArticleSchema = Schema({
  title: {
    type: String,
    required: true,
  },
  body: {
    type: String,
    required: true,
  },
  adminUser: {
    type: Schema.Types.ObjectId,
    ref: "AdminUser",
    required: true,
  },
  active: {
    type: Boolean,
    default: false,
  },
  event: {
    type: String,
    required: true,
  },
  company: {
    type: String,
    required: true,
  },
  image: {
    type: String,
    default:""
  },
});

module.exports = model("Article", ArticleSchema);
