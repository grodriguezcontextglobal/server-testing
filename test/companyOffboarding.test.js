'use strict';

/**
 * Baja de cliente (APP-2026-016): la fecha declarada manda sobre la observada.
 *
 * Lo que el hallazgo pedia es un instante desde el que contar los 120 dias de
 * retencion del log del console. Estos casos prueban las dos mitades: que la
 * fecha existe y se puede escribir con su motivo, y que el job de retencion la
 * usa en vez de la aproximacion de "el dia en que vi que ya no estaba".
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { planRetention, planActorRetention } = require('../scheduler/platformAuditRetention');
const { resolveCompany, offboardPlan, reinstatePlan } = require('../scripts/company-offboard');
const { ACTIVITY_ACTIONS, ACTIVITY_TARGET_MODELS } = require('../constants/activityVocabulary');

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-27T03:40:00Z');

describe('el job cuenta desde Company.offboardedAt', () => {
  test('una compañia de baja hace 120 dias se purga, aunque nunca se anotara como ausente', () => {
    const plan = planRetention({
      companiesInLog: ['c1'],
      // Sigue EXISTIENDO en Mongo, por eso no esta en `presentCompanies`: el
      // runner mete ahi solo a las que existen Y no tienen fecha de baja.
      presentCompanies: new Set(),
      absentSince: new Map(),
      offboardedAt: new Map([['c1', new Date(now.getTime() - 120 * DAY)]]),
      now, days: 120,
    });
    assert.equal(plan.purge.length, 1);
    assert.equal(plan.purge.at(0).companyId, 'c1');
    assert.equal(plan.purge.at(0).declared, true);
    // Y no se anota: la anotacion solo existe para quien no tiene fecha.
    assert.deepEqual(plan.mark, []);
  });

  test('a los 119 dias desde la baja todavia no', () => {
    const plan = planRetention({
      companiesInLog: ['c1'],
      presentCompanies: new Set(),
      absentSince: new Map(),
      offboardedAt: new Map([['c1', new Date(now.getTime() - 119 * DAY)]]),
      now, days: 120,
    });
    assert.equal(plan.purge.length, 0);
    assert.deepEqual(plan.mark, []);
  });

  test('la fecha declarada gana a la observada, y retira la anotacion', () => {
    // El job la vio ausente hace 200 dias, pero la baja real fue hace 10.
    // Manda la baja real: NO se borra nada todavia.
    const plan = planRetention({
      companiesInLog: ['c1'],
      presentCompanies: new Set(),
      absentSince: new Map([['c1', new Date(now.getTime() - 200 * DAY)]]),
      offboardedAt: new Map([['c1', new Date(now.getTime() - 10 * DAY)]]),
      now, days: 120,
    });
    assert.equal(plan.purge.length, 0);
    assert.deepEqual(plan.clear, ['c1']);
  });

  test('sin fecha de baja, se comporta como antes', () => {
    const plan = planRetention({
      companiesInLog: ['c1'],
      presentCompanies: new Set(),
      absentSince: new Map(),
      offboardedAt: new Map(),
      now, days: 120,
    });
    assert.deepEqual(plan.mark, ['c1']);
    assert.equal(plan.purge.length, 0);
  });

  test('una compañia activa no se toca aunque figure en el log', () => {
    const plan = planRetention({
      companiesInLog: ['c1'],
      presentCompanies: new Set(['c1']),
      absentSince: new Map(),
      offboardedAt: new Map(),
      now, days: 120,
    });
    assert.deepEqual(plan, { mark: [], clear: [], purge: [] });
  });

  test('el operador desactivado cuenta desde AdminUser.deactivatedAt (O3)', () => {
    const plan = planActorRetention({
      actorsInLog: ['u1'],
      activeOperators: new Set(),
      absentSince: new Map(),
      deactivatedAt: new Map([['u1', new Date(now.getTime() - 130 * DAY)]]),
      now, days: 120,
    });
    assert.equal(plan.purge.length, 1);
    assert.equal(plan.purge.at(0).actorUserId, 'u1');
    assert.equal(plan.purge.at(0).declared, true);
  });
});

describe('resolver la compañia por nombre o id', () => {
  const companies = [
    // Las dos primeras existen en produccion y NO son la misma: se diferencian
    // en un punto. Es exactamente el par que invita a elegir mal a ojo.
    { _id: 'aaa111', company_name: 'Testing Inc.' },
    { _id: 'bbb222', company_name: 'testing inc' },
    { _id: 'ccc333', company_name: 'Invoxia, Inc.' },
    // Estas dos si son el mismo nombre con otras mayusculas.
    { _id: 'ddd444', company_name: 'ACME Co' },
    { _id: 'eee555', company_name: 'acme co' },
  ];

  test('por id exacto', () => {
    assert.equal(resolveCompany(companies, 'ccc333').company._id, 'ccc333');
  });

  test('por nombre, sin distinguir mayusculas', () => {
    assert.equal(resolveCompany(companies, 'invoxia, inc.').company._id, 'ccc333');
  });

  test('dos nombres que solo difieren en mayusculas NO se resuelven solos', () => {
    // Elegir una de las dos por orden de llegada daria de baja a la que no era.
    const out = resolveCompany(companies, 'acme co');
    assert.equal(out.company, undefined);
    assert.match(out.error, /usa el id/);
    assert.equal(out.candidates.length, 2);
  });

  test('"Testing Inc." y "testing inc" son DOS compañias, y cada una resuelve a la suya', () => {
    // Un punto de diferencia. Las dos estan en produccion y una tiene datos.
    assert.equal(resolveCompany(companies, 'Testing Inc.').company._id, 'aaa111');
    assert.equal(resolveCompany(companies, 'testing inc').company._id, 'bbb222');
  });

  test('un nombre que no existe no resuelve a nada', () => {
    assert.match(resolveCompany(companies, 'No Such Co').error, /no hay ninguna/);
  });

  test('vacio tampoco', () => {
    assert.match(resolveCompany(companies, '').error, /falta el nombre/);
  });
});

describe('plan de baja', () => {
  const active = { _id: 'c1', company_name: 'X', offboardedAt: null };
  const down = { _id: 'c2', company_name: 'Y', offboardedAt: new Date('2026-06-01') };

  test('la fecha sin motivo no se acepta: no seria evidencia de nada', () => {
    const plan = offboardPlan({ company: active, reason: '  ', now });
    assert.equal(plan.ok, false);
    assert.match(plan.reason, /--reason/);
  });

  test('una fecha pasada vale, que es el caso normal', () => {
    const plan = offboardPlan({ company: active, at: '2026-09-15', reason: 'no renovo', now });
    assert.equal(plan.ok, true);
    assert.equal(plan.set.offboardedAt.toISOString().slice(0, 10), '2026-09-15');
    assert.equal(plan.set.offboardedReason, 'no renovo');
  });

  test('una fecha futura no: el contador arrancaria en negativo', () => {
    const plan = offboardPlan({ company: active, at: '2027-01-01', reason: 'x', now });
    assert.equal(plan.ok, false);
    assert.match(plan.reason, /futuro/);
  });

  test('una fecha que no es fecha tampoco', () => {
    assert.equal(offboardPlan({ company: active, at: 'ayer', reason: 'x', now }).ok, false);
  });

  test('dar de baja a quien ya esta de baja no reescribe su fecha', () => {
    const plan = offboardPlan({ company: down, reason: 'x', now });
    assert.equal(plan.ok, false);
    assert.match(plan.reason, /2026-06-01/);
  });

  test('sin --at, la baja es hoy', () => {
    const plan = offboardPlan({ company: active, reason: 'x', now });
    assert.equal(plan.set.offboardedAt.getTime(), now.getTime());
  });

  test('reactivar limpia los tres campos', () => {
    assert.deepEqual(reinstatePlan({ company: down }).set, {
      offboardedAt: null, offboardedReason: '', offboardedBy: null,
    });
  });

  test('reactivar a quien no esta de baja no hace nada', () => {
    assert.equal(reinstatePlan({ company: active }).ok, false);
  });
});

describe('el modelo y el vocabulario', () => {
  test('Company trae los tres campos, y una compañia nueva nace activa', () => {
    const Company = require('../models/Company');
    const paths = Company.schema.paths;
    assert.ok(paths.offboardedAt, 'falta offboardedAt');
    assert.ok(paths.offboardedReason, 'falta offboardedReason');
    assert.ok(paths.offboardedBy, 'falta offboardedBy');
    assert.equal(paths.offboardedAt.options.default, null);
    assert.equal(paths.offboardedBy.options.ref, 'AdminUser');
  });

  test('no se añade un `active` de compañia que pueda discrepar de la fecha', () => {
    // Una sola fuente de verdad: activa <=> offboardedAt es null. Si alguien
    // añade una bandera aparte, este test lo dice antes de que las dos se
    // contradigan en produccion.
    const Company = require('../models/Company');
    assert.equal(Company.schema.paths.active, undefined);
    assert.equal(Company.schema.paths.status, undefined);
  });

  test('OFFBOARD y REINSTATE son verbos publicados, sobre el modelo Company', () => {
    assert.ok(ACTIVITY_ACTIONS.includes('OFFBOARD'));
    assert.ok(ACTIVITY_ACTIONS.includes('REINSTATE'));
    assert.ok(ACTIVITY_TARGET_MODELS.includes('Company'));
  });
});
