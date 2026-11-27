'use strict';

/**
 * Censo de actividad (AC-2 · APP-2026-003): la clasificacion, sin base de datos.
 *
 * El caso que da sentido al script es el ultimo de la primera tanda: una cuenta
 * sin MFA que nunca ha entrado NO es un incumplimiento de MFA, porque nunca vio
 * la pantalla de enrolamiento. Mezclar los dos casos en un solo numero es lo que
 * hacia que el POA&M reportara "38 cuentas sin MFA" como si fueran 38 personas
 * saltandose el control.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { classifyStaff, classifyCompany, hasMfa, looksLikeTest } = require('../scripts/activity-census');

const now = new Date('2026-11-27T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (d) => new Date(now.getTime() - d * DAY);
const withMfa = { mfaEnabled: true, mfaSecret: { base32: 'SECRET' } };

describe('clasificacion de una cuenta de staff', () => {
  test('desactivada, antes que nada', () => {
    assert.equal(classifyStaff({ user: { active: false, lastLoginAt: ago(1) }, now }), 'ya desactivada');
  });

  test('sin login, sin contador y sin auditoria: nunca entro', () => {
    assert.equal(classifyStaff({ user: {}, now }), 'nunca entro');
  });

  test('una fila de auditoria basta para que haya entrado alguna vez', () => {
    assert.notEqual(classifyStaff({ user: {}, activityCount: 1, lastActivity: ago(400), now }), 'nunca entro');
  });

  test('sin MFA y ultimo acceso anterior al 2026-10-05: nunca se encontro el enrolamiento', () => {
    assert.equal(
      classifyStaff({ user: { lastLoginAt: new Date('2026-09-30') }, now }),
      'no entra desde que MFA es obligatoria'
    );
  });

  test('CON MFA y acceso anterior al mandato: dormida o en uso, nunca "bloqueada por la MFA"', () => {
    // Decir "no entra desde que MFA es obligatoria" de una cuenta enrolada
    // manda a revisar un control que esa persona ya cumplio. Los dos accesos
    // de abajo son anteriores al 2026-10-05 y ninguno cae en ese grupo.
    assert.equal(
      classifyStaff({ user: { ...withMfa, lastLoginAt: new Date('2026-07-01') }, now }),
      'dormida >90d'
    );
    // 60 dias: vieja para el mandato, reciente para la inactividad.
    assert.equal(
      classifyStaff({ user: { ...withMfa, lastLoginAt: new Date('2026-09-28') }, now }),
      'en uso'
    );
  });

  test('entro DESPUES del mandato y sigue sin MFA: eso si es un incumplimiento', () => {
    assert.equal(
      classifyStaff({ user: { lastLoginAt: new Date('2026-10-06') }, now }),
      'entro con MFA obligatoria y sin MFA'
    );
  });

  test('con MFA y accediendo: en uso', () => {
    assert.equal(classifyStaff({ user: { ...withMfa, lastLoginAt: ago(3) }, now }), 'en uso');
  });

  test('con MFA pero 91 dias sin aparecer: dormida', () => {
    assert.equal(classifyStaff({ user: { ...withMfa, lastLoginAt: ago(91) }, now }), 'dormida >90d');
  });

  test('a los 90 justos todavia no esta dormida', () => {
    assert.equal(classifyStaff({ user: { ...withMfa, lastLoginAt: ago(90) }, now }), 'en uso');
  });

  test('la actividad reciente cuenta aunque el login sea viejo', () => {
    // Un acceso de hace 200 dias con actividad de anteayer NO son 200 dias de
    // inactividad: la sesion sigue viva y la persona esta trabajando.
    assert.equal(
      classifyStaff({
        user: { ...withMfa, lastLoginAt: ago(200) }, activityCount: 5, lastActivity: ago(2), now,
      }),
      'en uso'
    );
  });

  test('mfaEnabled sin secreto no es tener MFA: el login la vuelve a pedir', () => {
    assert.equal(hasMfa({ mfaEnabled: true }), false);
    assert.equal(hasMfa({ mfaEnabled: true, mfaSecret: {} }), false);
    assert.equal(hasMfa(withMfa), true);
  });
});

describe('clasificacion de un cliente', () => {
  test('nada suyo y nadie que haya entrado: sin rastro', () => {
    assert.equal(
      classifyCompany({ footprint: 0, lastActivity: null, staffEverUsed: false, now }),
      'sin rastro de uso'
    );
  });

  test('nada suyo pero alguien entro alguna vez: solo cuentas', () => {
    assert.equal(
      classifyCompany({ footprint: 0, lastActivity: null, staffEverUsed: true, now }),
      'solo cuentas, sin datos'
    );
  });

  test('con datos y actividad reciente: en uso', () => {
    assert.equal(
      classifyCompany({ footprint: 500, lastActivity: ago(10), staffEverUsed: true, now }),
      'en uso'
    );
  });

  test('con datos y sin actividad en mas de 90 dias', () => {
    assert.equal(
      classifyCompany({ footprint: 500, lastActivity: ago(120), staffEverUsed: true, now }),
      'con datos, sin actividad reciente'
    );
  });

  test('1.800 aparatos y cero actividad NO es una compañia vacia', () => {
    // El caso de ABC Interpreting / BEGIN: el nombre y el silencio invitan a
    // tratarla como de prueba, y tiene miles de aparatos dentro.
    assert.notEqual(
      classifyCompany({ footprint: 1800, lastActivity: ago(200), staffEverUsed: true, now }),
      'sin rastro de uso'
    );
  });
});

describe('la heuristica de "parece de prueba" solo ordena, no condena', () => {
  test('marca los sospechosos de siempre', () => {
    for (const e of ['qaz@qaz.com', 'wsx@wsx.com', '123456789@test.com', 'test1.tester@tester.test']) {
      assert.equal(looksLikeTest(e), true, e);
    }
  });

  test('no marca un correo de persona', () => {
    for (const e of ['grodriguez@contextglobal.com', 'manager@invoxia.cc', 'fstarmark@gmail.com']) {
      assert.equal(looksLikeTest(e), false, e);
    }
  });
});
