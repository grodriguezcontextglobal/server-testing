'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

// Logger falso para poder afirmar qué se registra en un rechazo por CSRF.
const logged = [];
const loggerPath = require.resolve('../helpers/logger');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: {
    warn: (message, detail) => logged.push({ message, detail }),
    info: () => {},
    error: () => {},
    http: () => {},
  },
};

const {
  COOKIE_NAME,
  newCsrfToken,
  readSessionCookie,
  issueSessionCookie,
  clearSessionCookie,
  sessionCookieOptions,
  csrfMatches,
  expiresAtOf,
} = require('../helpers/sessionCookie');
const { createSessionCookieBridge } = require('../middlewares/sessionCookieBridge');
const { generateJWT } = require('../helpers/jwt');

const UID = '507f1f77bcf86cd799439011';
const CSRF = 'a'.repeat(64);

const tokenWith = (claims = {}) =>
  jwt.sign({ uid: UID, name: 'Ana', ...claims }, process.env.SECRET_JWT_SEED, { expiresIn: '2h' });

const makeRequest = ({ method = 'POST', cookieToken, xToken, csrfHeader } = {}) => {
  const headers = {};
  if (xToken) headers['x-token'] = xToken;
  if (cookieToken) headers.cookie = `theme=dark; ${COOKIE_NAME}=${cookieToken}; other=1`;
  if (csrfHeader) headers['x-csrf-token'] = csrfHeader;
  return {
    method,
    originalUrl: '/api/company/update-company/1',
    headers,
    header: (name) => headers[String(name).toLowerCase()],
  };
};

const makeResponse = () => {
  const response = { statusCode: null, body: null, cookies: [], cleared: [] };
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (payload) => {
    response.body = payload;
    return response;
  };
  response.cookie = (name, value, options) => response.cookies.push({ name, value, options });
  response.clearCookie = (name, options) => response.cleared.push({ name, options });
  return response;
};

const withMode = (value, run) => {
  const before = process.env.COOKIE_SESSION_MODE;
  process.env.COOKIE_SESSION_MODE = value;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env.COOKIE_SESSION_MODE;
    else process.env.COOKIE_SESSION_MODE = before;
  }
};

const bridge = createSessionCookieBridge();

const run = (request, response) => {
  let nexted = false;
  bridge(request, response, () => {
    nexted = true;
  });
  return nexted;
};

describe('middlewares/sessionCookieBridge', () => {
  test('con COOKIE_SESSION_MODE=off la cookie se ignora por completo', () => {
    withMode('off', () => {
      const request = makeRequest({ cookieToken: tokenWith({ csrf: CSRF }), csrfHeader: CSRF });
      const response = makeResponse();
      assert.equal(run(request, response), true);
      assert.equal(request.headers['x-token'], undefined);
      assert.equal(request.sessionFromCookie, undefined);
    });
  });

  test('dual + GET con cookie: el token pasa a x-token sin pedir CSRF', () => {
    withMode('dual', () => {
      const token = tokenWith({ csrf: CSRF });
      const request = makeRequest({ method: 'GET', cookieToken: token });
      const response = makeResponse();
      assert.equal(run(request, response), true);
      assert.equal(request.headers['x-token'], token);
      assert.equal(request.sessionFromCookie, true);
    });
  });

  test('dual + POST con cookie y sin X-CSRF-Token: 403 y nada se inyecta', () => {
    withMode('dual', () => {
      logged.length = 0;
      const request = makeRequest({ cookieToken: tokenWith({ csrf: CSRF }) });
      const response = makeResponse();
      assert.equal(run(request, response), false);
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.ok, false);
      assert.match(response.body.msg, /CSRF/);
      assert.equal(request.headers['x-token'], undefined);
      assert.equal(logged.length, 1);
      assert.match(logged[0].message, /cookie session: CSRF/);
    });
  });

  test('dual + POST con un X-CSRF-Token que no coincide: 403', () => {
    withMode('dual', () => {
      const request = makeRequest({
        cookieToken: tokenWith({ csrf: CSRF }),
        csrfHeader: 'b'.repeat(64), // misma longitud, valor distinto
      });
      const response = makeResponse();
      assert.equal(run(request, response), false);
      assert.equal(response.statusCode, 403);
    });
  });

  test('dual + POST con el X-CSRF-Token correcto: pasa', () => {
    withMode('dual', () => {
      const token = tokenWith({ csrf: CSRF });
      const request = makeRequest({ cookieToken: token, csrfHeader: CSRF });
      const response = makeResponse();
      assert.equal(run(request, response), true);
      assert.equal(request.headers['x-token'], token);
    });
  });

  // El contrato de la fase 1: el dashboard puede apagar su flag en cualquier
  // momento y volver a mandar el token a mano, sin CSRF y sin cambios aquí.
  test('la cabecera x-token manda sobre la cookie y no exige CSRF', () => {
    withMode('dual', () => {
      const headerToken = tokenWith({ csrf: CSRF });
      const request = makeRequest({
        xToken: headerToken,
        cookieToken: tokenWith({ csrf: 'c'.repeat(64) }),
      });
      const response = makeResponse();
      assert.equal(run(request, response), true);
      assert.equal(request.headers['x-token'], headerToken);
      assert.equal(request.sessionFromCookie, undefined);
    });
  });

  // Un token inválido no se convierte en un 403 nuevo: se sigue sin sesión y el
  // 401 lo da validateJWT, como siempre.
  test('cookie con un token que no verifica: ni inyecta ni responde', () => {
    withMode('dual', () => {
      const request = makeRequest({
        method: 'GET',
        cookieToken: jwt.sign({ uid: UID }, 'otro-secreto'),
      });
      const response = makeResponse();
      assert.equal(run(request, response), true);
      assert.equal(request.headers['x-token'], undefined);
      assert.equal(response.statusCode, null);
    });
  });

  test('un token sin claim csrf nunca pasa una escritura', () => {
    withMode('dual', () => {
      const request = makeRequest({ cookieToken: tokenWith(), csrfHeader: CSRF });
      const response = makeResponse();
      assert.equal(run(request, response), false);
      assert.equal(response.statusCode, 403);
    });
  });
});

