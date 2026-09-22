'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

/**
 * Estos tests existen por la caida de produccion del 2026-09-09.
 *
 * `uuid` estaba pinneado a un major ESM puro mientras el codigo lo cargaba con
 * require(), asi que el primer `npm ci` que instalo de verdad el lockfile tumbo
 * el arranque con ERR_REQUIRE_ESM en bucle. La suite estaba en verde: 1168 de
 * 1169. No lo vio porque test/registration.test.js inyectaba un uuid falso en
 * `require.cache`, de modo que el test nunca cargaba el modulo real y la
 * incompatibilidad era invisible POR CONSTRUCCION.
 *
 * De ahi los dos tests de abajo: comprueban que las dependencias que este
 * codigo carga con require() se pueden cargar de verdad. Es lo unico que el
 * patron de stubs no puede cubrir.
 *
 * scripts/deploy-node.ps1 hace la misma comprobacion de ESM antes de arrancar
 * los servicios; aqui salta antes, al correr la suite.
 */

test('ninguna dependencia directa es ESM pura (este codigo usa require)', () => {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
  );
  const deps = Object.keys(rootPkg.dependencies || {});
  assert.ok(deps.length > 0, 'package.json deberia declarar dependencias');

  const esmOnly = [];
  for (const name of deps) {
    const pkgPath = path.join(repoRoot, 'node_modules', name, 'package.json');
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (err) {
      // Sin instalar: no es lo que mide este test, y `npm ci` ya lo detecta.
      continue;
    }
    const dot = pkg.exports && pkg.exports['.'];
    const hasRequire =
      dot && typeof dot === 'object' &&
      Object.prototype.hasOwnProperty.call(dot, 'require');

    // `type: module` sin un export `require` ni un `main` = solo se puede
    // importar, y cualquier require() de este repo revienta al arrancar.
    if (pkg.type === 'module' && !hasRequire && !pkg.main) {
      esmOnly.push(`${name}@${pkg.version}`);
    }
  }

  assert.deepStrictEqual(
    esmOnly, [],
    `estas dependencias son ESM puras y romperan el arranque con ERR_REQUIRE_ESM: ${esmOnly.join(', ')}`
  );
});

/**
 * bcrypt es el unico paquete de TERCEROS que la suite sigue stubbeando via
 * require.cache (5 ficheros lo hacen, y con razon: hashear cuesta ~150ms y no
 * tiene sentido pagarlo en cada test). Pero es un modulo NATIVO, asi que esos
 * stubs esconden justo lo que puede fallar: que el binario no cargue por un
 * prebuild ausente o un ABI incompatible. Este test usa el real, una vez.
 */
test('bcrypt nativo carga y valida hashes existentes', () => {
  const bcrypt = require('bcrypt');

  // Ida y vuelta con un hash nuevo.
  const hash = bcrypt.hashSync('DemoPass123!', 10);
  assert.match(hash, /^\$2[aby]\$\d{2}\$/, 'el hash deberia tener prefijo bcrypt');
  assert.strictEqual(hash.length, 60);
  assert.strictEqual(bcrypt.compareSync('DemoPass123!', hash), true);
  assert.strictEqual(bcrypt.compareSync('otra-password', hash), false);

  // Un hash `$2a$` real, generado con bcrypt 5.1.1 antes del major a 6.0.0.
  // Es el prefijo que dejaron los hashes creados con bcryptjs, o sea el que
  // tienen las filas antiguas de la base de datos: si esto dejara de validar,
  // nadie con una cuenta vieja podria entrar.
  const hash2a = '$2a$10$abcdefghijklmnopqrstuuqKNgT5BDubAZMfatHFaUZLSA1SDUM0S';
  assert.strictEqual(bcrypt.compareSync('DemoPass123!', hash2a), true);
  assert.strictEqual(bcrypt.compareSync('DemoPass123', hash2a), false);
});
