# `inventory-export`: el contrato no cambia, pero hay dos cosas que saber

> Del servidor al dashboard, 2026-09-22.
> Continuación de `FRONTEND_inventory_export_response_2026-09-17.md`.

---

## Lo primero: no tenéis que tocar nada

**El contrato es el mismo que os pasamos el 17-sep.** La ruta, el cuerpo, el
202 + `jobId`, el polling por `GET /api/jobs/owned/:jobId`, el `result` con
`url` / `expiresAt` / `rowCount` / `fileName`, los 15 minutos de la URL
prefirmada, el techo de 200.000 filas y el `Idempotency-Key`: todo igual. Si ya
lo implementasteis contra aquel documento, no hay nada que cambiar.

Lo que sigue es **por qué todavía no está vivo** y **qué van a ver los usuarios
el primer día**.

## 1. Estado: listo, pendiente de desplegar

El export estaba construido sobre `main`, y `main` lleva siete cambios que
rompen contrato y que están esperando a la fase de medición. Desplegarlo tal cual
habría publicado los siete de rebote.

Así que va aparte: los dos commits del export están ahora sobre la rama que
producción ya corre, sin arrastrar nada más. Queda el despliegue en la máquina.
**Os avisamos cuando responda `202` en vez de `404`.**

## 2. El arreglo que faltaba, y que no se ve desde el contrato

Encolar el export no bastaba para sacarlo del hilo principal.

El tipo de job no pertenecía a ningún grupo, y el servidor de la API reclama todo
tipo que no tenga worker propio. O sea: la petición devolvía 202 al instante
—eso funcionaba— pero **exceljs generando hasta 200.000 filas corría dentro de
los mismos procesos que atienden el login y los pagos**. Mover el fichero del
navegador al hilo que sirve peticiones es mover el problema, no resolverlo.

Ya está en el grupo de trabajo pesado, con worker dedicado. No cambia nada de lo
que veis; lo contamos porque explica por qué el despliegue lleva dos pasos de
configuración y no uno, y por qué el export tarda lo mismo aunque el servidor
esté ocupado.

## 3. Lo que van a ver los usuarios: dos columnas cambian de contenido

Esto sí conviene avisarlo antes, porque es un fichero que la gente ya conoce y
compara con el del mes pasado.

| Columna | Hoy (hoja generada en el navegador) | Con el export del servidor |
|---|---|---|
| **Current Location** | **siempre vacía** | la locación real de la unidad |
| **Warehouse** | `"In-Use (In-Use)"` para todo lo que está fuera de stock | el estado real |

No es un cambio de diseño: es que `event_name` y `condition` **nunca fueron
columnas de `item_inv`**, así que nunca llegaron por `warehouse-items` y esas dos
celdas se rellenaban con un valor fijo. El export nuevo las resuelve con un
lookup en lote contra la asignación activa más reciente.

La consecuencia práctica: **el primer export después del despliegue va a
"cambiar" respecto al anterior sin que nadie haya tocado el inventario.** Si eso
merece un aviso en la UI o un correo a los clientes que exportan a menudo, es
vuestra decisión — nosotros no tenemos el contexto de a quién le importa.

## 4. Recordatorios del contrato que suelen morder

- **`expiresAt` son 15 minutos**, no 5. Entre que el job termina, vuestro polling
  de 3 s lo detecta y la persona vuelve a la pestaña, cinco minutos se consumen
  solos.
- La URL lleva `Content-Disposition: attachment`: **descarga**, no abre el .xlsx
  en una pestaña.
- El único `lastError` propio es el techo: *"The export exceeds the 200,000 row
  limit. Narrow the filters and try again."* Si a alguien le corta de verdad,
  decidlo y lo subimos.
- El vocabulario de filtros es **el mismo objeto de código** que el de
  `inventory-page`. Si un filtro vale en la tabla vale en el export; si no vale,
  da el mismo 400 con el mismo mensaje. Hay una prueba que falla si alguien los
  separa.
