# POA&M: dependencias de terceros (servidor)

> **Sistema:** Devitrak backend (API Node + Go worker), rama `release/observabilidad`
> **Fecha de estado:** 2026-11-05 · **Responsable (POC):** Gustavo Rodriguez
> **Controles:** RA-5 (escaneo de vulnerabilidades), SI-2 (corrección de fallos), CM-8, SR-3
> **Fuentes de detección:** GitHub Dependabot, `npm audit --omit=dev` (job `audit` del CI), `govulncheck` (job `go`)

> **Actualización 2026-11-17:** se añade DEP-2026-004 (`picomatch`, alta, sin versión corregida
> en ninguna rama publicada). Es la primera entrada que el job `audit` no puede dejar pasar por
> gravedad, así que desde hoy ese job corre `scripts/audit-check.js`: mismo `npm audit`, más una
> lista de excepciones con motivo y **fecha de caducidad**. Un check permanentemente rojo no avisa
> de nada; uno que vuelve a ponerse rojo en una fecha, sí.

Estas son las vulnerabilidades de dependencias que siguen abiertas después de la ronda del
2026-11-04/05. En esa ronda se cerraron estas:
- `qs` 6.17.1 (`5482111`);
- `klauspost/compress` 1.18.7 y `filippo.io/edwards25519` 1.1.1 (`56a7561`);
- todas las críticas y altas de producción.

Ninguna de las tres que siguen abiertas tiene corrección compatible publicada. En las tres
se comprobó que el código del sistema no llega a la parte vulnerable de la librería.

Plazos FedRAMP desde la detección: 90 días para moderadas y 180 para bajas.
Revisión: mensual, con el paquete de ConMon. También cuando el proveedor publique una
versión corregida, porque Dependabot y el job `audit` lo avisan solos.

---

## DEP-2026-001 · `uuid` < 11.1.1 (transitiva de `exceljs`)

| Campo | Valor |
|---|---|
| **Debilidad** | Falta comprobar los límites del buffer en `v3`/`v5`/`v6` cuando se pasa `buf` (CWE-787, CWE-1285) |
| **Identificador** | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| **Detectado por** | `npm audit --omit=dev`, 2026-11-04 |
| **Activo** | `node_modules/uuid` 8.3.x, traído por `exceljs` 4.4.0 (exportación de inventario a XLSX, worker `heavy`) |
| **Riesgo original** | Moderado (CVSS 3.1: 7.5, `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N`) |
| **Riesgo ajustado** | **Bajo** |
| **Por qué se ajusta** | `exceljs` solo usa `uuid` en `lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`, y ahí llama a `v4()` sin argumentos. El fallo solo existe en `v3`/`v5`/`v6` cuando quien llama pasa un `buf`. El servidor no importa `uuid` por su cuenta, así que nada hace esa llamada |
| **Dependencia de proveedor** | Sí. `exceljs` 4.4.0 es la última versión y fija `uuid ^8.3.0`. La única "corrección" de `npm audit` es bajar a `exceljs` 3.4.0, que es una versión vieja y peor |
| **Plan** | 1) Seguir `exceljs`: si sale una versión con `uuid` ≥ 11.1.1, actualizar. 2) Si a la fecha límite no hay versión, forzar `uuid` 11.1.1 solo para `exceljs` (`overrides: { "exceljs": { "uuid": "11.1.1" } }`) y validarlo con los tests de exportación. Desde la v9, `uuid` mantiene la exportación `v4` |
| **Hitos** | 2026-12-05: revisión de proveedor. 2027-01-15: si no hay versión, probar el override en una rama. 2027-02-02: cerrado |
| **Fecha programada** | 2027-02-02 (90 días) |
| **Estado** | Abierto: riesgo ajustado, hay plan de corrección |

## DEP-2026-002 · `deepmerge` 4.2.0–4.3.1 (transitiva de `@sendgrid/mail`)

| Campo | Valor |
|---|---|
| **Debilidad** | `mergeObject()` permite envenenar el prototipo **del objeto devuelto**. No contamina `Object.prototype` (CWE-1321) |
| **Identificador** | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4); Dependabot #350 |
| **Detectado por** | Dependabot y `npm audit --omit=dev`, 2026-11-04 |
| **Activo** | `node_modules/deepmerge` 4.3.1, traído por `@sendgrid/helpers`, dependencia de `@sendgrid/mail` 8.1.6 (envío de correo, servicio `DevitrakEmailWorker`) |
| **Riesgo original** | Bajo (CVSS 3.1: 5.3, `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`) |
| **Riesgo ajustado** | **Bajo** (sin cambio) |
| **Por qué no llega** | SendGrid solo usa `deepmerge` en `Personalization.deepMergeDynamicTemplateData()`, que mezcla `dynamicTemplateData`. El servidor no usa plantillas dinámicas de SendGrid: no hay `dynamicTemplateData` ni `templateId` en el código, porque los correos se arman con HTML propio. Aunque se usaran, el fallo solo afecta al objeto que se envía a la API de SendGrid y no al resto del proceso |
| **Dependencia de proveedor** | Sí. `deepmerge` 4.3.1 es la última versión y no tiene corrección. `@sendgrid/mail` 8.1.6 es la última versión |
| **Plan** | 1) Seguir `deepmerge` y `@sendgrid/mail`, y actualizar cuando haya corrección. 2) Mientras tanto, regla: no usar `dynamicTemplateData` con objetos que vengan del body tal cual, sino armarlos campo por campo |
| **Hitos** | 2026-12-05, 2027-02-05 y 2027-04-05: revisión de proveedor. 2027-05-03: cerrado o aceptado formalmente como riesgo operativo |
| **Fecha programada** | 2027-05-03 (180 días) |
| **Estado** | Abierto: depende del proveedor |

