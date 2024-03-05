const { Schema, model } = require("mongoose");

const NotificationLogSchema = Schema({
    user: {
        type: String,
        required: true,
    },
    actionTaken: {
        type: String,
        required: true,
    },
    destinatary: {
        type: String,
        required: true,
    },
    time: {
        type: String,
        required: true,
    }
});

NotificationLogSchema.method("toJSON", function () {
    const { _id, __v, ...object } = this.toObject();

    object.id = _id;
    return object;
});

module.exports = model("NotificationLog", NotificationLogSchema);