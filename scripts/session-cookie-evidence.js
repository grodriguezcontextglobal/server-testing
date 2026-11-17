'use strict';

/**
 * La cabecera `Set-Cookie` de la sesión, tal como sale del servidor (SC-23,
 * AC-12). Evidencia para el paquete de ConMon y para el evaluador.
 *
 * Existe porque el dashboard no puede enseñarla: una página no lee las
 * cabeceras de una respuesta, y con `HttpOnly` tampoco ve la cookie desde
 * JavaScript. La prueba tiene que venir de este lado.
 *
 * No simula la cabecera: levanta Express de verdad en un puerto efímero de
 * loopback, emite la cookie con `helpers/sessionCookie.js` —el mismo código que
 * usa el login— y transcribe lo que el servidor manda por el cable. El valor
 * del token se sustituye por un marcador: la evidencia es la LISTA DE
 * ATRIBUTOS, no la sesión.
 *
 *   node scripts/session-cookie-evidence.js                 # como produccion
 *   node scripts/session-cookie-evidence.js --samesite lax  # el dia del encendido
 *
 * Solo lee: no toca la base de datos, ni el `.env`, ni ningún servicio.
 */

const express = require('express');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

// Fuerza la configuración de producción para esta ejecución, sin leer ni
// escribir el .env de la máquina.
process.env.COOKIE_SESSION_MODE = 'dual';
process.env.SESSION_COOKIE_SECURE = flag('secure', 'true');
process.env.SESSION_COOKIE_SAMESITE = flag('samesite', 'none');

const {
  COOKIE_NAME,
  issueSessionCookie,
  sessionCookieOptions,
} = require('../helpers/sessionCookie');

const PLACEHOLDER = 'TOKEN-DE-SESION-ELIDIDO';

const main = async () => {
  const app = express();
  app.get('/evidence', (_request, response) => {
    issueSessionCookie(response, PLACEHOLDER);
    response.status(200).json({ ok: true });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  try {
    const { port } = server.address();
    const answer = await fetch(`http://127.0.0.1:${port}/evidence`);
    const header = answer.headers.getSetCookie?.()[0] ?? answer.headers.get('set-cookie');

    if (!header) {
      console.error('No salió ninguna cookie. ¿COOKIE_SESSION_MODE sigue en off?');
      return 1;
    }

    const options = sessionCookieOptions();
    console.log('Set-Cookie de la sesión de staff — servidor Devitrak');
    console.log(`Generado: ${new Date().toISOString()}`);
    console.log(`Configuración: COOKIE_SESSION_MODE=dual, SESSION_COOKIE_SECURE=${process.env.SESSION_COOKIE_SECURE}, SESSION_COOKIE_SAMESITE=${process.env.SESSION_COOKIE_SAMESITE}`);
    console.log(`Origen: helpers/sessionCookie.js vía Express, en loopback. El valor va elidido a propósito.`);
    console.log('');
    console.log(header.replace(PLACEHOLDER, '<valor de sesion elidido>'));
    console.log('');
    console.log(`Atributos: HttpOnly=${options.httpOnly}  Secure=${options.secure}  SameSite=${options.sameSite}  Path=${options.path}  Max-Age=${options.maxAge / 1000}s (${options.maxAge / 3600000} h, el techo de sesión de AC-12)`);
    console.log(`Nombre de la cookie: ${COOKIE_NAME}`);
    return 0;
  } finally {
    server.close();
  }
};

main().then((code) => process.exit(code));
