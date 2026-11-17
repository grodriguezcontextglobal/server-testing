'use strict';

/**
 * El job `audit` del CI, con excepciones explícitas y con fecha (RA-5, SI-2).
 *
 * Hasta el 2026-11-17 el CI corría `npm audit --omit=dev --audit-level=high` a
 * secas. Ese día apareció GHSA-fc5q-39xc-vjpf (ReDoS en `picomatch`) y el check
 * se quedó rojo de forma permanente, porque el aviso **no tiene versión
 * corregida**: el rango afectado es `<=4.0.7` y la última publicada es 4.0.7.
 *
 * Un check que está siempre rojo deja de significar algo, y el día que llegue
 * un aviso alto de verdad nadie lo va a ver entre el ruido. Por eso aquí hay
 * una lista de avisos aceptados, cada uno con su motivo y **su fecha de
 * caducidad**: pasada esa fecha el check vuelve a ponerse rojo a propósito, para
 * que la excepción se revise en vez de quedarse para siempre.
 *
 * Aceptar un aviso NO es cerrarlo: cada entrada de abajo tiene su ficha en
 * docs/POAM_dependencias.md con el análisis y el plan.
 *
 *   node scripts/audit-check.js           # lo que corre el CI
 *   node scripts/audit-check.js --json    # el informe crudo de npm, sin filtrar
 *
 * Sale 1 si queda alguna vulnerabilidad alta o crítica sin aceptar, o si una
 * excepción caducó.
 */

const { execFileSync } = require('child_process');

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/**
 * Avisos aceptados. Cada uno: por qué no nos expone, y hasta cuándo vale la
 * excepción. `until` es la fecha de revisión del POA&M, no una promesa de que
 * el problema desaparezca solo.
 */
const ACCEPTED = [
  {
    id: 'GHSA-fc5q-39xc-vjpf',
    package: 'picomatch',
    poam: 'DEP-2026-004',
    until: '2027-02-15',
    why:
      'No hay version corregida (rango <=4.0.7, ultima publicada 4.0.7). Llega solo por ' +
      'pm2 -> anymatch/readdirp, que es el vigilante de ficheros de pm2: no usamos watch y ' +
      'ningun glob sale de una peticion. El downgrade que sugiere npm (pm2 7.0.4) arrastra ' +
      'chokidar 3.6.0 y el mismo picomatch, asi que no arregla nada.',
  },
];

/** Los avisos del informe de `npm audit --json` (v2), sin repetir. */
const advisoriesOf = (report) => {
  const found = new Map();
  for (const vulnerability of Object.values(report?.vulnerabilities || {})) {
    for (const via of vulnerability.via || []) {
      // Un `via` de texto es "me afecta a través de este otro paquete": el
      // aviso de verdad aparece como objeto en el paquete de origen.
      if (typeof via !== 'object' || !via.url) continue;
      const id = String(via.url).split('/').pop();
      if (!found.has(id)) {
        found.set(id, {
          id,
          package: via.name || vulnerability.name,
          severity: String(via.severity || vulnerability.severity || '').toLowerCase(),
          title: via.title || '',
          url: via.url,
        });
      }
    }
  }
  return [...found.values()];
};

/**
 * Clasifica los avisos: los que bloquean, los aceptados y los que bloquean
 * PORQUE su excepción caducó. Función pura, para poder probarla sin red.
 */
const evaluate = (report, accepted = ACCEPTED, today = new Date()) => {
  const byId = new Map(accepted.map((entry) => [entry.id, entry]));
  const blocking = [];
  const allowed = [];
  const expired = [];

  for (const advisory of advisoriesOf(report)) {
    if (!BLOCKING_SEVERITIES.has(advisory.severity)) continue;
    const exception = byId.get(advisory.id);
    if (!exception) {
      blocking.push(advisory);
      continue;
    }
    if (new Date(`${exception.until}T23:59:59Z`) < today) {
      expired.push({ ...advisory, exception });
      continue;
    }
    allowed.push({ ...advisory, exception });
  }

  return { blocking, allowed, expired };
};

const runNpmAudit = () => {
  const isWindows = process.platform === 'win32';
  try {
    // npm sale con código 1 cuando encuentra algo, que es justo el caso normal
    // aquí: el informe viene igualmente por stdout.
    //
    // `shell: true` en Windows no es cosmético: desde Node 18.20/20.12, spawn
    // se niega a ejecutar un `.cmd` sin shell (CVE-2024-27980) y falla con
    // EINVAL. En Linux, que es donde corre el CI, va sin shell.
    return execFileSync(isWindows ? 'npm.cmd' : 'npm', ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      shell: isWindows,
    });
  } catch (error) {
    if (error.stdout) return error.stdout;
    throw error;
  }
};

const main = () => {
  const raw = runNpmAudit();
  if (process.argv.includes('--json')) {
    process.stdout.write(raw);
    return 0;
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    console.error('audit-check: npm audit no devolvió JSON. Salida cruda:\n');
    console.error(raw.slice(0, 2000));
    return 1;
  }

  const { blocking, allowed, expired } = evaluate(report);

  for (const item of allowed) {
    console.log(`ACEPTADO  ${item.id}  ${item.package} (${item.severity})`);
    console.log(`          ${item.exception.poam}, revisión ${item.exception.until}`);
    console.log(`          ${item.exception.why}`);
  }
  for (const item of expired) {
    console.log(`CADUCADA  ${item.id}  ${item.package} (${item.severity})`);
    console.log(`          La excepción venció el ${item.exception.until}: toca revisar ${item.exception.poam}.`);
  }
  for (const item of blocking) {
    console.log(`BLOQUEA   ${item.id}  ${item.package} (${item.severity})`);
    console.log(`          ${item.title}`);
    console.log(`          ${item.url}`);
  }

  const failures = blocking.length + expired.length;
  if (failures === 0) {
    console.log(
      `audit-check: sin vulnerabilidades altas ni críticas sin aceptar` +
        (allowed.length ? ` (${allowed.length} aceptada(s) con fecha de revisión).` : '.'),
    );
    return 0;
  }

  console.log(
    `\naudit-check: ${failures} aviso(s) que el CI no acepta. ` +
      'Si hay que aceptarlo, va en ACCEPTED de este archivo CON fecha y con su ficha en docs/POAM_dependencias.md.',
  );
  return 1;
};

if (require.main === module) {
  process.exit(main());
}

module.exports = { evaluate, advisoriesOf, ACCEPTED, BLOCKING_SEVERITIES };
