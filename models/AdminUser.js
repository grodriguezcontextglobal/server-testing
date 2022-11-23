const { Schema, model } = require("mongoose")


const AdminUserSchema = Schema({

    name:{
        type: String,
        required: true
    },
    email:{
        type: String,
        required: true,
        unique: true
    },
    password:{
        type: String,
        required: true,
        unique: true
    },
    role: {
        type: String,
        default:"Editor"
    },
    active: {
        type: Boolean,
        default: true
    }
})

AdminUserSchema.method('toJSON', function() {
    const { _id, __v, ...object } = this.toObject()

    object.id = _id
    return object;

})

module.exports = model( 'AdminUser', AdminUserSchema )