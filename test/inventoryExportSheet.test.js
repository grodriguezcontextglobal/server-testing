'use strict';

/**
 * Las dieciséis columnas y las cinco transformaciones de la hoja del export
 * (FRONTEND_inventory_export_contract_2026-09-17.md §4).
 *
 * Al pasar la escritura del .xlsx del navegador al servidor (opción A de su
 * §3.4), estas reglas cambian de dueño. Este fichero es el que impide que la
 * hoja cambie bajo los usuarios en el traspaso: cada transformación se
 * comprueba contra el comportamiento que el frontend describió.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SHEET_HEADERS,
  SHEET_COLUMNS,
  toSheetRow,
  buildExportFileName,
  formatWarehouse,
  formatCurrentLocation,
  formatOwnership,
  formatCondition,
  formatAssignable,
  formatReturnDate,
  formatExtraInfo,
} = require('../helpers/inventoryExportSheet');

test('la hoja tiene las dieciséis columnas del contrato, en orden', () => {
  assert.deepEqual(SHEET_HEADERS, [
    'Device ID (database)',
    'Serial Number',
    'Warehouse',
    'Brand',
    'Category Name',
    'Group Name',
    'Ownership',
    'Cost of Replacement (USD)',
    'Condition',
    'Current Location',
    'Tax Location',
    'Assignable',
    'Rented Equipment Return Date',
    'Extra Info',
    'Description',
    'Image (URL)',
  ]);
});

test('warehouse=1 da la ubicación con (In-Stock); si no, el evento con (In-Use)', () => {
  assert.equal(
    formatWarehouse({ warehouse: 1, location: 'Miami', event_name: 'NAB' }),
    'Miami (In-Stock)'
  );
  assert.equal(formatWarehouse({ warehouse: 0, event_name: 'NAB 2026' }), 'NAB 2026 (In-Use)');
});

test('sin event_name, un ítem fuera de stock cae a "In-Use (In-Use)"', () => {
  // Es lo que produce HOY la hoja del navegador para TODAS las filas fuera de
  // stock, porque warehouse-items (SELECT * FROM item_inv) nunca trajo
  // event_name. El export sí lo resuelve; este caso cubre el ítem sin
  // asignación activa, donde el respaldo sigue siendo el correcto.
  assert.equal(formatWarehouse({ warehouse: 0 }), 'In-Use (In-Use)');
});

test('warehouse llega como cadena y se compara igual', () => {
  // El driver de MySQL devuelve tinyint como número, pero el payload de un job
  // va y vuelve por JSON. Un '1' que se tratara como fuera-de-stock pondría
  // todo el inventario en "In-Use".
  assert.equal(formatWarehouse({ warehouse: '1', location: 'Miami' }), 'Miami (In-Stock)');
  assert.equal(formatAssignable({ enableAssignFeature: '1' }), 'Assignable');
});

test('Current Location: ubicación en stock, evento fuera de stock', () => {
  assert.equal(formatCurrentLocation({ warehouse: 1, location: 'Miami' }), 'Miami');
  assert.equal(formatCurrentLocation({ warehouse: 0, event_name: 'NAB' }), 'NAB');
  assert.equal(formatCurrentLocation({ warehouse: 0 }), '');
});

test('ownership se traduce, y Sale/Resale colapsan en For Resale', () => {
  assert.equal(formatOwnership({ ownership: 'Permanent' }), 'Permanent');
  assert.equal(formatOwnership({ ownership: 'Rent' }), 'Rented');
  assert.equal(formatOwnership({ ownership: 'Sale' }), 'For Resale');
  assert.equal(formatOwnership({ ownership: 'Resale' }), 'For Resale');
});

test('un ownership desconocido se deja crudo en vez de vaciarse', () => {
  assert.equal(formatOwnership({ ownership: 'Leased' }), 'Leased');
});

test('condition: status manda, condition es el respaldo', () => {
  assert.equal(formatCondition({ status: 'Good', condition: 'Damaged' }), 'Good');
  assert.equal(formatCondition({ condition: 'Damaged' }), 'Damaged');
  assert.equal(formatCondition({}), '');
});

test('la fecha de devolución solo sale en material alquilado', () => {
  assert.equal(formatReturnDate({ ownership: 'Rent', return_date: '2026-10-01' }), '2026-10-01');
  // Un ítem en propiedad puede arrastrar return_date de un alquiler anterior:
  // enseñarla haría pensar que hay que devolverlo.
  assert.equal(formatReturnDate({ ownership: 'Permanent', return_date: '2026-10-01' }), '');
});

test('Extra Info: una línea por entrada, venga como array o como JSON', () => {
  const entries = [
    { keyObject: 'MAC', valueObject: 'AA:BB' },
    { keyObject: 'IMEI', valueObject: '123' },
  ];
  const expected = '- MAC: AA:BB\n- IMEI: 123';

  assert.equal(formatExtraInfo({ extra_serial_number: entries }), expected);
  assert.equal(formatExtraInfo({ extra_serial_number: JSON.stringify(entries) }), expected);
});

test('un extra_serial_number ilegible no tumba el export', () => {
  // Una fila con datos raros no puede hacer fallar un export de 50.000.
  assert.equal(formatExtraInfo({ extra_serial_number: '{roto' }), '');
  assert.equal(formatExtraInfo({ extra_serial_number: null }), '');
  assert.equal(formatExtraInfo({}), '');
});

test('toSheetRow produce las dieciséis celdas en el orden de las cabeceras', () => {
  const row = toSheetRow({
    item_id: 42,
    serial_number: '00100003',
    warehouse: 0,
    location: 'Miami',
    event_name: 'NAB 2026',
    brand: 'Dell',
    category_name: 'Laptop',
    item_group: 'Latitude',
    ownership: 'Rent',
    cost: '1200.00',
    status: 'Good',
    main_warehouse: 'FL',
    enableAssignFeature: 1,
    return_date: '2026-10-01',
    extra_serial_number: [{ keyObject: 'MAC', valueObject: 'AA:BB' }],
    descript_item: 'Dock included',
    image_url: 'https://example.com/a.png',
  });

  assert.equal(row.length, SHEET_COLUMNS.length);
  assert.deepEqual(row, [
    42,
    '00100003',
    'NAB 2026 (In-Use)',
    'Dell',
    'Laptop',
    'Latitude',
    'Rented',
    '1200.00',
    'Good',
    'NAB 2026',
    'FL',
    'Assignable',
    '2026-10-01',
    '- MAC: AA:BB',
    'Dock included',
    'https://example.com/a.png',
  ]);
});

test('una fila vacía da dieciséis celdas, no revienta', () => {
  const row = toSheetRow({});
  assert.equal(row.length, SHEET_COLUMNS.length);
  assert.equal(row[2], 'In-Use (In-Use)');
  assert.equal(row[11], 'No Assignable');
});

test('el nombre del fichero lleva compañía y fecha', () => {
  assert.equal(
    buildExportFileName('77', new Date('2026-09-17T12:00:00Z')),
    'inventory-77-2026-09-17.xlsx'
  );
});
