'use strict';

const VALID_ROLE_TYPES_LIST = [
  'root_admin', 'admin', 'sale_manager',
  'event_manager', 'inventory_manager', 'assistant',
  'inventory_location_manager', 'inventory_location_assistant',
  'category_manager', 'category_assistant',
];

const VALID_ROLE_TYPES = new Set(VALID_ROLE_TYPES_LIST);

module.exports = { VALID_ROLE_TYPES, VALID_ROLE_TYPES_LIST };
