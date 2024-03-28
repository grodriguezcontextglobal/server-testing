const { Schema, model } = require("mongoose");

const SubscriptionSchema = new Schema({
    company: {
        type: String,
        required: true,
        default: "unknown"
    },
    record: [{
        subscription_id: {
            type: String,
            required: true,
            default: "unknown"
        },
        active: {
            type: Boolean,
            required: true,
            default: false
        },
        cancel_at: {
            type: Number,
            required: true,
            default: 0
        },
        subscription_type: {
            type: String,
            required: true,
            default: "unknown"
        },
        created_at: {
            type: Number,
            required: true
        }
    }],
});

SubscriptionSchema.method("toJSON", function () {
    const { _id, __v, ...object } = this.toObject();

    object.id = _id;
    return object;
});

module.exports = model("subscription", SubscriptionSchema);