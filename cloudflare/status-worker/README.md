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

## Qué NO hace todavía

No recibe latidos empujados desde la VM. Con ellos podría publicar componentes
como «Correos» o «Informes»; sin ellos solo puede hablar de lo que sondea, que
son dos: que el servicio responde, y que sus dependencias están sanas.

Los latidos de los workers ya existen (`helpers/heartbeat.js`) y hoy apuntan a
Kuma. Moverlos aquí el día que haga falta es cambiar una URL en el `.env`.

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
