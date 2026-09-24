# Vigilante externo y página de estado

Worker de Cloudflare que sondea el servicio **desde fuera de la red**, guarda el
historial en D1, avisa a Teams cuando cambia el estado, y sirve la página de
estado.

Diseño y motivos: `DESIGN_monitoring_uptime_kuma.md` §7.4 y §8.
Runbook de la parte interna (Uptime Kuma): `DEPLOY.md` § Monitoreo.

---

## Qué cubre esto que Kuma no puede

Kuma corre **dentro** de la VM, así que hay dos cosas que no puede hacer, y no
por configuración:

1. **Sondear `https://db.devitrak.net`.** Hairpin NAT: desde la propia máquina la
   petición sale a la IP pública y el cortafuegos no la devuelve. La cadena
   externa —DNS, TLS, IIS— es invisible desde dentro.
2. **Avisar si la VM se apaga.** El vigilante se apagaría con ella.

Este Worker cierra las dos. Y al vivir fuera, es lo único que puede sostener una
página de estado pública: sigue respondiendo el día que el servidor no responde,
que es el único día en que alguien la mira.

## Lo que Kuma le cuenta: `POST /ingest`

Un worker de la cola parado **no se ve desde fuera**: `/ready` comprueba MySQL,
Mongo, Redis y el worker de Go, y los tres workers de Node no están en esa lista.
Kuma sí lo ve, porque no sondea — espera un latido.

Por eso **Kuma es el sensor y este Worker el publicador**: Kuma manda una
notificación webhook a `/ingest` cada vez que uno de sus monitores cambia de
estado, y de ahí sale el componente **Background jobs**.

### Configurarlo en Kuma

*Settings → Notifications → Setup Notification*:

| Campo | Valor |
|---|---|
| Notification Type | `Webhook` |
| Friendly Name | `Status page (Cloudflare)` |
| Post URL | `https://devitrak-status.<subdominio>.workers.dev/ingest` |
| Request Body | `application/json` (el preestablecido) |
| Additional Headers | `{"x-status-token": "<el secreto INGEST_TOKEN>"}` |

Y **asignarla solo a los monitores que deben publicarse** (*Edit* de cada
monitor → *Notifications*), no a todos: los de la API y las dependencias los
sondea este Worker por su cuenta.

El secreto se pone con `wrangler secret put INGEST_TOKEN`. Sin él, `/ingest`
responde `503`; con un token que no coincide, `401`.

### Tres decisiones del diseño

**No hay freno al parpadeo en `/ingest`.** Kuma ya lo aplicó: dos reintentos de
120 s antes de dar un monitor por caído. Un segundo freno solo añadiría minutos
al aviso sin quitar un solo falso positivo.

**`/ingest` no avisa a Teams.** Kuma acaba de hacerlo. Si notificara también,
cada incidente llegaría dos veces al canal y en una semana nadie los leería.

**Un monitor que no esté en `MONITOR_COMPONENT` se ignora**, y se responde `200`
(no un error, que llenaría el panel de Kuma de alertas). Crear un monitor nuevo
en Kuma **no puede** cambiar por accidente lo que ven los clientes: para
publicar algo hay que añadirlo al mapa, que es una decisión y deja rastro.

### Un worker parado es `degraded`, no `down`

La cola es durable —`claimOne` reclama de forma atómica y `recoverStale` rescata
lo que quedó a medias—, así que el trabajo **no se pierde, se retrasa**. Decirle
a un cliente que está «caído» algo que solo va con retraso es exagerar, y una
página que exagera se deja de mirar igual que una que miente.

### La limitación que hay que conocer

Lo que llega por `/ingest` **no caduca**, al contrario que lo sondeado. Tiene que
ser así: Kuma solo habla cuando algo cambia, y un sistema sano puede pasar
semanas en silencio; caducarlo pondría el componente en «sin datos» justo por ir
todo bien.

La contrapartida: **si Kuma dejara de funcionar con la VM en pie, este
componente se quedaría congelado en su último valor.** Esa clase de fallo la
cubren los sondeos de `/health` y `/ready`, no esto. Si algún día molesta, la
salida es un aviso periódico de «Kuma sigue vivo» y aplicarle caducidad.

### Sembrar el primer estado

Como Kuma solo notifica en los cambios, un sistema que ya está sano **nunca
mandará nada**, y el componente se quedaría en `unknown` para siempre. Después de
configurar la notificación, y **solo si los monitores están en verde en Kuma**,
se siembra a mano una vez por monitor:

