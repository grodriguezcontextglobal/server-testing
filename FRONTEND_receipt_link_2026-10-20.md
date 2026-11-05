# Dashboard: QR del recibo con enlace firmado (2026-10-20)

> **Para:** el agente del dashboard · **De:** backend
> Cierra el último punto de `ReceiptPage.jsx:28-36` ("KNOWN LIMIT … needs an
> unauthenticated read keyed by an unguessable token, not by the payment intent").

## Por qué

Hoy el QR lleva solo `?tx=<paymentIntent>` y la página `/receipt` lee
`GET /transaction/transaction?paymentIntent=…`, que **sin sesión devuelve la
transacción entera** (nombre y email del consumidor) a quien conozca o adivine el
id. Ahora el servidor firma el QR, y la lectura pública solo devuelve lo que el
recibo necesita.

**Decisiones de producto (2026-10-20):**
- El QR vale **hasta el fin del evento más 30 días**.
- Quien lo escanea ve el **estado del pago, el importe, los dispositivos y el
  evento**. **Ni email, ni teléfono, ni nombre** del consumidor.

## Rutas nuevas

### 1. Emitir el enlace: `POST /api/transaction/receipt-link` (con sesión)

Se llama al pintar el QR (`StripeTransactionTable.jsx:377`, donde hoy se usa
`buildReceiptUrl`).

```js
const { data } = await devitrakApi.post("/transaction/receipt-link", {
  paymentIntent: record.paymentIntent,
});
// data: { ok: true, token, expiresAt }
const qr = `${buildReceiptUrl(origin, record.paymentIntent, { companyLogo })}&rt=${encodeURIComponent(data.token)}`;
```

| Código | Significado | Qué hacer |
|---|---|---|
| `200 { token, expiresAt }` | Listo | Añadir `&rt=<token>` al QR. Opcional: imprimir "Válido hasta {expiresAt}" |
| `410` | El evento terminó hace más de 30 días | Imprimir el QR **sin** `rt`: solo lo abrirá el staff con sesión |
| `404` | El pago no es de la compañía del contexto, o no hay transacción | No imprimir QR |
| `401` / `403` | Sin sesión, o pago sin dueño registrado (solo super_user de plataforma) | — |

Va con la misma comprobación que refund y capture: **el pago tiene que ser de la
compañía de `x-company-id`**.

### 2. Leer el recibo: `GET /api/transaction/receipt?rt=<token>` (sin sesión)

En `ReceiptPage.jsx`, si la URL trae `rt`:

```js
const rt = new URLSearchParams(location.search).get("rt");
const { data } = await devitrakApi.get(`/transaction/receipt?rt=${encodeURIComponent(rt)}`);
// data.receipt
```

```json
{
  "ok": true,
  "expiresAt": "2026-12-01T00:00:00.000Z",
  "receipt": {
    "paymentIntent": "pi_…",
    "active": true,
    "status": "active",
    "device": [{ "deviceType": "iPad", "deviceNeeded": 2, "deviceValue": 150 }],
    "amount": 300,
    "currency": "usd",
    "provider": "Lincoln High",
    "eventSelected": "Science Fair",
    "event_id": "…",
    "date": "…",
    "type": "event"
  }
}
```

- `status` es `"active"` o `"refunded"` (lo mismo que hoy deducís de `!active`).
- `deviceValue` y `amount` van **en dólares**, igual que en la transacción.
- **No hay `consumerInfo`.** `mapTransactionToReceipt` tiene que aceptar que falte
  (sin nombre del consumidor en el recibo público).
- Errores: `401` token inválido o caducado ("Este enlace del recibo caducó; pide una
  copia nueva"), `404` no existe.

Con sesión (el staff que abre un recibo desde el dashboard) podéis seguir usando
`GET /transaction/transaction?paymentIntent=…`, que da la transacción completa.

## Transición

- Los recibos **ya impresos** llevan un QR sin `rt`. `GET /transaction` sin sesión
  sigue funcionando en modo **`warn`** (`RECEIPT_PUBLIC_READ_MODE`): el servidor
  registra cada lectura anónima y la deja pasar.
- Cuando publiquéis el QR firmado, avisad. Pasaremos a **`enforce`** cuando ya no se
  espere escanear recibos impresos antes de ese día (como mucho, fin del último
  evento de entonces + 30 días). Desde entonces, un QR antiguo sin sesión mostrará
  vuestro estado "Sign in to view this receipt", que ya existe.

## Tests a añadir

- El QR incluye `&rt=` cuando `receipt-link` responde 200, y no lo incluye con 410.
- `ReceiptPage` con `rt` llama a `/transaction/receipt` y pinta `receipt` sin
  `consumerInfo`.
- `ReceiptPage` sin `rt` mantiene el comportamiento actual.
