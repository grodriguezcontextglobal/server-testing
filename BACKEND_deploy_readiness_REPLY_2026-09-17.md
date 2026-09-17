# Respuesta: la de una línea es NO, y la tanda 1 ya está desplegada

> Responde a `FRONTEND_deploy_readiness_2026-09-17.md`.
> Dos cosas primero, porque cambian vuestro calendario:
> **(1)** vuestra pregunta de la §1.5 tiene respuesta y es la que temíais;
> **(2)** la tanda 1 no hay que pedirla — está arriba desde hoy.

---

## 1 · §1.5 — **NO.** El servidor desplegado NO acepta el cuerpo sin `company_id`

**Vuestro orden es obligatorio, no una precaución.**

Lo que corre ahora mismo en producción es la rama `release/observabilidad`, que
**no** incluye `6ff962c`. Así que el handler desplegado es el de siempre:

```js
// mysql/routes/inventory.js — la ruta sigue ANÓNIMA hoy
router.post("/update-location-sub-location", updateSubLocation);

// mysql/controllers/item.js — y el handler exige company_id en el CUERPO
const { newName, path, currentIndex, company_id } = req.body;
if (!newName || !Array.isArray(path) || currentIndex === undefined ||
    !company_id || path.length === 0) {
  return res.status(400).json({
    message: "Missing required fields: newName, path (array), currentIndex, and company_id",
    success: false,
  });
}
```

Vuestro contrato generado en `src/docs` está **al día** en esto: `company_id`
sigue siendo requerido en el servidor desplegado.

**Consecuencia, confirmando lo que escribisteis:** si publicáis vuestro build con
`2b1cbe93` antes de nuestra tanda 2, el renombrado de locaciones responde **400 a
todo el mundo**, no solo a quien haya cambiado de compañía. La ventana ancha es
real.

Así que el orden de vuestra §1.5 queda fijado:

```
1. VM del servidor  → tanda 2
2. VM del dashboard → vuestro build
```

Y sí: al revés el fallo alcanza a cualquiera que renombre una locación. No lo
hagáis en ese orden.

> **Ojo con una cosa más del mismo punto:** esa ruta está **anónima** hoy. Vuestra
> verificación local del §1.7 punto 1 tiene que correr contra el servidor
> **endurecido** (rama `main`), no contra el desplegado, o dará un falso positivo:
> el de hoy acepta la llamada sin token y con `company_id`, que es justo lo que
> vais a dejar de mandar.

---

## 2 · La tanda 1 ya está desplegada — desde hoy

No hace falta pedirla. Producción corre `release/observabilidad`, que incluye
`94d7076`. Comprobado desde fuera, contra el host público:

```
GET https://db.devitrak.net/api/db_item/serial-suggest   ->  401
```

Un **401** significa que la ruta existe y pide token. Antes de hoy habría sido un
**404**. Las tres están vivas: `inventory-page`, `inventory-facets` y
`serial-suggest`.

**Podéis encender vuestro flag en local contra producción cuando queráis**, para
verificar el contrato del §1.7 punto 3.

### Y va bastante más que la tanda 1

Conviene que vuestro modelo mental cuadre con lo que hay. Lo desplegado hoy es
todo lo NO rompedor, no solo las tres rutas:

| Ya en producción | |
|---|---|
| `/ready` | readiness real: MySQL, Mongo, Redis y worker de Go, con detalle por dependencia |
| `/api/metrics` | latencia, tráfico, bytes y 4xx/5xx **por endpoint**, del cluster entero |
| Página pública de estado | sobre `/ready` |
| `94d7076` | las tres rutas nuevas de inventario |
| `395bba6` | bytes por endpoint |
| Control de acceso de `/api/company` | **en modo observación**: registra, no bloquea |
| Lecturas de Mongo desde secundaria, grupo `heavy` de la cola | interno |

Lo que **no** está: los cinco de ruptura. Siguen aparcados en `origin/main`,
fuera de producción.

---

## 3 · Vuestras tres preguntas: ya están contestadas

Se cruzaron los documentos. Las respondimos ayer en
**`BACKEND_answers_2026-09-17.md`**. Resumen:

### 3.1 · ¿`/api/stripe/*` = `/api/db_stripe/*`? → **Estáis cubiertos**

**El error era nuestro, en el documento.** Son dos ficheros distintos:

| Fichero | Se monta en | ¿Idempotencia? |
|---|---|---|
| `routes/stripe.js` | **`/api/stripe`** | **sí, las 8 rutas** |
| `mysql/routes/stripe.js` | `/api/db_stripe` | no — solo `consulting-stripe` y `new_stripe` |

Nuestro §6 escribió el prefijo mal. **Las protegidas son exactamente las cuatro
operaciones que llamáis**, así que el 409 os llega y `21896b77` era el trabajo
correcto. **La tanda 3 se desbloquea.**

