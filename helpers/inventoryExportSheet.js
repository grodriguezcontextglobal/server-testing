'use strict';

/**
 * La hoja del export de inventario: dieciséis columnas y las cinco
 * transformaciones que hasta hoy vivían en el navegador.
 *
 * ORIGEN: FRONTEND_inventory_export_contract_2026-09-17.md §4. Al mover la
 * escritura del fichero al servidor (opción A de su §3.4) estas reglas se mueven
 * con él; si se quedaran en el cliente, la hoja cambiaría bajo los usuarios en
 * cuanto el servidor empezara a generarla.
 *
 * Módulo puro y sin exceljs a propósito: las transformaciones se prueban con
 * objetos planos, y el handler solo se ocupa de volcarlas en el libro.
 */

/**
 * `ownership` tal como lo guarda `item_inv` → lo que lee el usuario.
 * `Sale` y `Resale` colapsan los dos en "For Resale"; no es un error de copia.
 */
const OWNERSHIP_LABELS = {
  Permanent: 'Permanent',
  Rent: 'Rented',
  Sale: 'For Resale',
  Resale: 'For Resale',
};

/** `warehouse` es 1/0 en la tabla, pero llega como número o como cadena. */
const isInStock = (item) => Number(item.warehouse) === 1;

/**
 * Col. 3 — Warehouse: la ubicación si está en stock, y si no el evento que lo
 * tiene, los dos con su etiqueta de estado entre paréntesis.
 */
const formatWarehouse = (item) =>
  isInStock(item)
    ? `${item.location ?? ''} (In-Stock)`
    : `${item.event_name ?? 'In-Use'} (In-Use)`;

/** Col. 10 — Current Location: ubicación si está en stock, evento si no. */
const formatCurrentLocation = (item) =>
  isInStock(item) ? item.location ?? '' : item.event_name ?? '';

/** Col. 7 — Ownership: etiqueta legible; un valor desconocido se deja crudo. */
const formatOwnership = (item) =>
  OWNERSHIP_LABELS[item.ownership] ?? (item.ownership ?? '');

/**
 * Col. 9 — Condition: `status` manda y `condition` es el respaldo.
 *
 * OJO: `status` es el de `item_inv` y `condition` el de
 * `item_inv_assigned_event`, que solo existe para ítems con asignación activa.
 * El respaldo por tanto casi nunca entra — pero ahora que el export resuelve la
 * asignación (ver `buildEventLookupQuery`) al menos existe, que es más de lo que
 * podía hacer la hoja del navegador: `warehouse-items` nunca trajo `condition`.
 */
const formatCondition = (item) => item.status ?? item.condition ?? '';

/** Col. 12 — Assignable: el flag es 1/0. */
const formatAssignable = (item) =>
  Number(item.enableAssignFeature) === 1 ? 'Assignable' : 'No Assignable';

/**
 * Col. 13 — Rented Equipment Return Date: SOLO para material alquilado.
 * Un ítem en propiedad puede llevar `return_date` de un alquiler anterior, y
 * enseñarla haría pensar que hay que devolverlo.
 */
const formatReturnDate = (item) => (item.ownership === 'Rent' ? item.return_date ?? '' : '');

/**
 * Col. 14 — Extra Info: una línea por entrada de `extra_serial_number`.
 *
 * La columna llega como JSON desde MySQL (texto en unas filas, array ya
 * parseado en otras según el driver), así que se acepta cualquiera de las dos y
 * un JSON ilegible se trata como vacío: una fila con datos raros no puede
 * tumbar un export de 50.000.
 */
const formatExtraInfo = (item) => {
  let entries = item.extra_serial_number;
  if (typeof entries === 'string') {
    try {
      entries = JSON.parse(entries);
    } catch {
      return '';
    }
  }
  if (!Array.isArray(entries)) return '';
  return entries
    .map((entry) => `- ${entry?.keyObject ?? ''}: ${entry?.valueObject ?? ''}`)
    .join('\n');
};

/**
 * Las dieciséis columnas, en orden. `width` reproduce los anchos de la hoja del
 * navegador; el frontend los marcó como no críticos, pero salen gratis.
 */
const SHEET_COLUMNS = [
  { header: 'Device ID (database)', width: 20, value: (item) => item.item_id ?? '' },
  { header: 'Serial Number', width: 20, value: (item) => item.serial_number ?? '' },
  { header: 'Warehouse', width: 28, value: formatWarehouse },
  { header: 'Brand', width: 18, value: (item) => item.brand ?? '' },
  { header: 'Category Name', width: 22, value: (item) => item.category_name ?? '' },
  { header: 'Group Name', width: 22, value: (item) => item.item_group ?? '' },
  { header: 'Ownership', width: 16, value: formatOwnership },
  { header: 'Cost of Replacement (USD)', width: 24, value: (item) => item.cost ?? '' },
  { header: 'Condition', width: 16, value: formatCondition },
  { header: 'Current Location', width: 24, value: formatCurrentLocation },
  { header: 'Tax Location', width: 20, value: (item) => item.main_warehouse ?? '' },
  { header: 'Assignable', width: 16, value: formatAssignable },
  { header: 'Rented Equipment Return Date', width: 26, value: formatReturnDate },
  { header: 'Extra Info', width: 30, value: formatExtraInfo },
  { header: 'Description', width: 40, value: (item) => item.descript_item ?? '' },
  { header: 'Image (URL)', width: 40, value: (item) => item.image_url ?? '' },
];

const SHEET_NAME = 'Stock - Report';

const SHEET_HEADERS = SHEET_COLUMNS.map((column) => column.header);

/** Una fila de la hoja, en el orden de `SHEET_COLUMNS`. */
const toSheetRow = (item) => SHEET_COLUMNS.map((column) => column.value(item || {}));

/**
 * Nombre del fichero. Lleva la fecha porque estos exports acaban en el
 * escritorio de alguien y "inventory.xlsx" a secas no se distingue del de la
 * semana pasada.
 */
const buildExportFileName = (companyId, now = new Date()) =>
  `inventory-${companyId}-${now.toISOString().slice(0, 10)}.xlsx`;

module.exports = {
  SHEET_COLUMNS,
  SHEET_HEADERS,
  SHEET_NAME,
  OWNERSHIP_LABELS,
  toSheetRow,
  buildExportFileName,
  formatWarehouse,
  formatCurrentLocation,
  formatOwnership,
  formatCondition,
  formatAssignable,
  formatReturnDate,
  formatExtraInfo,
};
