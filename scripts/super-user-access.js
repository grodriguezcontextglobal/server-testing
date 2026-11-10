'use strict';

/**
 * super_user de plataforma (AC-2, AC-6; 2026-11-10).
 *
 * `AdminUser.super_user` NO es un rol de compañía: middlewares/
 * authorizeMongoPermission.js se salta toda la autorización con él, en todas
 * las compañías. El informe del 2026-11-09 encontró 22 de 47 cuentas con el
 * flag; ningún flujo actual lo escribe (el registro solo marca al dueño en
 * Company.employees), así que venía de la antigua asignación masiva de campos
 * o de cambios a mano.
 *
 *   node scripts/super-user-access.js --list
 *       Las cuentas con super_user. Solo lee.
 *
 *   node scripts/super-user-access.js --revoke a@x.com,b@y.com --by <super_user email> [--dry-run]
 *       Quita el flag a esas cuentas. tokenVersion + 1 (la sesión que tengan
 *       abierta deja de valer y la siguiente ya entra sin él) y una fila
 *       REVOKE por cuenta en el audit trail. Se niega si --by está en la lista
 *       o si con el cambio no quedaría ningún super_user.
 *
 *   node scripts/super-user-access.js --grant a@x.com,b@y.com --by <super_user email> [--dry-run]
 *       Da el flag a esas cuentas (tienen que existir y estar activas). Una
 *       fila GRANT por cuenta en el audit trail. El flag vale desde su
 *       siguiente petición: authorizeMongoPermission lo lee de la base.
 *
 *   node scripts/super-user-access.js --only a@x.com,b@y.com --domain contextglobal.com --by <super_user email> [--dry-run]
 *       Dentro de UN dominio, deja exactamente esas cuentas como super_user: se
 *       lo da a las que no lo tienen y se lo quita a las demás DE ESE DOMINIO.
 *       Las cuentas de otros dominios (clientes, Gmail) no se tocan: su
 *       super_user lo configura quien administra la cuenta del cliente.
 *       --domain es obligatorio y todas las de la lista tienen que ser de él;
 *       --by tiene que estar en la lista.
 *
 *   node scripts/super-user-access.js --only a@x.com,b@y.com --all-domains --by <super_user email> [--dry-run]
 *       Igual, pero en TODAS las cuentas: solo las de la lista quedan con el
 *       bypass de plataforma (2026-11-10: AdminUser.super_user da acceso a
 *       todas las compañías). No toca Company.employees[].super_user: quien
 *       administra una compañía sigue siéndolo dentro de ella. Cada revoke
 *       muestra el rol que la cuenta conserva en sus compañías.
 */

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const normalize = (e) => String(e || '').trim().toLowerCase();

/**
 * Decide qué se revoca, sin tocar la base (testeable).
 * @param superUsers [{ _id, email }] cuentas que HOY tienen super_user
 * @param requested  emails pedidos
 * @param byEmail    quién lo hace
 * @returns {{ revoke: object[], notSuperUser: string[] }}
 */
function revokePlan(superUsers, requested, byEmail) {
  const wanted = [...new Set(requested.map(normalize).filter(Boolean))];
  if (!wanted.length) throw new Error('--revoke needs at least one email');
  const by = normalize(byEmail);
  if (wanted.includes(by)) throw new Error(`--by ${byEmail} is in the revoke list`);
  const byEmailMap = new Map(superUsers.map((u) => [normalize(u.email), u]));
  if (!byEmailMap.has(by)) throw new Error(`${byEmail} is not a super_user`);
  const revoke = wanted.filter((e) => byEmailMap.has(e)).map((e) => byEmailMap.get(e));
  const notSuperUser = wanted.filter((e) => !byEmailMap.has(e));
  if (superUsers.length - revoke.length < 1) throw new Error('no super_user would be left');
  return { revoke, notSuperUser };
}

/**
 * Decide a quién se da el flag, sin tocar la base (testeable).
 * @param accounts   [{ _id, email, super_user, active }] las cuentas pedidas que existen
 * @param requested  emails pedidos
 * @param byEmail    quién lo hace (tiene que ser super_user)
 * @param superUsers [{ email }] los super_user de hoy
 * @returns {{ grant: object[], already: string[], missing: string[], inactive: string[] }}
 */
