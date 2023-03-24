const { Schema, model, trusted } = require("mongoose");

const EventSchema = Schema({
    user: {
        type: String,
        required: true,
    },
    eventName: {
        type: String,
        required: true,
    },
    dateBegin: {
        type: String,
        required: true,
    },
    dateEnd: {
        type: String,
        required: true,
    },
    location: {
        type: String,
        required: true
    },
    instructions: {
        type: Object,
        required: true
    },
    locationInstructions: {
        type: String,
        required: true
    },
    company: {
        type: String,
        required: true
    }
});

EventSchema.method("toJSON", function () {
    const { _id, __v, ...object } = this.toObject();

    object.id = _id;
    return object;
});

module.exports = model("Event", EventSchema);