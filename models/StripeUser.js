const { Schema, model } = require("mongoose")


const StripeUserSchema = Schema({

    name:{
        type: String,
        required: true,
        unique: false
    },
    lastName:{
        type: String,
        required: true,
        unique: false
    },
    email:{
        type: String,
        required: true,
        unique: true,
    },
    phoneNumber:{
        type: Number,
        required: true,
        unique:true,
    }
})

//to return an id instead of _id

StripeUserSchema.method('toJSON', function() {
    const { _id, __v, ...object } = this.toObject()

    object.id = _id
    return object;

})



module.exports = model( 'StripeUser', StripeUserSchema )