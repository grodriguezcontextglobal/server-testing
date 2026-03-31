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
      required: false,
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
      email: {
        type: String,
        required: false,
      },
      employee_id: {
        type: String,
        required: false,
        default:""
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
        inventory_location: [
          {
            type: String,
            required: false,
          },
        ],
        managerLocation: [
          {
            location: {
              type: String,
              required: false,
            },
            actions: {
              create: {
                type: Boolean,
                default: false,
              },
              update: {
                type: Boolean,
                default: false,
              },
              transfer: {
                type: Boolean,
                default: false,
              },
              delete: {
                type: Boolean,
                default: false,
              },
              assign: {
                type: Boolean,
                default: false,
              },
              view: {
                type: Boolean,
                default: true,
              },
            },
          },
        ],
      },
      userId: {
        type: Schema.Types.ObjectId,
        ref: "AdminUser",
        required: false,
      },
    },
  ],
  company_logo: {
    type: String,
    required: false,
    default: "",
  },
  stripe_connected_account: {
    type: Object,
    required: false,
    default: {
      test: null,
      live: null,
    },
  },
  structure: {
    type: Object,
    required: false,
    default: {
      location_1: "Locations|Sub-locations",
      category_name: "Category",
      item_group: "Groups",
      brand: "Brands",
      ownership: "Ownership",
    },
  },
});

Company.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("Company", Company);
