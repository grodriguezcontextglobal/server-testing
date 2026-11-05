'use strict';

/**
 * express-rate-limit v8 + dotenv 17 (2026-11-05).
 *
 *   - clientIpKey: IPv4 tal cual, IPv6 agrupada por /56 (dos direcciones de la
 *     misma subred comparten cubo), y sin IP -> 'unknown'.
 *   - Ningún keyGenerator propio dispara ERR_ERL_KEY_GEN_IPV6 al crearse.
 *   - Toda llamada a dotenv.config() va con quiet: true (la v17 escribe una
 *     línea por llamada y hay ~40 por proceso).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { clientIpKey } = require('../helpers/rateLimitKey');

test('clientIpKey: IPv4 sin cambios, IPv6 por /56, sin IP unknown', () => {
  assert.equal(clientIpKey({ ip: '203.0.113.7' }), '203.0.113.7');
  const a = clientIpKey({ ip: '2001:db8:abcd:1200::1' });
  const b = clientIpKey({ ip: '2001:db8:abcd:12ff:ffff::9' });
  assert.equal(a, b, 'misma /56, mismo cubo');
  assert.notEqual(a, clientIpKey({ ip: '2001:db8:abcd:1300::1' }), 'otra /56, otro cubo');
  assert.equal(clientIpKey({}), 'unknown');
});

test('los limitadores con keyGenerator propio no avisan de IPv6 al crearse', () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    for (const rel of ['../middlewares/notificationAuth.js']) {
      delete require.cache[require.resolve(rel)];
      require(rel);
    }
    const { rateLimit } = require('express-rate-limit');
    rateLimit({ keyGenerator: clientIpKey });
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors.filter((e) => e.includes('ERR_ERL_KEY_GEN_IPV6')), []);
});

test('index.js usa clientIpKey en el limitador global', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
  assert.match(src, /keyGenerator: require\("\.\/helpers\/rateLimitKey"\)\.clientIpKey/);
});

test('toda llamada a dotenv.config() va con quiet: true', () => {
  const root = path.resolve(__dirname, '..');
  const skip = new Set(['node_modules', '.git', 'graphify-out', 'test', 'go-worker']);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
          if (/require\(['"]dotenv['"]\)\.config\(/.test(line) && !line.includes('quiet: true')) {
            offenders.push(`${path.relative(root, full)}: ${line.trim()}`);
          }
        }
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
