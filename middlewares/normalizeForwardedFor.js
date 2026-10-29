'use strict';

const net = require('net');

/**
 * Deja en req.ip la IP del cliente, sin puerto, antes de que nadie la lea.
 *
 * Cadena en prod: cliente -> pfSense -> NGINX (172.16.40.2) -> IIS (ARR) -> Node
 * en 127.0.0.1. NGINX pone la IP real del cliente en X-Real-IP. IIS añade al
 * final de X-Forwarded-For la IP de NGINX con su puerto ("172.16.40.2:50444"),
 * y con `trust proxy` = 1 esa entrada era req.ip. Tres efectos:
 *   - express-rate-limit rechazaba la IP (ERR_ERL_INVALID_IP_ADDRESS en
 *     service-err.log) en los limitadores con el keyGenerator por defecto.
 *   - El puerto cambia en cada conexión: cada petición contaba como una IP
 *     nueva y los limitadores por IP no limitaban nada (AC-7).
 *   - Sin puerto, seguiría siendo la IP de NGINX para todos los usuarios: un
 *     único cubo compartido. Por eso se usa X-Real-IP.
 *
 * X-Real-IP solo se cree si la conexión viene de loopback (IIS en la misma
 * máquina; Node escucha solo en 127.0.0.1). Desde otra dirección (p. ej. un
 * contenedor con BIND_HOST=0.0.0.0) cualquiera podría inventarla, y se ignora.
 *
 * Va el primero en index.js.
 */

const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
const IPV6_BRACKETED = /^\[([0-9a-fA-F:.]+)\](?::\d+)?$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function stripPort(entry) {
  const value = String(entry).trim();
  const v4 = value.match(IPV4_WITH_PORT);
  if (v4) return v4[1];
  const v6 = value.match(IPV6_BRACKETED);
  if (v6) return v6[1];
  return value;
}

function realIpFromLocalProxy(req) {
  if (!LOOPBACK.has(req.socket?.remoteAddress)) return null;
  const raw = req.headers['x-real-ip'];
  if (typeof raw !== 'string') return null;
  const ip = stripPort(raw);
  return net.isIP(ip) ? ip : null;
}

function normalizeForwardedFor(req, _res, next) {
  const raw = req.headers['x-forwarded-for'];
  if (typeof raw === 'string' && raw) {
    req.headers['x-forwarded-for'] = raw.split(',').map(stripPort).join(', ');
  }
  const realIp = realIpFromLocalProxy(req);
  if (realIp) {
    // Propiedad propia: tapa el getter de Express (que lee X-Forwarded-For).
    Object.defineProperty(req, 'ip', { value: realIp, configurable: true, enumerable: true, writable: true });
  }
  next();
}

module.exports = { normalizeForwardedFor, stripPort, realIpFromLocalProxy };
