# Contraste del informe contra el repositorio · 2026-09-28

> Verificación de *Devitrak FedRAMP Readiness* (16-sep, contra `origin/main @ a92b942`)
> contra el estado real del código **doce días después**.
>
> El informe dice que todos sus hallazgos son análisis estático y que no se
> llamó a ningún endpoint. **Aquí sí se ha ejecutado**: contra el repositorio,
> contra la rama que corre producción y, donde hacía falta, contra la base de
> datos.

---

## 0. Antes de nada: mi plan anterior estaba mal en tres puntos

`PLAN_fedramp.md`, que escribí ayer, se apoyaba en la estructura del programa
**anterior a la reforma de 2026**. El informe está mejor documentado y lo
corrige:

| Yo decía | La realidad de 2026 |
|---|---|
| Hace falta **patrocinador de agencia** | **No**, para las Clases A, B y C se autonomina. Solo la D lo exige |
| La Etapa 4 es **FedRAMP Ready** | **Ready pasó a legado el 28-jul-2026.** No se admiten nuevas solicitudes |
| Hay que **re-plataformar a GovCloud** para ser elegible | **No existe tal requisito** en el ruleset de 2026. Lo que mata la VM de Windows es la familia PE (fuego, energía), no la nube |

Además, el informe aporta dos cosas que yo no tenía: la vía de **exclusión por
uso de agencia** (despliegue de inquilino único dentro de la nube de la propia
agencia, fuera del alcance de FedRAMP) y que **GovRAMP vale como credencial de
entrada** a la Clase A. Eso convierte el camino de K-12 y el federal en uno solo.

**Dad por bueno el informe y no mi plan de ayer.** Lo que sigue es lo que puedo
aportar encima: verificación y una corrección de calendario.

---

## 1. Los ocho hallazgos, verificados hoy

| # | Hallazgo del informe | Estado real, 28-sep |
|---|---|---|
| 1 | Secretos publicados y sin rotar | 🔴 **CONFIRMADO Y PEOR DE LO DESCRITO** — ver §1.1 |
| 2 | 4 secretos en el bundle de Vite | ⚪ No verificable desde aquí (repositorio del frontend) |
| 3 | `NODE_ENV` + fuga del OTC de consentimiento | 🟡 **MITAD ARREGLADO** — ver §1.2 |
| 4 | `POST /api/admin/users` sin autenticación | 🔴 CONFIRMADO — `routes/admin.js:104`, `router.post("/users", showAllUsers)` sin middleware |
| 5 | Presigner de S3 sin autenticación | 🔴 CONFIRMADO — `routes/document.js`, `router.post("/download/documentUrl", generateTemporaryDownloadUrl)` |
| 6 | Hashes de contraseña servidos al navegador | 🔴 CONFIRMADO — `controller/admin.js:661` y `:678`, `AdminUser.find(request.body)` sin `.select("-password")` |
| 7 | Cualquiera cierra la sesión de toda la plataforma | 🔴 CONFIRMADO — `routes/admin.js:42`, `invalidate-all-sessions` con `optionalJWT`, que nunca rechaza |
| 8 | Audit log forjable y público | 🔴 CONFIRMADO — `routes/transactionAuditLog.js:12,15`, las dos rutas desnudas |

### 1.1 Los secretos: la cifra exacta

La rama `archive/development-2026-03` **sigue publicada en origin** (`3e29d9f`),
con su `.env` versionado. Comparé sus valores con el `.env` actual **por huella
SHA-256, sin imprimir ninguno**:

```
variables sensibles en la rama archivada: 18
  IDÉNTICAS al .env actual: 11
  distintas: 4        no presentes en el .env actual: 3
```

Las once idénticas incluyen **`SECRET_JWT_SEED`**, **`STRIPE_SECRET_KEY`**, la
URI de Mongo (`DB_AUTHENTICATION_CNN`), `TWILIO_AUTH_TOKEN`,
`CLOUDINARY_API_SECRET`, `TURNSTILE_SECRET_KEY` y las dos claves VAPID.

**`SECRET_JWT_SEED` es la que convierte todo lo demás en secundario.** Con esa
semilla se puede **firmar un token válido para cualquier usuario, incluido uno
con `super_user`**. Mientras siga publicada, discutir qué ruta lleva
`validateJWT` es discutir la cerradura de una puerta cuya llave está colgada
fuera.

### 1.2 `NODE_ENV`: la mitad que sí se arregló

