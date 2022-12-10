const { Schema, model } = require("mongoose");

const StripeCustomerSchema = new Schema({
    name: {
        type:String,
        required: true
    },
    email:{
        type:String,
        required: true,
        unique:true
    },
    phone:{
        type:String,
        required: true
    },
    id:{
        type: String,
        required: true,
        unique: true
    }
});

StripeCustomerSchema.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("StripeCustomer", StripeCustomerSchema);
