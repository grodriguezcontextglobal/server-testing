'use strict';

/**
 * Cobertura de MFA de las cuentas de staff (FedRAMP A5 · IA-2, AC-2).
 *
 *   node scripts/mfa-coverage.js           # solo números, global y por compañía
 *   node scripts/mfa-coverage.js --list    # además, los emails de cuentas activas sin MFA
 *
 * Solo lee. Con MFA obligatoria una cuenta sin MFA no puede entrar, pero sigue
 * existiendo: o nunca entró desde el 2026-10-05, o es una cuenta abandonada que
 * habría que desactivar (AC-2). Este informe es la evidencia de las dos cosas.
 *
 * "Con MFA" es mfaEnabled Y un secreto guardado: es lo mismo que exige el login
 * (una cuenta con mfaEnabled sin secreto vuelve a enrolarse).
 *
 * Salida: exit 0 si todas las cuentas activas tienen MFA, exit 1 si no — para
 * poder colgarlo de un cron.
 */

const LIST = process.argv.includes('--list');

// ─── Lógica pura (sin DB), exportada para el test ───────────────────────────

const hasMfa = (u) => Boolean(u.mfaEnabled && u.mfaSecret && u.mfaSecret.base32);
const isActive = (u) => u.active !== false;

function summarize(users) {
  const active = users.filter(isActive);
  const withMfa = active.filter(hasMfa);
  return {
    total: users.length,
    inactive: users.length - active.length,
    active: active.length,
    withMfa: withMfa.length,
    withoutMfa: active.length - withMfa.length,
    // Con MFA pero sin códigos: se activó antes de que existieran, o los gastó
    // todos. Si pierde el teléfono, solo le queda el reset de un administrador.
    withMfaNoRecoveryCodes: withMfa.filter((u) => !(u.mfaRecoveryCodes || []).length).length,
    withoutMfaEmails: active.filter((u) => !hasMfa(u)).map((u) => u.email).sort(),
  };
}

/** Por compañía: miembros activos (Company.employees) cruzados con su cuenta. */
function byCompany(companies, users) {
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const byEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), u]));
  return companies
    .map((c) => {
      const members = (c.employees || [])
        .filter((e) => e.active !== false)
        .map((e) => (e.userId && byId.get(String(e.userId))) || byEmail.get(String(e.user || '').toLowerCase()))
        .filter((u) => u && isActive(u));
      const unique = [...new Map(members.map((u) => [String(u._id), u])).values()];
      const withMfa = unique.filter(hasMfa).length;
      return { company: c.company_name || String(c._id), members: unique.length, withMfa, withoutMfa: unique.length - withMfa };
    })
    .filter((r) => r.members > 0)
    .sort((a, b) => b.withoutMfa - a.withoutMfa || a.company.localeCompare(b.company));
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '-');

async function main() {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const { dbConnection } = require('../database/config');
  await dbConnection();

  const db = mongoose.connection.db;
  // Directo a la colección: el modelo oculta mfaSecret y mfaRecoveryCodes.
  // Solo se proyecta si existen, nunca su valor.
  const users = await db
    .collection('adminusers')
    .aggregate([
      {
        $project: {
          email: 1,
          active: 1,
          mfaEnabled: 1,
          mfaSecret: { $cond: [{ $ifNull: ['$mfaSecret.base32', false] }, { base32: true }, null] },
          mfaRecoveryCodes: { $ifNull: ['$mfaRecoveryCodes', []] },
        },
      },
    ])
    .toArray();
  const companies = await db
    .collection('companies')
    .find({}, { projection: { company_name: 1, 'employees.user': 1, 'employees.userId': 1, 'employees.active': 1 } })
    .toArray();

  const s = summarize(users);
  console.log(`Cuentas de staff: ${s.total} (${s.inactive} inactivas)`);
  console.log(`Activas:          ${s.active}`);
  console.log(`  con MFA:        ${s.withMfa} (${pct(s.withMfa, s.active)})`);
  console.log(`  sin MFA:        ${s.withoutMfa}`);
  console.log(`  con MFA y sin códigos de recuperación: ${s.withMfaNoRecoveryCodes}`);
  console.log('\nPor compañía (miembros activos):');
  for (const r of byCompany(companies, users)) {
    console.log(`  ${r.company}: ${r.withMfa}/${r.members} con MFA${r.withoutMfa ? ` · ${r.withoutMfa} sin` : ''}`);
  }
  if (LIST && s.withoutMfaEmails.length) {
    console.log('\nActivas sin MFA:');
    for (const e of s.withoutMfaEmails) console.log(`  ${e}`);
  }

  await mongoose.disconnect();
  process.exit(s.withoutMfa ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(2);
  });
}

module.exports = { summarize, byCompany, hasMfa };
