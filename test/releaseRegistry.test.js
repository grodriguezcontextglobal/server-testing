'use strict';

/**
 * Registro de releases (CM-3, 2026-11-09): los dos scripts de deploy dejan un
 * registro en logs\releases.jsonl, también cuando fallan. El script en sí se
 * probó en PowerShell 5.1 contra un clon; aquí se comprueba que no se
 * desconecte de los scripts que lo usan.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'scripts', f), 'utf8');

test('release-registry.ps1 escribe en logs/releases.jsonl y etiqueta deploy-<componente>-', () => {
  const src = read('release-registry.ps1');
  assert.match(src, /logs\\releases\.jsonl/);
  assert.match(src, /"deploy-\$Component-"/);
  assert.match(src, /safe\.directory=/);
  // Nunca toca el árbol de trabajo ni el remoto salvo el push de la etiqueta.
  assert.doesNotMatch(src, /'(fetch|pull|checkout|reset)'/);
});

test('el parámetro no se llama $Result: al hacer dot-source pisaría el $result del llamador', () => {
  // Solo el param() del script: los de Write-ReleaseRecord son locales a la función.
  const scriptParams = read('release-registry.ps1').split(/\nfunction /)[0];
  assert.match(scriptParams, /\$RegResult/);
  assert.doesNotMatch(scriptParams, /\[string\]\s*\$(Result|Mode|Note|Component)\s*,/);
});

for (const [script, component] of [['deploy-node.ps1', 'node'], ['restart-go-worker.ps1', 'go-worker']]) {
  test(`${script} registra el resultado (OK y FAILED) como ${component}`, () => {
    const src = read(script);
    assert.match(src, /\. \(Join-Path \$PSScriptRoot 'release-registry\.ps1'\)/);
    for (const result of ['OK', 'FAILED']) {
      assert.match(src, new RegExp(`Write-ReleaseRecord[^\\n]*-Component '${component}' -Result '${result}'`));
    }
    assert.match(src, /\[switch\] \$PushTag/);
  });
}
