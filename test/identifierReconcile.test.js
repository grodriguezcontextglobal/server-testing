/**
 * Fase 2 del plan de conteo por identificador (ver DESIGN_rfid_event_count.md § 6).
 *
 * reconcile() es el núcleo del conteo: compara el conjunto ESPERADO (lo que el
 * evento tiene asignado) contra lo ESCANEADO (lo que el lector RFID y la pistola
 * de código de barras reportaron) y clasifica.
 *
 * Puro: sin DB, sin HTTP, sin Date.now(). Es la pieza que se reusa completa
 * cuando esto se extrapole al conteo de inventario de bodega -- ahí solo cambia
 * de dónde salen los "esperados".
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { reconcile } = require('../mysql/helpers/identifier');

/** Item esperado, con los campos que devuelve la consulta del conjunto esperado. */
function item(item_id, serial_number, epc = null, extra = {}) {
  return { item_id, serial_number, epc, category_name: 'Receivers', item_group: 'RX-100', ...extra };
}

const ids = (list) => list.map((row) => row.item_id).sort((a, b) => a - b);

describe('reconcile — caso feliz', () => {
  it('marca como matched los esperados que aparecieron, por EPC o por serial', () => {
    const expected = [
      item(1, '10001', '3425E16CB4'),  // tiene tag
      item(2, '10002', '3425E16CB5'),  // tiene tag
      item(3, '10003'),                // sin tag, entra por código de barras
    ];

    const out = reconcile({ expected, scanned: ['3425E16CB4', '3425E16CB5', '10003'] });

    assert.deepEqual(ids(out.matched), [1, 2, 3]);
    assert.deepEqual(out.missingTagged, []);
    assert.deepEqual(out.missingUntagged, []);
    assert.deepEqual(out.unmatched, []);
    assert.deepEqual(out.ambiguous, []);
  });

  it('informa por qué vía entró cada match', () => {
    const expected = [item(1, '10001', '3425E16CB4'), item(2, '10002')];
    const out = reconcile({ expected, scanned: ['3425E16CB4', '10002'] });

    const byId = new Map(out.matched.map((row) => [row.item_id, row]));
    assert.equal(byId.get(1).matchedVia, 'epc');
    assert.equal(byId.get(1).matchedBy, '3425E16CB4');
    assert.equal(byId.get(2).matchedVia, 'serial');
    assert.equal(byId.get(2).matchedBy, '10002');
  });
});

describe('reconcile — faltantes', () => {
  // La razón de existir de esta partición: un equipo SIN etiqueta que sí está
  // en la caja se ve idéntico a uno perdido. Sin separarlos, la pantalla muestra
  // falsas alarmas y el operador aprende a ignorarlas.
  it('parte los faltantes en tagged (alarma real) y untagged (verificar a mano)', () => {
    const expected = [
      item(1, '10001', '3425E16CB4'),
      item(2, '10002', '3425E16CB5'), // tenía tag y no respondió -> alarma
      item(3, '10003'),               // nunca tuvo tag -> verificar
    ];

    const out = reconcile({ expected, scanned: ['3425E16CB4'] });

    assert.deepEqual(ids(out.matched), [1]);
    assert.deepEqual(ids(out.missingTagged), [2]);
    assert.deepEqual(ids(out.missingUntagged), [3]);
  });

  it('un esperado sin tag NUNCA cae en missingTagged', () => {
    const expected = [item(1, '10001'), item(2, '10002'), item(3, '10003')];
    const out = reconcile({ expected, scanned: [] });

    assert.deepEqual(out.missingTagged, []);
    assert.deepEqual(ids(out.missingUntagged), [1, 2, 3]);
  });

  it('un EPC en blanco cuenta como sin tag, no como tag que no respondió', () => {
    const expected = [item(1, '10001', '   '), item(2, '10002', null)];
    const out = reconcile({ expected, scanned: [] });

    assert.deepEqual(out.missingTagged, []);
    assert.deepEqual(ids(out.missingUntagged), [1, 2]);
  });
});

describe('reconcile — escaneos que no son del evento', () => {
  it('deja en unmatched los valores que no corresponden a ningún esperado', () => {
    const expected = [item(1, '10001', '3425E16CB4')];
    const out = reconcile({ expected, scanned: ['3425E16CB4', 'AABBCCDD', '99999'] });

    assert.deepEqual(ids(out.matched), [1]);
    assert.deepEqual(out.unmatched.sort(), ['99999', 'AABBCCDD']);
  });
});

