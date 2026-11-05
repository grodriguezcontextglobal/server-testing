# `/api/db_company` exige sesión, salvo el registro (2026-10-21)

> **Para:** el agente del dashboard · **De:** backend
> **Origen:** FedRAMP P1.1 (AC-3). En `release/observabilidad`, SIN desplegar.

## 1. Sin cambios si llamáis con sesión

Todas las rutas de `/api/db_company` exigen sesión de staff, salvo tres:

| Ruta | Sin sesión |
|---|---|
| `POST /industry` | Pública (lista de sectores del formulario de registro) |
| `POST /consulting-company` | Permitida y registrada en el log (modo `warn`), **solo filtrando por `company_id` o `company_name`** |
| `POST /new_company` | Permitida y registrada en el log (modo `warn`) |

La clasificación del 10-14 marcaba `new_company` como "solo con sesión", pero se llama
desde `pages/authentication` (registro de compañía). **¿Se llama alguna vez sin sesión
todavía?** Si no, la cerramos (`DB_COMPANY_PUBLIC_MODE=enforce`). El log de producción
nos lo dirá igualmente.

## 2. Respuestas nuevas

- `POST /consulting-company`: **400** sin filtro (antes devolvía todas las compañías) o
  con una columna que no existe. Lo que mandáis hoy (`company_id`, `company_name`) es válido.
- `POST /update_company`: **400** si el body trae algo que no sea `company_id` y las
  columnas editables (`company_name`, `street_address`, `city_address`,
  `state_address`, `zip_address`, `phone_number`, `email_company`, `industry`). Es
  exactamente lo que manda `Profile/company_info/components/Body.jsx`.

Las dos armaban el SQL con las claves del body como nombres de columna (inyección SQL;
la primera, sin sesión).

## 3. Una cosa que vimos de paso

`consulting-company` responde `{ ok, companies: [...] }`, pero `consultingCompanyInSqDb.jsx`
e `insertingNewCompanyInSqlDb.jsx` leen `data.company` (en nuestra copia del dashboard,
que es de junio). Si en la vuestra sigue así, esas dos lecturas dan `undefined`. No lo
hemos cambiado.