```bash
curl -X POST https://devitrak-status.<subdominio>.workers.dev/ingest \
  -H "x-status-token: <INGEST_TOKEN>" -H "content-type: application/json" \
  -d '{"monitor":{"name":"Delete worker"},"heartbeat":{"status":1}}'
```

---

## Desplegar

```bash
cd cloudflare/status-worker
npm install -g wrangler        # o npx wrangler en cada comando
wrangler login

# 1. La base
wrangler d1 create devitrak-status
#    → copiar el database_id que imprime y pegarlo en wrangler.toml

# 2. El esquema
wrangler d1 execute devitrak-status --remote --file=./schema.sql

# 3. El webhook de Teams, como SECRETO (lleva la firma `sig=`)
wrangler secret put TEAMS_WEBHOOK_URL

# 4. Publicar
wrangler deploy
```

Al terminar responde en `https://devitrak-status.<subdominio>.workers.dev`.
Para el dominio propio (`status.devitrak.net`), añadir una ruta al Worker desde
el panel de Cloudflare; **no hace falta tocar nada del servidor**.

### Comprobar

```bash
curl https://devitrak-status.<subdominio>.workers.dev/healthz        # ok
curl https://devitrak-status.<subdominio>.workers.dev/api/status.json
```

El cron tarda un minuto en la primera ronda: hasta entonces los componentes
salen como `unknown`, que es honesto — no hay datos todavía, y eso es distinto
de estar bien.

Para no esperar:

```bash
wrangler tail                                   # ver la ronda en vivo
```

---

## Rutas

| Ruta | Qué es |
|---|---|
| `/` | La página de estado |
| `/api/status.json` | El snapshot público, en JSON |
| `/healthz` | Sondeo del propio Worker, para poder vigilar al vigilante |

---

## Las tres decisiones que están cocidas en el código

**1. Solo se publica lo que construye `buildSnapshot`.** Es el único sitio donde
se decide qué sale a internet. Los sondeos guardan un campo `detail` que puede
llevar mensajes de error, y **nunca se publica**: si un dato no está en el
snapshot, no hay forma de que llegue a la página.

**2. Componentes de negocio, no dependencias.** La página dice «Core services»,
no «Redis» ni «PlanetScale». Un cliente no sabe qué es Redis ni tiene por qué —
y ese vocabulario además evita publicar el mapa de la arquitectura y de quién
dependemos.

**3. Subir es inmediato, bajar cuesta dos fallos seguidos.**
(`FAILURES_BEFORE_DOWN`). Anunciar una recuperación de más dura un minuto;
anunciar una caída de más quema la credibilidad de la página, que es lo único
que la hace valer para vender.

---

## Antes de enlazarla en material comercial

De `DESIGN_monitoring_uptime_kuma.md` §8.3, y conviene releerlo entero:

- **Tiene que ponerse en rojo cuando toque.** Una página siempre verde la
  descubre el primer cliente que sí notó la caída.
- **El historial empieza el día uno.** Arráncala pronto aunque no la enlaces.
- **Falta poder escribir mensajes de incidente a mano.** Hoy el estado es
  automático; un cliente que ve rojo quiere leer «estamos investigando, afecta a
  los correos, actualizamos en 30 min». La tabla `events` está preparada para
  sostenerlo, pero la escritura manual no está construida.
- **Decidir si se publica el porcentaje.** Ahora mismo se publica el de 90 días.
  Es un número del que luego respondes; quitarlo es borrar una línea de la
  plantilla.

## Pendiente de decidir: `/ready` es público

`https://db.devitrak.net/ready` responde **sin autenticación** desde internet, y
su cuerpo lleva `localhost:7453`, los nombres de las dependencias, el `pid` y el
tiempo de arranque — justo la lista de §8.1 de lo que no debe publicarse. O sea
que hoy hay más detalle expuesto del que tendría la página de estado.

Este Worker **necesita** llegar a `/ready` desde fuera, así que hay tres salidas
y ninguna es gratis:

1. Dejarlo como está y aceptar la exposición.
2. Recortar el cuerpo para llamadas no autenticadas (mantener `status`, quitar
   `checks` y `pid`) — el Worker se apañaría con `status`.
3. Exigir una cabecera compartida solo para el detalle, y dársela al Worker como
   secreto.

La 2 es la que menos mueve y la que más quita. Requiere tocar
`helpers/readiness.js` y `routes/health.js`, así que es decisión aparte.
