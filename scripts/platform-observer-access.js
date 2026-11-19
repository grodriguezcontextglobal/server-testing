'use strict';

/**
 * `platform_observer` — quien puede entrar al console de plataforma (DC1 §2.1).
 *
 * El console lee datos de TODOS los clientes, asi que su lista de operadores es
 * la lista mas sensible del sistema. Se administra desde aqui y no desde una
 * pantalla a proposito: una pantalla para repartir este flag es una pantalla que
 * alguien usa sin pensarlo.
 *
 * El gate (middlewares/requirePlatformConsole.js) pide CINCO cosas a la vez, y
 * este script las enseña todas porque tener el flag no es lo mismo que poder
 * entrar:
 *
 *     platform_observer === true
 *     active !== false
 *     correo @devitrak.com exacto
 *     estar en PLATFORM_CONSOLE_ALLOWLIST (helpers/platformAccess.js)
 *     mfaEnabled === true
 *
 * DOS FORMAS DE QUITAR EL ACCESO, y hacen cosas distintas:
 *
 *   - Borrar la linea de PLATFORM_CONSOLE_ALLOWLIST: pierde el console y
 *     conserva `/api/metrics`. Es lo que se hizo el 2026-11-18 con las dos
 *     cuentas que tenian el flag desde antes.
 *   - `--revoke`: pierde las dos, porque quita el flag.
 *
 *   node scripts/platform-observer-access.js --list
 *       Quien tiene el flag hoy, y si de verdad entraria o que le falta.
 *
 *   node scripts/platform-observer-access.js --candidates
 *       Los operadores de PLATFORM_CONSOLE_ALLOWLIST y que le falta a cada uno
 *       para poder entrar — empezando por si la cuenta existe. Marca con
 *       (EXTERNAL) toda compañia suya que no este en PLATFORM_INTERNAL_COMPANIES
 *       y las lista aparte. Al final, las cuentas @devitrak.com que NO estan en
 *       la lista. Solo lee.
 *
 * UNA SEXTA COSA, que el gate no mira: para CONCEDER el flag, todas las
 * compañias del operador tienen que estar en PLATFORM_INTERNAL_COMPANIES. Un
 * operador puede tener compañia —no hay forma de crear una cuenta sin ella— pero
 * nunca la de un cliente real. Se comprueba al conceder y no en cada peticion;
 * la deriva posterior la enseña `--candidates`.
 *
 *   node scripts/platform-observer-access.js --company-ids
 *       Los ids de las compañias en las que figuran los operadores, para poblar
 *       PLATFORM_INTERNAL_COMPANIES. Solo lee.
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

const {
  evaluatePlatformAccess,
  isPlatformDomain,
  isAllowedOperator,
  isInternalCompany,
  PLATFORM_DOMAIN,
  PLATFORM_CONSOLE_ALLOWLIST,
  PLATFORM_INTERNAL_COMPANIES,
  GRANT_DENY_REASONS,
} = require('../helpers/platformAccess');

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
 *
 * `notOperator` SI impide la concesion. Este script existe para dar de alta
 * operadores del console, y a quien no esta en la lista cerrada el flag no le
 * sirve para eso: solo le daria `/api/metrics`, que es una concesion distinta y
 * merece hacerse a sabiendas y no de paso. Para eso, primero su linea en
 * PLATFORM_CONSOLE_ALLOWLIST.
 *
 * `notInternalCompany` TAMBIEN impide la concesion (peticion del dashboard,
 * 2026-11-19). Un operador puede pertenecer a una compañia —no hay forma de
 * crear una cuenta sin ella— pero nunca a la de un cliente real, porque entonces
 * la misma persona aparece en el rastro de auditoria con dos identidades. Que
 * una compañia sea interna lo dice PLATFORM_INTERNAL_COMPANIES y nada mas.
 *
 * @param companiesByUserId Map(String(_id) -> [{id, name}]). OBLIGATORIO: sin el
 *   no se puede comprobar la regla, y una comprobacion que se salta sola cuando
 *   falta un dato no es una comprobacion. Se lanza en vez de pasar de largo.
 */
