'use strict';

/**
 * Resumen de las violaciones de CSP recibidas en POST /api/csp-report
 * (models/CspReport.js). Es la evidencia antes de pasar la CSP del dashboard
 * de Report-Only a enforce (SI-4, CM-7).
 *
 *   node scripts/summarize-csp-reports.js                # últimos 7 días
 *   node scripts/summarize-csp-reports.js --days 30 --top 20
 *   node scripts/summarize-csp-reports.js --json > logs/evidence/csp-YYYYMMDD.json
 *
 * Solo lee. Los informes se borran solos a los 30 días.
 */

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

// Agrupa por directiva + recurso bloqueado + página.
function summarize(reports, top = 15) {
  const groups = new Map();
  for (const r of reports) {
    const directive = r.effectiveDirective || r.violatedDirective || '?';
    const key = `${directive}\u0000${r.blockedUri || '?'}\u0000${r.documentUri || '?'}`;
    const g = groups.get(key) || {
      directive, blockedUri: r.blockedUri || '?', documentUri: r.documentUri || '?',
      count: 0, enforced: 0, first: r.createdAt, last: r.createdAt,
    };
    g.count += 1;
    if (r.disposition === 'enforce') g.enforced += 1;
    if (r.createdAt < g.first) g.first = r.createdAt;
    if (r.createdAt > g.last) g.last = r.createdAt;
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.count - a.count);
  return { total: reports.length, distinct: rows.length, top: rows.slice(0, top) };
}

async function main() {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const { dbConnection } = require('../database/config');
  await dbConnection();
  const CspReport = require('../models/CspReport');

  const days = Number(arg('--days', 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const reports = await CspReport.find({ createdAt: { $gte: since } }).lean();
  const s = summarize(reports, Number(arg('--top', 15)));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ since: since.toISOString(), days, ...s }, null, 2));
  } else {
    console.log(`Informes de CSP desde ${since.toISOString()} (${days} días): ${s.total}, ${s.distinct} distintos`);
    for (const g of s.top) {
      console.log(`  ${String(g.count).padStart(5)}  ${g.directive}  ${g.blockedUri}  en ${g.documentUri}`);
    }
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(2);
  });
}

module.exports = { summarize };
