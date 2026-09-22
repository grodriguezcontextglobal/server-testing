# Separar lecturas y escrituras: diseño

> **Fecha:** 2026-09-11 · Propuesta: leer de una réplica de PlanetScale y dejar
> la principal para escritura.
> Los tamaños están medidos sobre el repo; el mecanismo de PlanetScale hay que
> contrastarlo con el plan contratado antes de comprometer fechas.

---

## 1. Lo primero, aunque no sea lo que se quiere oír: el orden

La idea es correcta y a medio plazo hay que hacerla. Pero **hoy no sabemos que
la base de datos sea el cuello de botella**, y añadir una réplica trae coste,
complejidad y una familia entera de bugs nueva (la de la latencia de
replicación). Dos datos del análisis de capacidad:

- En el orden en que este servidor se rompe, la base de datos es **el cuarto**
  escalón. Antes están el rate limit global (0,33 req/s por IP), el threadpool
  de libuv (~106 logins/s en toda la máquina) y el event loop. **Se llega a los
  tres primeros antes que al pool de conexiones.**
- `/api/metrics` lleva desplegado unos días. Una semana de datos dice qué
  endpoints se comen el tiempo y **si son lecturas**. Eso convierte este diseño
  en una lista concreta de rutas a migrar en vez de un rediseño a ciegas.

Así que: diseñémoslo, preparemos el código para que la migración sea barata, y
**enciéndalo cuando los datos digan dónde**. Lo de abajo está pensado justo para
eso — el cambio de código y el cambio de infraestructura quedan desacoplados.

---

## 2. La palanca barata que ya está pagada: Mongo

Antes de tocar PlanetScale. `database/config.js` conecta **sin `readPreference`**,
así que todas las lecturas van al primario mientras las secundarias del replica
set de Atlas están ahí sin usarse.

```js
await mongoose.connect(url, {
  serverSelectionTimeoutMS: 15000,
  appName: "devitrak-server",
  readPreference: "secondaryPreferred",   // <-- esto
});
```

`secondaryPreferred` y no `secondary`: si las secundarias no están disponibles,
cae al primario en vez de fallar. Mismas advertencias de latencia que el resto
del documento, y por eso conviene aplicarlo **por consulta** en las colecciones
que toleran retraso, no globalmente de golpe.

Coste: una línea. Ganancia: sacar del primario las lecturas de Mongo, que en
este repo son muchas (búsqueda, eventos, transacciones, admin).

---

## 3. PlanetScale: el mecanismo

PlanetScale corre sobre Vitess, que enruta por tipo de tablet. En la práctica se
lee de réplica de dos formas:

1. **Sufijo `@replica` en el nombre de la base** dentro de la cadena de
   conexión. Misma credencial, misma host, otro destino.
2. **Read-only regions**: un host aparte, más cerca de los clientes. Es
   **función de pago** y cambia la factura.

⚠️ **Verificar contra el plan contratado antes de prometer nada.** PlanetScale
ha movido sus planes más de una vez, y mi información puede estar desfasada.
Lo que no cambia es el diseño del lado de la aplicación, que es lo de abajo.

---

## 4. La arquitectura en el código: opt-in, nunca automático

El repo tiene **41 ficheros** que usan la conexión MySQL, **272 llamadas** a
`query`/`execute` y **25 bloques transaccionales**. Enrutar automáticamente por
el verbo de la SQL (`SELECT` → réplica) parece atractivo y es una trampa: un
`SELECT` dentro de una transacción, o el de un *comprobar-y-luego-escribir*,
tiene que ir al primario obligatoriamente, y un router automático no distingue.

La forma segura son **dos accesores explícitos**:

```js
// mysql/database/config.js
getConnection()      // el de siempre: escrituras, transacciones, y TODO lo dudoso
getReadConnection()  // lecturas que toleran retraso
```

Y la pieza que hace esto barato y reversible:

> **`getReadConnection()` devuelve el pool PRINCIPAL si no hay réplica
> configurada.**

Eso desacopla las dos mitades del proyecto. Se pueden migrar los call sites de
lectura poco a poco, mergear y desplegar **sin ningún cambio de comportamiento**,
porque sin `PLANETSCALE_REPLICA_URL` todo sigue yendo al primario. El día que se
configure la variable, las rutas ya migradas cambian de destino solas. Y si algo
sale mal, se quita la variable: rollback sin desplegar código.