**Pero hay un hueco real, y lo destapó vuestro dato del importe editable.** La
clave, sin cabecera, se deriva de método + ruta + params + cuerpo. Entonces:

| Dos capturas del mismo depósito | ¿Las colapsa? |
|---|---|
| Mismo importe | **Sí** — 409 o la respuesta guardada |
| **Importe distinto** | **No** — cuerpos distintos, claves distintas, las dos ejecutan |

En ese segundo caso lo único que frena la doble captura es **Stripe**, que
rechaza un `payment_intent` ya capturado. Es un backstop, no un diseño.

**Si lo queréis cerrar, está en vuestra mano:** mandad `Idempotency-Key` con algo
estable por operación —el id del depósito, **no el importe**—. La cabecera tiene
precedencia sobre la clave derivada.

### 3.2 · ¿Cuáles de las catorce estaban bajo el `/:id`? → **Ninguna de vuestras siete**

Mirado en el fichero de rutas, y **contra la versión que corre en producción**
(`c13cfd2`), no contra desarrollo — porque preguntabais por daño ya ocurrido.
`router.post("/:id")` está en la **línea 101**; vuestras siete, entre la 51 y la
90. **No hay borrados históricos por esa vía.**

Un dato de vuestra columna «muy usadas» que sí importa: **`delete-item` (20
llamadas) SÍ estaba por debajo** —línea 104—. No pasó nada porque `/:id` apuntaba
**al mismo handler**, que ignora el parámetro de la URL. Es el ejemplo que
sostiene la corrección de método.

### 3.3 · Rol de locación sin scope en SQL → **fail-closed, tabla vacía**

`buildInventoryScopeFilter` devuelve `1=0`. Es el segundo de vuestros dos
finales, **no el inseguro**: nadie ve inventario que no le toca.

Sobre el backfill: aceptado, y **no empieza de cero** —
`mysql/scripts/migrate-roles.js:126` ya lee `preference.managerLocation`. Hay que
revisarlo y volver a correrlo, no escribirlo. Tres cosas explican que falten
filas hoy, y están en el documento completo. La principal: **mapea por nombre y
descarta en silencio lo que no resuelve**, que es exactamente vuestro síntoma.

Y os devolvemos una: **el backfill solo es una cinta de correr** mientras la
pantalla antigua siga escribiendo únicamente en Mongo. ¿Quién la retira?

---

## 4 · Una corrección a vuestra §1.5, sobre el modal de depósitos

Escribisteis que ante un 409 el texto *"The deposit was not captured. Nothing was
charged."* sería falso y peligroso. Tenéis razón, **y es peor: ya falla hoy**.

Hoy, una captura duplicada con el mismo importe llega a Stripe, que la rechaza
por PI ya capturado → error → el modal dice «no se cobró nada» cuando la primera
**sí cobró**. El 409 no crea el problema; solo cambia de dónde viene el error.

**No es un riesgo que introduzca nuestro despliegue: es un bug vivo.** Merece
arreglarse aunque la tanda 3 se retrase.

---

## 5 · Compromisos, por los dos lados

**Nuestros:**

1. ✅ Tanda 1 — **hecha**, hoy.
2. Tanda 2 — cuando nos aviséis de que vuestro build está arriba. **Nosotros
   primero, vosotros después** (§1).
3. Os avisamos el mismo día, para vuestro smoke test de 15 minutos.
4. Tanda 3 — desbloqueada por nuestra parte (§3.1). Cuando queráis.

**Lo que esperamos de vosotros:**

1. La verificación local conjunta del §1.7 — contra la rama `main` del servidor,
   no contra lo desplegado (ojo del §1).
2. Aviso de que vuestro build está publicado.
3. Si mandaréis `Idempotency-Key` en las capturas (§3.1).
4. Quién retira la pantalla antigua de locaciones (§3.3).

---

## 6 · Sobre vuestra §5, «cómo sabremos que salió bien»

Buena noticia: `/api/metrics` **ya es legible**. Hasta hoy respondía 403 a todo
el mundo —el gate miraba un flag que no concedía nadie—, y ahora hay un rol de
solo lectura para observabilidad.

Vuestro plan de mirar `s4xx` por ruta funciona tal cual. Dos avisos para que no
os engañe:

- **La ventana son 3 horas, no 24-48.** Hay que muestrear varias veces al día y
  guardar la salida. Una ruta poco llamada puede dar **cero** en una ventana sin
  que eso signifique que nadie la usa.
- **Las cuatro rutas que dan 401 siguen dándolo hoy**, porque el arreglo va en la
  tanda 2. O sea que su contador plano **antes** de la tanda 2 confirma
  exactamente lo que nos dijisteis: que no las llama nadie.
