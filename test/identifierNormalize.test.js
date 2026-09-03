/**
 * Fase 2 del plan de conteo por identificador (ver DESIGN_rfid_event_count.md § 6).
 *
 * normalizeIdentifier es el ÚNICO punto de normalización de un identificador
 * escaneable (EPC o código de barras). Lo consumen tanto el registro como la
 * resolución: si la escritura normaliza y la lectura no, una lectura en
 * minúsculas no matchea y el item aparece como faltante sin error visible.
 *
 * Puro: sin DB, sin HTTP.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeIdentifier } = require('../mysql/helpers/identifier');

describe('normalizeIdentifier', () => {
  it('recorta espacios y pasa a mayúsculas', () => {
    assert.equal(normalizeIdentifier('  3425e16cb4  '), '3425E16CB4');
  });

  it('deja intacto un valor ya normalizado', () => {
    assert.equal(normalizeIdentifier('3425E16CB4'), '3425E16CB4');
  });

  it('devuelve null para vacío, espacios, null y undefined', () => {
    assert.equal(normalizeIdentifier(''), null);
    assert.equal(normalizeIdentifier('   '), null);
    assert.equal(normalizeIdentifier(null), null);
    assert.equal(normalizeIdentifier(undefined), null);
  });

  // Los seriales de item_inv son strings ('00170', '10001'), pero un cliente
  // puede mandarlos como número desde JSON. Coercionar evita que 10001 !== '10001'
  // convierta un equipo presente en un faltante.
  it('coerciona números a string sin perder el valor', () => {
    assert.equal(normalizeIdentifier(10001), '10001');
    assert.equal(normalizeIdentifier(0), '0');
  });

  // Conservador a propósito: no se tocan los separadores internos. Si el lector
  // OR2505 emite el EPC con espacios ('3425 E16C'), eso es una decisión de
  // formato canónico todavía abierta (DESIGN_rfid_event_count.md § 14), no algo
  // que este helper deba adivinar.
  it('no altera separadores internos', () => {
    assert.equal(normalizeIdentifier(' urn:epc:id:giai:1234.567 '), 'URN:EPC:ID:GIAI:1234.567');
  });

  it('no acepta objetos ni arrays como identificador', () => {
    assert.equal(normalizeIdentifier({}), null);
    assert.equal(normalizeIdentifier([]), null);
    assert.equal(normalizeIdentifier(['A']), null);
  });
});
