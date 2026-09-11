'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { fromSecondary, secondaryReadsEnabled } = require('../helpers/mongoRead');

/** Doble de una consulta de mongoose: solo necesita `read` y ser encadenable. */
const fakeQuery = () => {
  const query = { reads: [], sorted: null };
  query.read = (preference) => { query.reads.push(preference); return query; };
  query.sort = (spec) => { query.sorted = spec; return query; };
  return query;
};

const withEnv = (value, run) => {
  const previous = process.env.MONGO_SECONDARY_READS;
  if (value === undefined) delete process.env.MONGO_SECONDARY_READS;
  else process.env.MONGO_SECONDARY_READS = value;
  try { run(); } finally {
    if (previous === undefined) delete process.env.MONGO_SECONDARY_READS;
    else process.env.MONGO_SECONDARY_READS = previous;
  }
};

test('marca la consulta como secondaryPreferred, no como secondary', () => {
  // `secondary` a secas falla si no hay secundarias disponibles. Una lectura de
  // diagnostico no debe romperse porque el replica set este en una eleccion.
  withEnv(undefined, () => {
    const query = fakeQuery();
    fromSecondary(query);
    assert.deepStrictEqual(query.reads, ['secondaryPreferred']);
  });
});

test('devuelve la misma consulta, para que siga encadenando', () => {
  withEnv(undefined, () => {
    const query = fakeQuery();
    const result = fromSecondary(query).sort({ createdAt: -1 });
    assert.strictEqual(result, query);
    assert.deepStrictEqual(query.sorted, { createdAt: -1 });
  });
});

test('MONGO_SECONDARY_READS=off devuelve todo al primario', () => {
  // Es el rollback sin desplegar: si el retraso de replicacion causa un
  // problema, esa variable lo revierte entero.
  withEnv('off', () => {
    const query = fakeQuery();
    const result = fromSecondary(query);
    assert.strictEqual(result, query);
    assert.deepStrictEqual(query.reads, [], 'no deberia haber tocado la preferencia');
    assert.strictEqual(secondaryReadsEnabled(), false);
  });
});

test('el interruptor se lee en cada llamada, no al cargar el modulo', () => {
  // Si se leyera al importar, cambiar la variable no tendria efecto sin
  // reiniciar, y el test de arriba pasaria por el motivo equivocado.
  withEnv('off', () => assert.strictEqual(secondaryReadsEnabled(), false));
  withEnv('on', () => assert.strictEqual(secondaryReadsEnabled(), true));
});

test('un valor desconocido no apaga la funcion por accidente', () => {
  // Solo "off" apaga. Un typo no deberia cambiar el destino de las lecturas en
  // silencio, ni en un sentido ni en el otro.
  withEnv('OFF', () => assert.strictEqual(secondaryReadsEnabled(), false));
  withEnv('false', () => assert.strictEqual(secondaryReadsEnabled(), true));
  withEnv('', () => assert.strictEqual(secondaryReadsEnabled(), true));
});

test('no revienta con algo que no es una consulta', () => {
  assert.strictEqual(fromSecondary(null), null);
  assert.strictEqual(fromSecondary(undefined), undefined);
  const plain = { hola: 1 };
  assert.strictEqual(fromSecondary(plain), plain);
});

test('los dos listados de diagnostico siguen usando el helper', () => {
  // Estructural a proposito: sin esto, alguien "simplificando" el codigo puede
  // quitar el fromSecondary y devolver esas lecturas al primario sin que nada
  // lo note -- el comportamiento visible es identico.
  for (const file of ['controller/notificationLog.js', 'controller/transactionAuditLog.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(source, /fromSecondary\(/, `${file} deberia leer desde secundaria`);
    assert.match(source, /require\(["']\.\.\/helpers\/mongoRead["']\)/, `${file} deberia importar el helper`);
  }
});
