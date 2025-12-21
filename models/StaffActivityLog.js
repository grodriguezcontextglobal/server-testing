const { Schema, model } = require("mongoose");

const StaffActivityLogSchema = new Schema({
  staff_member_id: {
    type: Schema.Types.ObjectId,
    ref: "AdminUser",
    required: true,
  },
  company_id: {
    type: String,
    required: true,
  },
  action: {
    type: String,
    required: true,
    // Suggestions: 'LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'ASSIGN', 'UNASSIGN', 'IMPORT', 'EXPORT'
  },
  target_model: {
    type: String,
    required: true,
    // Suggestions: 'AdminUser', 'User', 'Event', 'Inventory', 'Lease', 'Verification'
  },
  target_id: {
    type: String, // ID of the affected object
    required: false,
  },
  details: {
    type: Object, // Flexible field for details like "Added 5 items", "Assigned iPad to John", etc.
    default: {},
  },
  ip_address: {
    type: String,
    default: "",
  },
  device_info: {
    type: String, // User Agent
    default: "",
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

StaffActivityLogSchema.method("toJSON", function () {
  const { __v, _id, ...object } = this.toObject();
  object.id = _id;
  return object;
});

module.exports = model("StaffActivityLog", StaffActivityLogSchema);
