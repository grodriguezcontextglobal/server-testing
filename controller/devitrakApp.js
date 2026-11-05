const logger = require("../helpers/logger");
const DevitrakApp = require("../models/DevitrakApp");
const AdminUser = require("../models/AdminUser");

// Las dos rutas van sin sesión (la página de invitación las llama antes de que
// exista la cuenta), así que el body no es de fiar: FedRAMP A2 (2026-10-27).
const sameEmail = (a, b) =>
  typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

const acceptancePoliciesAndTermsApp = async (request, response) => {
  try {
    const { signature, email, documentsAndPolicies } = request.body || {};
    if (typeof signature !== "string" || typeof email !== "string" || !signature.trim() || !email.trim()) {
      return response.status(400).json({ ok: false, msg: "signature and email are required." });
    }

    const acceptanceFound = await DevitrakApp.exists({ email });
    if (acceptanceFound) {
      // Sin el registro: devolverlo dejaba leer la firma y la fecha de
      // aceptación de cualquiera con solo su email.
      return response.status(201).json({
        ok: true,
        msg: "Staff member already accepted platform's policies and terms.",
      });
    }
    // Solo los campos del modelo que pone el cliente; staff_id y date no
    // (antes `new DevitrakApp(request.body)` aceptaba los dos).
    const acceptance = new DevitrakApp({
      signature,
      email,
      documentsAndPolicies: Array.isArray(documentsAndPolicies)
        ? documentsAndPolicies.map(({ documentName, url } = {}) => ({
            documentName: String(documentName ?? ""),
            url: String(url ?? ""),
          }))
        : [],
    });
    await acceptance.save();
    return response
    .status(201)
    .json({ ok: true, msg: "Acceptance saved", acceptanceInfo: acceptance });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: "Internal server error",
    });
  }
};

// Ata la aceptación a la cuenta recién creada por la invitación. Sin sesión,
// lo único que lo prueba es la coherencia: la aceptación, el email y la cuenta
// tienen que ser del mismo email, y una aceptación ya atada no se reasigna.
// Antes cualquiera podía poner cualquier staff_id en cualquier aceptación.
const updateAcceptanceByAddingStaffMemberID = async (request, response) => {
  try {
    const { email, staff_id } = request.body || {};
    const [acceptance, staff] = await Promise.all([
      DevitrakApp.findById(request.params.id).catch(() => null),
      AdminUser.findById(staff_id).select("email").catch(() => null),
    ]);
    const consistent =
      acceptance && staff && sameEmail(acceptance.email, email) && sameEmail(staff.email, email);
    if (!consistent) {
      return response.status(404).json({ ok: false, msg: "Acceptance not found." });
    }
    if (acceptance.staff_id && String(acceptance.staff_id) !== String(staff._id)) {
      return response.status(409).json({ ok: false, msg: "Acceptance already linked to another account." });
    }
    await DevitrakApp.findByIdAndUpdate(acceptance._id, { staff_id: staff._id });
    return response.status(201).json({ ok: true, msg: "Acceptance updated" });
  } catch (error) {
    logger.error(error);
    response.status(500).json({
      ok: false,
      msg: "Internal server error",
    });
  }
};

module.exports = {
  acceptancePoliciesAndTermsApp,
  updateAcceptanceByAddingStaffMemberID,
};
