'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSqlShape, describeSqlShape } = require('../helpers/sqlShape');

// Casos tomados TAL CUAL de las llamadas reales del frontend a
// /inventory-based-on-submitted-parameters. El objetivo del normalizador es
// que estas colapsen a un inventario corto y estable de formas, para poder
// construir el catálogo de queries del servidor sin dejar ninguna afuera.

test('colapsa listas IN de cualquier tamaño a una sola forma', () => {
  const dos = normalizeSqlShape(
    'SELECT item_id FROM item_inv WHERE item_id IN (?, ?) AND company_id = ?'
  );
  const cinco = normalizeSqlShape(
    'SELECT item_id FROM item_inv WHERE item_id IN (?, ?, ?, ?, ?) AND company_id = ?'
  );
  assert.equal(dos, cinco, 'el largo de la lista IN no debe generar formas distintas');
});

test('colapsa listas IN interpoladas por el cliente (valores crudos, no placeholders)', () => {
  // Este es el patrón que el frontend arma con .map().join(",") -- la misma
  // query logica llega distinta en cada llamada.
  const a = normalizeSqlShape(
    "SELECT * FROM item_inv WHERE serial_number in ('SN1','SN2','SN3')"
  );
  const b = normalizeSqlShape(
    "SELECT * FROM item_inv WHERE serial_number in ('OTRO','DISTINTO')"
  );
  assert.equal(a, b);
  // El reemplazo canoniza tambien el caso de la palabra IN, asi que `in (...)`
  // y `IN (...)` convergen a la misma forma -- justo lo que se busca.
  assert.equal(a, 'SELECT * FROM item_inv WHERE serial_number IN (?)');
});

test('no filtra valores al log: los literales se reemplazan por ?', () => {
  const shape = normalizeSqlShape(
    "SELECT * FROM staff_member WHERE email = 'alguien@empresa.com'"
  );
  assert.ok(!shape.includes('alguien@empresa.com'), 'un email no debe sobrevivir a la normalizacion');
  assert.equal(shape, 'SELECT * FROM staff_member WHERE email = ?');
});

test('normaliza el espaciado (queries multilinea del cliente)', () => {
  const multilinea = normalizeSqlShape(`SELECT
        serial_number
        FROM item_inv
        WHERE item_group = ? AND category_name = ?`);
  assert.equal(
    multilinea,
    'SELECT serial_number FROM item_inv WHERE item_group = ? AND category_name = ?'
  );
});

test('no colapsa subqueries IN (SELECT ...) -- se perderia la segunda tabla', () => {
  const shape = normalizeSqlShape(
    'SELECT * FROM item_inv WHERE item_id IN (SELECT device_id FROM member_assigned_device_lease)'
  );
  assert.ok(shape.includes('member_assigned_device_lease'));
});

test('la misma forma produce el mismo hash; formas distintas, hashes distintos', () => {
  const a = describeSqlShape('SELECT * FROM item_inv WHERE item_id IN (?, ?)');
  const b = describeSqlShape('SELECT * FROM item_inv WHERE item_id IN (?, ?, ?, ?)');
  const c = describeSqlShape('SELECT * FROM item_inv WHERE brand = ?');
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
});

test('identifica el tipo de sentencia (incluidas las de escritura en uso hoy)', () => {
  assert.equal(describeSqlShape('SELECT * FROM item_inv').type, 'SELECT');
  assert.equal(
    describeSqlShape('UPDATE item_inv set warehouse = 1, update_at = NOW() WHERE company_id = ?').type,
    'UPDATE'
  );
  assert.equal(
    describeSqlShape('DELETE FROM item_inv_assigned_event WHERE event_id = ?').type,
    'DELETE'
  );
});

test('extrae las tablas involucradas', () => {
  assert.deepEqual(
    describeSqlShape('SELECT * FROM item_inv WHERE company_id = ?').tables,
    ['item_inv']
  );
  assert.deepEqual(
    describeSqlShape('DELETE FROM item_inv_assigned_event WHERE event_id = ?').tables,
    ['item_inv_assigned_event']
  );
  assert.deepEqual(
    describeSqlShape('UPDATE item_inv set warehouse = 1 WHERE company_id = ?').tables,
    ['item_inv']
  );
});

// El campo que decide la prioridad del catálogo: una forma sin company_id no
// puede acotarse a la compañía de quien llama -- es una lectura (o escritura)
// cross-tenant.
test('marca has_company_id, que es lo que delata las formas cross-tenant', () => {
  const conScope = describeSqlShape(
    'SELECT item_id, serial_number, item_group FROM item_inv WHERE item_id IN (?) AND ownership = ? AND company_id = ?'
  );
  assert.equal(conScope.hasCompanyId, true);

  // Caso real del frontend: lee PII de staff sin ningun filtro de compania.
  const sinScope = describeSqlShape(
    'SELECT staff_id, first_name, last_name, email FROM staff_member WHERE staff_id IN (?, ?)'
  );
  assert.equal(sinScope.hasCompanyId, false);

  // Otro caso real: borra asignaciones sin acotar por compania.
  const borradoSinScope = describeSqlShape(
    'DELETE FROM item_inv_assigned_event WHERE event_id = ? AND item_id IN (?, ?)'
  );
  assert.equal(borradoSinScope.hasCompanyId, false);
});

test('no revienta con entradas invalidas (el body lo controla el cliente)', () => {
  for (const entrada of [undefined, null, 42, {}, []]) {
    assert.doesNotThrow(() => describeSqlShape(entrada));
    assert.equal(describeSqlShape(entrada).type, 'UNKNOWN');
  }
});
