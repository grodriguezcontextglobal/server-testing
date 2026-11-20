'use strict';

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');

const { auditCompanyLinks, fuzzyKey, REASONS } = require('../scripts/company-link-audit');

// Las dos bases se enlazan por igualdad exacta del nombre de la compañia
// (helpers/planLimits.js:123). Estos tests fijan QUE MIDE el script, que es lo
// que va a decidir si el arreglo es de dos filas o una migracion.

const company = (id, name, staff = 1) => ({
  _id: id,
  company_name: name,
  employees: Array.from({ length: staff }, () => ({ active: true })),
});

const sql = (id, name) => ({ company_id: id, company_name: name });

describe('auditCompanyLinks', () => {
  test('un nombre identico en las dos bases resuelve', () => {
    const report = auditCompanyLinks({
      companies: [company('m1', 'Acme Corp')],
      sqlRows: [sql(7, 'Acme Corp')],
      subscriptions: [],
    });
    assert.equal(report.summary.ok, 1);
    assert.equal(report.findings[0].sqlCompanyId, 7);
  });

  // EL LIMITE DE LA MEDICION, fijado a proposito. Un renombrado de verdad
  // —"Acme Corp" pasa a llamarse "Acme Corporation"— es indistinguible de una
  // compañia que nunca estuvo en SQL, y sale como `no_sql_row`. No se puede
  // hacer mejor desde fuera: afinar la comparacion hasta que estos dos
  // nombres casen es la misma pendiente que acaba emparejando a dos clientes
  // distintos. Quien lea el informe tiene que saber que `no_sql_row` significa
  // "no se puede saber", no "no existe".
  test('un renombrado a un nombre distinto es indistinguible de no existir', () => {
    const report = auditCompanyLinks({
      companies: [company('m1', 'Acme Corporation')],
      sqlRows: [sql(7, 'Acme Corp')],
      subscriptions: [],
    });
    const found = report.findings[0];
    assert.equal(found.reason, REASONS.NO_SQL_ROW);
    assert.equal(found.sqlCompanyId, null);
    assert.deepEqual(found.candidates, []);
  });

  test('una diferencia de acento, mayuscula o espacio tambien es name_differs', () => {
    const report = auditCompanyLinks({
      companies: [company('m1', '  Café  Múnich ')],
      sqlRows: [sql(9, 'Cafe Munich')],
      subscriptions: [],
    });
    assert.equal(report.findings[0].reason, REASONS.NAME_DIFFERS);
    assert.deepEqual(report.findings[0].candidates, [{ id: 9, name: 'Cafe Munich' }]);
  });

  test('sin nada parecido en SQL es no_sql_row, no name_differs', () => {
    const report = auditCompanyLinks({
      companies: [company('m1', 'Acme Corp')],
      sqlRows: [sql(7, 'Totally Different Ltd')],
      subscriptions: [],
    });
    assert.equal(report.findings[0].reason, REASONS.NO_SQL_ROW);
    assert.deepEqual(report.findings[0].candidates, []);
  });

  // `LIMIT 1` elige una de las dos sin decirlo, y puede ser la equivocada.
  test('un nombre repetido en company_info es ambiguous, con las dos candidatas', () => {
    const report = auditCompanyLinks({
      companies: [company('m1', 'Acme Corp')],
      sqlRows: [sql(7, 'Acme Corp'), sql(8, 'Acme Corp')],
      subscriptions: [],
    });
    const found = report.findings[0];
    assert.equal(found.reason, REASONS.AMBIGUOUS);
    assert.equal(found.sqlCompanyId, null);
    assert.equal(found.candidates.length, 2);
  });

  test('una compañia de Mongo sin nombre no se cuenta como fallo de cruce', () => {
    const report = auditCompanyLinks({
      companies: [{ _id: 'm1', company_name: '   ', employees: [] }],
      sqlRows: [sql(7, 'Acme Corp')],
      subscriptions: [],
    });
    assert.equal(report.findings[0].reason, REASONS.NO_NAME);
  });

  // La prioridad no la marca el numero de compañias rotas, la marca cuanta
  // gente esta detras. Una rota sin personal es deuda; una con veinte es un
  // incidente.
  test('cuenta el personal activo que hay detras de cada cruce roto', () => {
    const report = auditCompanyLinks({
      companies: [
        company('m1', 'Rota Grande', 20),
        company('m2', 'Rota Vacia', 0),
        company('m3', 'Sana', 5),
      ],
      sqlRows: [sql(1, 'Sana')],
      subscriptions: [],
    });
    assert.equal(report.summary.ok, 1);
    assert.equal(report.summary.staffBehindBrokenLinks, 20);
  });

  test('el personal inactivo no cuenta', () => {
    const report = auditCompanyLinks({
      companies: [
        { _id: 'm1', company_name: 'Rota', employees: [{ active: true }, { active: false }] },
      ],
      sqlRows: [],
      subscriptions: [],
    });
    assert.equal(report.summary.staffBehindBrokenLinks, 1);
  });

  // El id cacheado en CompanySubscription salva el cruce mientras la fila
  // exista. Si apunta a una que ya no esta, es peor que no tenerlo: resuelve a
  // algo que no existe en vez de fallar.
  test('un id cacheado que ya no existe en SQL se señala', () => {
    const report = auditCompanyLinks({
      companies: [company('m1', 'Acme Corp')],
      sqlRows: [sql(7, 'Acme Corp')],
      subscriptions: [{ company: 'm1', sql_company_id: 999 }],
    });
    assert.equal(report.summary.cachedOrphans, 1);
    assert.equal(report.findings[0].cachedSqlId, 999);
    assert.equal(report.findings[0].cachedOrphan, true);
  });

  test('un id cacheado que sigue existiendo no se señala', () => {
    const report = auditCompanyLinks({
      companies: [company('m1', 'Acme Corp')],
      sqlRows: [sql(7, 'Acme Corp')],
      subscriptions: [{ company: 'm1', sql_company_id: 7 }],
    });
    assert.equal(report.summary.cachedOrphans, 0);
  });

  // El otro sentido del cruce (resolveMongoCompanyId): inventario y
  // transacciones en SQL sin dueño en Mongo.
  test('las filas de SQL que ningun nombre de Mongo alcanza se listan aparte', () => {
    const report = auditCompanyLinks({
      companies: [company('m1', 'Acme Corp')],
      sqlRows: [sql(7, 'Acme Corp'), sql(8, 'Huerfana SL')],
      subscriptions: [],
    });
    assert.equal(report.summary.orphanSqlRows, 1);
    assert.deepEqual(report.orphanSqlRows, [{ sqlCompanyId: 8, companyName: "Huerfana SL", activeStaff: null }]);
  });

  // EL HUECO QUE TENIA LA PRIMERA VERSION. Una compañia que solo existe en SQL
  // no tiene documento en Mongo, asi que no tiene `employees`: contar solo el
  // personal de Mongo daba "0 afectados" sin haber mirado a los unicos que
  // podian estarlo — y es justo el sentido por el que falla el inicio de
  // sesion (SQL -> Mongo).
  test('cuenta el personal de las compañias que solo existen en SQL', () => {
    const report = auditCompanyLinks({
      companies: [company('m1', 'Sana')],
      sqlRows: [sql(1, 'Sana'), sql(56, 'Solo en SQL')],
      subscriptions: [],
      staffBySqlCompany: new Map([[1, 9], [56, 4]]),
    });
    assert.equal(report.summary.staffBehindBrokenLinks, 0);
    assert.equal(report.summary.staffInSqlOnlyCompanies, 4);
    assert.deepEqual(report.orphanSqlRows, [
      { sqlCompanyId: 56, companyName: 'Solo en SQL', activeStaff: 4 },
    ]);
  });

  // LOS DOS LADOS DE LA MISMA MONEDA, y los dos se equivocaron una vez.
  //
  // Sin mapa, no se inventa un cero: un cero falso en la columna tranquila hace
  // que nadie vuelva a mirar.
  test('sin consultar el personal, una compañia solo-SQL queda como desconocida', () => {
    const report = auditCompanyLinks({
      companies: [],
      sqlRows: [sql(56, 'Solo en SQL')],
      subscriptions: [],
    });
    assert.equal(report.orphanSqlRows[0].activeStaff, null);
    assert.equal(report.summary.sqlOnlyCompaniesWithUnknownStaff, 1);
    assert.equal(report.summary.sqlCompaniesWithStaff, null);
  });

  // Y con el mapa, tampoco se inventa un "desconocido": ausente de un
  // `GROUP BY ... WHERE is_active = 1` es CERO, que es un dato. Decir "no se
  // sabe" de algo medido manda a alguien a mirar lo que ya estaba contestado.
  test('con el personal consultado, no aparecer en el mapa es CERO, no desconocido', () => {
    const report = auditCompanyLinks({
      companies: [],
      sqlRows: [sql(56, 'Solo en SQL')],
      subscriptions: [],
      staffBySqlCompany: new Map([[99, 3]]),
    });
    assert.equal(report.orphanSqlRows[0].activeStaff, 0);
    assert.equal(report.summary.sqlOnlyCompaniesWithUnknownStaff, 0);
  });

  // Un mapa vacio sigue siendo una consulta hecha: ceros, no desconocidos. Y
  // `sqlCompaniesWithStaff: 0` es lo que permite dudar de esos ceros si la
  // tabla resulta estar vacia por otra razon.
  test('un mapa vacio da ceros medidos, y lo señala', () => {
    const report = auditCompanyLinks({
      companies: [],
      sqlRows: [sql(56, 'Solo en SQL')],
      subscriptions: [],
      staffBySqlCompany: new Map(),
    });
    assert.equal(report.orphanSqlRows[0].activeStaff, 0);
    assert.equal(report.summary.sqlCompaniesWithStaff, 0);
  });

  // Las dos cifras no se suman: cada una dice por que SENTIDO esta roto el
  // cruce, y juntarlas esconderia cual de los dos.
  test('el personal de los dos lados se cuenta por separado', () => {
    const report = auditCompanyLinks({
      companies: [company('m1', 'Rota en Mongo', 3)],
      sqlRows: [sql(56, 'Solo en SQL')],
      subscriptions: [],
      staffBySqlCompany: new Map([[56, 7]]),
    });
    assert.equal(report.summary.staffBehindBrokenLinks, 3);
    assert.equal(report.summary.staffInSqlOnlyCompanies, 7);
  });

  test('sin compañias no revienta', () => {
    const report = auditCompanyLinks({ companies: [], sqlRows: [], subscriptions: [] });
    assert.equal(report.summary.mongoCompanies, 0);
    assert.equal(report.summary.staffBehindBrokenLinks, 0);
  });
});

describe('fuzzyKey', () => {
  // Existe SOLO para explicar por que fallo un cruce. Que normalice mucho es
  // deliberado: cuanto mas agrupa, mejor distingue "no esta" de "esta escrita
  // de otra forma". Lo que NO puede es convertirse en la regla de
  // emparejamiento, y por eso el script nunca devuelve un sqlCompanyId sacado
  // de aqui — ningun test de arriba lo permite.
  test('iguala acentos, mayusculas, puntuacion y espacios de mas', () => {
    assert.equal(fuzzyKey('  Café  Múnich, S.L. '), fuzzyKey('cafe munich s l'));
    assert.equal(fuzzyKey('Acme-Corp'), fuzzyKey('ACME CORP'));
  });

  test('no iguala nombres que de verdad son distintos', () => {
    assert.notEqual(fuzzyKey('Acme Corp'), fuzzyKey('Acme Corporation'));
  });

  test('un nombre vacio da clave vacia', () => {
    assert.equal(fuzzyKey('   '), '');
    assert.equal(fuzzyKey(null), '');
  });
});
