'use strict';

/**
 * CATALOGO DEL ASISTENTE DE STAFF — la lista cerrada de lo que se puede preguntar.
 *
 * Todo lo de aqui es PURO: ni Mongo, ni SQL, ni red. Decide QUE pregunta se ha
 * hecho; traerla es trabajo del controlador. Asi la parte que decide se puede
 * probar sin una base delante, que es lo unico que la mantiene honesta — el
 * mismo reparto que `helpers/platformConsole.js`.
 *
 * POR QUE UNA LISTA CERRADA Y NO TEXTO LIBRE
 *
 * Un asistente convierte lo que escribe una persona en lecturas de datos. Eso
 * hace que el texto de entrada sea entrada NO FIABLE, igual que lo es un fichero
 * subido. La defensa no es redactar mejor el prompt: es que lo que el asistente
 * puede pedir sea un identificador de esta lista y nada mas. Una pregunta
 * manipulada, en el peor caso, devuelve otra de las respuestas que esa persona
 * ya podia ver.
 *
 * Es el mismo razonamiento que PLATFORM_RESOURCES en platformConsole.js: si el
 * recurso fuera un segmento que se pasa a ciegas, "que puede leer el asistente"
 * se contestaria mirando al cliente.
 *
 * EL EMPAREJADOR DE ESTA VERSION NO USA UN MODELO, y es deliberado.
 *
 * Un modelo traduce "que equipos tengo fuera" a `company_devices_out`. Hace eso
 * y solo eso, y hacerlo bien con lenguaje libre es exactamente donde un modelo
 * gana. Pero un modelo alojado fuera significa que el texto que escribe el staff
 * sale de la frontera del sistema, y eso es una entrada en el diagrama de flujo
 * de datos del SSP (APP-2026-001). Empezar por palabras clave da el circuito
 * entero —sesion, compañia, alcance, catalogo, auditoria— sin mover la frontera,
 * y deja el modelo como una MEJORA del emparejamiento y no como un cimiento: el
 * dia que se añada, si hay que quitarlo, el asistente sigue de pie.
 *
 * `matchQuestion` y `validateChoice` estan separadas a proposito. Cuando el
 * emparejador sea un modelo, lo que cambia es la primera; `validateChoice`
 * —recortar a la lista— sigue siendo la misma funcion, porque la eleccion de un
 * modelo tambien es entrada no fiable.
 */

/** Tope de la pregunta. Acordado con el dashboard el 2026-11-23. */
const MAX_QUESTION_LENGTH = 1000;

/** Mismo vocabulario que el console (`RANGES` en platformConsole.js). */
const RANGES = Object.freeze(['7d', '30d', '90d']);
const DEFAULT_RANGE = '30d';

/** Mismos topes que el console. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/**
 * LAS PREGUNTAS.
 *
 * `resource` es el recurso de COMPANY_RESOURCES al que pertenece: lo escribe la
 * fila de auditoria, para que "que leyo el asistente" se pueda contar con el
 * mismo vocabulario que el resto del sistema.
 *
 * LO QUE NO ESTA AQUI, Y ES LA DECISION MAS IMPORTANTE DE ESTE FICHERO: nada que
 * hoy se devuelva `null`. Ni importes ni equipos vencidos.
 *
 * El dinero no esta guardado —ninguno de los dos modelos de transaccion tiene el
 * importe, vive solo en Stripe— y `devicesOverdue` aun no se calcula. Un
 * asistente que conteste "no veo equipos vencidos" cuando la verdad es "eso no
 * se calcula" construye en lenguaje natural el mismo fallo por el que el
 * dashboard retiro su pastilla de Overdue el 2026-11-20 — y peor, porque una
 * frase no parece una casilla vacia. Una casilla vacia se nota; una frase
 * serena, no.
 *
 * Entran en el catalogo el dia que los datos existan, no antes.
 */
