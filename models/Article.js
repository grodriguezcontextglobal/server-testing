const { Schema, model } = require("mongoose");

const ArticleSchema = Schema({
  img: {
    type: String,
    required: true,
  },
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
});

module.exports = model("Article", ArticleSchema);
