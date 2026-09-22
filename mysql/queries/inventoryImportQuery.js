'use strict';

/**
 * Construcción y validación del import de inventario desde hoja de cálculo
 * (ver FRONTEND_inventory_import_endpoint_2026-09-21.md).
 *
 * Todo lo de este fichero es PURO: ni conexión ni red. El controller valida el
 * cuerpo entero antes de encolar nada, porque un fichero mal formado tiene que
 * dar 400 inmediato —con la lista de filas malas— y no un job `failed` medio
 * minuto después, cuando la persona ya cerró la pestaña.
 *
 * Por qué existe este endpoint y no campos nuevos en `bulk-item-alphanumeric`:
 * aquel es una petición por GRUPO de unidades idénticas, y una hoja de cálculo
 * es una fila por unidad. Con el endpoint viejo, el fichero medido de 500
 * unidades necesita 499 peticiones (una por combinación distinta de valores)
 * contra un límite de 300 cada 15 minutos — o una sola petición por grupo que
 * escribe en 482 de 500 unidades el coste de OTRA fila. Ninguna de las dos es
 * aceptable, y no hay una tercera forma de repartir el fichero que lo arregle:
 * el número de peticiones crece con las filas y el límite no.
 */

/**
 * Techo de unidades por import.
 *
 * No es un límite de producto: es el seguro de que un fichero pegado por error
 * no deje al worker media hora ocupado ni haga un cuerpo de decenas de MB. El
 * job viejo está documentado a ~15.000 seriales, y una unidad de esta forma
 * ocupa ~0,5 KB, así que 10.000 unidades son ~5 MB contra el límite de 50 MB
 * del cuerpo (`index.js`). Configurable para poder subirlo sin desplegar.
 */
const MAX_IMPORT_UNITS = Number(process.env.INVENTORY_IMPORT_MAX_UNITS || 10000);

/**
 * Filas por sentencia INSERT.
 *
 * Más bajo que las 1.000 del bulk alfanumérico a propósito: aquí cada fila
 * lleva sus propios valores (no se repite un escalar), así que la sentencia es
 * bastante más gorda con el mismo número de filas.
 */
const IMPORT_BATCH_SIZE = 500;

/** Cuántas filas malas se devuelven en el 400. Más que esto no ayuda a nadie. */
const MAX_REPORTED_ERRORS = 25;

class ImportValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ImportValidationError';
    this.errors = errors;
  }
}

const asTrimmedString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

/** El nombre de la locación puede venir como cadena o como `{ name }`. */
const locationNameOf = (unit) => {
  const raw = unit && unit.location;
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object') return asTrimmedString(raw.name);
  return '';
};

/**
 * `sub_location` se acepta en las tres formas que ya circulan por el sistema
 * (array, JSON string de array, nombre suelto) y se normaliza a array de
 * segmentos, que es lo que `processSubLocationPath` consume.
 */
const subLocationSegments = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map(asTrimmedString).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(asTrimmedString).filter(Boolean);
    } catch (e) {
      /* no era JSON: es un nombre suelto */
    }
    return value.trim() ? [value.trim()] : [];
  }
  if (typeof value === 'object' && value.name) return [asTrimmedString(value.name)];
  return [];
};

/**
 * El coste es lo que más se ensucia en una hoja: vienen "$1,234.56", celdas
 * vacías y textos. Un NaN escrito en la columna es peor que un 0 explícito.
 */
const parseCost = (value) => {
  if (value === undefined || value === null || value === '') return 0;
  const cleaned = typeof value === 'string' ? value.replace(/[^0-9.-]/g, '') : value;
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * `extra_serial_number` se guarda como JSON string en `item_inv`, igual que lo
 * escribe `insertingItem`. Aquí ya viene por unidad, así que no hace falta el
 * mapa serial -> info del handler viejo.
 */
const normalizeExtraSerialNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (e) {
    return null;
  }
};

/**
 * Valida el cuerpo entero y devuelve las unidades normalizadas.
 *
 * Las filas duplicadas dentro del mismo fichero NO son un error de validación:
 * se queda la primera y las siguientes salen en `skipped`, para que un serial
 * repetido no tumbe un import de 500 unidades. Las filas sin serial, sin
 * categoría o sin locación sí lo son — de esas no se puede escribir nada
 * sensato y el fichero necesita arreglo.
 *
 * @returns {{units: Array, skipped: Array<{serial_number: string, reason: string}>}}
 * @throws {ImportValidationError}
 */
