'use strict';

/**
 * El `WHERE a=? AND b=?` que arman las rutas de consulta (SI-11, AC-4;
 * 2026-11-17).
 *
 * Tres rutas de lectura construían el filtro así:
 *
 *   const formatting = Object.keys(body).map((k) => `\`${k}\`=?`).join(' AND ');
 *   const query = `select * from event_info where ${formatting}`;
 *
 * Con un cuerpo vacío, `formatting` es la cadena vacía y la consulta sale
 * `... where ;`. El motor devuelve un error de sintaxis, y el handler se lo
 * reenviaba al cliente. El dashboard lo midió el 2026-11-17: de dieciséis
 * rutas de lectura, las tres que filtran así son las tres que se iban de la
 * lengua, y las dos de `/db_event` fallaban en la misma posición porque son el
 * mismo código duplicado.
 *
 * El fallo no es el mensaje, es consultar antes de validar. Aquí se valida:
 * sin filtro no hay consulta, y una columna fuera de la lista tampoco. Los
 * nombres de columna se comprueban contra un conjunto cerrado y nunca se
 * interpolan sin comprobar; los valores siempre van como parámetros.
 *
 * Devuelve `{ ok: true, where, values }` o `{ ok: false, status, msg }` para
 * que el handler responda sin pensar.
 */

/**
 * @param {object} body             El cuerpo de la petición.
 * @param {Set<string>} allowed     Columnas que se pueden filtrar.
 * @param {object} [options]
 * @param {string} [options.subject] Qué se consulta, para el mensaje de error.
 */
const buildEqualityFilter = (body, allowed, { subject = 'query' } = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, msg: `Invalid body for ${subject}.` };
  }

  const keys = Object.keys(body);

  const invalid = keys.filter((key) => !allowed.has(key));
  if (invalid.length > 0) {
    return { ok: false, status: 400, msg: `Invalid field(s): ${invalid.join(', ')}` };
  }

  // Sin esto la consulta sale `where ;`. Y además: un filtro vacío pide la
  // tabla entera, que en estas rutas es inventario o eventos de todas las
  // compañías. Que falle aquí es lo correcto aunque el SQL fuese válido.
  if (keys.length === 0) {
    return {
      ok: false,
      status: 400,
      msg: `At least one filter is required for ${subject}.`,
    };
  }

  // Un valor `undefined` llega al driver como parámetro ausente y rompe la
  // consulta igual que el filtro vacío, solo que más tarde.
  const empty = keys.filter((key) => body[key] === undefined);
  if (empty.length > 0) {
    return { ok: false, status: 400, msg: `Empty value for: ${empty.join(', ')}` };
  }

  return {
    ok: true,
    where: keys.map((key) => `\`${key}\`=?`).join(' AND '),
    values: keys.map((key) => body[key]),
  };
};

module.exports = { buildEqualityFilter };
