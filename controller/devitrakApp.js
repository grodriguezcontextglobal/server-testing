const logger = require("../helpers/logger");
const DevitrakApp = require("../models/DevitrakApp");

const acceptancePoliciesAndTermsApp = async (request, response) => {
  console.log(request.body)
  const acceptanceFound = await DevitrakApp.find({
    email: request.body.email,
  });
  if (acceptanceFound.length > 0) {
    return response.status(201).json({
      ok: true,
      msg: "Staff member already accepted platform's policies and terms.",
    });
  }
  const acceptance = new DevitrakApp(request.body);
  await acceptance.save();
  return response
    .status(201)
    .json({ ok: true, msg: "Acceptance saved", acceptanceInfo: acceptance });
};

const updateAcceptanceByAddingStaffMemberID = async (request, response) => {
  try {
    const { email, staff_id } = request.body;
    const acceptanceFound = await DevitrakApp.find({
      email: email,
    });
    if (!acceptanceFound) {
      return response.status(201).json({
        ok: true,
        msg: "Staff member has not accepted platform's policies and terms.",
      });
    }
    const updatedAcceptance = {
      ...acceptanceFound,
      staff_id: staff_id,
    };
    await DevitrakApp.findByIdAndUpdate(request.params.id, updatedAcceptance, {
      new: true,
    });
    return response.status(201).json({ ok: true, msg: "Acceptance updated" });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: "Internal server error",
      err: JSON.stringify(error),
    });
  }
};

module.exports = {
  acceptancePoliciesAndTermsApp,
  updateAcceptanceByAddingStaffMemberID,
};