function grantPlan(accounts, requested, byEmail, superUsers) {
  const wanted = [...new Set(requested.map(normalize).filter(Boolean))];
  if (!wanted.length) throw new Error('--grant needs at least one email');
  if (!superUsers.some((u) => normalize(u.email) === normalize(byEmail))) {
    throw new Error(`${byEmail} is not a super_user`);
  }
  const byEmailMap = new Map(accounts.map((u) => [normalize(u.email), u]));
  const out = { grant: [], already: [], missing: [], inactive: [] };
  for (const e of wanted) {
    const u = byEmailMap.get(e);
    if (!u) out.missing.push(e);
    else if (u.super_user) out.already.push(e);
    else if (u.active === false) out.inactive.push(e);
    else out.grant.push(u);
  }
  return out;
}

/**
 * --only: el conjunto final de super_user dentro de un dominio (testeable).
 * @returns {{ grant: object[], revoke: object[], missing: string[], inactive: string[] }}
 */
function onlyPlan(accounts, keepList, byEmail, superUsers, domain) {
  const dom = normalize(domain).replace(/^@/, '');
  if (!dom) throw new Error('--only needs --domain <domain> or --all-domains');
  const inDomain = (e) => dom === '*' || normalize(e).endsWith(`@${dom}`);
  const keep = [...new Set(keepList.map(normalize).filter(Boolean))];
  if (!keep.length) throw new Error('--only needs at least one email');
  const outside = keep.filter((e) => !inDomain(e));
  if (outside.length) throw new Error(`--only accounts must be @${dom} (${outside.join(', ')})`);
  if (!keep.includes(normalize(byEmail))) throw new Error(`--by ${byEmail} must be in the --only list`);
  const g = grantPlan(accounts, keep, byEmail, superUsers);
  if (g.missing.length || g.inactive.length) {
    throw new Error(
      `every --only account must exist and be active (missing: ${g.missing.join(', ') || '-'}; ` +
        `disabled: ${g.inactive.join(', ') || '-'})`
    );
  }
  const revoke = superUsers.filter((u) => inDomain(u.email) && !keep.includes(normalize(u.email)));
  return { grant: g.grant, revoke, missing: g.missing, inactive: g.inactive };
}

/**
 * El rol que una cuenta tiene en cada compañía (Company.employees), que NO
 * cambia al quitarle el super_user de plataforma (testeable).
 * @param companies [{ company_name, employees: [{ user, userId, super_user, roleType, active }] }]
 * @returns string[] p. ej. ['Invoxia: super_user', 'Acme: manager (inactive)']
 */
function companyRolesOf(companies, user) {
  const uid = String(user._id ?? '');
  const email = normalize(user.email);
  const out = [];
  for (const c of companies) {
    for (const e of c.employees || []) {
      const match = (e.userId != null && String(e.userId) === uid) || normalize(e.user) === email;
      if (!match) continue;
      const role = e.super_user ? 'super_user' : e.roleType || 'no role';
      out.push(`${c.company_name || c._id}: ${role}${e.active === false ? ' (inactive)' : ''}`);
    }
  }
  return out;
}

