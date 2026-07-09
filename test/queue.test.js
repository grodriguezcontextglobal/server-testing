'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Núcleo PURO de la cola (sin mongoose) para poder testear sin DB, igual que
// scripts/migrate* e idempotencyMutationCache. El wiring a Mongo (models/Job.js,
// helpers/queue.js, queue/worker.js) usa estas funciones; la atomicidad real la
// garantiza findOneAndUpdate a nivel DB (documentado, no unit-testeable aquí).
const {
  DEFAULTS,
  buildNewJob,
  buildContext,
  computeBackoffMs,
  applySuccess,
  applyFailure,
  isStale,
  buildClaimFilter,
  buildClaimUpdate,
  buildRecoveryFilter,
  buildRecoveryUpdate,
  isDuplicateKeyError,
} = require('../queue/core');

const { extractJobContext } = require('../helpers/queue');

const NOW = 1_700_000_000_000; // timestamp fijo (no Date.now) para tests deterministas

// ─── buildNewJob: el doc que se inserta al encolar ───────────────────────────

test('buildNewJob: crea job en pending, attempts 0, listo para ejecutarse ya', () => {
  const job = buildNewJob({ type: 'send-email:invoice', payload: { to: 'a@b.com' } }, NOW);
  assert.equal(job.type, 'send-email:invoice');
  assert.deepEqual(job.payload, { to: 'a@b.com' });
  assert.equal(job.status, 'pending');
  assert.equal(job.attempts, 0);
  assert.equal(job.maxAttempts, DEFAULTS.maxAttempts);
  assert.equal(job.nextAttemptAt.getTime(), NOW);
  assert.equal(job.lockedBy, null);
});

test('buildNewJob: respeta maxAttempts e idempotencyKey explícitos', () => {
  const job = buildNewJob(
    { type: 'go-worker:insert-item-event', payload: {}, idempotencyKey: 'insert:item1:ev1', maxAttempts: 3 },
    NOW,
  );
  assert.equal(job.idempotencyKey, 'insert:item1:ev1');
  assert.equal(job.maxAttempts, 3);
});

test('buildNewJob: sin idempotencyKey el campo queda AUSENTE (no null), si no el índice unique choca', () => {
  // BUG que esto previene: un índice `unique + sparse` NO omite los valores
  // `null` PRESENTES (sparse solo omite el campo ausente). Si escribiéramos
  // null, solo UN job sin clave podría existir en toda la colección (el 2do
  // daría E11000 dup key { idempotencyKey: null }). El campo debe quedar
  // ausente para que el índice sparse realmente lo ignore.
  const job = buildNewJob({ type: 'log:event', payload: {} }, NOW);
  assert.equal('idempotencyKey' in job, false);
});

test('buildNewJob: idempotencyKey vacío/undefined NO se incluye (queda ausente)', () => {
  assert.equal('idempotencyKey' in buildNewJob({ type: 'x', payload: {}, idempotencyKey: undefined }, NOW), false);
  assert.equal('idempotencyKey' in buildNewJob({ type: 'x', payload: {}, idempotencyKey: '' }, NOW), false);
});

// ─── context: snapshot de auditoría/identidad, NUNCA credenciales crudas ─────
//
// Cuando el job se ejecuta más tarde ya no existe el `req` original (headers
// x-token, s-token-lq, x-company-id se perdieron). Por eso el enqueue captura
// un snapshot de la IDENTIDAD YA VERIFICADA por el middleware de auth de la
// request original (req.uid, req.sqlStaffId, companyId resuelto) — nunca el
// token en sí. buildContext es un ALLOWLIST estricto: solo deja pasar campos
// conocidos, así que aunque alguien pase un token por error, se descarta.
// Ver DESIGN_task_queue.md § "Contexto de auditoría en jobs" para extenderlo.

test('buildContext: normaliza uid/companyId/sqlStaffId, ausentes quedan null', () => {
  assert.deepEqual(buildContext({ uid: 'U1', companyId: 'C1', sqlStaffId: 42 }), {
    uid: 'U1',
    companyId: 'C1',
    sqlStaffId: 42,
  });
  assert.deepEqual(buildContext({}), { uid: null, companyId: null, sqlStaffId: null });
  assert.deepEqual(buildContext(undefined), { uid: null, companyId: null, sqlStaffId: null });
});

