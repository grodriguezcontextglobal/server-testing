'use strict';

/**
 * Resumen de RAM y CPU medidos, para dimensionar la máquina de destino de la
 * migración (Oracle, AWS o Azure) — A10, 2026-10-28.
 *
 *   node scripts/summarize-ram.js                     # logs/ de este directorio
 *   node scripts/summarize-ram.js D:\copia\logs       # otra carpeta
 *   node scripts/summarize-ram.js --headroom 0.4      # margen sobre el pico (0.3 por defecto)
 *   node scripts/summarize-ram.js --json              # para guardar como evidencia
 *
 * Lee dos fuentes, las que haya:
 *   ram-*.csv               scripts/measure-ram.ps1: la máquina entera y cada
 *                           servicio con sus procesos hijos (bases de datos,
 *                           IIS, worker de Go incluidos)
 *   runtime-metrics*.log    helpers/runtimeMetrics.js: cada proceso Node por
 *                           dentro (heap, event loop), para ver fugas
 *
 * El tamaño sale del PICO medido más el margen, no de la media: la máquina
 * tiene que aguantar el día de evento. Y por eso lo primero del informe es la
 * VENTANA: una semana tranquila subestima.
 *
 * Solo lee. No necesita .env ni bases de datos.
 */

const fs = require('fs');
const path = require('path');

const SIZES_GB = [1, 2, 4, 8, 16, 32, 64, 128, 256];
const VCPUS = [2, 4, 8, 16, 32, 64];
// Lo que se reserva para el sistema operativo cuando solo se suman los
// procesos de la aplicación (escenario "solo la app").
const OS_RESERVE_MB = 2048;

// ─── lectura ────────────────────────────────────────────────────────────────

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** Filas de un CSV de measure-ram.ps1 (con o sin la columna cores). */
function parseRamCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
    return {
      at: row.timestamp_utc,
      kind: row.kind,
      group: row.group,
      processes: num(row.processes),
      ws: num(row.working_set_mb),
      priv: num(row.private_mb),
      cpu: num(row.cpu_pct),
      total: num(row.total_mb),
      cores: num(row.cores),
    };
  });
}

/** Registros runtime_metrics de un runtime-metrics.log (una línea JSON cada uno). */
function parseRuntimeLog(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    try {
      const r = JSON.parse(line);
      if (r.type === 'runtime_metrics') out.push(r);
    } catch {}
  }
  return out;
}

// ─── estadística ────────────────────────────────────────────────────────────

