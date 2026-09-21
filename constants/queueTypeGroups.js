'use strict';

/**
 * Grupos de tipos de job de la cola — fuente única de verdad para repartir la
 * cola entre workers dedicados (ver DEPLOY.md § Split services).
 *
 * Por qué existe: el reparto se hace por env (`QUEUE_TYPES` /
 * `QUEUE_EXCLUDE_TYPES`) y hasta ahora la misma lista de tipos vivía escrita a
 * mano en TRES lugares — el worker dedicado, la exclusión del server principal
 * y DEPLOY.md. Agregar un tipo y olvidarse de uno de los tres deja al server
 * principal compitiendo por trabajo que ya no debería tomar (el claim atómico
 * evita el doble procesamiento, pero se pierde el aislamiento que se buscaba).
 * Con los grupos, el server principal se configura con
 * `QUEUE_EXCLUDE_GROUPS=dedicated` y no hay que volver a tocarlo.
 *
 * Los grupos deben ser DISJUNTOS: un tipo pertenece a exactamente un worker.
 */

// Correos: fan-out a SendGrid, tolera latencia, es el grupo más ruidoso.
const EMAIL_TYPES = [
  'send-email',
  'send-email-multiple',
  'send-email-multiple-with-attachments',
];

// Escrituras masivas con poll rápido (QUEUE_POLL_MS=300): sus controllers
// encolan y ESPERAN el resultado (createSyncOrQueuedController /
// waitForJobOutcome, maxWaitMs=4000) para no romper el contrato síncrono.
const BULK_WRITE_TYPES = [
  'inventory:bulk-insert-range',
  'member:bulk-insert',
  'member:bulk-return-leases',
];

// Borrados masivos. Separados de BULK_WRITE_TYPES a propósito: el worker
// procesa los jobs de a uno (queue/worker.js § tick), así que un insert de
// ~15,000 seriales retiene el tick y el borrado que quedó atrás agota los
// 4s de `waitForJobOutcome` y cae al 202+jobId. Un borrado no compite con
// un insert si vive en su propio proceso.
const DELETE_TYPES = [
  'inventory:bulk-delete-by-criteria',
  'inventory:bulk-delete-by-ids',
];

// Escrituras pesadas que NADIE espera: sus controllers responden 202 + jobId y
// el cliente consulta despues (createQueuedJobController, sin
// waitForJobOutcome). Van aparte de BULK_WRITE_TYPES justo por eso, y por la
// misma razon que DELETE_TYPES: el worker procesa de a uno, asi que un insert
// alfanumerico de ~15.000 seriales retendria el tick y haria reventar la
// ventana de 4s de los jobs que SI se esperan.
//
// Hasta ahora no estaban en ningun grupo, lo que significa que el server
// principal (QUEUE_EXCLUDE_GROUPS=dedicated) los consumia DENTRO de los
// procesos que atienden login y pagos.
//
// `inventory:export` no es una escritura, pero tiene exactamente la misma
// forma -- 202 + jobId, nadie espera -- y es el trabajo MAS LARGO del grupo:
// lee el inventario a trozos y escribe una celda de exceljs por columna, hasta
// el techo de 200.000 filas. Dejarlo fuera de un grupo habria repetido el
// mismo fallo que estos tres: el .xlsx se generaria dentro de los procesos que
// atienden login y pagos, que es justo lo que el export en cola venia a
// evitar. Es tambien el argumento mas fuerte para separar `heavy` en su propio
// servicio en vez de colgarlo del worker de bulk (DEPLOY.md, opcion (b)).
const HEAVY_ASYNC_TYPES = [
  'inventory:bulk-insert-alphanumeric',
  'inventory:bulk-update-alphanumeric',
  'event:bulk-update-item-shipping',
  'inventory:export',
];

const GROUPS = Object.freeze({
  email: Object.freeze([...EMAIL_TYPES]),
  bulk: Object.freeze([...BULK_WRITE_TYPES]),
  delete: Object.freeze([...DELETE_TYPES]),
  heavy: Object.freeze([...HEAVY_ASYNC_TYPES]),
});

