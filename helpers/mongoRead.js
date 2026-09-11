'use strict';

/**
 * Lecturas de Mongo desde una secundaria, por consulta y nunca de forma global.
 *
 * POR QUÉ NO EN LA CONEXIÓN. Poner `readPreference: "secondaryPreferred"` en
 * `mongoose.connect` es una línea y es tentador, pero manda a una secundaria
 * **todas** las lecturas: la validación de sesión, la caché de idempotencia, y
 * el `find` que un controlador hace justo después de escribir. El replica set
 * de Atlas va por detrás —normalmente milisegundos, a veces segundos—, así que
 * eso produce exactamente los bugs de `DESIGN_read_write_split.md` §5: creas un
 * estudiante y no aparece en el roster, y los logs dicen que todo fue bien.
 *
 * Así que se activa consulta a consulta, y solo donde el retraso da igual.
 *
 * CUÁNDO SÍ:
 *   - Listados de diagnóstico y auditoría.
 *   - Informes, exportaciones y agregados de panel.
 *   - Búsquedas y navegación, si nadie acaba de escribir lo que busca.
 *
 * CUÁNDO NO, y esto no es negociable:
 *   - Autenticación y validación de sesión. Un token revocado hace dos
 *     segundos tiene que estar revocado.
 *   - Idempotencia: su trabajo es ver la escritura anterior.
 *   - Comprobar-y-luego-escribir. Verificar stock antes de asignar leyendo de
 *     una secundaria es cómo se asigna dos veces el mismo equipo.
 *   - Cualquier cosa dentro de una transacción o con `session`.
 *   - Pagos, en cualquier forma.
 *
 * INTERRUPTOR: `MONGO_SECONDARY_READS=off` devuelve todo al primario sin tocar
 * código ni desplegar. Si algún día el retraso de replicación causa un
 * problema, esa variable es el rollback.
 *
 * NOTA SOBRE EL BENEFICIO REAL: si el cluster de Atlas es de tier compartido, o
 * si la cadena de conexión apunta a un solo nodo, `secondaryPreferred` cae al
 * primario y esto no hace nada — tampoco rompe nada. Conviene confirmar el tier
 * antes de contar con la ganancia.
 */

/** Se lee en cada llamada, no al cargar el módulo, para que los tests puedan alternarlo. */
const secondaryReadsEnabled = () =>
  String(process.env.MONGO_SECONDARY_READS || "on").toLowerCase() !== "off";

/**
 * Marca una consulta de mongoose para que pueda servirla una secundaria.
 *
 * `secondaryPreferred` y no `secondary`: si no hay secundarias disponibles cae
 * al primario en vez de fallar. Una lectura de diagnóstico no debe romperse
 * porque el replica set esté en elección.
 *
 * Devuelve la misma consulta, así que encadena igual que antes:
 *   fromSecondary(Model.find(filtro)).sort({ createdAt: -1 }).limit(100)
 */
const fromSecondary = (query) => {
  if (!query || typeof query.read !== "function") return query;
  if (!secondaryReadsEnabled()) return query;
  return query.read("secondaryPreferred");
};

module.exports = { fromSecondary, secondaryReadsEnabled };
