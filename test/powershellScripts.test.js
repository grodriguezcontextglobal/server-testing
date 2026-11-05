'use strict';

/**
 * Los .ps1 corren en la VM con Windows PowerShell 5.1, que lee un .ps1 sin BOM
 * como ANSI: un guion largo o una tilde en UTF-8 se convierten en caracteres
 * que el parser toma por comillas, y el script entero deja de parsear. Ya pasó
 * (reference_prod_deploy_machine #1). Este test lo para antes del deploy.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'scripts');
const scripts = fs.readdirSync(dir).filter((f) => f.endsWith('.ps1'));

test('hay scripts de PowerShell que comprobar', () => {
  assert.ok(scripts.length >= 4);
});

for (const name of scripts) {
  test(`${name} es ASCII puro`, () => {
    const bytes = fs.readFileSync(path.join(dir, name));
    const lines = bytes.toString('latin1').split('\n');
    const bad = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /[^\x00-\x7f]/.test(l));
    assert.deepEqual(bad.map(([n]) => n), [], `${name}: líneas con caracteres no ASCII`);
  });
}