describe('helpers/sessionCookie', () => {
  test('readSessionCookie encuentra la cookie entre otras y la decodifica', () => {
    const request = {
      headers: { cookie: `a=1; ${COOKIE_NAME}=abc%3Ddef; z=2` },
      header: (name) => request.headers[name],
    };
    assert.equal(readSessionCookie(request), 'abc=def');
    assert.equal(readSessionCookie({ headers: {} }), null);
    assert.equal(readSessionCookie({ headers: { cookie: 'a=1' } }), null);
  });

  test('issueSessionCookie no emite nada con el modo apagado', () => {
    withMode('off', () => {
      const response = makeResponse();
      assert.equal(issueSessionCookie(response, 'token'), false);
      assert.equal(response.cookies.length, 0);
    });
  });

  test('issueSessionCookie emite HttpOnly con la vida de la sesión', () => {
    withMode('dual', () => {
      const response = makeResponse();
      assert.equal(issueSessionCookie(response, 'token'), true);
      const [cookie] = response.cookies;
      assert.equal(cookie.name, COOKIE_NAME);
      assert.equal(cookie.value, 'token');
      assert.equal(cookie.options.httpOnly, true);
      assert.equal(cookie.options.path, '/');
      assert.equal(cookie.options.maxAge, 12 * 60 * 60 * 1000);
    });
  });

  // El dashboard y la API se sirven desde hosts distintos: sin Secure+None el
  // navegador no manda la cookie en producción.
  test('con SESSION_COOKIE_SECURE la cookie va Secure y SameSite=None', () => {
    const before = process.env.SESSION_COOKIE_SECURE;
    process.env.SESSION_COOKIE_SECURE = 'true';
    try {
      const options = sessionCookieOptions();
      assert.equal(options.secure, true);
      assert.equal(options.sameSite, 'none');
    } finally {
      if (before === undefined) delete process.env.SESSION_COOKIE_SECURE;
      else process.env.SESSION_COOKIE_SECURE = before;
    }
  });

  test('sin Secure la cookie va Lax, para que localhost la acepte', () => {
    const before = process.env.SESSION_COOKIE_SECURE;
    delete process.env.SESSION_COOKIE_SECURE;
    try {
      const options = sessionCookieOptions();
      assert.equal(options.secure, false);
      assert.equal(options.sameSite, 'lax');
    } finally {
      if (before !== undefined) process.env.SESSION_COOKIE_SECURE = before;
    }
  });

  // Si el modo se apaga con sesiones abiertas, el logout tiene que cerrarlas.
  test('clearSessionCookie borra la cookie aunque el modo esté apagado', () => {
    withMode('off', () => {
      const response = makeResponse();
      assert.equal(clearSessionCookie(response), true);
      assert.equal(response.cleared[0].name, COOKIE_NAME);
      assert.equal(response.cleared[0].options.maxAge, undefined);
    });
  });

  // El dashboard y la API son el MISMO sitio en producción (devitrak.net), así
  // que allí basta Lax; None solo hace falta para probar desde un build local.
  test('SESSION_COOKIE_SAMESITE fuerza el valor', () => {
    const beforeSecure = process.env.SESSION_COOKIE_SECURE;
    const beforeSameSite = process.env.SESSION_COOKIE_SAMESITE;
    process.env.SESSION_COOKIE_SECURE = 'true';
    try {
      process.env.SESSION_COOKIE_SAMESITE = 'lax';
      assert.equal(sessionCookieOptions().sameSite, 'lax');
      process.env.SESSION_COOKIE_SAMESITE = 'strict';
      assert.equal(sessionCookieOptions().sameSite, 'strict');
      // Un valor que no existe se ignora, no rompe la cookie.
      process.env.SESSION_COOKIE_SAMESITE = 'sideways';
      assert.equal(sessionCookieOptions().sameSite, 'none');
    } finally {
      if (beforeSecure === undefined) delete process.env.SESSION_COOKIE_SECURE;
      else process.env.SESSION_COOKIE_SECURE = beforeSecure;
      if (beforeSameSite === undefined) delete process.env.SESSION_COOKIE_SAMESITE;
      else process.env.SESSION_COOKIE_SAMESITE = beforeSameSite;
    }
  });

  // None sin Secure es una cookie que el navegador tira: se degrada a Lax en
  // vez de dejar la sesión sin funcionar.
  test('SameSite=None pedido sin Secure se degrada a Lax', () => {
    const beforeSecure = process.env.SESSION_COOKIE_SECURE;
    const beforeSameSite = process.env.SESSION_COOKIE_SAMESITE;
    delete process.env.SESSION_COOKIE_SECURE;
    process.env.SESSION_COOKIE_SAMESITE = 'none';
    try {
      const options = sessionCookieOptions();
      assert.equal(options.secure, false);
      assert.equal(options.sameSite, 'lax');
    } finally {
      if (beforeSecure !== undefined) process.env.SESSION_COOKIE_SECURE = beforeSecure;
      if (beforeSameSite === undefined) delete process.env.SESSION_COOKIE_SAMESITE;
      else process.env.SESSION_COOKIE_SAMESITE = beforeSameSite;
    }
  });

  test('csrfMatches rechaza vacíos, longitudes distintas y no-cadenas', () => {
    assert.equal(csrfMatches(CSRF, CSRF), true);
    assert.equal(csrfMatches('', ''), false);
    assert.equal(csrfMatches(CSRF, CSRF.slice(0, 32)), false);
    assert.equal(csrfMatches(undefined, CSRF), false);
    assert.equal(csrfMatches(CSRF, undefined), false);
  });

  test('newCsrfToken da 64 hex distintos cada vez', () => {
    const a = newCsrfToken();
    const b = newCsrfToken();
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, b);
  });
});

describe('helpers/jwt: claim csrf', () => {
  test('el claim solo existe cuando se pide', async () => {
    const withCsrf = await generateJWT(UID, 'Ana', 1, null, { csrf: CSRF });
    const without = await generateJWT(UID, 'Ana', 1, null, {});
    assert.equal(jwt.decode(withCsrf).csrf, CSRF);
    assert.equal(jwt.decode(without).csrf, undefined);
  });

  // Varias suites inyectan un generateJWT falso que devuelve una cadena
  // cualquiera. Un campo informativo del login no puede dar un 500 por eso.
  test('expiresAtOf: ISO con un token real, null con cualquier otra cosa', async () => {
    const token = await generateJWT(UID, 'Ana', 1, null, {});
    assert.match(expiresAtOf(token), /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(new Date(expiresAtOf(token)) > new Date(), true);
    for (const value of ['token-de-prueba', '', null, undefined, {}, 123]) {
      assert.equal(expiresAtOf(value), null);
    }
  });
});