- ✅ **La fuga del OTC ya no existe.** `requestConsent` devuelve hoy
  `consent_id`, `status`, `expires_at` y `guardian_email` — el enlace con el
  código va **solo en el correo**. Lo cerró el trabajo de `otc → otc_hash`
  (agosto).
- 🔴 **La otra mitad sigue viva.** `NODE_ENV` no está definida en el `.env`, y
  `controller/admin.js:64` y `:874` hacen
  `secure: process.env.NODE_ENV === "production"`. En producción eso evalúa a
  **falso**: las cookies de sesión salen sin el flag `secure`. Sigue siendo el
  arreglo de una línea que dice el informe.

### 1.3 La escala, medida hoy contra la rama que corre producción

Conté las rutas de `routes/` y `mysql/routes/` en `release/observabilidad`,
tratando como autenticada cualquiera que lleve **algún** middleware de identidad
—incluido `optionalJWT`, que ni siquiera rechaza— y contando los `router.use`:

```
rutas totales: 505  |  sin NINGÚN middleware: 342  (67,7 %)
```

El informe decía ~337 de 510 (66 %) de superficie efectivamente no autenticada.
**Mi conteo independiente lo corrobora**, y es un criterio más estricto: esas 342
no tienen absolutamente nada.

---

## 2. Lo que ha cambiado en doce días

No todo es deuda. Estas dos semanas movieron una de las familias que el informe
marca como pendiente:

| Familia | El informe decía (16-sep) | Hoy |
|---|---|---|
| **SI-4 · Monitorización** | *"No alerting. El equipo lo dice: «no hay alertas», y un desajuste de puerto del worker de Go tumbó el inventario semanas sin detección"* | 🟢 **Cerrado en lo esencial.** Uptime Kuma en la VM con 5 sondeos y 6 latidos; vigilante externo en Cloudflare con página de estado pública; alertas a Teams verificadas de punta a punta; *dead-man switch* en los schedulers diarios. Ese fallo del puerto hoy se detecta en ~6 minutos |
| **AC-3 · Autorización por defecto** | *"Rearquitectura: el arreglo es una lista blanca de rutas públicas"* | 🟡 **El patrón ya existe y está probado** — ver §3 |

Y una que empeoró **por decisión explícita**: `POST /api/staff/force-logout`
dejó de exigir contraseña el 23-sep. Es la misma clase que el hallazgo 7.

---

## 3. La aportación concreta: el arreglo de AC-3 ya está escrito

El informe llama a AC-3 *"rearquitectura"* y le pone el peso máximo. Es el
diagnóstico correcto, pero **el patrón ya lo construimos esta semana, sobre el
peor fichero del repositorio**.

`routes/stripe.js` tenía 46 rutas en las que el límite de peticiones y la
idempotencia se ponían **ruta a ruta**: 6 y 9 las tenían respectivamente. El
25-sep pasaron al router:

```js
router.use(optionalJWT);
router.use(publicPaymentRateLimit);
router.use(idempotencyOnMutations);
```

…más `test/stripeRouterGuards.test.js`, que **falla si alguien vuelve a montar
una ruta sin ellos** o los duplica. Una tarde de trabajo, el fichero más
enrevesado que hay, y con invariante comprobable.

**Eso es exactamente la arquitectura de lista blanca que pide AC-3**, solo que
aplicada a un fichero en vez de a los 505. La diferencia entre «rearquitectura»
y «tarea grande pero conocida» es que ya sabemos cuánto cuesta por fichero y
tenemos el test que lo sostiene.

No lo digo para rebajar el hallazgo: 342 rutas siguen desnudas y la tenencia se
resuelve desde una cabecera del cliente, que es el problema de verdad. Lo digo
porque **el plan del informe para Fase 1 tiene ya su plantilla**, y eso mueve la
estimación.

---

## 4. Dónde estamos, en una frase por gate

1. **Sin certificación previa cualificante** (SOC 2 II / GovRAMP / FedRAMP
   Rev5 en 12 meses) → **cerrado**, y no se abre este año.
2. **Sin cliente federal** → **cerrado**, y ninguna cantidad de ingeniería lo
   abre.
3. **Auto-alojados** → **cerrado hasta 2027**, con fecha de posible apertura
   (RFC-0033 Track 2).

Y por debajo de los tres: **la llave de firma de tokens está publicada.** Ningún
marco —FedRAMP, GovRAMP, SOC 2 o el propio contrato con Bridges— se supera con
eso vivo.

---

## 5. El plan óptimo, y por qué es el del informe

