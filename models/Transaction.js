const { Schema, model } = require("mongoose");

const TransactionSchema = new Schema({
    device: [{
        type: Object,
        required: true,
    }],
    paymentIntent: {
        type: String,
        required: true,
    },
    clientSecret: {
        type: String,
        required: true,
    },
    consumerInfo: {
        type: Object,
        required: true,
    },
    eventSelected: {
        type: String,
        required: true
    },
    provider: {
        type: String,
        required: true
    },
    date: {
        type: String,
        required: true,
    },
    active:{
        type: Boolean,
        required: true,
        default:true
    }
});

TransactionSchema.method("toJSON", function () {
    const { _id, __v, ...object } = this.toObject();

    object.id = _id;
    return object;
});

module.exports = model("Transaction", TransactionSchema);