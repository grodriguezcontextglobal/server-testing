'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { evaluate, advisoriesOf, ACCEPTED } = require('../scripts/audit-check');

// Un informe de `npm audit --json` (v2) recortado a lo que lee el script: el
// paquete de origen trae el aviso como objeto, y el que lo arrastra lo cita por
// su nombre, en texto.
const report = ({ id = 'GHSA-aaaa-bbbb-cccc', severity = 'high', name = 'picomatch' } = {}) => ({
  vulnerabilities: {
    [name]: {
      name,
      severity,
      via: [
        {
          source: 1247710,
          name,
          title: `${name} es vulnerable a algo`,
          url: `https://github.com/advisories/${id}`,
          severity,
        },
      ],
    },
    anymatch: { name: 'anymatch', severity, via: [name] },
  },
});

const HOY = new Date('2026-11-17T12:00:00Z');

describe('scripts/audit-check', () => {
  test('un aviso alto sin excepción bloquea', () => {
    const { blocking, allowed, expired } = evaluate(report(), [], HOY);
    assert.equal(blocking.length, 1);
    assert.equal(blocking[0].id, 'GHSA-aaaa-bbbb-cccc');
    assert.equal(allowed.length, 0);
    assert.equal(expired.length, 0);
  });

  test('con excepción en vigor, se acepta y no bloquea', () => {
    const accepted = [{ id: 'GHSA-aaaa-bbbb-cccc', until: '2027-02-15', poam: 'DEP-X', why: '...' }];
    const { blocking, allowed } = evaluate(report(), accepted, HOY);
    assert.equal(blocking.length, 0);
    assert.equal(allowed.length, 1);
    assert.equal(allowed[0].exception.poam, 'DEP-X');
  });

  // Lo que evita que una excepción se quede para siempre.
  test('una excepción caducada vuelve a bloquear', () => {
    const accepted = [{ id: 'GHSA-aaaa-bbbb-cccc', until: '2026-11-16', poam: 'DEP-X', why: '...' }];
    const { blocking, allowed, expired } = evaluate(report(), accepted, HOY);
    assert.equal(allowed.length, 0);
    assert.equal(blocking.length, 0);
    assert.equal(expired.length, 1);
  });

  test('el último día de la excepción todavía vale', () => {
    const accepted = [{ id: 'GHSA-aaaa-bbbb-cccc', until: '2026-11-17', poam: 'DEP-X', why: '...' }];
    const { allowed, expired } = evaluate(report(), accepted, HOY);
    assert.equal(allowed.length, 1);
    assert.equal(expired.length, 0);
  });

  test('moderadas y bajas no bloquean, aunque no estén aceptadas', () => {
    for (const severity of ['moderate', 'low', 'info']) {
      const { blocking, allowed, expired } = evaluate(report({ severity }), [], HOY);
      assert.equal(blocking.length, 0, severity);
      assert.equal(allowed.length, 0, severity);
      assert.equal(expired.length, 0, severity);
    }
  });

  // El paquete que solo cita a otro por su nombre no genera un aviso aparte:
  // si no, aceptar uno obligaría a aceptar también a todos sus arrastrados.
  test('un `via` de texto no cuenta como aviso propio', () => {
    const advisories = advisoriesOf(report());
    assert.equal(advisories.length, 1);
    assert.equal(advisories[0].package, 'picomatch');
  });

  test('un informe sin vulnerabilidades no bloquea', () => {
    assert.deepEqual(evaluate({}, [], HOY), { blocking: [], allowed: [], expired: [] });
    assert.deepEqual(evaluate({ vulnerabilities: {} }, [], HOY), {
      blocking: [],
      allowed: [],
      expired: [],
    });
  });

  // La lista de verdad: cada entrada tiene que poder justificarse y revisarse.
  test('toda excepción real lleva motivo, ficha del POA&M y fecha futura', () => {
    for (const entry of ACCEPTED) {
      assert.match(entry.id, /^GHSA-/);
      assert.match(entry.poam, /^DEP-/);
      assert.match(entry.until, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(entry.why && entry.why.length > 40, `${entry.id} sin motivo suficiente`);
    }
  });
});
