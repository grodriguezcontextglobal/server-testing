const { Schema, model } = require("mongoose");

const CashReportSchema = Schema({
    attendee: {
        type: String,
        required: true,
    },
    admin: {
        type: String,
        required: true,
    },
    deviceLost: [{
        type: Object,
    }],
    amount: {
        type: String,
        required: true,
    },
    event: {
        type: String,
        required: true,
    },
    company: {
        type: String,
        required: true,
    },
    typeCollection:{
        type:String,
        required: true
    }
});

CashReportSchema.method("toJSON", function () {
    const { _id, __v, ...object } = this.toObject();

    object.id = _id;
    return object;
});

module.exports = model("CashReport", CashReportSchema);