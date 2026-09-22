'use strict';

/**
 * Lógica pura de scripts/audit-role-consistency.js — sin mongoose y sin MySQL,
 * igual que test/migrateMongoRoleTypes.test.js.
 *
 * Los cuatro casos de abajo son regresiones de bugs reales. El script corre
 * contra PRODUCCIÓN y con `--apply` escribe, así que cada uno importa por lo
 * que hacía mal, no por hipótesis.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveCompanyMatch,
  resolveDesiredActive,
  computeExitCode,
  NEEDS_HUMAN,
  FIXABLE_BY_APPLY,
} = require('../scripts/audit-role-consistency');

const empty = () => ({
  roleMismatch: [], activeMismatch: [], noMembership: [], noStaffMember: [],
  mongoSelfConflict: [], ambiguousCompany: [], unmatchedCompany: [], pendingInvitation: [],
});

// ─── resolveCompanyMatch ────────────────────────────────────────────────────
// El matcheo de compañía es POR NOMBRE. Antes, ante varios candidatos, el
// script registraba el hallazgo y seguía igual con candidates[0] — así que los
// UPDATE de --apply podían caer en la compañía equivocada.

test('un solo candidato: auditable contra ese id', () => {
  const match = resolveCompanyMatch([45]);
  assert.equal(match.auditable, true);
  assert.equal(match.companyId, 45);
});

test('REGRESIÓN: varios candidatos NO es auditable, y no propone ningún company_id', () => {
  const match = resolveCompanyMatch([45, 137]);
  assert.equal(match.auditable, false);
  assert.equal(match.reason, 'ambiguous');
  assert.equal(match.companyId, undefined, 'no debe elegir uno arbitrario');
  assert.deepEqual(match.company_ids, [45, 137]);
});

test('REGRESIÓN: sin candidatos se reporta, no se descarta en silencio', () => {
  const match = resolveCompanyMatch([]);
  assert.equal(match.auditable, false);
  assert.equal(match.reason, 'unmatched');
});

test('tolera undefined (la compañía no está en el índice)', () => {
  const match = resolveCompanyMatch(undefined);
  assert.equal(match.auditable, false);
  assert.equal(match.reason, 'unmatched');
});

// ─── resolveDesiredActive ───────────────────────────────────────────────────
// Antes era `emp.active === false ? 0 : 1`, o sea que un `active` AUSENTE se
// trataba como activo y --apply podía reactivar a alguien dado de baja bien.

test('active true → 1, active false → 0', () => {
  assert.equal(resolveDesiredActive({ active: true }), 1);
  assert.equal(resolveDesiredActive({ active: false }), 0);
});

test('REGRESIÓN: active ausente → null, Mongo no opina', () => {
  assert.equal(resolveDesiredActive({}), null);
  assert.equal(resolveDesiredActive({ active: undefined }), null);
  assert.equal(resolveDesiredActive(undefined), null);
});

test('un active no booleano no se interpreta', () => {
  // El propio script documenta que `active`/`status` de Mongo no son confiables;
  // adivinar la intención de un string sería exactamente el error a evitar.
  assert.equal(resolveDesiredActive({ active: 'Confirmed' }), null);
  assert.equal(resolveDesiredActive({ active: 1 }), null);
});

// ─── computeExitCode ────────────────────────────────────────────────────────
// Antes era `drift > 0 && !APPLY ? 1 : 0`: con --apply el exit era SIEMPRE 0,
// incluso con hallazgos que --apply no puede arreglar. Un cron con esa bandera
// nunca reportaba justamente lo que necesita a una persona.

test('todo limpio → 0, con o sin --apply', () => {
  assert.equal(computeExitCode(empty(), { apply: false }), 0);
  assert.equal(computeExitCode(empty(), { apply: true }), 0);
});

test('solo hallazgos arreglables: 1 sin --apply, 0 con --apply', () => {
  const f = empty();
  f.roleMismatch.push({ email: 'a@b.com' });
  assert.equal(computeExitCode(f, { apply: false }), 1);
  assert.equal(computeExitCode(f, { apply: true }), 0, '--apply ya los arregló');
});

test('REGRESIÓN: con --apply, lo que necesita a un humano sigue dando 1', () => {
  for (const key of NEEDS_HUMAN) {
    const f = empty();
    f[key].push({ email: 'a@b.com' });
    assert.equal(
      computeExitCode(f, { apply: true }), 1,
      `${key} no se arregla con --apply: el exit debe seguir siendo 1`
    );
  }
});

test('REGRESIÓN: una company ambigua sola ya es motivo de exit 1', () => {
  // Antes ni siquiera entraba en el cálculo: el script salía 0 mientras la
  // ambigüedad corrompía la auditoría en silencio.
  const f = empty();
  f.ambiguousCompany.push({ company: 'Acme', company_ids: [45, 137] });
  assert.equal(computeExitCode(f, { apply: false }), 1);
  assert.equal(computeExitCode(f, { apply: true }), 1);
});

test('una invitación pendiente NO es divergencia: sigue dando 0', () => {
  const f = empty();
  f.pendingInvitation.push({ email: 'a@b.com' });
  assert.equal(computeExitCode(f, { apply: false }), 0);
  assert.equal(computeExitCode(f, { apply: true }), 0);
});

test('las dos listas de clasificación son disjuntas', () => {
  const overlap = FIXABLE_BY_APPLY.filter((key) => NEEDS_HUMAN.includes(key));
  assert.deepEqual(overlap, [], 'un hallazgo pertenece a una categoría o a la otra');
});

test('tolera un objeto de hallazgos incompleto', () => {
  assert.equal(computeExitCode({}, { apply: false }), 0);
  assert.equal(computeExitCode(undefined, { apply: false }), 0);
});
