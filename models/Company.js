const { Schema, model } = require("mongoose");
const { VALID_ROLE_TYPES_LIST } = require("../mysql/constants/roles");

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
        default: ""
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
      // Número heredado (0-5). Ningún permiso lo lee: authorizeMongoPermission
      // decide por roleType. Opcional desde 2026-11-04 para que el dashboard
      // pueda dejar de escribirlo (S1.3).
      role: {
        type: String,
        required: false,
      },
      // La misma lista que SQL y rolePermissions (10 tipos, con los de
      // categoría). Antes faltaban category_manager/category_assistant y un
      // save() con ellos fallaba la validación.
      roleType: {
        type: String,
        required: false,
        enum: VALID_ROLE_TYPES_LIST,
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

  /**
   * Branding applied to the notification emails Devitrak sends on this
   * company's behalf. Opt-in: with `enabled` false — the state of every
   * company that predates this field — mail keeps Devitrak's own look, so
   * turning the feature on never restyles anyone's email behind their back.
   *
   * Every field is optional and falls back to something already on the
   * company: the logo to `company_logo`, the name to `company_name`, the
   * reply-to to `main_email`. See nodeMailer/branding.js#normalizeBranding.
   */
  email_branding: {
    enabled: {
      type: Boolean,
      required: false,
      default: false,
    },
    display_name: {
      type: String,
      required: false,
      default: "",
    },
    logo_url: {
      type: String,
      required: false,
      default: "",
    },
    brand_color: {
      type: String,
      required: false,
      default: "",
    },
    reply_to: {
      type: String,
      required: false,
      default: "",
    },
    footer_note: {
      type: String,
      required: false,
      default: "",
    },
    show_powered_by: {
      type: Boolean,
      required: false,
      default: true,
    },
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
  roleLabels: {
    type: Object,
    required: false,
    default: {
      "root_admin": "Root Administrator", "admin": "Administrator", "sale_manager": "Sale Manager", "event_manager": "Event Manager", "inventory_manager": "Warehouse Manager", "assistant": "Assistant", "inventory_location_manager": "Inventory Location Manager", "inventory_location_assistant": "Inventory Location Assistant", "category_manager": "Category Manager", "category_assistant": "Category Assistant"
    }
  }
});

Company.method("toJSON", function () {
  const { _id, __v, ...object } = this.toObject();

  object.id = _id;
  return object;
});

module.exports = model("Company", Company);