const CATALOG = Object.freeze([
  {
    id: 'company_devices_out',
    resource: 'inventory',
    label: 'Equipos fuera del almacen ahora mismo',
    // AFINA al resumen de inventario: "cuantos equipos tengo FUERA" es la misma
    // pregunta mas una palabra, y esa palabra es la que decide. Sin esta
    // relacion gana el resumen, porque "cuantos equipos" es una cadena mas larga
    // que "fuera" — el peso por longitud premia lo generico cuando lo generico
    // se dice con mas letras. Lo encontro un test.
    refines: 'company_inventory_summary',
    // Sin `limit`: esta pregunta devuelve un CONTEO, no una lista. Listar
    // aparatos obligaria a nombrar columnas de `item_inv` y ahi ya hay un
    // historial de claves equivocadas; el conteo se construye con las dos
    // columnas que el console ya usa (company_id, warehouse) y es ademas lo que
    // la pregunta pide de verdad. La lista esta a un clic, en su pagina.
    params: [],
    keywords: [
      'fuera', 'afuera', 'salidos', 'prestados', 'entregados', 'en la calle',
      'out', 'checked out', 'on loan', 'lent', 'deployed',
    ],
  },
  {
    id: 'company_inventory_summary',
    resource: 'inventory',
    label: 'Resumen de inventario: cuantos equipos hay y cuantos estan fuera',
    params: [],
    keywords: [
      'inventario', 'cuantos equipos', 'cuantos aparatos', 'cuantos dispositivos',
      'total de equipos', 'resumen de inventario',
      'inventory', 'how many devices', 'device count', 'stock',
    ],
  },
  {
    id: 'company_events_active',
    resource: 'events',
    label: 'Eventos activos ahora mismo',
    params: ['limit'],
    keywords: [
      'eventos', 'evento activo', 'eventos activos', 'eventos abiertos',
      'que eventos', 'eventos en curso',
      'events', 'active events', 'open events', 'ongoing',
    ],
  },
  {
    id: 'company_staff_list',
    resource: 'staff',
    label: 'Miembros del staff activos y su rol',
    params: ['limit'],
    keywords: [
      'staff', 'personal', 'empleados', 'miembros', 'quien trabaja', 'equipo humano',
      'usuarios', 'team', 'employees', 'members', 'who works',
    ],
  },
  {
    id: 'company_subscription_status',
    resource: 'subscription',
    label: 'Plan y estado de la suscripcion',
    params: [],
    keywords: [
      'plan', 'suscripcion', 'subscripcion', 'mi plan', 'que plan',
      'estado de la cuenta', 'subscription', 'billing status', 'my plan',
    ],
  },
  {
    id: 'company_activity_recent',
    resource: 'activity',
    label: 'Actividad reciente del staff',
    params: ['range', 'limit'],
    keywords: [
      'actividad', 'ultimos movimientos', 'que ha pasado', 'historial',
      'reciente', 'ultimas acciones', 'registro',
      'activity', 'recent activity', 'what happened', 'history', 'log',
    ],
  },
]);

/**
 * LA SALIDA HONESTA. No es relleno.
 *
 * Sin ella, una lista cerrada obliga a elegir lo mas parecido, y lo mas parecido
 * a una pregunta que no esta en la lista es una respuesta equivocada dicha con
 * aplomo. Ademas, las preguntas que caen aqui SON la lista de lo que al catalogo
 * le falta: es la unica evidencia real de si hace falta un diseño mas capaz, y
 * hoy no la tiene nadie.
 */
const UNSUPPORTED = 'unsupported';

const CATALOG_IDS = Object.freeze(CATALOG.map((q) => q.id));
const byId = new Map(CATALOG.map((q) => [q.id, q]));

const isKnownQuestion = (id) => byId.has(String(id || ''));
const questionById = (id) => byId.get(String(id || '')) || null;

/**
 * Normaliza para comparar: minusculas, sin tildes y sin puntuacion.
 *
 * Sin tildes a proposito: "cuantos" y "cuántos" son la misma palabra para quien
 * pregunta con prisa, y un asistente que distingue entre las dos esta castigando
 * a quien escribe rapido.
 */
const normalize = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Rango pedido, si la pregunta lo nombra. Cualquier otra cosa es el de por defecto. */
const readRangeFromText = (normalized) => {
  if (/\b(hoy|ayer|esta semana|ultimos 7|ultima semana|this week|last 7|past week)\b/.test(normalized)) {
    return '7d';
  }
  if (/\b(trimestre|ultimos 90|90 dias|quarter|last 90|past 90)\b/.test(normalized)) {
    return '90d';
  }
  if (/\b(mes|ultimos 30|30 dias|month|last 30|past 30)\b/.test(normalized)) {
    return '30d';
  }
  return null;
};

/**
 * Empareja la pregunta con UNA entrada del catalogo.
 *
 * Puntua por palabra clave encontrada, y da mas peso a las mas largas: "eventos
 * activos" dice mas que "eventos", y quien escribe lo primero esta siendo mas
 * concreto. Un empate a cero es `unsupported`, nunca la primera de la lista.
 *
 * @returns {{question_id: string, params: object, confidence: number,
 *            reason: string, matched: string[]}}
 */
