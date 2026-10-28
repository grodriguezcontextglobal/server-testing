'use strict';

/** scripts/summarize-ram.js: resumen de measure-ram.ps1 y runtime-metrics.log (A10). */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRamCsv, parseRuntimeLog, summarizeRam, render, sizeUp } = require('../scripts/summarize-ram');

// Formato de scripts/measure-ram.ps1.
const CSV = [
  'timestamp_utc,kind,group,processes,working_set_mb,private_mb,cpu_pct,total_mb,cores',
  '2026-10-28T10:00:00Z,MACHINE,"MACHINE",120,6000,9000,20,32768,4',
  '2026-10-28T10:00:00Z,service,"DevitrakServer",6,1500,1800,,,',
  '2026-10-28T10:00:00Z,service,"DevitrakBulkWorker",2,200,250,,,',
  '2026-10-28T10:00:00Z,service,"MySQL80",1,2000,2100,,,',
  '2026-10-28T10:00:00Z,process,"w3wp.exe",2,300,350,,,',
  '2026-10-28T10:01:00Z,MACHINE,"MACHINE",121,7000,9500,50,32768,4',
  '2026-10-28T10:01:00Z,service,"DevitrakServer",6,2500,2800,30,,',
  '2026-10-28T10:01:00Z,service,"DevitrakBulkWorker",2,500,550,10,,',
  '2026-10-28T10:01:00Z,service,"MySQL80",1,2100,2200,5,,',
  '2026-10-28T10:01:00Z,process,"w3wp.exe",2,320,360,1,,',
].join('\r\n');

test('parseRamCsv lee las columnas, con comillas y celdas vacías', () => {
  const rows = parseRamCsv(CSV);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[0], { at: '2026-10-28T10:00:00Z', kind: 'MACHINE', group: 'MACHINE', processes: 120, ws: 6000, priv: 9000, cpu: 20, total: 32768, cores: 4 });
  assert.equal(rows[1].cpu, null);
});

test('summarizeRam: máquina, app sumada por instante, bases de datos aparte y tamaño con margen', () => {
  const s = summarizeRam(parseRamCsv(CSV), [], { headroom: 0.3 });
  assert.equal(s.machine.total_mb, 32768);
  assert.equal(s.machine.used_mb.max, 7000);
  assert.equal(s.app_mb.max, 3000, 'Server + Bulk en el mismo instante');
  assert.equal(s.databases_mb.max, 2100);
  assert.equal(s.groups[0].group, 'DevitrakServer');
  // 7000 × 1.3 = 9100 MB → 16 GB; CPU p95 50 % de 4 núcleos × 1.3 = 2.6 → 4 vCPU.
  assert.deepEqual(s.sizing.whole_machine, { ram: { peak_mb: 7000, needed_mb: 9100, gb: 16 }, vcpu: 4 });
  // 3000 × 1.3 + 2048 de SO = 5948 → 8 GB.
  assert.equal(s.sizing.app_only.ram.gb, 8);
  assert.match(render(s), /AVISO: menos de 7 días/);
});

test('runtime-metrics: por rol, y el heap que crece se ve en MB por día', () => {
  const lines = [];
  for (let i = 0; i < 40; i++) {
    const timestamp = new Date(Date.UTC(2026, 9, 28) + i * 3600e3).toISOString();
    lines.push(JSON.stringify({ type: 'runtime_metrics', role: 'api:0', pid: 1, timestamp, rss_mb: 300 + i, heap_used_mb: 100 + i, cpu_pct: 5, loop_p99_ms: 12 }));
    lines.push(JSON.stringify({ type: 'runtime_metrics', role: 'worker:bulk', pid: 2, timestamp, rss_mb: 150, heap_used_mb: 60, cpu_pct: 1, loop_p99_ms: 3 }));
  }
  lines.push('{"level":"info","message":"otra cosa"}', 'no es json');
  const runtime = parseRuntimeLog(lines.join('\n'));
  assert.equal(runtime.length, 80);
  const s = summarizeRam([], runtime);
  const api = s.roles.find((r) => r.role === 'api:0');
  const bulk = s.roles.find((r) => r.role === 'worker:bulk');
  assert.equal(api.rss.max, 339);
  assert.ok(api.heap_growth_mb_per_day > 20, `crece: ${api.heap_growth_mb_per_day}`);
  assert.equal(bulk.heap_growth_mb_per_day, 0);
  assert.match(render(s), /api:0/);
});

test('sizeUp redondea al tamaño estándar', () => {
  assert.equal(sizeUp(900), 1);
  assert.equal(sizeUp(4096), 4);
  assert.equal(sizeUp(4097), 8);
});
