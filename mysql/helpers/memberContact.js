// Regla de contacto de members_info. El schema no la impone (email y
// phone_number son NULL y sin UNIQUE), así que vive aquí y la aplican los tres
// caminos de escritura: insertNewMember, insertBulkMembers y updateMemberInfo.
//
//   - Adulto (minor distinto de 1, NULL incluido): email Y phone_number.
//   - Menor con email y teléfono propios: nada más.
//   - Menor al que le falta alguno: parent_guardian_email, que es a donde van
//     los recordatorios y con lo que el tutor se identifica.

const filled = (v) => v !== undefined && v !== null && String(v).trim() !== "";

const isMinorFlag = (v) =>
  v === true ||
  v === 1 ||
  ["1", "true", "yes", "y"].includes(String(v ?? "").toLowerCase().trim());

// Devuelve null si el member es válido, o { missing, msg } si no.
function memberContactProblem(member) {
  const m = member || {};
  const ownMissing = ["email", "phone_number"].filter((k) => !filled(m[k]));

  if (!isMinorFlag(m.minor)) {
    if (ownMissing.length === 0) return null;
    return {
      missing: ownMissing,
      msg: `Adult members require ${ownMissing.join(" and ")}.`,
    };
  }

  if (ownMissing.length === 0 || filled(m.parent_guardian_email)) return null;
  return {
    missing: ["parent_guardian_email"],
    msg: `Minors without their own ${ownMissing.join(" and ")} require parent_guardian_email.`,
  };
}

module.exports = { memberContactProblem, isMinorFlag, filled };
