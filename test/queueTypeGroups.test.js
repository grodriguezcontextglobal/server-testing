'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  GROUPS,
  GROUP_NAMES,
  DELETE_TYPES,
  EMAIL_TYPES,
  BULK_WRITE_TYPES,
  typesForGroup,
  resolveWorkerScope,
} = require('../constants/queueTypeGroups');

// ─── Los grupos como contrato ────────────────────────────────────────────────

test('los grupos son disjuntos: un tipo pertenece a un solo worker', () => {
  const seen = new Map();
  for (const name of GROUP_NAMES) {
    for (const type of GROUPS[name]) {
      assert.strictEqual(
        seen.has(type),
        false,
        `'${type}' está en '${seen.get(type)}' y en '${name}'`
      );
      seen.set(type, name);
    }
  }
});

test('el grupo delete es el que reclama el worker de borrados', () => {
  assert.deepStrictEqual(DELETE_TYPES, [
    'inventory:bulk-delete-by-criteria',
    'inventory:bulk-delete-by-ids',
  ]);
  assert.deepStrictEqual([...GROUPS.delete], DELETE_TYPES);
});

test('los borrados NO están en el grupo bulk (es el punto del split)', () => {
  for (const type of DELETE_TYPES) {
    assert.ok(!BULK_WRITE_TYPES.includes(type), `${type} sigue en el grupo bulk`);
  }
});

test("'dedicated' expande a la unión de todos los grupos", () => {
  const all = typesForGroup('dedicated');
  for (const type of [...EMAIL_TYPES, ...BULK_WRITE_TYPES, ...DELETE_TYPES]) {
    assert.ok(all.includes(type), `${type} falta en 'dedicated'`);
  }
  assert.strictEqual(all.length, new Set(all).size, 'dedicated trae duplicados');
});

test('un grupo desconocido lanza en vez de dejar al worker sin filtro', () => {
  assert.throws(() => typesForGroup('deletes'), /Grupo de cola desconocido/);
  assert.throws(() => typesForGroup(''), /Grupo de cola desconocido/);
});

test('el nombre del grupo es case-insensitive y tolera espacios', () => {
  assert.deepStrictEqual(typesForGroup('  DELETE '), [...DELETE_TYPES]);
});

// ─── resolveWorkerScope: la configuración real de cada servicio ──────────────

test('DevitrakDeleteWorker: QUEUE_GROUP=delete => include solo borrados', () => {
  const scope = resolveWorkerScope({ QUEUE_GROUP: 'delete' });
  assert.deepStrictEqual(scope.includeTypes, [...DELETE_TYPES]);
  assert.deepStrictEqual(scope.excludeTypes, []);
});

test('DevitrakServer: QUEUE_EXCLUDE_GROUPS=dedicated => excluye email, bulk y delete', () => {
  const scope = resolveWorkerScope({ QUEUE_EXCLUDE_GROUPS: 'dedicated' });
  assert.deepStrictEqual(scope.includeTypes, []);
  for (const type of [...EMAIL_TYPES, ...BULK_WRITE_TYPES, ...DELETE_TYPES]) {
    assert.ok(scope.excludeTypes.includes(type), `${type} no fue excluido`);
  }
});

test('sin env, el worker toma toda la cola (default de un solo worker)', () => {
  assert.deepStrictEqual(resolveWorkerScope({}), { includeTypes: [], excludeTypes: [] });
});

test('QUEUE_TYPES explícito gana sobre QUEUE_GROUP (no rompe servicios ya configurados)', () => {
  const scope = resolveWorkerScope({ QUEUE_TYPES: 'send-email', QUEUE_GROUP: 'delete' });
  assert.deepStrictEqual(scope.includeTypes, ['send-email']);
});

test('QUEUE_EXCLUDE_TYPES se SUMA a QUEUE_EXCLUDE_GROUPS, sin duplicar', () => {
  const scope = resolveWorkerScope({
    QUEUE_EXCLUDE_TYPES: 'log:error, send-email',
    QUEUE_EXCLUDE_GROUPS: 'email,delete',
  });
  assert.ok(scope.excludeTypes.includes('log:error'));
  assert.ok(scope.excludeTypes.includes('inventory:bulk-delete-by-criteria'));
  assert.strictEqual(
    scope.excludeTypes.filter((t) => t === 'send-email').length,
    1,
    'send-email quedó duplicado'
  );
});

test('un QUEUE_GROUP inválido lanza (el worker dedicado no debe arrancar sin filtro)', () => {
  assert.throws(() => resolveWorkerScope({ QUEUE_GROUP: 'borrados' }), /Grupo de cola desconocido/);
});

test('un QUEUE_EXCLUDE_GROUPS inválido avisa y se ignora (no tira abajo la API)', () => {
  const warnings = [];
  const scope = resolveWorkerScope(
    { QUEUE_EXCLUDE_GROUPS: 'dedicatd, email' },
    { warn: (m) => warnings.push(m) }
  );
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /dedicatd/);
  // el grupo válido de la misma lista sí se aplica
  assert.ok(scope.excludeTypes.includes('send-email'));
});

test('varios grupos excluidos se acumulan', () => {
  const scope = resolveWorkerScope({ QUEUE_EXCLUDE_GROUPS: 'email, bulk' });
  assert.ok(scope.excludeTypes.includes('send-email-multiple'));
  assert.ok(scope.excludeTypes.includes('member:bulk-insert'));
  assert.ok(!scope.excludeTypes.includes('inventory:bulk-delete-by-criteria'));
});

// ─── El filtro de claim que sale de esa configuración ────────────────────────

test('el scope del delete worker produce un claim filter que solo toma borrados', () => {
  const core = require('../queue/core');
  const scope = resolveWorkerScope({ QUEUE_GROUP: 'delete' });
  const filter = core.buildClaimFilter(1700000000000, {
    includeTypes: scope.includeTypes,
    excludeTypes: scope.excludeTypes,
  });
  assert.deepStrictEqual(filter.type, { $in: [...DELETE_TYPES] });
  assert.strictEqual(filter.status, 'pending');
});

test('todo tipo de un grupo está registrado en queue/handlers (sin handler, el worker dedicado manda el job a dead-letter)', () => {
  // Se lee el fuente en vez de require()-ear el registro: cargarlo abre la
  // conexión a MySQL y el cliente de SendGrid, y eso agrega ~20s a la suite.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'queue', 'handlers', 'index.js'), 'utf8');
  const registered = new Set(
    [...src.matchAll(/register\(\s*["']([^"']+)["']/g)].map((m) => m[1])
  );
  for (const name of GROUP_NAMES) {
    for (const type of GROUPS[name]) {
      assert.ok(registered.has(type), `'${type}' (grupo ${name}) no está registrado`);
    }
  }
});
