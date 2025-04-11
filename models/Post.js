const { Schema, model } = require("mongoose");

const PostSchema = new Schema({
  title: {
    type: String,
    required: true,
  },
  subtitle: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
    default: "",
  },
  displayed_in: [
    {
      type: String,
      required: true,
    },
  ],
  media: {
    cover: {
      type: String,
      required: false,
      default: "",
    },
    content: [
      {
        type: String,
        required: false,
      },
    ],
  },
  company_id: {
    type: String,
    required: true,
},
  published: {
    type: Boolean,
    default: true,
  },
  published_at: {
    type: Date,
    default: Date.now,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

PostSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("Post", PostSchema);
