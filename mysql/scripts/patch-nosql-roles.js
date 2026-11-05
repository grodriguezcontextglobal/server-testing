// scripts/patch-nosql-roles.js
// Normaliza los campos role/roleType de todos los employees en MongoDB.
// Ejecutar DESPUÉS de migrate-roles.js, con --dry-run primero.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true })
const { MongoClient } = require('mongodb')

const { VALID_ROLE_TYPES } = require('../constants/roles')

const OLD_ROLE_MAP = {
  '0': 'root_admin',
  '1': 'admin',
  '3': 'assistant',
  '4': 'assistant',
}

const NEW_ROLE_LEVELS = {
  root_admin: 0, admin: 1, sale_manager: 2,
  event_manager: 3, inventory_manager: 4, assistant: 5,
}

function inferRoleType2(emp) {
  const hasLocations = (emp.preference?.managerLocation?.length ?? 0) > 0
  return hasLocations ? 'inventory_manager' : 'event_manager'
}

function resolveEmployeeRoleType(emp) {
  if (emp.roleType && VALID_ROLE_TYPES.has(emp.roleType)) return emp.roleType
  if (String(emp.role ?? '') === '2') return inferRoleType2(emp)
  return OLD_ROLE_MAP[String(emp.role ?? '')] ?? 'assistant'
}

async function patchNosql(dryRun = true) {
  const mongo = await MongoClient.connect(process.env.DB_CNN)
  const db    = mongo.db()

  const companies = await db.collection('companies').find({}).toArray()

  let updated = 0, skipped = 0

  for (const company of companies) {
    const updatedEmployees = (company.employees ?? []).map(emp => {
      const roleType = resolveEmployeeRoleType(emp)
      const newRole  = String(NEW_ROLE_LEVELS[roleType])

      if (emp.roleType === roleType && String(emp.role) === newRole) {
        skipped++
        return emp
      }

      updated++
      return { ...emp, role: newRole, roleType }
    })

    if (!dryRun) {
      await db.collection('companies').updateOne(
        { _id: company._id },
        { $set: { employees: updatedEmployees } }
      )
    }
  }

  console.log(`\nResumen patch MongoDB:`)
  console.log(`  Registros actualizados: ${updated}`)
  console.log(`  Registros sin cambios:  ${skipped}`)

  if (dryRun) console.log('  (dry run — no se escribió nada)')
  else        console.log('  ✓ Patch completado.')

  await mongo.close()
}

patchNosql(process.argv.includes('--dry-run'))
