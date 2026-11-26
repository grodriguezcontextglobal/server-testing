'use strict';

/**
 * GovRAMP, revisión del 2026-11-26: los dos arreglos que no dependen de nadie.
 *
 *   APP-2026-002 (AU-11, AU-4) · una serie de logs por proceso
 *   APP-2026-014 (AC-4, SC-7)  · `login.microsoftonline.com` fuera del CORS
 */

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('APP-2026-014 · orígenes CORS', () => {
  const { corsOptions } = require('../config/cors');

  const allowed = (origin) =>
    new Promise((resolve) => corsOptions.origin(origin, (err) => resolve(!err)));

  test('login.microsoftonline.com ya no está aceptado', async () => {
    assert.equal(await allowed('https://login.microsoftonline.com'), false);
    assert.equal(await allowed('https://login.microsoftonline.com/'), false);
  });

  // Lo que SÍ tiene que seguir entrando. Quitar un origen de más seria peor
  // que dejar el de Microsoft: tumbaria el dashboard.
  test('los orígenes de producción siguen aceptados', async () => {
    for (const origin of [
      'https://admin.devitrak.net',
      'https://app.devitrak.net',
      'https://ops.devitrak.net',
    ]) {
      assert.equal(await allowed(origin), true, `${origin} tiene que seguir entrando`);
    }
  });

  test('un origen cualquiera sigue rechazado', async () => {
    assert.equal(await allowed('https://evil.test'), false);
  });

  // Los tres `localhost` se van el dia del encendido de la cookie, no hoy:
  // son el unico camino que tiene el dashboard para probar `dual`. Este test
  // NO los defiende, los registra, para que el dia que se quiten se vea aqui.
  test('quedan tres localhost, pendientes del día de la cookie', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'config', 'cors.js'), 'utf8');
    const live = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    const locals = live.match(/"http:\/\/localhost:\d+"/g) || [];
    assert.equal(locals.length, 3, 'si cambia el número, el POA&M (APP-2026-014) hay que tocarlo');
  });
});

describe('APP-2026-002 · una serie de logs por proceso', () => {
  // La rotación de winston es por tamaño y cada proceso lleva su contador. Con
  // seis procesos sobre el mismo archivo los índices se pisaban: por eso habia
  // combined1.log de mayo junto a combined.log de noviembre.
  test('el nombre del archivo lleva el rol del proceso', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'logger.js'), 'utf8');
    for (const serie of ['combined', 'error', 'requests', 'exceptions', 'rejections']) {
      assert.match(
        source,
        new RegExp(`\`${serie}-\\$\\{fileTag\\(\\)\\}\\.log\``),
        `la serie ${serie} tiene que ir por proceso`
      );
    }
  });

  test('ningún transporte escribe ya en el archivo compartido', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'logger.js'), 'utf8');
    const live = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    assert.doesNotMatch(live, /'combined\.log'|'requests\.log'|'error\.log'/);
  });

  // `api:0` no vale como nombre de archivo en Windows: los dos puntos están
  // reservados. Se miran los transportes ya construidos y no el disco, porque
  // winston crea el archivo al primer registro, no al instanciarse.
  test('el rol se sanea para que sirva de nombre de archivo', () => {
    delete require.cache[require.resolve('../helpers/logger')];
    const before = process.env.NODE_APP_INSTANCE;
    process.env.NODE_APP_INSTANCE = '0';
    try {
      const logger = require('../helpers/logger');
      const names = logger.transports
        .map((t) => t.filename)
        .filter(Boolean)
        .map((f) => path.basename(f));

      assert.ok(names.includes('combined-api-0.log'), `se esperaba combined-api-0.log, hay ${names}`);
      assert.ok(names.includes('requests-api-0.log'));
      for (const name of names) assert.doesNotMatch(name, /:/, 'un dos puntos no vale en Windows');
    } finally {
      if (before === undefined) delete process.env.NODE_APP_INSTANCE;
      else process.env.NODE_APP_INSTANCE = before;
      delete require.cache[require.resolve('../helpers/logger')];
    }
  });

  test('la capacidad se puede cambiar sin desplegar', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'logger.js'), 'utf8');
    for (const name of ['LOG_COMBINED_MAX_MB', 'LOG_COMBINED_MAX_FILES', 'LOG_REQUESTS_MAX_MB']) {
      assert.ok(source.includes(name), `falta la variable ${name}`);
    }
  });

  // El script que resume los warn tiene que encontrar las dos convenciones:
  // la nueva y la que ya está escrita en el disco de la VM.
  test('summarize-warn-logs reconoce los nombres viejos y los nuevos', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'summarize-warn-logs.js'), 'utf8');
    const match = source.match(/\/\^combined[^/]*\/\.test/);
    assert.ok(match, 'no se encontró el filtro de archivos');
    const re = new RegExp(match[0].slice(1, -6));
    for (const name of ['combined.log', 'combined3.log', 'combined-api-0.log', 'combined-worker-heavy.log']) {
      assert.ok(re.test(name), `${name} tiene que casar`);
    }
    assert.ok(!re.test('requests-api-0.log'), 'y requests no');
  });
});