---

## 5. La trampa central, donde estos proyectos se mueren

**Leer tus propias escrituras.** La réplica va por detrás — normalmente
milisegundos, a veces segundos. En esta aplicación eso aparece así:

- Asignas un dispositivo → vuelves a la lista → **no está**.
- Creas un estudiante → abres el roster → **no aparece**.
- Registras un pago → consultas el saldo → **el de antes**.

No son fallos: son la semántica de una réplica. Y son de los peores bugs que
existen, porque no se reproducen con el sistema en reposo y el usuario que los
ve tiene razón mientras los logs dicen que todo fue bien.

**Mitigación, por orden de contundencia:**

1. **Ventana pegajosa tras escribir.** Un middleware marca la sesión cuando una
   petición escribe; durante los siguientes ~5 s, **todas** las lecturas de esa
   sesión van al primario. Cubre el 95 % de los casos reales, que son
   exactamente "escribo y miro".
2. **Nunca desde réplica dentro de una transacción.** La conexión ya está fijada,
   así que basta con no usar `getReadConnection()` ahí.
3. **Nunca en un comprobar-y-luego-escribir.** Verificar stock antes de asignar,
   mirar la caché de idempotencia, `SHOW COLUMNS`: si el resultado decide una
   escritura, va al primario. Leer de la réplica aquí es cómo se asigna dos
   veces el mismo equipo.

---

## 6. Reglas duras

**Al primario, siempre:**

| Qué | Por qué |
|---|---|
| Todo lo que esté dentro de `beginTransaction` | La conexión está fijada; además la transacción no existe en la réplica |
| Comprobar-y-luego-escribir | Decide una escritura sobre datos posiblemente viejos |
| Autenticación y validación de sesión | Un token revocado hace 2 s tiene que estar revocado |
| Pagos, en cualquier forma | Depósitos, reembolsos, capturas, cargos |
| Idempotencia | Su trabajo es ver la escritura anterior |
| Cualquier lectura dentro de la ventana pegajosa | §5 |

**Candidatas buenas para réplica** — toleran segundos de retraso sin que nadie
lo note:

- Dashboards y agregados (`/api/school/dashboard`)
- Informes y exportaciones (`/student/export`)
- Búsqueda y navegación de inventario
- Listados del audit trail
- Histórico de custodia de un ítem

Lo que decide cuáles migrar primero **no es esta lista, son las métricas**: las
rutas con más tiempo acumulado (`count × p95`) que además sean lecturas.

---

## 7. Cómo saber si funciona, en vez de suponerlo

Tres cosas que hay que poder ver desde el primer día:

1. **El retraso de replicación**, como número. Sin él se está a ciegas sobre lo
   único que puede romper esto.
2. **Qué fracción de lecturas va a réplica.** Si migras diez rutas y el reparto
   no se mueve, esas rutas no eran las que pesaban.
3. **Un canario**: escribir un valor con marca de tiempo y leerlo de la réplica
   cada minuto, registrando cuánto tardó en aparecer. Es la forma directa de
   medir el retraso real y de que salte una alerta cuando se dispare.

Encaja con lo que ya existe: `/ready` puede incluir la réplica como dependencia
**degradante** (si va retrasada o no responde, se lee del primario y se sigue
sirviendo), y `/api/metrics` puede separar los contadores por destino.

---

## 8. Orden propuesto

```
1. readPreference en Mongo, por coleccion        <- una linea, ya esta pagado
2. Una semana de /api/metrics                    <- que diga si las lecturas pesan
3. getReadConnection() con fallback al primario  <- codigo sin cambio de comportamiento
4. Migrar las 5-10 lecturas mas pesadas segun (2)
5. Ventana pegajosa tras escritura + canario de retraso
6. Encender la replica de PlanetScale            <- una variable de entorno
```

Los pasos 1 a 4 no requieren réplica ninguna y ya dejan el sistema mejor. El 6 es
el único que cuesta dinero, y para entonces habrá datos que digan si hace falta.

**Y una alternativa que conviene tener sobre la mesa antes del paso 6:** una
caché de lecturas compartida en Redis para los endpoints de dashboard e informes
—que son los que más pesan y los que más retraso toleran— puede dar el mismo
alivio sin réplica, sin coste nuevo y sin la familia de bugs de §5. Con las
métricas en la mano se puede comparar en serio en vez de por intuición.
