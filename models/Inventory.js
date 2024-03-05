const { Schema, model } = require("mongoose");

const InventorySchema = Schema({
    batch: {
        type: String,
        required: true,
    },
    company: {
        type: String,
        required: true,
    },
    event: {
        type: String,
        required: true,
    },
    items: {
        type: [Object], // Assuming items is an array of object, you can adjust this based on your actual item structure
        required: true,
    },
    saveDefaultFormat: {
        type: Boolean,
        required: true,
    },
});
InventorySchema.method("toJSON", function () {
    const { _id, __v, ...object } = this.toObject();

    object.id = _id;
    return object;
});

module.exports = model("Inventory", InventorySchema);
