const toBool = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};

const toNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const paymentsPolicy = {
  dualLaneEnabled: toBool(process.env.PAYMENTS_DUAL_LANE_ENABLED, true),
  monitorMode: toBool(process.env.PAYMENTS_MONITOR_MODE, false),
  windowMs: toNumber(process.env.PUBLIC_PAYMENTS_WINDOW_MS, 5 * 60 * 1000),
  createLimitPublic: toNumber(process.env.PUBLIC_PAYMENTS_CREATE_LIMIT, 30),
  createLimitAuthenticated: toNumber(process.env.AUTH_PAYMENTS_CREATE_LIMIT, 120),
  mutationLimit: toNumber(process.env.PUBLIC_PAYMENTS_MUTATION_LIMIT, 10),
};

module.exports = {
  paymentsPolicy,
};
