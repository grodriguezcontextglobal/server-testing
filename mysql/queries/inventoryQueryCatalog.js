'use strict';

/**
 * Server-side catalog of the statements the frontend used to send as raw SQL to
 * /inventory-based-on-submitted-parameters.
 *
 * The point of the catalog is that the CLIENT NO LONGER CHOOSES THE SQL. It
 * names an entry and supplies parameters; the SQL text lives here.
 *
 * Two invariants every entry must honour:
 *
 *  1. `companyId` comes from the caller's verified company membership, never
 *     from the request body. It is passed in via `context`, and entries must
 *     use it rather than accepting a company id as a parameter.
 *  2. Values never enter the SQL string. Variable-length lists build their own
 *     `?` placeholders and push the values, in the same order.
 *
 * Several legacy shapes had NO company filter at all (they could read or write
 * across tenants). Those entries add the scoping here — see `scopingAdded` on
 * each one. That is a deliberate behaviour change: the old query could touch
 * another company's rows, the catalog entry cannot.
 */

/** Thrown for bad/missing parameters so the controller can answer 400. */
class QueryParamError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueryParamError';
  }
}

const requireNonEmptyArray = (value, name) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new QueryParamError(`${name} must be a non-empty array`);
  }
  return value;
};

const requirePresent = (value, name) => {
  if (value === undefined || value === null || value === '') {
    throw new QueryParamError(`${name} is required`);
  }
  return value;
};

/** Positive integer, for LIMIT/OFFSET which cannot be bound as placeholders safely everywhere. */
const requireCount = (value, name, { max = 10000, min = 0 } = {}) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new QueryParamError(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
};

/** `?, ?, ?` for a list of n values. */
const placeholders = (list) => list.map(() => '?').join(', ');

/**
 * Columns the "filter inventory by one attribute" screens are allowed to filter
 * on. An allowlist, because the column name is the one thing that cannot be a
 * bound parameter — it goes into the SQL text, so it must never come from the
 * client unchecked.
 */
const FILTERABLE_ATTRIBUTES = new Set([
  'brand',
  'category_name',
  'item_group',
  'location',
  'ownership',
]);

const RENT_COLUMNS = 'item_id, serial_number, item_group';

/**
 * Shared WHERE for the "rented items" screens: always scoped to the caller's
 * company, optionally narrowed by supplier and by a free-text search.
 */
const buildRentFilter = ({ supplierId, search }, companyId) => {
  const conditions = ['ownership = ?', 'company_id = ?'];
  const values = ['Rent', companyId];

  if (supplierId !== undefined && supplierId !== null && supplierId !== '') {
    conditions.push('supplier_info = ?');
    values.push(supplierId);
  }
  if (search !== undefined && search !== null && search !== '') {
    conditions.push('(CAST(item_id AS CHAR) LIKE ? OR serial_number LIKE ?)');
    const pattern = `%${search}%`;
    values.push(pattern, pattern);
  }
  return { where: conditions.join(' AND '), values };
};