const matchQuestion = (text) => {
  const normalized = normalize(text);

  if (!normalized) {
    return {
      question_id: UNSUPPORTED,
      params: {},
      confidence: 0,
      reason: 'la pregunta llego vacia',
      matched: [],
    };
  }

  const hits = [];
  for (const question of CATALOG) {
    const matched = question.keywords.filter((k) => normalized.includes(normalize(k)));
    if (matched.length === 0) continue;
    // El peso es la longitud de lo que caso, no cuantas casaron: una frase larga
    // que coincide es mejor señal que tres palabras sueltas.
    const score = matched.reduce((total, k) => total + normalize(k).length, 0);
    hits.push({ question, matched, score });
  }

  let best = hits.reduce((top, hit) => (!top || hit.score > top.score ? hit : top), null);

  /**
   * UNA AFINACION GANA A LO QUE AFINA, aunque puntue menos.
   *
   * "cuantos equipos tengo fuera" casa con el resumen de inventario por
   * "cuantos equipos" (15 letras) y con los equipos fuera por "fuera" (5). Por
   * peso gana el resumen, y la respuesta seria el numero equivocado: la palabra
   * corta era la que distinguia. El peso por longitud premia lo generico cuando
   * lo generico se dice con mas letras, y ninguna puntuacion arregla eso sola.
   *
   * Asi que la relacion se declara: si una entrada que AFINA a la ganadora
   * tambien caso, manda ella. Es un bucle y no un `if` porque una cadena de
   * afinaciones es concebible; hoy solo hay un eslabon.
   */
  const matchedIds = new Set(hits.map((h) => h.question.id));
  let guard = CATALOG.length;
  while (best && guard-- > 0) {
    const refinement = hits.find(
      (h) => h.question.refines === best.question.id && matchedIds.has(h.question.id)
    );
    if (!refinement) break;
    best = refinement;
  }

  if (!best) {
    return {
      question_id: UNSUPPORTED,
      params: {},
      confidence: 0,
      reason: 'ninguna pregunta del catalogo encaja',
      matched: [],
    };
  }

  const params = {};
  if (best.question.params.includes('range')) {
    params.range = readRangeFromText(normalized) || DEFAULT_RANGE;
  }
  if (best.question.params.includes('limit')) {
    params.limit = DEFAULT_LIMIT;
  }

  return {
    question_id: best.question.id,
    params,
    // Deliberadamente modesta: esto es emparejar palabras, no entender. El numero
    // sirve para ordenar y para decidir si conviene pedir que lo reformulen; no
    // para presumir de acierto.
    confidence: Math.min(1, best.score / 20),
    reason: `casaron: ${best.matched.join(', ')}`,
    matched: best.matched,
  };
};

/**
 * Recorta una eleccion a lo que el catalogo admite.
 *
 * ESTA FUNCION ES LA FRONTERA, y por eso no comparte codigo con `matchQuestion`:
 * hoy la eleccion la hace nuestro emparejador y se podria confiar en ella; el dia
 * que la haga un modelo, la eleccion sera entrada no fiable y esta funcion tiene
 * que seguir siendo suficiente ella sola.
 *
 * Los parametros se RECONSTRUYEN, no se copian. Lo que no este nombrado aqui no
 * pasa, asi que un campo inventado no llega nunca a una consulta.
 */
const validateChoice = (choice = {}) => {
  const askedId = String(choice.question_id || '');
  const question = questionById(askedId);

  if (!question) {
    return {
      question_id: UNSUPPORTED,
      params: {},
      reason: askedId ? `"${askedId}" no esta en el catalogo` : 'sin pregunta',
    };
  }

  const params = {};

  if (question.params.includes('range')) {
    const asked = String(choice.params?.range || '');
    params.range = RANGES.includes(asked) ? asked : DEFAULT_RANGE;
  }

  if (question.params.includes('limit')) {
    const asked = Math.floor(Number(choice.params?.limit));
    params.limit =
      Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;
  }

  return {
    question_id: question.id,
    params,
    reason: choice.reason ? String(choice.reason).slice(0, 300) : null,
  };
};

/**
 * Lo que se le ofrece a quien pregunta algo que no esta en el catalogo.
 *
 * Decir "no se" y callar es peor que no contestar: deja a la persona adivinando
 * si el problema es la pregunta o el asistente. Esto le enseña la lista.
 */
const catalogOffer = () =>
  CATALOG.map((q) => ({ id: q.id, label: q.label }));

/** Longitud valida de una pregunta. El cliente aplica el mismo tope. */
const checkQuestionLength = (text) => {
  const value = String(text ?? '');
  if (!value.trim()) return { ok: false, msg: 'The question is empty.' };
  if (value.length > MAX_QUESTION_LENGTH) {
    return { ok: false, msg: `The question exceeds ${MAX_QUESTION_LENGTH} characters.` };
  }
  return { ok: true };
};

module.exports = {
  CATALOG,
  CATALOG_IDS,
  UNSUPPORTED,
  MAX_QUESTION_LENGTH,
  RANGES,
  DEFAULT_RANGE,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  normalize,
  isKnownQuestion,
  questionById,
  matchQuestion,
  validateChoice,
  catalogOffer,
  checkQuestionLength,
};