test('buildContext: es un allowlist — descarta cualquier campo no reconocido (ej. tokens crudos)', () => {
  const ctx = buildContext({
    uid: 'U1',
    xToken: 'eyJhbGciOi...', // nunca debe persistirse un JWT crudo en el job
    sToken: 'raw-secret',
    somethingElse: 'ignored',
  });
  assert.deepEqual(ctx, { uid: 'U1', companyId: null, sqlStaffId: null });
  assert.equal('xToken' in ctx, false);
  assert.equal('sToken' in ctx, false);
});

test('buildNewJob: adjunta el context provisto (auditoría de quién encoló la tarea)', () => {
  const job = buildNewJob(
    {
      type: 'send-email:invoice',
      payload: { to: 'a@b.com' },
      context: { uid: 'U1', companyId: 'C1', sqlStaffId: 7 },
    },
    NOW,
  );
  assert.deepEqual(job.context, { uid: 'U1', companyId: 'C1', sqlStaffId: 7 });
});

test('buildNewJob: sin context, queda normalizado a nulls (compatibilidad hacia atrás)', () => {
  const job = buildNewJob({ type: 'log:event', payload: {} }, NOW);
  assert.deepEqual(job.context, { uid: null, companyId: null, sqlStaffId: null });
});

// ─── extractJobContext: lee identidad YA VERIFICADA del req, nunca el token ──
// Mismo patrón de mock que idempotencyMutationCache.test.js (sin servidor real).

function mockReq({ uid, sqlStaffId, headerCompanyId, bodyCompanyId } = {}) {
  return {
    uid,
    sqlStaffId,
    body: bodyCompanyId ? { company_id: bodyCompanyId } : {},
    params: {},
    query: {},
    header: (name) => (name === 'x-company-id' ? headerCompanyId : undefined),
  };
}

test('extractJobContext: toma uid/sqlStaffId ya seteados por validateJWT', () => {
  const ctx = extractJobContext(mockReq({ uid: 'U1', sqlStaffId: 7 }));
  assert.equal(ctx.uid, 'U1');
  assert.equal(ctx.sqlStaffId, 7);
});

test('extractJobContext: companyId prioriza el header x-company-id sobre el body', () => {
  const ctx = extractJobContext(mockReq({ headerCompanyId: 'C-header', bodyCompanyId: 'C-body' }));
  assert.equal(ctx.companyId, 'C-header');
});

test('extractJobContext: cae a body.company_id si no hay header', () => {
  const ctx = extractJobContext(mockReq({ bodyCompanyId: 'C-body' }));
  assert.equal(ctx.companyId, 'C-body');
});

test('extractJobContext: sin nada de contexto, todo null (nunca lanza)', () => {
  assert.deepEqual(extractJobContext(mockReq()), { uid: null, companyId: null, sqlStaffId: null });
});

test('extractJobContext: NUNCA lee ni expone x-token / s-token-lq', () => {
  const req = mockReq({ uid: 'U1' });
  req.header = (name) => {
    if (name === 'x-token') throw new Error('extractJobContext no debe leer x-token');
    if (name === 's-token-lq') throw new Error('extractJobContext no debe leer s-token-lq');
    return undefined;
  };
  assert.doesNotThrow(() => extractJobContext(req));
});

// ─── computeBackoffMs: exponencial con techo ─────────────────────────────────

test('computeBackoffMs: crece exponencial desde baseDelayMs', () => {
  const o = { baseDelayMs: 1000, maxDelayMs: 5 * 60 * 1000 };
  assert.equal(computeBackoffMs(1, o), 1000);  // 1000 * 2^0
  assert.equal(computeBackoffMs(2, o), 2000);  // 1000 * 2^1
  assert.equal(computeBackoffMs(3, o), 4000);  // 1000 * 2^2
  assert.equal(computeBackoffMs(4, o), 8000);
});

test('computeBackoffMs: nunca supera maxDelayMs', () => {
  const o = { baseDelayMs: 1000, maxDelayMs: 5000 };
  assert.equal(computeBackoffMs(10, o), 5000);
});

// ─── applySuccess: transición a done ─────────────────────────────────────────

test('applySuccess: marca done, setea doneAt/result y libera el lock', () => {
  const upd = applySuccess({ attempts: 2 }, { messageId: 'x' }, NOW);
  assert.equal(upd.status, 'done');
  assert.equal(upd.doneAt.getTime(), NOW);
  assert.deepEqual(upd.result, { messageId: 'x' });
  assert.equal(upd.lockedBy, null);
  assert.equal(upd.lockedAt, null);
  assert.equal(upd.lastError, null);
});