const catalog = {
  // ── item_inv reads ────────────────────────────────────────────────────────

  'inventory.itemsByIds': {
    description: 'Rented items by explicit id list, optionally narrowed by supplier.',
    build: ({ itemIds, supplierId }, { companyId }) => {
      const ids = requireNonEmptyArray(itemIds, 'itemIds');
      const values = [...ids, 'Rent', companyId];
      let sql =
        `SELECT ${RENT_COLUMNS} FROM item_inv ` +
        `WHERE item_id IN (${placeholders(ids)}) AND ownership = ? AND company_id = ?`;
      if (supplierId !== undefined && supplierId !== null && supplierId !== '') {
        sql += ' AND supplier_info = ?';
        values.push(supplierId);
      }
      return { sql, values };
    },
  },

  'inventory.serialsByGroupCategoryLocation': {
    description: 'Serial numbers available in a location for a group/category.',
    build: ({ itemGroup, categoryName, location, warehouse = 1 }, { companyId }) => ({
      sql:
        'SELECT serial_number FROM item_inv ' +
        'WHERE item_group = ? AND category_name = ? AND company_id = ? AND location = ? AND warehouse = ? ' +
        'ORDER BY serial_number ASC',
      values: [
        requirePresent(itemGroup, 'itemGroup'),
        requirePresent(categoryName, 'categoryName'),
        companyId,
        requirePresent(location, 'location'),
        requireCount(warehouse, 'warehouse', { max: 1 }),
      ],
    }),
  },

  'inventory.itemsByGroupCategoryLocationSerials': {
    description: 'Full rows for specific serials within a group/category/location.',
    build: (
      { itemGroup, categoryName, location, serialNumbers, warehouse = 1 },
      { companyId }
    ) => {
      const serials = requireNonEmptyArray(serialNumbers, 'serialNumbers');
      return {
        sql:
          'SELECT * FROM item_inv ' +
          'WHERE item_group = ? AND category_name = ? AND company_id = ? AND location = ? AND warehouse = ? ' +
          `AND serial_number IN (${placeholders(serials)})`,
        values: [
          requirePresent(itemGroup, 'itemGroup'),
          requirePresent(categoryName, 'categoryName'),
          companyId,
          requirePresent(location, 'location'),
          requireCount(warehouse, 'warehouse', { max: 1 }),
          ...serials,
        ],
      };
    },
  },

  'inventory.itemIdsByGroupCategorySerials': {
    description: 'Item ids for given serials in a group/category.',
    // Legacy shape had no company filter, so it could resolve ids belonging to
    // another tenant and feed them straight into the delete below.
    scopingAdded: true,
    build: ({ itemGroup, categoryName, serialNumbers }, { companyId }) => {
      const serials = requireNonEmptyArray(serialNumbers, 'serialNumbers');
      return {
        sql:
          'SELECT item_id FROM item_inv ' +
          'WHERE item_group = ? AND category_name = ? AND company_id = ? ' +
          `AND serial_number IN (${placeholders(serials)})`,
        values: [
          requirePresent(itemGroup, 'itemGroup'),
          requirePresent(categoryName, 'categoryName'),
          companyId,
          ...serials,
        ],
      };
    },
  },

  'inventory.itemsSummaryByIds': {
    description: 'Summary columns for an explicit item id list.',
    scopingAdded: true, // legacy shape had no company filter
    build: ({ itemIds }, { companyId }) => {
      const ids = requireNonEmptyArray(itemIds, 'itemIds');
      return {
        sql:
          'SELECT item_id, item_group, brand, serial_number, location, warehouse, cost, category_name ' +
          `FROM item_inv WHERE company_id = ? AND item_id IN (${placeholders(ids)})`,
        values: [companyId, ...ids],
      };
    },
  },

  'inventory.assignableExactSerial': {
    description: 'The assignable item matching one exact serial.',
    build: ({ location, itemGroup, categoryName, serialNumber }, { companyId }) => ({
      sql:
        'SELECT * FROM item_inv ' +
        'WHERE company_id = ? AND warehouse = 1 AND enableAssignFeature = 1 ' +
        'AND location = ? AND item_group = ? AND category_name = ? AND serial_number = ?',
      values: [
        companyId,
        requirePresent(location, 'location'),
        requirePresent(itemGroup, 'itemGroup'),
        requirePresent(categoryName, 'categoryName'),
        requirePresent(serialNumber, 'serialNumber'),
      ],
    }),
  },

  'inventory.assignableFromSerial': {
    description: 'Assignable items from a starting serial onward, capped by quantity.',
    build: (
      { location, itemGroup, categoryName, startingSerial, quantity },
      { companyId }
    ) => {
      // LIMIT is interpolated because MySQL will not accept a placeholder there
      // in every driver/version combination; it is validated as an integer
      // first, so no client text reaches the SQL.
      const limit = requireCount(quantity, 'quantity', { min: 1, max: 5000 });
      return {
        sql:
          'SELECT item_id, serial_number, location, container, category_name, item_group ' +
          'FROM item_inv WHERE company_id = ? AND warehouse = 1 AND enableAssignFeature = 1 ' +
          'AND location = ? AND item_group = ? AND category_name = ? AND serial_number >= ? ' +
          `ORDER BY serial_number ASC LIMIT ${limit}`,
        values: [
          companyId,
          requirePresent(location, 'location'),
          requirePresent(itemGroup, 'itemGroup'),
          requirePresent(categoryName, 'categoryName'),
          requirePresent(startingSerial, 'startingSerial'),
        ],
      };
    },
  },

  'inventory.byAttribute': {
    description: 'All items matching one allowlisted attribute (brand, category, group, location, ownership).',
    build: ({ attribute, value }, { companyId }) => {
      if (!FILTERABLE_ATTRIBUTES.has(attribute)) {
        throw new QueryParamError(
          `attribute must be one of: ${[...FILTERABLE_ATTRIBUTES].join(', ')}`
        );
      }
      // `attribute` is concatenated, which is only safe because it was just
      // checked against the allowlist above. Never relax that check.
      return {
        sql: `SELECT * FROM item_inv WHERE ${attribute} = ? AND company_id = ?`,
        values: [requirePresent(value, 'value'), companyId],
      };
    },
  },

  // ── rented-items screens (paginated list + count + full export) ───────────

  'inventory.rentedPage': {
    description: 'One page of rented items, optional supplier and search filters.',
    build: ({ supplierId, search, pageSize, offset }, { companyId }) => {
      const { where, values } = buildRentFilter({ supplierId, search }, companyId);
      const limit = requireCount(pageSize, 'pageSize', { min: 1, max: 1000 });
      const skip = requireCount(offset, 'offset', { min: 0, max: 10_000_000 });
      return {
        sql: `SELECT ${RENT_COLUMNS} FROM item_inv WHERE ${where} LIMIT ${limit} OFFSET ${skip}`,
        values,
      };
    },
  },

  'inventory.rentedCount': {
    description: 'Total rented items for the same filters as inventory.rentedPage.',
    build: ({ supplierId, search }, { companyId }) => {
      const { where, values } = buildRentFilter({ supplierId, search }, companyId);
      return { sql: `SELECT COUNT(*) as total FROM item_inv WHERE ${where}`, values };
    },
  },

  'inventory.rentedAll': {
    description: 'Every rented item, unpaginated (export paths).',
    build: ({ supplierId }, { companyId }) => {
      const { where, values } = buildRentFilter({ supplierId }, companyId);
      return { sql: `SELECT ${RENT_COLUMNS} FROM item_inv WHERE ${where}`, values };
    },
  },

  // ── writes ───────────────────────────────────────────────────────────────

  'inventory.markInWarehouse': {
    description: 'Return items to the warehouse (warehouse = 1).',
    build: ({ itemGroup, categoryName, serialNumbers }, { companyId }) => {
      const serials = requireNonEmptyArray(serialNumbers, 'serialNumbers');
      return {
        sql:
          'UPDATE item_inv SET warehouse = 1, update_at = NOW() ' +
          'WHERE item_group = ? AND category_name = ? AND company_id = ? ' +
          `AND serial_number IN (${placeholders(serials)})`,
        values: [
          requirePresent(itemGroup, 'itemGroup'),
          requirePresent(categoryName, 'categoryName'),
          companyId,
          ...serials,
        ],
      };
    },
  },

  'eventAssignments.deleteByEventAndItems': {
    description: 'Detach items from an event.',
    // Legacy shape was `DELETE FROM item_inv_assigned_event WHERE event_id = ?
    // AND item_id IN (...)` with no company filter at all -- an unscoped DELETE.
    // item_inv_assigned_event has no company_id column, so scoping goes through
    // a join to item_inv, which does.
    scopingAdded: true,
    build: ({ eventId, itemIds }, { companyId }) => {
      const ids = requireNonEmptyArray(itemIds, 'itemIds');
      return {
        sql:
          'DELETE iiae FROM item_inv_assigned_event iiae ' +
          'JOIN item_inv ii ON ii.item_id = iiae.item_id ' +
          `WHERE iiae.event_id = ? AND ii.company_id = ? AND iiae.item_id IN (${placeholders(ids)})`,
        values: [requirePresent(eventId, 'eventId'), companyId, ...ids],
      };
    },
  },

  // ── staff_member reads ───────────────────────────────────────────────────
  // Both legacy shapes read staff PII with no company filter whatsoever.
  // staff_member has no company_id column; membership lives in company_staff.

  'staff.idsByEmails': {
    description: 'Resolve staff ids from emails, restricted to active members of the company.',
    scopingAdded: true,
    build: ({ emails }, { companyId }) => {
      const list = requireNonEmptyArray(emails, 'emails');
      return {
        sql:
          'SELECT sm.staff_id, sm.email FROM staff_member sm ' +
          'JOIN company_staff cs ON cs.staff_id = sm.staff_id ' +
          `WHERE cs.company_id = ? AND cs.is_active = 1 AND sm.email IN (${placeholders(list)})`,
        values: [companyId, ...list],
      };
    },
  },

  'staff.detailsByIds': {
    description: 'Staff names/emails by id, restricted to active members of the company.',
    scopingAdded: true,
    build: ({ staffIds }, { companyId }) => {
      const ids = requireNonEmptyArray(staffIds, 'staffIds');
      return {
        sql:
          'SELECT sm.staff_id, sm.first_name, sm.last_name, sm.email FROM staff_member sm ' +
          'JOIN company_staff cs ON cs.staff_id = sm.staff_id ' +
          `WHERE cs.company_id = ? AND cs.is_active = 1 AND sm.staff_id IN (${placeholders(ids)})`,
        values: [companyId, ...ids],
      };
    },
  },
};

/**
 * Builds the statement for a named entry.
 * @throws {QueryParamError} unknown name, or invalid/missing parameters.
 */
const buildNamedQuery = (queryName, params = {}, context = {}) => {
  const entry = catalog[queryName];
  if (!entry) {
    throw new QueryParamError(`Unknown queryName: ${queryName}`);
  }
  if (!context.companyId) {
    throw new QueryParamError('company context could not be resolved');
  }
  return entry.build(params || {}, context);
};

const listQueryNames = () => Object.keys(catalog);

module.exports = { catalog, buildNamedQuery, listQueryNames, QueryParamError };
