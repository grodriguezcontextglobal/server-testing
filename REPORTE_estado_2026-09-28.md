# Estado y pendientes · 2026-09-28

> Dos partes: **qué queda por hacer** y **qué distancia hay hasta FedRAMP**.
> Lo verificado se dice como verificado; lo que no, se dice también.

---

# Parte 1 · Pendientes

## 1.1 Lo que pasó hoy, antes de nada

**El vigilante externo estuvo mudo desde las 10:14 UTC** y nadie se enteró,
porque el que avisa es él. Causa: la poda del historial recorría la tabla entera
**en cada ronda del cron** — ~12,8 millones de filas leídas al día contra el
límite gratuito de 5 millones de D1. Arreglado y desplegado hoy (`4a8f5c8`):
poda una vez al día, disponibilidad desde un agregado diario en vez del
historial crudo, y `/healthz` que ahora informa de la **edad** del último sondeo
y responde 503 si está rancio.

Dos cosas que conviene retener:

- **La regla de caducidad hizo su trabajo.** Con los datos congelados, la página
  publicó *"Status data unavailable"* en vez de un verde mentiroso. Eso es
  exactamente lo que se diseñó el 24-sep.
- **Falta cerrar el círculo:** que Kuma vigile `/healthz` del Worker. Hoy nada
  vigila al vigilante, y por eso pasaron dos horas y media sin que sonara nada.

**La cuota de D1 se restablece a las 00:00 UTC.** Hasta entonces la página puede
seguir dando error. Pendiente para mañana: rellenar `daily_uptime` con las 8.918
filas de historial que ya existen.

## 1.2 Bloqueantes de despliegue

| | |
|---|---|
| `main` va **27 commits por detrás** de `release/observabilidad` | Todo lo de estas dos semanas vive en la rama de release. Producción corre esa rama, así que está desplegado — pero `main` no representa la realidad |
| **Fase 2 del plan de despliegue** (`PLAN_ejecucion_2026-09-18.md`) | Sigue sin arrancar. Bloquea las Fases 4 y 5 |
| `platform_observer` | Sin conceder → `/api/metrics` responde 403 y no se está midiendo nada |
| 5 ramas sin mergear a `main` | `feat/inventory-export`, `feat/monitoring-heartbeats`, `release/observabilidad`, `fix/demo-school-system-premerge`, `fix/notification-public-rate-limit` |

## 1.3 Seguridad — lo abierto, por gravedad

1. **Rutas anónimas con efecto destructivo.** De las 46 rutas de Stripe, 29
   llevan `optionalJWT` (pasan sin sesión) e incluyen `DELETE /subscriptions/:id`,
   `DELETE /removing/:id` y `GET /transaction`. De cuatro controladores que
   revisé, **ninguno comprueba identidad por dentro**. Sin auditar los otros 25.
2. **`DELETE /api/db_sub_location/sub-locations/:id`** — anónima y sin filtro de
   compañía: borra sub-locaciones de cualquier inquilino.
3. **`POST /api/staff/force-logout`** — cierra la sesión de cualquier empleado
   conociendo su correo, sin autenticación. Decisión explícita del 23-sep.
4. **Clave de idempotencia sin segmentar por compañía**
   (`middlewares/idempotencyMutationCache.js:25`): dos compañías con la misma
   `Idempotency-Key` colisionan y la segunda recibe la respuesta de la primera.
5. **`PATCH /api/admin/profile/:id`** — asignación masiva sin comprobar
   propiedad: cualquier autenticado puede ponerle `super_user` a otro.
6. **`routes/auth.js` `GET /:id` sin `validateJWT`** — el único test que falla en
   toda la suite, desde julio.
7. **`/ready` es público** y expone `localhost:7453`, nombres de dependencias,
   `pid` y uptime.
8. **Credenciales en el historial de git** (rama archivada). El usuario declinó
   rotarlas por ser repositorio privado. Para cualquier auditoría, esto es un
   hallazgo.

## 1.4 Datos

- **11 eventos / 3.054 filas** cerradas sin que su estado final llegara a MySQL
  (el bug del `CASE`, arreglado el 25-sep). El dato real sigue en Mongo y es
  reconstruible. **No se ha tocado nada**: espera decisión.
- **`condition` == `status` en 75.000 de 75.000 filas** — esa columna nunca tuvo
  valor propio. Arreglado hacia delante; el histórico sigue así.

## 1.5 Producto (reunión del 10-sep)

Atomicidad de la asignación · dirección no obligatoria · plantillas de correo al
chasis · audit trail por entidad · enum de condición de devolución ·
deduplicar seriales · ingesta del lector OR2505 · **roles personalizados con
matriz de permisos** (la más grande, sin dimensionar).

## 1.6 Infraestructura

`BACKLOG_infra.md` T1–T5. Lo que cambió: **T1 está en gran parte hecho** (Kuma,
métricas, `/ready`, página de estado, alertas a Teams). Siguen abiertos los tres
estados en memoria — rate limit, caché y circuit breaker por proceso — y el
resto de T3/T5.

## 1.7 Stripe Connect

Agendado el 25-sep (`BACKLOG_stripe_connect.md`). Media tarea hecha por
adelantado; falta que **alguna** llamada pase `stripeAccount`. Antes hay que
decidir el tipo de cargo y cerrar la clave de idempotencia.

---

# Parte 2 · Distancia hasta FedRAMP

## 2.1 La respuesta corta

**No es una lista de tareas de código, y por eso no puedo darte un porcentaje.**

