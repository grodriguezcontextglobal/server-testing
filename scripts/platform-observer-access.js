'use strict';

/**
 * `platform_observer` — quien puede entrar al console de plataforma (DC1 §2.1).
 *
 * El console lee datos de TODOS los clientes, asi que su lista de operadores es
 * la lista mas sensible del sistema. Se administra desde aqui y no desde una
 * pantalla a proposito: una pantalla para repartir este flag es una pantalla que
 * alguien usa sin pensarlo.
 *
 * El gate (middlewares/requirePlatformConsole.js) pide CUATRO cosas a la vez, y
 * este script las enseña todas porque tener el flag no es lo mismo que poder
 * entrar:
 *
 *     platform_observer === true
 *     active !== false
 *     correo @devitrak.com exacto
 *     mfaEnabled === true
 *
 *   node scripts/platform-observer-access.js --list
 *       Quien tiene el flag hoy, y si de verdad entraria o que le falta.
 *
 *   node scripts/platform-observer-access.js --candidates
 *       Las cuentas @devitrak.com que PODRIAN ser operadoras: estado, MFA y si
 *       ademas son empleadas de alguna compañia cliente. Es la lista con la que
 *       se decide quienes son los primeros operadores. Solo lee.
 *
 *   node scripts/platform-observer-access.js --grant a@devitrak.com,... --by <super_user email> [--dry-run]
 *   node scripts/platform-observer-access.js --revoke a@devitrak.com,... --by <super_user email> [--dry-run]
 *
 * `--by` es un `super_user` de plataforma, NO un `platform_observer`. Tiene que
 * ser asi: la primera concesion ocurre cuando todavia no hay ningun observer, y
 * un requisito que no se puede cumplir la primera vez no es un requisito, es un
 * punto muerto.
 *
 * NO hay regla de "no te quedes sin ninguno", al reves que en
 * super-user-access.js: cero operadores es un estado legitimo —es el estado de
 * hoy— y ademas es el estado seguro.
 *
 * Cada cambio deja dos rastros: una fila en el audit trail de staff y una fila
 * `access_change` en `platform_audit_log`, que es lo que pide DC2.
 */

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const normalize = (e) => String(e || '').trim().toLowerCase();

const { evaluatePlatformAccess, isPlatformDomain, PLATFORM_DOMAIN } = require('../helpers/platformAccess');

/**
 * Que le falta a una cuenta para entrar, en una palabra. '-' cuando no le falta
 * nada.
 */
const blockedBy = (user) => {
  const verdict = evaluatePlatformAccess(user);
  return verdict.ok ? '-' : verdict.reason;
};

/**
 * @param accounts  cuentas encontradas para los emails pedidos
 * @param requested emails pedidos
 * @returns {{grant: object[], missing: string[], already: string[], inactive: string[], wrongDomain: string[], noMfa: object[]}}
 *
 * `noMfa` NO impide la concesion: el flag y el segundo factor son dos cosas
 * distintas y quien administra cuentas puede querer dejar el flag puesto
 * mientras el operador configura su MFA. Pero se avisa en voz alta, porque una
 * cuenta con flag y sin MFA parece operativa en cualquier listado y no lo es.
 */
function grantPlan(accounts, requested) {
  const wanted = [...new Set(requested.map(normalize).filter(Boolean))];
  if (!wanted.length) throw new Error('--grant needs at least one email');

  const byEmail = new Map(accounts.map((a) => [normalize(a.email), a]));
  const out = { grant: [], missing: [], already: [], inactive: [], wrongDomain: [], noMfa: [] };

  for (const email of wanted) {
    const account = byEmail.get(email);
    if (!account) { out.missing.push(email); continue; }
    if (!isPlatformDomain(account.email)) { out.wrongDomain.push(email); continue; }
    if (account.active === false) { out.inactive.push(email); continue; }
    if (account.platform_observer === true) { out.already.push(email); continue; }
    if (account.mfaEnabled !== true) out.noMfa.push(account);
    out.grant.push(account);
  }
  return out;
}

/**
 * @param observers cuentas que HOY tienen el flag
 * @param requested emails pedidos
 * @returns {{revoke: object[], notObserver: string[]}}
 */
