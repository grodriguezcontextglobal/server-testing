const { Schema, model } = require("mongoose");

const FolderSchema = new Schema({
  folder_name: {
    type: String,
    required: true,
  },
  folder_description: {
    type: String,
    required: true,
  },
  company_id: {
    type: Schema.Types.ObjectId,
    ref: "Company",
    required: false,
  },
  trigger_action: {
    type: String,
    required: true,
  },
  documents: [
    {
      type: String,
      required: false,
      unique: false,
    },
  ],
  documents: [
    {
      document_name: {
        type: String,
        required: true,
      },
      active: {
        type: Boolean,
        default: true,
      },
      document_id: {
        type: Schema.Types.ObjectId,
        ref: "Document",
        required: false,
      },
    },
  ],
});

FolderSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("Folder", FolderSchema);
