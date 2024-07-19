const { Schema, model } = require("mongoose");

const Company = new Schema({
  company_name: {
    type: String,
    required: true,
    default: "unknown",
  },
  address: {
    type: Object,
    required: true,
    street: {
      type: String,
      required: true,
      default: "unknown",
    },
    city: {
      type: String,
      required: true,
      default: "unknown",
    },
    state: {
      type: String,
      required: true,
      default: "unknown",
    },
    postal_code: {
      type: String,
      required: true,
      default: "unknown",
    },
  },
  location: [
    {
      type: String,
      required: true,
      default: "unknown",
    },
  ],
  phone: {
    main: {
      type: String,
      required: true,
      default: "unknown",
    },
    alternative: {
      type: String,
      required: true,
      default: "unknown",
    },
    fax: {
      type: String,
      required: true,
      default: "unknown",
    },
  },
  owner: {
    first_name: {
      type: String,
      required: true,
      default: "unknown",
    },
    last_name: {
      type: String,
      required: true,
      default: "unknown",
    },
    email: {
      type: String,
      required: true,
      default: "unknown",
    },
  },
  website: {
    type: String,
    required: true,
    default: "unknown",
  },
  main_email: {
    type: String,
    required: true,
    default: "unknown",
  },
  industry: {
    type: String,
    required: true,
    default: "unknown",
  },
  stripe_customer_id: {
    type: String,
    required: true,
    default: "unknown",
  },
  employees: [
    {
      user: {
        type: String,
        required: true,
      },
      firstName: {
        type: String,
        required: true,
      },
      lastName: {
        type: String,
        required: true,
      },
      status: {
        type: String,
        required: true,
        default: "Pending",
      },
      super_user: {
        type: Boolean,
        required: true,
      },
      role: {
        type: String,
        required: true,
      },
      active: {
        type: Boolean,
        required: true,
        default: true,
      },
      preference: {
        type: Object,
        inventory_location: [
          {
            type: String,
            required: false,
          },
        ],
      },
    },
  ],
  company_logo:{
    type:String,
    required:true,
    default:""
  }
});

Company.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("Company", Company);