// ─── applyFailure: reintento con backoff, o dead-letter ──────────────────────

test('applyFailure: con reintentos disponibles vuelve a pending con nextAttemptAt futuro', () => {
  const o = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 60000 };
  const upd = applyFailure({ attempts: 0 }, 'SendGrid 503', NOW, o);
  assert.equal(upd.status, 'pending');
  assert.equal(upd.attempts, 1);
  assert.equal(upd.nextAttemptAt.getTime(), NOW + 1000); // backoff(1)
  assert.equal(upd.lastError, 'SendGrid 503');
  assert.equal(upd.lockedBy, null); // libera el lock para el próximo ciclo
});

test('applyFailure: incrementa attempts y aplica backoff creciente', () => {
  const o = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 60000 };
  const upd = applyFailure({ attempts: 2 }, 'boom', NOW, o);
  assert.equal(upd.attempts, 3);
  assert.equal(upd.nextAttemptAt.getTime(), NOW + 4000); // backoff(3)
});

test('applyFailure: al alcanzar maxAttempts pasa a dead (dead-letter)', () => {
  const o = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60000 };
  const upd = applyFailure({ attempts: 2 }, 'último intento', NOW, o); // 2+1 = 3 == max
  assert.equal(upd.status, 'dead');
  assert.equal(upd.attempts, 3);
  assert.equal(upd.lastError, 'último intento');
  assert.equal(upd.nextAttemptAt, undefined); // ya no se reintenta
});

// ─── isStale: recuperación de jobs 'processing' colgados ─────────────────────

test('isStale: processing con lockedAt viejo (server murió a mitad) es recuperable', () => {
  const job = { status: 'processing', lockedAt: new Date(NOW - 5 * 60 * 1000) };
  assert.equal(isStale(job, NOW, 2 * 60 * 1000), true);
});

test('isStale: processing reciente NO es stale', () => {
  const job = { status: 'processing', lockedAt: new Date(NOW - 10 * 1000) };
  assert.equal(isStale(job, NOW, 2 * 60 * 1000), false);
});

test('isStale: un job pending nunca es stale', () => {
  const job = { status: 'pending', lockedAt: null };
  assert.equal(isStale(job, NOW, 2 * 60 * 1000), false);
});

// ─── claim atómico: contrato del filtro/update ───────────────────────────────
// La no-duplicación real la da findOneAndUpdate: tras reclamar, el doc pasa a
// 'processing', así que un segundo claim con este mismo filtro ya NO lo ve.

test('buildClaimFilter: solo toma pending cuyo nextAttemptAt ya venció', () => {
  const filter = buildClaimFilter(NOW);
  assert.equal(filter.status, 'pending');
  assert.equal(filter.nextAttemptAt.$lte.getTime(), NOW);
});

test('buildClaimUpdate: marca processing y sella lockedBy/lockedAt (evita doble toma)', () => {
  const upd = buildClaimUpdate('worker-A', NOW);
  assert.equal(upd.$set.status, 'processing');
  assert.equal(upd.$set.lockedBy, 'worker-A');
  assert.equal(upd.$set.lockedAt.getTime(), NOW);
});

// ─── recuperación de colgados: filtro/update del barrido ─────────────────────

test('buildRecoveryFilter: encuentra processing con lock más viejo que el timeout', () => {
  const filter = buildRecoveryFilter(NOW, 2 * 60 * 1000);
  assert.equal(filter.status, 'processing');
  assert.equal(filter.lockedAt.$lte.getTime(), NOW - 2 * 60 * 1000);
});

test('buildRecoveryUpdate: devuelve el job a pending y libera el lock', () => {
  const upd = buildRecoveryUpdate(NOW);
  assert.equal(upd.$set.status, 'pending');
  assert.equal(upd.$set.lockedBy, null);
  assert.equal(upd.$set.lockedAt, null);
});

// ─── idempotencia: detección del choque de clave única (E11000) ──────────────

test('isDuplicateKeyError: reconoce el error 11000 de Mongo (job ya encolado)', () => {
  assert.equal(isDuplicateKeyError({ code: 11000 }), true);
  assert.equal(isDuplicateKeyError({ code: 11001 }), true);
});

test('isDuplicateKeyError: false para otros errores o nulos', () => {
  assert.equal(isDuplicateKeyError({ code: 121 }), false);
  assert.equal(isDuplicateKeyError(new Error('network')), false);
  assert.equal(isDuplicateKeyError(null), false);
});