function revokePlan(observers, requested) {
  const wanted = [...new Set(requested.map(normalize).filter(Boolean))];
  if (!wanted.length) throw new Error('--revoke needs at least one email');

  const byEmail = new Map(observers.map((o) => [normalize(o.email), o]));
  const out = { revoke: [], notObserver: [] };
  for (const email of wanted) {
    const account = byEmail.get(email);
    if (!account) { out.notObserver.push(email); continue; }
    out.revoke.push(account);
  }
  return out;
}

/** En que compañias cliente figura esta cuenta como empleada. */
function clientCompaniesOf(companies, user) {
  const uid = String(user._id ?? '');
  const email = normalize(user.email);
  const out = [];
  for (const c of companies) {
    for (const e of c.employees || []) {
      const match = (e.userId != null && String(e.userId) === uid) || normalize(e.user) === email;
      if (match) out.push(c.company_name || String(c._id));
    }
  }
  return [...new Set(out)];
}

async function main() {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const { dbConnection } = require('../database/config');
  await dbConnection();
  const AdminUser = require('../models/AdminUser');
  const Company = require('../models/Company');

  const SELECT = 'email name lastName active mfaEnabled platform_observer super_user lastLoginAt';

  const withCompanies = async (users) => {
    if (!users.length) return new Map();
    const companies = await Company.find({
      $or: [
        { 'employees.userId': { $in: users.map((u) => u._id) } },
        { 'employees.user': { $in: users.map((u) => u.email) } },
      ],
    })
      .select('company_name employees.user employees.userId')
      .lean();
    return new Map(users.map((u) => [String(u._id), clientCompaniesOf(companies, u)]));
  };

  try {
    const observers = await AdminUser.find({ platform_observer: true }).select(SELECT).lean();

    if (process.argv.includes('--list')) {
      const memberships = await withCompanies(observers);
      console.table(
        observers
          .map((u) => ({
            email: u.email,
            active: u.active !== false,
            mfa: u.mfaEnabled === true,
            would_enter: blockedBy(u) === '-',
            blocked_by: blockedBy(u),
            client_companies: (memberships.get(String(u._id)) || []).join(', ') || '-',
          }))
          .sort((a, b) => a.email.localeCompare(b.email))
      );
      const able = observers.filter((u) => blockedBy(u) === '-').length;
      console.log(`${observers.length} platform_observer account(s); ${able} can actually enter the console`);
      return;
    }

    if (process.argv.includes('--candidates')) {
      // Todas las @devitrak.com: la lista con la que se eligen los operadores.
      // El filtro va en JS y no en la consulta porque el criterio de dominio es
      // "texto tras la ULTIMA arroba", no un sufijo, y debe ser el MISMO que
      // aplica el gate — si aqui se usara un $regex parecido pero no igual, la
      // lista mentiria.
      const all = await AdminUser.find({}).select(SELECT).lean();
      const candidates = all.filter((u) => isPlatformDomain(u.email));
      const memberships = await withCompanies(candidates);
      console.table(
        candidates
          .map((u) => ({
            email: u.email,
            name: `${u.name || ''} ${u.lastName || ''}`.trim(),
            active: u.active !== false,
            mfa: u.mfaEnabled === true,
            observer: u.platform_observer === true,
            last_login: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 10) : '-',
            client_companies: (memberships.get(String(u._id)) || []).join(', ') || '-',
          }))
          .sort((a, b) => a.email.localeCompare(b.email))
      );
      const noMfa = candidates.filter((u) => u.mfaEnabled !== true).length;
      console.log(
        `${candidates.length} @${PLATFORM_DOMAIN} account(s); ${noMfa} without MFA (those cannot enter the console until they set it up)`
      );
      console.log(
        'client_companies matters: an operator who is also a client employee mixes two identities in the audit trail.'
      );
      return;
    }

    const dryRun = process.argv.includes('--dry-run');
    const byEmail = arg('--by');
    const mode = ['--grant', '--revoke'].find((m) => arg(m));

    if (mode) {
      if (!byEmail) throw new Error('--by <super_user email> is required');
      const actor = await AdminUser.findOne({ email: normalize(byEmail) })
        .select('email super_user active')
        .lean();
      if (!actor) throw new Error(`--by ${byEmail}: no such account`);
      if (actor.super_user !== true) {
        throw new Error(`--by ${byEmail} is not a platform super_user`);
      }

      const emails = arg(mode).split(',').map(normalize).filter(Boolean);
      let grant = [];
      let revoke = [];

      if (mode === '--grant') {
        const accounts = await AdminUser.find({ email: { $in: emails } }).select(SELECT).lean();
        const plan = grantPlan(accounts, emails);
        for (const e of plan.missing) console.log(`  skip ${e}: no such account`);
        for (const e of plan.wrongDomain) console.log(`  skip ${e}: not an @${PLATFORM_DOMAIN} account`);
        for (const e of plan.inactive) console.log(`  skip ${e}: account is disabled (reactivate it first)`);
        for (const e of plan.already) console.log(`  skip ${e}: already a platform_observer`);
        for (const u of plan.noMfa) {
          console.log(`  WARNING ${u.email}: no MFA — the flag will be set but the console will still refuse this account`);
        }
        grant = plan.grant;
      } else {
        const plan = revokePlan(observers, emails);
        for (const e of plan.notObserver) console.log(`  skip ${e}: not a platform_observer (or no such account)`);
        revoke = plan.revoke;
      }

      for (const u of grant) console.log(`  grant  ${u.email}`);
      for (const u of revoke) console.log(`  revoke ${u.email}`);
      console.log(
        `${grant.length} to grant, ${revoke.length} to revoke; ` +
          `${observers.length + grant.length - revoke.length} platform_observer(s) after` +
          (dryRun ? ' (dry run, nothing saved)' : '')
      );
      if (dryRun || (!grant.length && !revoke.length)) return;

      const { logStaffActivity } = require('../controller/staffActivityLog');
      const { writePlatformAuditRow } = require('../helpers/platformAuditLog');
      let saved = 0;

      const steps = [
        ...grant.map((u) => ({ u, action: 'GRANT', to: true,
          filter: { _id: u._id, platform_observer: { $ne: true }, active: { $ne: false } },
          update: { $set: { platform_observer: true } } })),
        // El revoke NO sube tokenVersion, al reves que el de super_user, y no
        // hace falta: el gate lee el flag de la base en CADA peticion, asi que
        // el acceso se corta en la siguiente sin tocar la sesion. Subirlo
        // ademas echaria al operador del dashboard entero por quitarle un
        // permiso de solo lectura.
        ...revoke.map((u) => ({ u, action: 'REVOKE', to: false,
          filter: { _id: u._id, platform_observer: true },
          update: { $set: { platform_observer: false } } })),
      ];

      for (const s of steps) {
        const res = await AdminUser.updateOne(s.filter, s.update);
        if (!res.modifiedCount) continue;
        saved += 1;

        await logStaffActivity({
          staff_member_id: actor._id,
          actor_type: 'staff',
          action: s.action,
          target_model: 'AdminUser',
          target_id: String(s.u._id),
          details: {
            field: 'platform_observer', from: !s.to, to: s.to,
            email: s.u.email, script: 'platform-observer-access',
          },
        });

        // DC2: una fila `access_change` cada vez que alguien gana o pierde
        // acceso de plataforma. Si esta falla NO se deshace el cambio —ya esta
        // en Mongo—, pero se grita, porque un cambio de acceso sin registro es
        // justo lo que un evaluador busca.
        await writePlatformAuditRow({
          actorUserId: String(actor._id),
          actorEmail: actor.email,
          action: 'access_change',
          companyId: null,
          resource: 'scripts/platform-observer-access',
          details: { target: s.u.email, field: 'platform_observer', from: !s.to, to: s.to },
          result: 'allowed',
        }).catch((error) => {
          console.error(`  ERROR: ${s.u.email} changed but NOT recorded in platform_audit_log: ${error.message}`);
        });
      }
      console.log(`Saved: ${saved}`);
      return;
    }

    console.log(
      'usage: --list | --candidates | --grant a@devitrak.com,... | --revoke a@devitrak.com,...  ' +
        '(grant/revoke need --by <super_user email>; add --dry-run to preview)'
    );
    process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { grantPlan, revokePlan, clientCompaniesOf, blockedBy };