/** Todos los tipos que un worker dedicado reclama (lo que el server principal debe excluir). */
const DEDICATED_GROUP = 'dedicated';

const GROUP_NAMES = Object.keys(GROUPS);

const parseList = (value) =>
  value
    ? String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

const unique = (arr) => [...new Set(arr)];

/**
 * Tipos de un grupo. `dedicated` expande a la unión de todos los grupos.
 * Lanza ante un nombre desconocido: un typo en `QUEUE_GROUP` dejaría al worker
 * sin filtro, reclamando TODA la cola — es preferible que el servicio no
 * arranque y nssm lo deje en falla visible.
 */
function typesForGroup(name) {
  const key = String(name || '').trim().toLowerCase();
  if (key === DEDICATED_GROUP) {
    return unique(GROUP_NAMES.flatMap((g) => [...GROUPS[g]]));
  }
  if (!Object.prototype.hasOwnProperty.call(GROUPS, key)) {
    throw new Error(
      `Grupo de cola desconocido: '${name}'. Válidos: ${[...GROUP_NAMES, DEDICATED_GROUP].join(', ')}`
    );
  }
  return [...GROUPS[key]];
}

/**
 * Resuelve el alcance (include/exclude) de este worker a partir del entorno.
 *
 * Precedencia — lo explícito manda, para no romper los servicios ya
 * configurados con listas de tipos a mano:
 *   QUEUE_TYPES          > QUEUE_GROUP
 *   QUEUE_EXCLUDE_TYPES  se SUMA a QUEUE_EXCLUDE_GROUPS
 *
 * Un nombre de grupo inválido se trata distinto según de qué lado esté, según
 * qué falla es peor:
 * - en `QUEUE_GROUP` (worker dedicado) LANZA: ignorarlo dejaría al worker sin
 *   filtro, reclamando toda la cola. Vale más que el servicio no arranque.
 * - en `QUEUE_EXCLUDE_GROUPS` (server principal) se AVISA y se ignora: lanzar
 *   ahí tiraría abajo la API entera por un typo, cuando la consecuencia real
 *   es solo perder el aislamiento (el server tomaría también esos tipos, que
 *   sigue siendo correcto gracias al claim atómico).
 *
 * @param {object} [env=process.env]
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{includeTypes: string[], excludeTypes: string[]}}
 */
function resolveWorkerScope(env = process.env, { warn } = {}) {
  const includeFromTypes = parseList(env.QUEUE_TYPES);
  const group = String(env.QUEUE_GROUP || '').trim();

  // QUEUE_GROUP admite una LISTA: 'bulk,heavy' deja que un mismo servicio
  // sirva dos grupos. Eso desacopla como se agrupan los tipos en el codigo de
  // cuantos servicios nssm existen, y permite crear un grupo hoy y decidir la
  // topologia despues. Un solo nombre sigue funcionando igual que antes.
  const groups = parseList(group);
  const includeTypes = includeFromTypes.length
    ? includeFromTypes
    : groups.length
      ? unique(groups.flatMap((name) => typesForGroup(name)))
      : [];

  const excludeFromGroups = [];
  for (const name of parseList(env.QUEUE_EXCLUDE_GROUPS)) {
    try {
      excludeFromGroups.push(...typesForGroup(name));
    } catch (err) {
      if (typeof warn === 'function') warn(`QUEUE_EXCLUDE_GROUPS: ${err.message} — se ignora`);
    }
  }

  const excludeTypes = unique([...parseList(env.QUEUE_EXCLUDE_TYPES), ...excludeFromGroups]);

  return { includeTypes, excludeTypes };
}

module.exports = {
  EMAIL_TYPES,
  BULK_WRITE_TYPES,
  DELETE_TYPES,
  HEAVY_ASYNC_TYPES,
  GROUPS,
  GROUP_NAMES,
  DEDICATED_GROUP,
  typesForGroup,
  resolveWorkerScope,
};
