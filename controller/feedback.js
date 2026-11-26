const Feedback = require("../models/Feedback");
const { respondError } = require("../helpers/errorResponder");

const newFeedback = async (request, response = express.response) => {
  try {
    const {
      receivedService,
      metExpectations,
      expectationsComment,
      audioQuality,
      interpretationQuality,
      easeGettingReceiver,
      easeReturningReceiver,
      improvementSuggestion,
      aiInterpretation,
      aiComment,
      audioStreamingInterest,
      videoStreamingInterest,
      wifiToCellularUse,
      age,
      gender,
      name,
      email,
      eventId,
      eventName,
    } = request.body;
    const feedbackTemplate = {
      receivedService,
      metExpectations,
      expectationsComment,
      audioQuality,
      interpretationQuality,
      easeGettingReceiver,
      easeReturningReceiver,
      improvementSuggestion,
      aiInterpretation,
      aiComment,
      audioStreamingInterest,
      videoStreamingInterest,
      wifiToCellularUse,
      age,
      gender,
      name,
      email,
      eventId,
      eventName,
    };
    const newFeedback = new Feedback(feedbackTemplate);
    await newFeedback.save();
    return response.status(201).json({
      ok: true,
      message: "Feedback received successfully",
      newFeedback,
    });
  } catch (error) {
    return respondError(request, response, error, { msg: "Please contact Administrator" });
  }
};

module.exports = {
  newFeedback,
};