function grantPlan(accounts, requested, companiesByUserId) {
  const wanted = [...new Set(requested.map(normalize).filter(Boolean))];
  if (!wanted.length) throw new Error('--grant needs at least one email');
  if (!(companiesByUserId instanceof Map)) {
    throw new Error('grantPlan needs the company memberships to check PLATFORM_INTERNAL_COMPANIES');
  }

  const byEmail = new Map(accounts.map((a) => [normalize(a.email), a]));
  const out = {
    grant: [], missing: [], already: [], inactive: [],
    wrongDomain: [], notOperator: [], notInternalCompany: [], noMfa: [],
  };

  for (const email of wanted) {
    const account = byEmail.get(email);
    if (!account) { out.missing.push(email); continue; }
    if (!isPlatformDomain(account.email)) { out.wrongDomain.push(email); continue; }
    if (!isAllowedOperator(account.email)) { out.notOperator.push(email); continue; }

    // Cero compañias se permite: es el caso que el dashboard preferia y que hoy
    // no se puede crear. Lo que se rechaza es pertenecer a una que no sea
    // interna, no pertenecer a alguna.
    const memberships = companiesByUserId.get(String(account._id)) || [];
    const external = memberships.filter((c) => !isInternalCompany(c.id));
    if (external.length) {
      out.notInternalCompany.push({ email, companies: external.map((c) => c.name) });
      continue;
    }

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

/**
 * En que compañias figura esta cuenta como empleada. Devuelve `{id, name}` y no
 * solo el nombre: el nombre es para que lo lea una persona, el id es con lo que
 * se compara contra PLATFORM_INTERNAL_COMPANIES. Comparar por nombre seria
 * exactamente la regla fragil que la lista de ids existe para evitar.
 */
function clientCompaniesOf(companies, user) {
  const uid = String(user._id ?? '');
  const email = normalize(user.email);
  const out = new Map();
  for (const c of companies) {
    for (const e of c.employees || []) {
      const match = (e.userId != null && String(e.userId) === uid) || normalize(e.user) === email;
      if (match) out.set(String(c._id), { id: String(c._id), name: c.company_name || String(c._id) });
    }
  }
  return [...out.values()];
}

/** Como se enseña una compañia en las tablas: nombre, y si cuenta como interna. */
const describeCompany = (c) => `${c.name}${isInternalCompany(c.id) ? '' : ' (EXTERNAL)'}`;

async function main() {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const { dbConnection } = require('../database/config');
  await dbConnection();
  const AdminUser = require('../models/AdminUser');
  const Company = require('../models/Company');

  const SELECT = 'email name lastName active mfaEnabled platform_observer super_user lastLoginAt';
  const ALLOWLIST_EMAILS = PLATFORM_CONSOLE_ALLOWLIST.map(normalize);

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
            client_companies:
              (memberships.get(String(u._id)) || []).map(describeCompany).join(', ') || '-',
          }))
          .sort((a, b) => a.email.localeCompare(b.email))
      );
      const able = observers.filter((u) => blockedBy(u) === '-').length;
      console.log(`${observers.length} platform_observer account(s); ${able} can actually enter the console`);
      return;
    }

    // Para poblar PLATFORM_INTERNAL_COMPANIES: los ids de las compañias en las
    // que figuran los operadores de la lista. Es lo unico que hace falta copiar,
    // y se mira una vez: la lista no se descubre sola a proposito.
    if (process.argv.includes('--company-ids')) {
      const listed = await AdminUser.find({ email: { $in: [...ALLOWLIST_EMAILS] } })
        .select(SELECT).lean();
      const memberships = await withCompanies(listed);
      const seen = new Map();
      for (const u of listed) {
        for (const c of memberships.get(String(u._id)) || []) {
          if (!seen.has(c.id)) seen.set(c.id, { ...c, members: [] });
          seen.get(c.id).members.push(u.email);
        }
      }
      if (!seen.size) {
        console.log('no operator belongs to any company');
        return;
      }
      console.table(
        [...seen.values()].map((c) => ({
          company_id: c.id,
          company_name: c.name,
          internal: isInternalCompany(c.id),
          operators: c.members.join(', '),
        }))
      );
      console.log(
        'Copy the id of each INTERNAL company into PLATFORM_INTERNAL_COMPANIES ' +
          '(helpers/platformAccess.js). A company that is a real client does NOT go in: ' +
          'that operator should not be one.'
      );
      return;
    }

    if (process.argv.includes('--candidates')) {
      // La lista cerrada manda, asi que esto ya no es "quien podria ser
      // operador" sino "que le falta a cada operador de la lista para poder
      // entrar". Suele faltar algo: la cuenta misma.
      const listed = await AdminUser.find({ email: { $in: [...ALLOWLIST_EMAILS] } })
        .select(SELECT).lean();
      const byEmail = new Map(listed.map((u) => [normalize(u.email), u]));
      const memberships = await withCompanies(listed);

      console.table(
        PLATFORM_CONSOLE_ALLOWLIST.map((email) => {
          const u = byEmail.get(normalize(email));
          if (!u) {
            return {
              email, account: false, active: '-', mfa: '-', observer: '-',
              would_enter: false, missing: 'the AdminUser account does not exist',
              client_companies: '-',
            };
          }
          const verdict = evaluatePlatformAccess(u);
          return {
            email,
            account: true,
            active: u.active !== false,
            mfa: u.mfaEnabled === true,
            observer: u.platform_observer === true,
            would_enter: verdict.ok,
            missing: verdict.ok ? '-' : verdict.reason,
            client_companies:
              (memberships.get(String(u._id)) || []).map(describeCompany).join(', ') || '-',
          };
        })
      );

      const ready = PLATFORM_CONSOLE_ALLOWLIST.filter((email) => {
        const u = byEmail.get(normalize(email));
        return u && evaluatePlatformAccess(u).ok;
      }).length;
      console.log(
        `${PLATFORM_CONSOLE_ALLOWLIST.length} operator(s) on the allow-list; ${ready} can enter the console today`
      );
      console.log(
        'client_companies matters: an operator who is also a client employee mixes two identities in the audit trail.'
      );

      // La deriva que la comprobacion al conceder no puede cubrir: a un operador
      // ya concedido lo meten despues en la compañia de un cliente. Nada lo
      // vuelve a mirar solo, asi que se mira aqui.
      const drifted = listed
        .map((u) => ({
          email: u.email,
          external: (memberships.get(String(u._id)) || []).filter((c) => !isInternalCompany(c.id)),
        }))
        .filter((x) => x.external.length);
      if (drifted.length) {
        console.log(
          `\nOPERATORS IN A COMPANY THAT IS NOT INTERNAL (${PLATFORM_INTERNAL_COMPANIES.length} id(s) listed):`
        );
        for (const x of drifted) {
          console.log(`  ${x.email}: ${x.external.map((c) => c.name).join(', ')}`);
        }
        console.log(
          '  Either the company belongs in PLATFORM_INTERNAL_COMPANIES (helpers/platformAccess.js),\n' +
            '  or this operator should not be one. A grant would be refused today; an existing one is not undone by itself.'
        );
      }

      // Una cuenta @devitrak.com que NO esta en la lista no entra, pero conviene
      // verla: o sobra la cuenta, o falta su linea en la lista.
      const all = await AdminUser.find({}).select('email active').lean();
      const strays = all
        .filter((u) => isPlatformDomain(u.email) && !isAllowedOperator(u.email))
        .map((u) => u.email);
      if (strays.length) {
        console.log(`\n@${PLATFORM_DOMAIN} accounts NOT on the allow-list (they cannot enter): ${strays.join(', ')}`);
      }
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
        const plan = grantPlan(accounts, emails, await withCompanies(accounts));
        for (const e of plan.missing) console.log(`  skip ${e}: no such account`);
        for (const e of plan.wrongDomain) console.log(`  skip ${e}: not an @${PLATFORM_DOMAIN} account`);
        for (const e of plan.notOperator) {
          console.log(`  skip ${e}: not in PLATFORM_CONSOLE_ALLOWLIST (helpers/platformAccess.js) — add the line first`);
        }
        for (const x of plan.notInternalCompany) {
          console.log(
            `  skip ${x.email}: ${GRANT_DENY_REASONS.COMPANY_NOT_INTERNAL} — ` +
              `member of ${x.companies.join(', ')}. ` +
              'An operator may belong to an internal company, never to a client\'s. Add the id to ' +
              'PLATFORM_INTERNAL_COMPANIES (helpers/platformAccess.js) if it is internal.'
          );
        }
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
      'usage: --list | --candidates | --company-ids | --grant a@devitrak.com,... | --revoke a@devitrak.com,...  ' +
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