async function main() {
  require('dotenv').config({ quiet: true });
  const mongoose = require('mongoose');
  const { dbConnection } = require('../database/config');
  await dbConnection();
  const AdminUser = require('../models/AdminUser');

  try {
    const superUsers = await AdminUser.find({ super_user: true })
      .select('email name lastName active lastLoginAt')
      .lean();

    if (process.argv.includes('--list')) {
      console.table(
        superUsers
          .map((u) => ({
            email: u.email,
            name: `${u.name || ''} ${u.lastName || ''}`.trim(),
            active: u.active !== false,
            last_login: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 10) : '-',
          }))
          .sort((a, b) => a.email.localeCompare(b.email))
      );
      console.log(`${superUsers.length} super_user account(s)`);
      return;
    }

    const dryRun = process.argv.includes('--dry-run');
    const byEmail = arg('--by');
    const actorOf = () => superUsers.find((u) => normalize(u.email) === normalize(byEmail));
    const accountsFor = (emails) =>
      AdminUser.find({ email: { $in: emails } }).select('email super_user active').lean();

    // Escribe y audita. Grant primero y revoke después, así nunca hay un
    // momento sin super_user. Revoke sube tokenVersion: la sesión abierta cae.
    const apply = async ({ grant = [], revoke = [] }) => {
      const { logStaffActivity } = require('../controller/staffActivityLog');
      const actor = actorOf();
      let saved = 0;
      const steps = [
        ...grant.map((u) => ({
          u, action: 'GRANT', from: false, to: true,
          filter: { _id: u._id, super_user: { $ne: true }, active: { $ne: false } },
          update: { $set: { super_user: true } },
        })),
        ...revoke.map((u) => ({
          u, action: 'REVOKE', from: true, to: false,
          filter: { _id: u._id, super_user: true },
          update: { $set: { super_user: false }, $inc: { tokenVersion: 1 } },
        })),
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
          details: { field: 'super_user', from: s.from, to: s.to, email: s.u.email, script: 'super-user-access' },
        });
      }
      console.log(`Saved: ${saved}`);
    };
    const summary = (grant, revoke) =>
      console.log(
        `${grant.length} to grant, ${revoke.length} to revoke; ` +
          `${superUsers.length + grant.length - revoke.length} super_user(s) after` +
          (dryRun ? ' (dry run, nothing saved)' : '')
      );

    const mode = ['--only', '--grant', '--revoke'].find((m) => arg(m));
    if (mode) {
      if (!byEmail) throw new Error('--by <super_user email> is required');
      const emails = arg(mode).split(',').map(normalize).filter(Boolean);
      let grant = [];
      let revoke = [];
      if (mode === '--revoke') {
        const plan = revokePlan(superUsers, emails, byEmail);
        for (const e of plan.notSuperUser) console.log(`  skip ${e}: not a super_user (or no such account)`);
        revoke = plan.revoke;
      } else if (mode === '--grant') {
        const plan = grantPlan(await accountsFor(emails), emails, byEmail, superUsers);
        for (const e of plan.missing) console.log(`  skip ${e}: no such account`);
        for (const e of plan.already) console.log(`  skip ${e}: already a super_user`);
        for (const e of plan.inactive) console.log(`  skip ${e}: account is disabled (reactivate it first)`);
        grant = plan.grant;
      } else {
        const domain = process.argv.includes('--all-domains') ? '*' : arg('--domain');
        const plan = onlyPlan(await accountsFor(emails), emails, byEmail, superUsers, domain);
        grant = plan.grant;
        revoke = plan.revoke;
        const scope = domain === '*' ? 'all domains' : `@${normalize(domain).replace(/^@/, '')} only`;
        console.log(`  keep (${scope}): ${emails.join(', ')}`);
      }
      for (const u of grant) console.log(`  grant  ${u.email}`);
      if (revoke.length) {
        // Lo que cada cuenta conserva: su rol dentro de sus compañías.
        const Company = require('../models/Company');
        const companies = await Company.find({
          $or: [
            { 'employees.userId': { $in: revoke.map((u) => u._id) } },
            { 'employees.user': { $in: revoke.map((u) => u.email) } },
          ],
        })
          .select('company_name employees.user employees.userId employees.super_user employees.roleType employees.active')
          .lean();
        for (const u of revoke) {
          const roles = companyRolesOf(companies, u);
          console.log(`  revoke ${u.email}  -> keeps: ${roles.join('; ') || 'NO company membership'}`);
        }
      }
      summary(grant, revoke);
      if (dryRun || (!grant.length && !revoke.length)) return;
      await apply({ grant, revoke });
      return;
    }

    console.log(
      'usage: --list | --only a@x.com,b@y.com --domain x.com|--all-domains | --grant a@x.com,... | --revoke a@x.com,...  ' +
        '(all but --list need --by <super_user email>; add --dry-run to preview)'
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

module.exports = { revokePlan, grantPlan, onlyPlan, companyRolesOf };
