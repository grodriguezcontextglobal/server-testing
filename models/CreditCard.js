const { Schema, model } = require("mongoose")


const CreditCardSchema = new Schema({

    cardName: {
        type: String,
        required: true
    },
    cardNumber: {
        type: Number,
        required: true
    },
    mm: {
        type: Number,
        required: true
    },
    yy: {
        type: Number,
        required: true
    },
    cvv: {
        type: Number,
        required: true
    },
    zip: {
        type: {},
        required: true
    },
    country: {
        type: String,
        required: true
    },
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }


})


CreditCardSchema.method('toJSON', function() {
    const { _id, __v, ...object } = this.toObject()

    object.id = _id
    return object;

})

module.exports = model( 'CreditCard', CreditCardSchema )