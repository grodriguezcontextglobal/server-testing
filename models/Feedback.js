const { Schema, model, default: mongoose } = require("mongoose");

const FeedbackSchema = new Schema({
  receivedService: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  metExpectations: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  expectationsComment: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  audioQuality: {
    type: Number,
    required: true,
    unique: false,
    default: 0,
  },
  interpretationQuality: {
    type: Number,
    required: true,
    unique: false,
    default: 0,
  },
  easeGettingReceiver: {
    type: Number,
    required: true,
    unique: false,
    default: 0,
  },
  easeReturningReceiver: {
    type: Number,
    required: true,
    unique: false,
    default: 0,
  },
  improvementSuggestion: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  aiInterpretation: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  aiComment: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  audioStreamingInterest: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  videoStreamingInterest: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  wifiToCellularUse: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  age: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  gender: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  name: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  email: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
  eventId: {
    type: Schema.Types.ObjectId,
    ref: "Event",
    required: true,
    unique: false,
    default: "",
  },
  eventName: {
    type: String,
    required: true,
    unique: false,
    default: "",
  },
});

module.exports = model("Feedback", FeedbackSchema);