describe('reconcile — ambigüedad de serial', () => {
  // Producción tiene seriales duplicados por diseño (bulkInsertItemRange acuña
  // rangos que se solapan entre categorías; la compañía 136 tiene 48+ casos).
  // Si dos items del MISMO evento comparten serial, escanear ese código de
  // barras no identifica a ninguno: marcar los dos como presentes sería mentir.
  it('no marca matched cuando un valor resuelve a más de un esperado', () => {
    const expected = [
      item(1, '10001', null, { category_name: 'Receivers' }),
      item(2, '10001', null, { category_name: 'Transmitters' }),
      item(3, '10002', '3425E16CB4'),
    ];

    const out = reconcile({ expected, scanned: ['10001', '3425E16CB4'] });

    assert.deepEqual(ids(out.matched), [3]);
    assert.equal(out.ambiguous.length, 1);
    assert.equal(out.ambiguous[0].value, '10001');
    assert.deepEqual(out.ambiguous[0].item_ids.sort((a, b) => a - b), [1, 2]);

    // Los dos ambiguos siguen contando como faltantes: nadie confirmó cuál está.
    assert.deepEqual(ids(out.missingUntagged), [1, 2]);
  });

  it('el EPC desambigua lo que el serial no puede', () => {
    const expected = [
      item(1, '10001', '3425E16CB4'),
      item(2, '10001', '3425E16CB5'),
    ];

    const out = reconcile({ expected, scanned: ['3425E16CB4', '3425E16CB5'] });

    assert.deepEqual(ids(out.matched), [1, 2]);
    assert.deepEqual(out.ambiguous, []);
  });
});

describe('reconcile — normalización y ruido del lector', () => {
  it('normaliza ambos lados antes de comparar', () => {
    const expected = [item(1, ' 10001 ', ' 3425e16cb4 ')];
    const out = reconcile({ expected, scanned: ['3425E16CB4'] });

    assert.deepEqual(ids(out.matched), [1]);
  });

  // Un lector RFID re-emite el mismo tag muchas veces por barrido, y el operador
  // re-escanea. La deduplicación es parte de la lógica, no del transporte.
  it('deduplica los escaneos repetidos', () => {
    const expected = [item(1, '10001', '3425E16CB4')];
    const out = reconcile({
      expected,
      scanned: ['3425E16CB4', '3425E16CB4', ' 3425e16cb4 ', 'ZZZ', 'ZZZ'],
    });

    assert.equal(out.matched.length, 1);
    assert.deepEqual(out.unmatched, ['ZZZ']);
  });

  it('ignora entradas vacías del lector sin contarlas como desconocidas', () => {
    const expected = [item(1, '10001', '3425E16CB4')];
    const out = reconcile({ expected, scanned: ['3425E16CB4', '', '   ', null, undefined] });

    assert.deepEqual(ids(out.matched), [1]);
    assert.deepEqual(out.unmatched, []);
  });
});

describe('reconcile — bordes', () => {
  it('sin esperados, todo lo escaneado queda en unmatched', () => {
    const out = reconcile({ expected: [], scanned: ['AABB'] });

    assert.deepEqual(out.matched, []);
    assert.deepEqual(out.unmatched, ['AABB']);
  });

  it('sin escaneos, todos los esperados quedan faltantes', () => {
    const expected = [item(1, '10001', '3425E16CB4'), item(2, '10002')];
    const out = reconcile({ expected, scanned: [] });

    assert.deepEqual(ids(out.missingTagged), [1]);
    assert.deepEqual(ids(out.missingUntagged), [2]);
  });

  it('tolera llamada sin argumentos', () => {
    const out = reconcile();

    assert.deepEqual(out.matched, []);
    assert.deepEqual(out.missingTagged, []);
    assert.deepEqual(out.missingUntagged, []);
    assert.deepEqual(out.unmatched, []);
    assert.deepEqual(out.ambiguous, []);
  });

  it('no muta las entradas', () => {
    const expected = [item(1, '10001', '3425E16CB4')];
    const scanned = ['3425E16CB4'];
    const snapshot = JSON.stringify({ expected, scanned });

    reconcile({ expected, scanned });

    assert.equal(JSON.stringify({ expected, scanned }), snapshot);
  });
});
