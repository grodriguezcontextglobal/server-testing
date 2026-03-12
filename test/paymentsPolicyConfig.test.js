const test = require('node:test');
const assert = require('node:assert/strict');

const CONFIG_PATH = '../config/paymentsPolicy';
const OPTIONAL_JWT_PATH = '../middlewares/optionalJWT';

const loadPolicyWithEnv = (env) => {
  const original = {
    PAYMENTS_DUAL_LANE_ENABLED: process.env.PAYMENTS_DUAL_LANE_ENABLED,
    PAYMENTS_MONITOR_MODE: process.env.PAYMENTS_MONITOR_MODE,
    PUBLIC_PAYMENTS_CREATE_LIMIT: process.env.PUBLIC_PAYMENTS_CREATE_LIMIT,
    AUTH_PAYMENTS_CREATE_LIMIT: process.env.AUTH_PAYMENTS_CREATE_LIMIT,
  };

  Object.assign(process.env, env);
  delete require.cache[require.resolve(CONFIG_PATH)];
  const loaded = require(CONFIG_PATH);

  Object.keys(original).forEach((k) => {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  });

  delete require.cache[require.resolve(CONFIG_PATH)];
  return loaded.paymentsPolicy;
};

test('paymentsPolicy loads dual lane on by default', () => {
  const policy = loadPolicyWithEnv({ PAYMENTS_DUAL_LANE_ENABLED: '' });
  assert.equal(policy.dualLaneEnabled, true);
});

test('paymentsPolicy supports dual lane off', () => {
  const policy = loadPolicyWithEnv({ PAYMENTS_DUAL_LANE_ENABLED: 'false' });
  assert.equal(policy.dualLaneEnabled, false);
});

test('optionalJWT stays public when token is absent (compatible behavior)', () => {
  process.env.PAYMENTS_DUAL_LANE_ENABLED = 'false';

  delete require.cache[require.resolve(CONFIG_PATH)];
  delete require.cache[require.resolve(OPTIONAL_JWT_PATH)];
  const { optionalJWT } = require(OPTIONAL_JWT_PATH);

  const req = {
    header: () => undefined,
    originalUrl: '/api/stripe/create-payment-intent',
  };

  optionalJWT(req, {}, () => {});
  assert.equal(req.authContext.lane, 'public');

  delete process.env.PAYMENTS_DUAL_LANE_ENABLED;
  delete require.cache[require.resolve(CONFIG_PATH)];
  delete require.cache[require.resolve(OPTIONAL_JWT_PATH)];
});
