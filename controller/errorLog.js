const ErrorLogs = require("../models/ErrorLogs");
const {
  errorFeedbackEmailNotification,
} = require("../nodeMailer/notifications");

const createErrorFeed = async (request, response) => {
  try {
    const { componentStack, error } = request.body;
    const errorLog = new ErrorLogs({
      componentStack,
      error,
    });
    const savedError = await errorLog.save();

    await errorFeedbackEmailNotification({
      errorId: savedError._id,
      componentStack: componentStack,
      error: error,
    });

    return response.status(200).json({
      ok: true,
      msg: `Error ID: ${errorLog.id}. Error log created successfully. Please save the id for future reference.`,
      errorId: errorLog.id,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error,
      msg: error.message,
    });
  }
};

module.exports = {
  createErrorFeed,
};
