const { Schema, model } = require("mongoose");

const TransactionAuditLogSchema = Schema({
    transaction: {
        type: String,
        required: true,
    }, 
    user: {
        type: String,
        required: true,
    },
    actionTaken: {
        type: String,
        required: true,
    },
    time: {
        type: String,
        required: false,
    }
});

TransactionAuditLogSchema.method("toJSON", function () {
    const { _id, __v, ...object } = this.toObject();

    object.id = _id;
    return object;
});

module.exports = model("TransactionAuditLog", TransactionAuditLogSchema);