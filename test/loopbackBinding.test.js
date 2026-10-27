'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// FedRAMP A1 / SC-7 (2026-10-27): el inventario de la VM de prod encontró Node
// (34001) y el Go worker (7453) escuchando en todas las interfaces, así que la
// única barrera era el firewall. Los dos ahora caen a loopback por default, y
// sus llamadores (IIS, Node, los scripts de deploy) apuntan a 127.0.0.1 — no a
// "localhost", que en Windows puede resolver primero a ::1 y no encontrar a nadie.

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('Node escucha en BIND_HOST, que cae a 127.0.0.1', () => {
  const src = read('index.js');
  assert.match(src, /const BIND_HOST = process\.env\.BIND_HOST \|\| "127\.0\.0\.1";/);
  assert.match(src, /\.listen\(PORT, BIND_HOST,/,
    'listen() sin host vuelve a escuchar en todas las interfaces');
});

test('el Go worker cae a 127.0.0.1 y escucha en host:puerto, no en ":puerto"', () => {
  const src = read('go-worker/main.go');
  assert.match(src, /bind = "127\.0\.0\.1"/);
  assert.match(src, /http\.ListenAndServe\(addr, nil\)/);
  assert.doesNotMatch(src, /ListenAndServe\(":"\s*\+/);
});

test('IIS reescribe a 127.0.0.1:34001', () => {
  assert.match(read('public/web.config'), /url="http:\/\/127\.0\.0\.1:34001\/\{R:1\}"/);
});

test('la imagen Docker abre BIND_HOST para que el puerto publicado responda', () => {
  assert.match(read('Dockerfile'), /^ENV BIND_HOST=0\.0\.0\.0$/m);
});

test('los health checks de deploy no dependen de cómo resuelva "localhost"', () => {
  assert.match(read('scripts/deploy-node.ps1'), /http:\/\/127\.0\.0\.1:34001\/health/);
  assert.match(read('scripts/restart-go-worker.ps1'), /http:\/\/127\.0\.0\.1:\$port\/health/);
});