function validateImportBody(body = {}) {
  const units = body.units;
  if (!Array.isArray(units) || units.length === 0) {
    throw new ImportValidationError('units must be a non-empty array');
  }
  if (units.length > MAX_IMPORT_UNITS) {
    throw new ImportValidationError(
      `This import has ${units.length} units and the limit is ${MAX_IMPORT_UNITS}. Split the file and try again.`
    );
  }

  const errors = [];
  const normalized = [];
  const skipped = [];
  const seenSerials = new Set();

  units.forEach((unit, index) => {
    // DE DÓNDE SALE `row`, y por qué no se deriva.
    //
    // Se devuelve tal cual venga en la unidad. Derivarlo como `índice + 2`
    // —que es lo que hacía antes— solo acierta si el array trae TODAS las filas
    // del fichero, y el cliente descarta antes de enviar las que le faltan
    // columnas obligatorias: el array llega comprimido, así que esa cuenta
    // apunta a una fila que ni siquiera se mandó. Lo detectó el dashboard
    // (FRONTEND_inventory_import_endpoint_REPLY_2026-09-22.md §2) después de
    // taparlo por su lado traduciendo el número de vuelta — un acoplamiento
    // invisible desde aquí que se habría roto en silencio el día que alguien
    // cambiara la derivación.
    //
    // Sin `row` se sigue cayendo a `índice + 2`, que es lo único que se puede
    // decir cuando nadie dijo de qué fila salió la unidad. Entonces es la
    // posición en el array, no la fila del fichero, y así está documentado.
    const declaredRow = Number(unit && unit.row);
    const row =
      Number.isInteger(declaredRow) && declaredRow > 0 ? declaredRow : index + 2;
    const serial = asTrimmedString(unit && unit.serial_number);
    const categoryName = asTrimmedString(unit && unit.category_name);
    const locationName = locationNameOf(unit);

    if (!serial) {
      errors.push({ row, reason: 'serial_number is required' });
      return;
    }
    if (!categoryName) {
      errors.push({ row, serial_number: serial, reason: 'category_name is required' });
      return;
    }
    if (!locationName) {
      errors.push({ row, serial_number: serial, reason: 'location is required' });
      return;
    }

    const dedupeKey = serial.toLowerCase();
    if (seenSerials.has(dedupeKey)) {
      skipped.push({
        row,
        serial_number: serial,
        reason: 'duplicate serial number within the import',
      });
      return;
    }
    seenSerials.add(dedupeKey);

    normalized.push({
      row,
      serial_number: serial,
      category_name: categoryName,
      location_name: locationName,
      item_group: asTrimmedString(unit.item_group) || null,
      brand: asTrimmedString(unit.brand) || null,
      descript_item: asTrimmedString(unit.descript_item) || null,
      ownership: asTrimmedString(unit.ownership) || null,
      main_warehouse: asTrimmedString(unit.main_warehouse) || locationName,
      cost: parseCost(unit.cost),
      sub_location_segments: subLocationSegments(unit.sub_location),
      extra_serial_number: normalizeExtraSerialNumber(unit.extra_serial_number),
      image_url: asTrimmedString(unit.image_url) || null,
      supplier_info: asTrimmedString(unit.supplier_info) || null,
    });
  });

  if (errors.length > 0) {
    throw new ImportValidationError(
      `${errors.length} row(s) cannot be imported. Fix them in the file and upload it again.`,
      errors.slice(0, MAX_REPORTED_ERRORS)
    );
  }

  return { units: normalized, skipped };
}

/** Nombres de locación distintos, en el orden en que aparecen en el fichero. */
function distinctLocationNames(units) {
  return [...new Set(units.map((u) => u.location_name))];
}

/** Categorías distintas, para el chequeo de scope de los roles por categoría. */
function distinctCategoryNames(units) {
  return [...new Set(units.map((u) => u.category_name))];
}

/**
 * Clave con la que se comparan nombres de locación.
 *
 * Para una persona, `"Almeria"`, `"almeria "` y `"ALMERIA"` son la MISMA
 * locación de su compañía. Para un `WHERE location_name = ?` son tres, y cada
 * variante del fichero acabaría creando una locación nueva: el inventario
 * quedaría repartido entre duplicados que nadie distingue en pantalla.
 *
 * Se normaliza en JavaScript y no en SQL a propósito: un `WHERE
 * LOWER(TRIM(location_name)) = ?` no puede usar el índice, y aquí se comparan
 * decenas de nombres, no miles.
 */
const normalizeLocationKey = (name) => String(name || '').trim().toLowerCase();

