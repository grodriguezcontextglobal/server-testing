const { Schema, model } = require('mongoose');

const ItemSchema = new Schema({
    category: {
        type: String,
        required: true,
    },
    group: {
        type: String,
        required: true,
    },
    value: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    company: {
        type: String,
        required: true,
    },
    quantity: {
        type: String,
        required: true,
    },
    ownership: {
        type: String,
        required: true,
    },
    createdBy: {
        type: String,
        required: true,
    },
    key: {
        type: String, // Assuming items is an array of objects, you can adjust this based on your actual item structure
        required: true,
    },
    dateCreated: {
        type: String,
        required: true,
    },
    resume: {
        type: String,
        required: true,
    },
    consumerUses: {
        type: Boolean,
        require: true,
        default: true
    }
});

const Item = model('Item', ItemSchema);

module.exports = Item;