**Adoptad la secuencia del informe.** Está mejor investigada que la mía y ordena
por retorno comercial, no por pulcritud de cumplimiento. Solo le haría tres
ajustes, todos de calendario:

### Ajuste 1 · La Fase 0 es de días, pero necesita una ventana

Rotar `SECRET_JWT_SEED` **invalida todos los tokens emitidos**: cierra la sesión
de todo el mundo a la vez. Eso no se hace un martes por la tarde. El resto de la
Fase 0 —las cinco rutas, `NODE_ENV`, los hashes— sí es de días.

**Orden dentro de la Fase 0**, que el informe no fija y sí importa:

1. `NODE_ENV=production` y las cinco rutas. Horas. No rompe nada.
2. Los hashes de contraseña, backend y frontend a la vez. Coordinado.
3. **Rotar los once secretos**, con la semilla del JWT en una ventana anunciada,
   y **purgar la rama**. Rotar sin purgar deja la próxima filtración preparada.

### Ajuste 2 · La Fase 1 tiene una parte ya pagada

SI-4 está cerrado (§2) y AC-3 tiene plantilla (§3). De los cinco bloques de la
Fase 1, el de monitorización ya no cuenta y el de enrutado default-deny tiene un
coste conocido por fichero. Las otras tres piezas —reconciliar los tres sistemas
de autorización, tenencia resuelta en el servidor, y CI con revisión
obligatoria— siguen intactas, y la de la tenencia es la más cara.

**Sigo estimando las dos quintas partes del informe**, pero con menos varianza.

### Ajuste 3 · Añadir CP-9 a la Fase 0, no a la 1

El informe pone los respaldos en la Fase 1 y marca CP-9 como *"days"*. **No hay
copias de seguridad de nada**, y esta semana comprobamos en carne propia lo que
cuesta no vigilar lo que se cree vigilado. Una copia con restauración probada
cuesta días y elimina el riesgo de perderlo todo, que es mayor que cualquier
hallazgo de esta lista salvo la semilla del JWT.

---

## 6. Calendario, sumando lo verificado

| Cuándo | Qué | Coste |
|---|---|---|
| **Esta semana** | Fase 0 + respaldos. `NODE_ENV`, cinco rutas, hashes, rotación y purga, copia con restauración probada | ~1 semana de ingeniería |
| **Antes del 9-oct** | Comentar RFC-0033 Track 2. Es la única fecha con vencimiento | horas |
| **Esta semana** | Los cinco correos gratis del informe: BIE, DoDEA, dónde está el servidor, qué llama `app.devitrak.net`, y GovRAMP sobre el SOC 2 | ~0 |
| **Q4 2026** | Fase 2 (contratos SDPC + DC Code) y 2b (GovRAMP Snapshot) | $1.500 |
| **Q4 26 – Q1 27** | Fase 1. Default-deny, tenencia servidor, CI, staging | ~2 trimestres de dos ingenieros |
| **2027** | SOC 2 Tipo II tras la Fase 1 | $25–150k |
| **2027** | GovRAMP Core | ~$10,5k/año |
| **2028-29** | FedRAMP **solo si aparece un dólar federal** | condicional |

**Hasta FedRAMP: 18-30 meses, y el informe acierta en que casi nada de eso es
cola del gobierno — es trabajo nuestro.** Hasta algo vendible a Bridges y a
distritos: **este trimestre**.

---

## 7. La pregunta que yo también haría

El informe cierra con *"¿por qué queréis FedRAMP?"* y ofrece como una de las
respuestas plausibles: *"nuestra seguridad es mala y queremos un forzador"*.

Desde el código, y con los ocho hallazgos verificados delante, esa hipótesis
encaja con lo que veo. Si es esa, el informe tiene razón: **el forzador sale
mucho más barato por la Fase 0 y la Fase 1 que por una certificación federal**, y
llega antes.

---

## Lo que este contraste no afirma

- No verifiqué los cuatro secretos del bundle de Vite: ese repositorio no está
  aquí.
- «Idéntico al `.env` actual» significa el `.env` de esta máquina de desarrollo.
  El informe afirma haberlos verificado contra el `.env` **de producción**; las
  dos afirmaciones son coherentes, pero no he comprobado esa segunda.
- No he validado ninguna cifra de coste ni de plazo del programa. Las tomo del
  informe, que las marca como de origen vendedor salvo las del GAO.
- Mi conteo de rutas usa mi propio criterio de «lleva middleware de identidad».
  Coincide con el del informe dentro de un punto porcentual, pero no es el mismo
  script.