FedRAMP no es una certificación que se aprueba arreglando hallazgos: es una
**autorización** que concede una agencia federal sobre un sistema concreto,
evaluado por un auditor acreditado (3PAO) contra unos 325 controles de NIST
800-53 en el nivel Moderate, y mantenida con monitorización continua mensual.

Y el obstáculo no está en el código: **está en dónde corre.**

## 2.2 Por qué la arquitectura actual no está en ese camino

Bajo FedRAMP, un sistema **hereda** la mayoría de sus controles de la
infraestructura autorizada sobre la que se apoya — física, personal, redes,
hipervisor. Son cientos de controles que no escribes tú.

Hoy el sistema corre en **una VM de Windows Server 2019 gestionada por
nosotros**, con servicios `nssm`, IIS delante, y estas dependencias externas:
PlanetScale, MongoDB Atlas, Redis, SendGrid, Stripe, AWS S3 comercial y
Cloudflare.

De ahí **no se hereda nada**, y cada una de esas dependencias tendría que estar
dentro del límite autorizado o ser ella misma un servicio autorizado. Eso
significa, como mínimo:

- Mover todo a una nube con autorización FedRAMP (AWS GovCloud, Azure
  Government) y **sustituir** cada proveedor que no tenga oferta autorizada.
- Criptografía con módulos validados FIPS 140.
- Datos y personal con acceso en territorio estadounidense.
- Un patrocinador federal que pida la autorización.
- Una evaluación 3PAO y un SSP, que es un documento de varios cientos de páginas.

En orden de magnitud —y esto **hay que verificarlo**, no lo tomes como cifra
firme— la industria habla de **12 a 24 meses y seis cifras en dólares** para una
autorización Moderate. El programa además está cambiando (la iniciativa
«FedRAMP 20x» de 2025), así que los requisitos concretos hay que confirmarlos
contra la documentación vigente antes de planificar nada.

## 2.3 La pregunta que haría antes de gastar un euro en esto

**¿FedRAMP es de verdad lo que os piden?**

FedRAMP autoriza servicios en la nube **para agencias del gobierno federal de
EE. UU.** Vuestros clientes son colegios — *Bridges Public Charter School* es el
que aparece en las notas de la reunión. Un colegio concertado no compra bajo
FedRAMP.

Lo que sí piden los compradores de ese sector, y donde el trabajo **sí** cuenta:

| Marco | A quién aplica | Qué tan lejos estáis |
|---|---|---|
| **FERPA / COPPA** | Colegios, obligatorio | **Lo más avanzado** — auditoría de PII, consentimiento con opt-in, export/erase ya construidos |
| **SOC 2 Tipo II** | Lo que de verdad piden las compras privadas y muchos distritos | Alcanzable: controles + 6-12 meses de evidencia |
| **StateRAMP** | Gobierno **estatal y local** | Es el primo de FedRAMP para este mercado, y mucho más realista |
| **FedRAMP** | **Solo agencias federales** | Muy lejos, y probablemente innecesario |

Si FedRAMP salió en una conversación comercial, merece la pena confirmar si el
cliente quería decir *"¿tenéis seguridad seria y auditada?"*, que es una pregunta
muy distinta y se responde con SOC 2.

## 2.4 Lo que ya tenéis, mapeado a familias de control

Sirve para cualquiera de los cuatro marcos, así que no es trabajo perdido:

| Familia | Estado |
|---|---|
| **AU · Auditoría** | 🟡 Registro de actividad de staff y auditoría de accesos a PII del módulo escolar. Falta retención definida, sincronía horaria e integridad frente a manipulación |
| **SI · Monitorización** | 🟢 **Lo mejor que tenéis**, y es de esta semana: readiness real, métricas por endpoint, vigilancia interna y externa, alertas a Teams, página de estado |
| **IA · Identificación** | 🟡 MFA existe, JWT con versión revocable, roles por categoría |
| **AC · Control de acceso** | 🔴 **El punto débil.** Los 8 hallazgos de §1.3 son todos de esta familia |
| **SC · Protección** | 🟡 TLS en el borde; secretos en `.env` en disco; credenciales en el historial de git |
| **CM · Configuración** | 🔴 Despliegue manual por PowerShell, sin línea base ni control de cambios |
| **CP · Contingencia** | 🔴 Sin plan de respaldo ni prueba de restauración documentada |
| **IR · Respuesta a incidentes** | 🟡 Ahora hay detección y aviso; falta el procedimiento escrito |
| **RA · Vulnerabilidades** | 🟡 Dependabot activo; sin cadencia documentada ni POA&M |
| **PE / PS · Físico y personal** | 🔴 No heredáis nada de nadie. Es consecuencia directa de §2.2 |

**Esto no es una evaluación formal**: es una lectura de ingeniería basada en lo
que he visto del repositorio y de producción estas dos semanas.

## 2.5 Qué haría, en orden

1. **Confirmar el marco.** Una llamada con quien lo pidió. Cambia todo lo demás.
2. **Cerrar los 8 hallazgos de §1.3.** Cuentan para los cuatro marcos, y varios
   son de una línea.
3. **Escribir lo que ya hacéis**: respuesta a incidentes, respaldo y
   restauración, cadencia de parcheo. Auditar cuesta más por lo no documentado
   que por lo no hecho.
4. **Si el objetivo es vender a colegios y distritos**: SOC 2 Tipo II, y
   StateRAMP si aparece gobierno estatal.
5. **Si de verdad hay un cliente federal detrás**: la conversación no empieza por
   el código, empieza por mover la plataforma a una nube autorizada y por buscar
   patrocinador. Antes de eso, cualquier trabajo de controles es prematuro.