/**
 * TODAS las locaciones de la compañía, para resolver contra ellas en memoria.
 *
 * Es una sola consulta y sin `IN (...)` de nombres a propósito. Con `IN` hay que
 * acertar el nombre EXACTO —y el fichero trae variantes de mayúsculas y
 * espacios—, así que un `IN` que no casa se traduce en una locación duplicada.
 * Una compañía tiene decenas de locaciones, no miles: traerlas todas y comparar
 * normalizado es mas barato que el duplicado que evita.
 */
function buildCompanyLocationsQuery(companyId) {
  return {
    sql: 'SELECT location_id, location_name FROM locations WHERE company_id = ? ORDER BY location_id ASC',
    params: [companyId],
  };
}

/**
 * Índice normalizado de las locaciones que ya tiene la compañía.
 *
 * Si dos filas normalizan igual —porque el duplicado ya existe de antes— gana la
 * de menor `location_id`, que es la primera que se creó. Elegir siempre la misma
 * importa: si el criterio variara entre ejecuciones, dos imports del mismo
 * fichero repartirían el inventario entre las dos.
 */
function indexLocationsByKey(rows = []) {
  const byKey = new Map();
  for (const row of rows) {
    const key = normalizeLocationKey(row.location_name);
    const id = Number(row.location_id);
    const current = byKey.get(key);
    // El mínimo explícito, no "la primera fila que llegó": la consulta ordena
    // por id, pero una función cuya corrección depende del ORDER BY de quien la
    // llama es una trampa esperando a que alguien reordene la consulta.
    if (current === undefined || id < current) byKey.set(key, id);
  }
  return byKey;
}

/**
 * Seriales que la compañía YA tiene. `item_inv` no lleva UNIQUE sobre
 * `serial_number` —en producción hay duplicados por diseño—, así que esto no es
 * una restricción de la base: es la política del import, que prefiere avisar a
 * duplicar una unidad que alguien ya dio de alta a mano.
 */
function buildExistingSerialsQuery(companyId, serials) {
  const placeholders = serials.map(() => '?').join(', ');
  return {
    sql: `SELECT serial_number FROM item_inv WHERE company_id = ? AND serial_number IN (${placeholders})`,
    params: [companyId, ...serials],
  };
}

/**
 * Chequeo de scope de TODO el import, todo o nada.
 *
 * El endpoint viejo resuelve una locación y llama a `canWriteInScope` una vez
 * —«single location + category per request, so an all-or-nothing check is
 * correct»—. Una hoja de cálculo abarca varias de las dos cosas, así que aquí
 * se usa el primo por lotes, `getWritableScope`, que resuelve el scope
 * escribible en UNA consulta y se compara contra el fichero entero.
 *
 * Una locación que todavía no existe no puede estar en el scope de un rol
 * acotado por locación, así que crearla implícitamente sería ampliarse el
 * permiso a uno mismo: para ese rol es un 403 que nombra la locación, no una
 * creación silenciosa.
 *
 * @param {{full:boolean, dimension?:string, values?:Array}} writableScope
 * @param {{locationIdsByName: Map<string, number>, locationNames: string[], categoryNames: string[]}} target
 * @returns {{ok: boolean, msg?: string}}
 */
function checkImportScope(writableScope, { locationIdsByName, locationNames, categoryNames }) {
  if (writableScope && writableScope.full) return { ok: true };
  if (!writableScope || !writableScope.dimension) {
    return { ok: false, msg: 'Not allowed to create items in this company' };
  }

  if (writableScope.dimension === 'location') {
    const allowed = new Set((writableScope.values || []).map(Number));
    for (const name of locationNames) {
      const id = locationIdsByName.get(normalizeLocationKey(name));
      if (id === undefined) {
        return {
          ok: false,
          msg: `Location '${name}' does not exist yet, and your role cannot create locations. Ask an administrator to create it, then import again.`,
        };
      }
      if (!allowed.has(Number(id))) {
        return { ok: false, msg: `Not allowed to create items in location '${name}'` };
      }
    }
    return { ok: true };
  }

  if (writableScope.dimension === 'category') {
    const allowed = new Set(writableScope.values || []);
    for (const name of categoryNames) {
      if (!allowed.has(name)) {
        return { ok: false, msg: `Not allowed to create items in category '${name}'` };
      }
    }
    return { ok: true };
  }

  return { ok: false, msg: 'Not allowed to create items in this company' };
}

module.exports = {
  MAX_IMPORT_UNITS,
  IMPORT_BATCH_SIZE,
  ImportValidationError,
  validateImportBody,
  distinctLocationNames,
  distinctCategoryNames,
  buildCompanyLocationsQuery,
  indexLocationsByKey,
  normalizeLocationKey,
  buildExistingSerialsQuery,
  checkImportScope,
  subLocationSegments,
  parseCost,
};