const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
function stats(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return { n: 0, avg: null, p95: null, max: null };
  const pick = (q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
  return { n: v.length, avg: r1(v.reduce((a, b) => a + b, 0) / v.length), p95: r1(pick(0.95)), max: r1(v[v.length - 1]) };
}
const sizeUp = (mb) => SIZES_GB.find((gb) => gb * 1024 >= mb) ?? Math.ceil(mb / 1024);
const groupBy = (rows, key) => rows.reduce((m, r) => m.set(key(r), [...(m.get(key(r)) || []), r]), new Map());

const isApp = (g) => /^(Devitrak|UptimeKuma)/i.test(g);
const isDatabase = (g) => /^(MySQL|MariaDB|MongoDB|Redis|Memurai|MSSQL)/i.test(g);

// ─── resumen ────────────────────────────────────────────────────────────────

function summarizeRam(rows, runtime = [], { headroom = 0.3 } = {}) {
  const machine = rows.filter((r) => r.kind === 'MACHINE');
  const others = rows.filter((r) => r.kind !== 'MACHINE');
  const times = [...rows.map((r) => r.at), ...runtime.map((r) => r.timestamp)].filter(Boolean).sort();
  const hours = times.length > 1 ? (Date.parse(times[times.length - 1]) - Date.parse(times[0])) / 3.6e6 : 0;
  const days = new Set(times.map((t) => t.slice(0, 10))).size;

  const groups = [...groupBy(others, (r) => `${r.kind}|${r.group}`)].map(([k, list]) => {
    const [kind, group] = k.split('|');
    return { kind, group, samples: list.length, ws: stats(list.map((r) => r.ws)), private_max: stats(list.map((r) => r.priv)).max, cpu: stats(list.map((r) => r.cpu)) };
  });
  groups.sort((a, b) => (b.ws.p95 ?? 0) - (a.ws.p95 ?? 0));

  // Por instante: lo que suman la app y las bases de datos que vivan en la VM.
  const perInstant = (pred) => [...groupBy(others.filter((r) => r.kind === 'service' && pred(r.group)), (r) => r.at).values()]
    .map((list) => list.reduce((a, r) => a + (r.ws ?? 0), 0));
  const app = stats(perInstant(isApp));
  const databases = stats(perInstant(isDatabase));

  const total = machine.find((r) => r.total)?.total ?? null;
  const cores = machine.find((r) => r.cores)?.cores ?? null;
  const used = stats(machine.map((r) => r.ws));
  const cpu = stats(machine.map((r) => r.cpu));

  const ram = (peakMb, reserve = 0) => (peakMb == null ? null : { peak_mb: peakMb, needed_mb: Math.round(peakMb * (1 + headroom) + reserve), gb: sizeUp(peakMb * (1 + headroom) + reserve) });
  // vCPU con el p95 (no el máximo): un pico de CPU de un minuto encola, no tumba.
  const vcpu = (pct) => {
    if (pct == null || !cores) return null;
    const needed = (pct / 100) * cores * (1 + headroom);
    return VCPUS.find((n) => n >= needed) ?? Math.ceil(needed);
  };
  const sizing = {
    headroom,
    // Todo lo que hoy corre en la VM, tal cual (incluye SO, IIS y bases de datos locales).
    whole_machine: { ram: ram(used.max), vcpu: vcpu(cpu.p95) },
    // Solo los servicios de la app; las bases de datos irían a un servicio gestionado.
    app_only: app.n ? { ram: ram(app.max, OS_RESERVE_MB) } : null,
    databases_on_vm: databases.n ? { ram: ram(databases.max) } : null,
  };

  const roles = [...groupBy(runtime, (r) => r.role || '(sin rol)')].map(([role, list]) => {
    list.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    // Fuga: heap de la primera décima frente a la última, en MB por día.
    const tenth = Math.max(1, Math.floor(list.length / 10));
    const avgHeap = (l) => l.reduce((a, r) => a + (r.heap_used_mb ?? 0), 0) / l.length;
    const spanDays = (Date.parse(list[list.length - 1].timestamp) - Date.parse(list[0].timestamp)) / 8.64e7;
    const growth = list.length >= 20 && spanDays > 0 ? r1((avgHeap(list.slice(-tenth)) - avgHeap(list.slice(0, tenth))) / spanDays) : null;
    return {
      role,
      samples: list.length,
      processes: new Set(list.map((r) => r.pid)).size,
      rss: stats(list.map((r) => r.rss_mb)),
      heap_used: stats(list.map((r) => r.heap_used_mb)),
      heap_growth_mb_per_day: growth,
      cpu: stats(list.map((r) => r.cpu_pct)),
      loop_p99_max_ms: stats(list.map((r) => r.loop_p99_ms)).max,
    };
  });
  roles.sort((a, b) => a.role.localeCompare(b.role));

  return {
    window: { from: times[0] ?? null, to: times[times.length - 1] ?? null, hours: r1(hours), days_with_data: days, machine_samples: machine.length, runtime_samples: runtime.length },
    machine: { total_mb: total, cores, used_mb: used, cpu_pct: cpu, committed_max_mb: stats(machine.map((r) => r.priv)).max },
    app_mb: app,
    databases_mb: databases,
    groups,
    roles,
    sizing,
  };
}

// ─── salida ─────────────────────────────────────────────────────────────────

const f = (v) => (v == null ? '—' : String(v));
const s3 = (s) => `${f(s.avg)} / ${f(s.p95)} / ${f(s.max)}`;

function render(summary, { top = 15 } = {}) {
  const { window: w, machine: m, sizing } = summary;
  const out = [];
  out.push(`Ventana: ${f(w.from)} → ${f(w.to)} (${f(w.hours)} h, ${w.days_with_data} días con datos)`);
  out.push(`Muestras: ${w.machine_samples} de la máquina, ${w.runtime_samples} de procesos Node`);
  if (w.hours < 24 * 7) out.push('AVISO: menos de 7 días. Mide al menos una semana con un día de evento antes de decidir.');
  out.push('');
  if (w.machine_samples) {
    out.push(`Máquina: ${f(m.total_mb)} MB, ${f(m.cores)} núcleos`);
    out.push(`  RAM usada MB  media / p95 / máx: ${s3(m.used_mb)}   (comprometida máx ${f(m.committed_max_mb)})`);
    out.push(`  CPU %         media / p95 / máx: ${s3(m.cpu_pct)}`);
    if (summary.app_mb.n) out.push(`  App (Devitrak*) MB media / p95 / máx: ${s3(summary.app_mb)}`);
    if (summary.databases_mb.n) out.push(`  Bases de datos en la VM MB media / p95 / máx: ${s3(summary.databases_mb)}`);
    out.push('');
    out.push('Por servicio / proceso (working set MB y CPU % de la máquina: media / p95 / máx)');
    for (const g of summary.groups.slice(0, top)) {
      out.push(`  ${g.kind.padEnd(7)} ${g.group.padEnd(28)} RAM ${s3(g.ws).padEnd(26)} CPU ${s3(g.cpu)}`);
    }
    out.push('');
  }
  if (summary.roles.length) {
    out.push('Procesos Node por dentro (MB; heap creciente = posible fuga)');
    for (const r of summary.roles) {
      const growth = r.heap_growth_mb_per_day == null ? '' : `  heap ${r.heap_growth_mb_per_day > 0 ? '+' : ''}${r.heap_growth_mb_per_day} MB/día`;
      out.push(`  ${r.role.padEnd(16)} rss ${s3(r.rss).padEnd(24)} heap máx ${f(r.heap_used.max).padEnd(8)} loop p99 máx ${f(r.loop_p99_max_ms)} ms${growth}`);
    }
    out.push('');
  }
  out.push(`Dimensionado (pico × ${1 + sizing.headroom}, redondeado al tamaño estándar):`);
  const line = (label, s) => s?.ram && out.push(`  ${label.padEnd(38)} ${s.ram.gb} GB RAM (pico ${s.ram.peak_mb} MB → ${s.ram.needed_mb} MB)${s.vcpu ? `, ${s.vcpu} vCPU` : ''}`);
  line('Todo lo de la VM en una sola máquina:', sizing.whole_machine);
  line('Solo la app (BD en servicio gestionado):', sizing.app_only);
  line('Bases de datos que hoy viven en la VM:', sizing.databases_on_vm);
  return out.join('\n');
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function inputFiles(targets) {
  const files = [];
  for (const t of targets) {
    if (fs.existsSync(t) && fs.statSync(t).isDirectory()) {
      for (const name of fs.readdirSync(t)) {
        if (/^ram-.*\.csv$/.test(name) || /^runtime-metrics\d*\.log$/.test(name)) files.push(path.join(t, name));
      }
    } else if (fs.existsSync(t)) files.push(t);
  }
  return files;
}

function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const values = new Set([option('--headroom'), option('--top')].filter(Boolean));
  const targets = args.filter((a) => !a.startsWith('--') && !values.has(a));
  const files = inputFiles(targets.length ? targets : [path.join(__dirname, '..', 'logs')]);
  if (!files.length) {
    console.error('No hay ram-*.csv ni runtime-metrics*.log. Corre scripts/measure-ram.ps1 en la VM primero.');
    process.exit(2);
  }
  const rows = files.filter((p) => p.endsWith('.csv')).flatMap((p) => parseRamCsv(fs.readFileSync(p, 'utf8')));
  const runtime = files.filter((p) => !p.endsWith('.csv')).flatMap((p) => parseRuntimeLog(fs.readFileSync(p, 'utf8')));
  const headroom = option('--headroom') != null ? Number(option('--headroom')) : 0.3;
  const summary = summarizeRam(rows, runtime, { headroom });
  if (args.includes('--json')) console.log(JSON.stringify(summary, null, 2));
  else console.log(render(summary, { top: Number(option('--top')) || 15 }));
}

if (require.main === module) main();

module.exports = { parseRamCsv, parseRuntimeLog, summarizeRam, render, sizeUp };
