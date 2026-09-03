'use strict';

/**
 * Núcleo PURO del conteo por identificador escaneable (RFID / código de barras).
 * Ver DESIGN_rfid_event_count.md § 6.
 *
 * Sin DB, sin HTTP, sin Date.now() -- mismo criterio que queue/core.js y
 * resolveUpdatePlan: la lógica de decisión vive acá y se testea sin levantar
 * nada; los controladores solo traen los datos y aplican estas funciones.
 *
 * Es la pieza que se reusa COMPLETA cuando esto se extrapole del cierre de
 * evento al conteo de inventario de bodega: ahí solo cambia de dónde salen los
 * "esperados", y reconcile() ni se entera.
 */

/** Tipos de identificador que viven en item_identifier.id_type. */
const IDENTIFIER_TYPES = Object.freeze(['epc', 'barcode']);

/**
 * Normaliza un identificador escaneable a su forma canónica: recortado y en
 * mayúsculas, o `null` si no hay valor.
 *
 * ES EL ÚNICO punto de normalización, a propósito. Lo consumen el registro
 * (item_identifier) y la resolución. Si la escritura normalizara y la lectura
 * no, una lectura en minúsculas no matchearía y el equipo aparecería como
 * faltante sin ningún error visible -- el peor modo de falla posible para un
 * conteo.
 *
 * Coerciona números porque los seriales de item_inv son strings ('00170') pero
 * un cliente puede mandarlos como número desde JSON; sin esto, 10001 !== '10001'
 * convertiría un equipo presente en un faltante.
 *
 * Conservador con los separadores internos: no los toca. Si el lector OR2505
 * emite el EPC con espacios, eso es la decisión de formato canónico que sigue
 * abierta (DESIGN_rfid_event_count.md § 14), no algo que este helper adivine.
 */
function normalizeIdentifier(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;

  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed.toUpperCase();
}

/**
 * Compara el conjunto ESPERADO contra lo ESCANEADO y clasifica.
 *
 * @param {Object}   input
 * @param {Array}    input.expected  Filas del conjunto esperado. Cada una:
 *   `{ item_id, serial_number, epc, ...cualquier otro campo que se quiera devolver }`.
 *   `epc` puede ser null (equipo sin etiquetar).
 * @param {Array}    input.scanned   Valores crudos del lector / la pistola.
 *   Se normalizan y deduplican acá dentro.
 *
 * @returns {{
 *   matched:         Array,  esperados que aparecieron (+ matchedBy / matchedVia)
 *   missingTagged:   Array,  esperados CON tag que no respondieron -> alarma real
 *   missingUntagged: Array,  esperados SIN tag -> verificar a mano
 *   unmatched:       string[], valores escaneados que no son de este conjunto
 *   ambiguous:       Array<{value, item_ids}>, valores que resuelven a >1 esperado
 * }}
 */
function reconcile({ expected = [], scanned = [] } = {}) {
  const rows = Array.isArray(expected) ? expected : [];
  const rawScans = Array.isArray(scanned) ? scanned : [];

  // Un valor escaneado puede resolver a más de una fila: los seriales NO son
  // únicos (bulkInsertItemRange acuña rangos que se solapan entre categorías).
  // Por eso el índice apunta a una lista, no a una fila.
  const byValue = new Map();
  const addKey = (key, row, via) => {
    if (!key) return;
    if (!byValue.has(key)) byValue.set(key, []);
    byValue.get(key).push({ row, via });
  };

  for (const row of rows) {
    addKey(normalizeIdentifier(row?.epc), row, 'epc');
    addKey(normalizeIdentifier(row?.serial_number), row, 'serial');
  }

  // Deduplicar preservando el orden de llegada: un lector RFID re-emite el mismo
  // tag muchas veces por barrido, y el operador re-escanea.
  const seen = new Set();
  const scans = [];
  for (const raw of rawScans) {
    const value = normalizeIdentifier(raw);
    if (value === null || seen.has(value)) continue;
    seen.add(value);
    scans.push(value);
  }

  const hits = new Map(); // item_id -> { matchedBy, matchedVia }
  const unmatched = [];
  const ambiguous = [];

  for (const value of scans) {
    const candidates = byValue.get(value);

    if (!candidates || candidates.length === 0) {
      unmatched.push(value);
      continue;
    }

    // Un mismo valor puede indexar la misma fila dos veces (epc === serial).
    // Eso no es ambigüedad: sigue siendo un solo equipo.
    const distinct = [...new Map(candidates.map((c) => [c.row.item_id, c])).values()];

    if (distinct.length > 1) {
      // Escanear esto no identifica ningún equipo. Marcar los dos como presentes
      // sería mentir, así que quedan como faltantes y el valor se reporta aparte:
      // es exactamente la ambigüedad que el EPC existe para resolver.
      ambiguous.push({ value, item_ids: distinct.map((c) => c.row.item_id) });
      continue;
    }

    const { row, via } = distinct[0];
    if (!hits.has(row.item_id)) {
      hits.set(row.item_id, { matchedBy: value, matchedVia: via });
    }
  }

  const matched = [];
  const missingTagged = [];
  const missingUntagged = [];

  for (const row of rows) {
    const hit = hits.get(row?.item_id);
    if (hit) {
      matched.push({ ...row, ...hit });
    } else if (normalizeIdentifier(row?.epc) !== null) {
      missingTagged.push(row);
    } else {
      missingUntagged.push(row);
    }
  }

  return { matched, missingTagged, missingUntagged, unmatched, ambiguous };
}

module.exports = { IDENTIFIER_TYPES, normalizeIdentifier, reconcile };