## DEP-2026-003 · `minimatch` 7.0.0–11.0.0 (transitiva de `nodemon`, solo desarrollo)

| Campo | Valor |
|---|---|
| **Debilidad** | DoS por amplificación de `globparts` (CWE-405) |
| **Identificador** | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) |
| **Detectado por** | `npm audit` (árbol completo), 2026-11-04. **No** sale con `--omit=dev` |
| **Activo** | `node_modules/minimatch` 10.2.6, traído por `nodemon` 3.1.14 (`devDependencies`, recarga en caliente en local) |
| **Riesgo original** | Moderado |
| **Riesgo ajustado** | **Falso positivo para el entorno de producción** |
| **Por qué** | `nodemon` es `devDependency`, y `scripts/deploy-node.ps1` instala con `npm ci --omit=dev`, así que el paquete no existe en la VM de producción. Los otros `minimatch` del árbol de producción (3.1.5 y 5.1.9, vía `exceljs` → `archiver`) quedan fuera del rango afectado (≥ 7.0.0). En desarrollo, `nodemon` solo recibe patrones de la configuración local, nunca entrada externa |
| **Dependencia de proveedor** | Sí. `nodemon` 3.1.14 es la última versión y pide `minimatch ^10.2.1`. La corrección está solo en la 11.0.1 |
| **Plan** | Actualizar `nodemon` cuando acepte `minimatch` ≥ 11.0.1. No forzar la 11 con un override: es un cambio mayor, no hay riesgo en producción y se arriesga el entorno de desarrollo |
| **Fecha programada** | 2027-02-02 (revisión) |
| **Estado** | Abierto: falso positivo en producción, depende del proveedor |

## DEP-2026-004 · `picomatch` (transitiva de `pm2`)

| Campo | Valor |
|---|---|
| **Debilidad** | ReDoS: un patrón glob con extglobs repetidos de una sola rama dispara el tiempo de compilación del patrón (CWE-1333) |
| **Identificador** | [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) |
| **Detectado por** | `npm audit --omit=dev`, 2026-11-17. Puso el job `audit` en rojo el mismo día, en todas las PRs abiertas |
| **Activo** | `picomatch` 2.3.2, traído por `pm2` 7.1.1 → `anymatch` 3.1.3 y `readdirp` 3.6.0 |
| **Riesgo original** | **Alto** (CVSS 3.1: 7.5, `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`; solo disponibilidad) |
| **Riesgo ajustado** | **Bajo** |
| **Por qué se ajusta** | El único consumidor de `picomatch` en el árbol es el vigilante de ficheros de `pm2`. La VM corre `pm2-runtime` **sin `watch`**, y ningún patrón glob del sistema sale de una petición: este ReDoS necesita que el patrón lo elija quien ataca. No hay camino desde una petición HTTP hasta esa librería |
| **Dependencia de proveedor** | Sí, y además **no hay versión corregida**: el rango afectado es `<=4.0.7` y la última publicada es la 4.0.7 |
| **La corrección que sugiere npm no corrige** | `npm audit fix --force` propone bajar a `pm2` 7.0.4. Comprobado: 7.0.4 depende de `chokidar` 3.6.0, que arrastra el mismo `anymatch`/`readdirp` y el mismo `picomatch`. Es un downgrade a cambio de nada. **No ejecutar ese comando** |
| **Por qué tampoco vale un override** | La salida real es `chokidar` 4, que ya no usa `picomatch` (solo `readdirp` ^4). Pero `readdirp` ≥ 4 es **ESM puro** (`"type": "module"`) y `pm2` lo carga con `require()`: forzarlo reproduce el `ERR_REQUIRE_ESM` que tumbó producción con `uuid`, el mismo que `scripts/deploy-node.ps1` comprueba desde entonces. `anymatch` tampoco tiene salida: su última versión sigue pidiendo `picomatch ^2` |
| **Plan** | 1) Esperar a que `pm2` suba a `chokidar` 4; Dependabot y el job `audit` lo avisan solos. 2) Mientras tanto, excepción explícita y con fecha en `scripts/audit-check.js`, para que el check siga sirviendo para el siguiente aviso alto. 3) Si en la fecha de revisión sigue sin haber versión, reevaluar: `pm2` es el supervisor del clúster (`DEPLOY.md`), así que quitarlo no es una línea, es cambiar cómo arranca el servicio |
| **Hitos** | 2026-12-15: revisión de proveedor. 2027-02-15: caduca la excepción del CI y se reevalúa |
| **Fecha programada** | 2027-02-15 |
| **Estado** | Abierto: riesgo ajustado, aceptado con fecha, sin corrección publicada |

---

## Evidencia

- `npm audit --omit=dev` en `5482111`: 0 críticas, 0 altas, 2 moderadas (`uuid`/`exceljs`) y 4 bajas (`deepmerge`/`@sendgrid/*`).
- El job `audit` del CI bloquea el merge desde `high`. Desde el 2026-11-17 lo hace con `node scripts/audit-check.js`, que es el mismo `npm audit --omit=dev` más las excepciones con fecha: solo pasan los avisos de su lista `ACCEPTED`, y cuando una fecha vence el check vuelve a fallar solo. Si alguna de estas entradas sube de gravedad, el CI falla.
- CI verde en `5482111`, `56a7561` y `bae3a26` (`test`, `audit`, `go`).
- Dependabot revisa `main`. Hasta que se mergee el PR #31, sus alertas no reflejan producción.
