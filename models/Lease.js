const { Schema, model } = require("mongoose");

const LeaseSchema = Schema({
    admin_user: {
        fullName: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            required: true,
        },
        role: {
            type: String,
            required: true,
        },
        staffIdSQL: {
            type: String,
            required: true
        }
    },
    company: {
        companyID: {
            type: String,
            required: true
        }
    },
    subscription: {
        initialDate: {
            type: Date,
            required: true,
            default: new Date()
        },
        expectedReturnDate: {
            type: Date,
        },
        returnedDate: {
            type: Date
        },
        currentInUse: {
            type: Boolean,
            required: true,
            default: true
        },
        location: {
            type: String,
            required: true,
        },
    },
    staff_member: {
        staff_id: {
            type: String,
            required: true
        }
    },
    device: {
        item_id: {
            type: String,
            required: true
        }
    },
    active: {
        type: Boolean,
        required: true
    },
    date_assignment: {
        type: Date,
        required: true,
        default: new Date()
    }
});

LeaseSchema.method("toJSON", function () {
    const { _id, __v, ...object } = this.toObject();

    object.id = _id;
    return object;
});

module.exports = model("Lease", LeaseSchema);