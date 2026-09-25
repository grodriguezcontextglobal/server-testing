# Stripe Connect: que cada cliente cobre en su propia cuenta

> Agendado el **2026-09-25**. **Nada implementado.**
> Cada punto dice **qué ya existe** (con `archivo:línea`) para no re-estudiar lo
> estudiado, y **qué decisión** hace falta antes de escribir código.

**Objetivo:** que el dashboard reciba el *account id* de Stripe del cliente y lo
use en las llamadas, de forma que **cada compañía gestione sus propias
transacciones** en vez de que todo el dinero caiga en la cuenta de la plataforma.

---

## 1. Lo que YA existe (y es más de lo que parece)

La mitad de la incorporación está construida:

| Pieza | Dónde |
|---|---|
| Crear la cuenta conectada | `controller/stripe.js:52` `stripeAccountCreate` → `stripe.accounts.create` |
| Enlace de alta (onboarding) | `controller/stripe.js:93` `stripeAccountLink` → `stripe.accountLinks.create` |
| Sesión de componentes embebidos | `controller/stripe.js:118` `stripeAccountSession` |
| Rutas | `routes/stripe.js:68,71,74` — `/accounts`, `/account_link`, `/account_sessions` |
| Modelo | `models/StripeConnectedAccount.js` |

Y las cuentas ya se crean con el modelo de control moderno
(`controller.fees.payer = "application"`, `losses.payments = "application"`,
`stripe_dashboard.type = "express"`), o sea: **la plataforma paga las comisiones
y asume la responsabilidad de las pérdidas**. Esa decisión ya está tomada en el
código y condiciona el punto 3.

## 2. Lo que falta, y es el corazón de la tarea

**Ninguna llamada a Stripe pasa la cuenta conectada.** Verificado: no hay una
sola aparición de la opción `stripeAccount:` en `controller/`, `routes/`,
`queue/` ni `helpers/`. Así que hoy se crean cuentas conectadas… y después
**todos los cobros se hacen contra la cuenta de la plataforma**.

El cambio, en una línea, es este:

```js
await stripe.paymentIntents.create(params, { stripeAccount: "acct_xxx" });
```

…aplicado de forma **consistente** a las 46 rutas de `routes/stripe.js`, que es
donde está el trabajo real: no es una llamada, es una convención que no se puede
olvidar en ninguna.

## 3. Las decisiones que hay que tomar ANTES de escribir código

**a) El tipo de cargo.** Stripe ofrece tres y no son intercambiables:

| | Dónde vive el cargo | Consecuencia |
|---|---|---|
| **Directo** (`stripeAccount`) | En la cuenta del cliente | El cliente ve sus pagos en su panel. **Sus clientes y métodos de pago viven en SU cuenta**, no en la nuestra |
| **Con destino** (`transfer_data.destination`) | En la nuestra, se transfiere | Seguimos siendo el comerciante de registro |
| **Cargos y transferencias separados** | En la nuestra | Máximo control, máxima complejidad |

Lo ya configurado en `accounts.create` apunta a que la plataforma lleva
comisiones y pérdidas, lo cual encaja con **directo + comisión de aplicación**.
Pero es una decisión de negocio, no técnica.

**b) Qué pasa con lo que ya existe.** Si se va a cargos directos, los
`StripeCustomer` que hay hoy son de la cuenta de la plataforma y **no se mueven**
a la del cliente. Hay que decidir si se migran, se recrean o conviven.

**c) Dónde se guarda el `acct_`.** Hoy `StripeCompany` (`models/StripeCompany.js`)
tiene `stripeID`, pero hay que confirmar si eso es el cliente de la plataforma o
la cuenta conectada — son cosas distintas y el nombre no lo distingue.

**d) Qué pasa si una compañía no tiene cuenta conectada.** ¿Se cobra en la
plataforma como hoy, o se rechaza? Un valor por omisión silencioso aquí es dinero
en la cuenta equivocada.

## 4. Dos cosas que hay que cerrar antes, y una es un riesgo actual

### ⚠️ La clave de idempotencia NO está segmentada por compañía

`middlewares/idempotencyMutationCache.js:25` construye la clave así:

```js
if (headerKey) return `hdr:${String(headerKey).trim()}`;
```

**Sin compañía, sin cuenta, sin nada más.** Dos compañías distintas que manden el
mismo `Idempotency-Key` —y `abc123` o `1` no son valores improbables— colisionan:
la segunda recibe **la respuesta cacheada de la primera**, con el id de un pago
ajeno.

Hoy ya es un fallo de aislamiento entre inquilinos en rutas de pago públicas. Con
Connect, donde cada cuenta es dinero de un cliente distinto, pasa a ser
inaceptable. **La clave tiene que llevar la compañía o la cuenta conectada.**

Además, en Stripe las claves de idempotencia **son por cuenta**: la misma clave
contra dos `acct_` distintos son dos operaciones distintas, así que el cambio va
en la misma dirección que la API.

### No hay webhooks

No existe ningún `constructEvent` ni endpoint de webhook en el repositorio. Hoy
el resultado de un pago solo se conoce preguntando. Con Connect eso se queda muy
corto: los eventos de la cuenta conectada (requisitos pendientes, capacidades
concedidas, pagos disputados) **llegan por webhook y por ningún otro sitio**, y
sin ellos no se puede saber si una cuenta terminó de darse de alta.

## 5. Y el detalle de las rutas públicas

Cinco rutas de pago aceptan peticiones **sin JWT** a propósito, por compatibilidad
con integraciones externas (`docs/payments-endpoints-matrix.md`). Si el `acct_`
se toma del cuerpo de la petición, **cualquiera podría cobrar contra la cuenta de
cualquier compañía**. La cuenta conectada tiene que resolverse **del lado del
servidor** a partir de la compañía autenticada, nunca de lo que mande el cliente.

Es el mismo patrón de `resolveCompanyContext` que ya se usa en el resto.

## 6. Esfuerzo

- **Decisiones (§3):** una reunión. Bloquean todo lo demás.
- **Segmentar la clave de idempotencia (§4):** 1 día, y se puede hacer ya — es un
  arreglo por sí mismo, independiente de Connect.
- **Webhooks (§4):** 2–3 días, incluido el endpoint, la verificación de firma y
  el manejo de los eventos de cuenta.
- **Pasar `stripeAccount` en las 46 rutas (§2):** 3–5 días, más pruebas. El
  riesgo no está en la dificultad sino en el olvido: conviene una función
  envoltorio única que lo aplique, y un test que falle si alguien llama a Stripe
  sin pasar por ella.
- **Migración de clientes existentes (§3b):** depende de la decisión.

## 7. Documentación relacionada

- `docs/payments-endpoints-matrix.md` — qué rutas son públicas y cuáles no
- `docs/payments-dual-lane.md` — el patrón público/autenticado
- `docs/payments-ops-runbook.md`
- Stripe: *Connect* → *Direct charges* / *Destination charges*, y *Account Links*
