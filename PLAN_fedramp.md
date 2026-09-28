# Plan de acción — FedRAMP

> **2026-09-28.** Plan por etapas, pedido explícitamente después de plantear que
> el marco podría no ser el adecuado (ver `REPORTE_estado_2026-09-28.md` §2.3).
> Queda anotado y no se vuelve sobre ello: esto es el plan.

---

## Cómo leer esto

Hay dos clases de contenido y conviene no confundirlas:

- **La ingeniería** — re-plataforma, controles, documentación. Es el 90 % del
  esfuerzo y **no cambia** con la mecánica del programa. Aquí voy con detalle.
- **El procedimiento del programa** — vías de autorización, patrocinio, papeles.
  **El programa se reestructuró**: hoy existen las *Consolidated Rules for 2026*
  y una vía **FedRAMP 20x** aparte de la tradicional. No he podido extraer la
  mecánica exacta de la documentación oficial, así que **confirmarla es la
  primera tarea de la Etapa 0**, no una nota al pie.

Los plazos y costes son **órdenes de magnitud del sector**, no presupuesto.

---

## El principio que decide el coste: reducir el límite

Antes de las etapas, la decisión que más dinero mueve.

Bajo FedRAMP todo lo que queda **dentro del límite de autorización** hereda sus
obligaciones: cada servicio se evalúa, cada control aplica, y el coste de
monitorización continua se paga **todos los meses, para siempre**.

> **No metáis Devitrak entero.** Carvad una **instancia federal separada** con lo
> mínimo que un cliente federal necesite, y dejad fuera el resto del producto,
> los clientes comerciales y los colegios.

Dos sistemas cuestan más de operar y muchísimo menos de autorizar y de mantener
autorizados. Es la diferencia entre auditar 46 rutas de Stripe o ninguna.

---

## Etapa 0 · Decisiones — 4 a 6 semanas, sin tocar código

Nada de lo demás se puede planificar sin esto.

| # | Decisión | Por qué bloquea |
|---|---|---|
| 0.1 | **Confirmar la mecánica vigente** con FedRAMP (`info@fedramp.gov`) y las *Consolidated Rules 2026*: vías disponibles, si sigue haciendo falta patrocinador de agencia, qué es y cómo se obtiene el estado *Ready*, y qué cambia con 20x | Un plan montado sobre la estructura antigua se rehace entero |
| 0.2 | **Nivel de impacto**: Low o Moderate | Cambia el número de controles y el coste. Con PII de por medio, Moderate es lo esperable |
| 0.3 | **Qué producto entra** en el límite | Ver el principio de arriba. Es la decisión más cara de todas |
| 0.4 | **Patrocinador**: qué agencia y quién lo gestiona | Sin cliente federal real, el resto es inversión especulativa |
| 0.5 | **Presupuesto y equipo** | Hace falta un responsable de seguridad dedicado. Esto no se hace a ratos |

**Criterio de salida:** una hoja con las cinco respuestas. Si 0.4 no tiene
respuesta, **parar aquí** y quedarse en la Etapa 1, que vale igual.

---

## Etapa 1 · Higiene que cuenta para cualquier marco — 3 a 6 meses

Empieza ya, en paralelo con la 0. **Nada de esta etapa se pierde** aunque
FedRAMP se cancele: es el grueso de SOC 2 y de StateRAMP.

### 1.1 Cerrar los ocho hallazgos de control de acceso

Los del `REPORTE_estado_2026-09-28.md` §1.3. Varios son de una línea:

- Las 29 rutas de Stripe con `optionalJWT` — auditar cuáles comprueban identidad
  por dentro y cerrar las que no.
- `DELETE /api/db_sub_location/sub-locations/:id` anónima y sin scope de compañía.
- `POST /api/staff/force-logout` sin autenticación.
- Clave de idempotencia sin segmentar por compañía.
- `PATCH /api/admin/profile/:id` con asignación masiva.
- `routes/auth.js GET /:id` sin `validateJWT`.
- `/ready` público con detalle de arquitectura.

### 1.2 Secretos

- Sacar los secretos del `.env` en disco → gestor de secretos.
- **Rotar las credenciales que están en el historial de git.** Se declinó en su
  momento por ser repositorio privado; para una auditoría eso no es una
  respuesta. El historial hay que limpiarlo o las claves hay que rotarlas.

### 1.3 Escribir lo que ya hacéis

Auditar cuesta más por lo no documentado que por lo no hecho. Hace falta una
política por familia de control, y estos procedimientos:

- Respuesta a incidentes (ahora ya hay detección y aviso: es la mitad).
- Respaldo y recuperación, **con una prueba de restauración ejecutada**.
- Gestión de cambios y línea base de configuración.
- Cadencia de parcheo y gestión de vulnerabilidades, con POA&M.
- Reglas de comportamiento y alta/baja de personal.

### 1.4 Registro y auditoría

Retención definida, sincronía horaria, e **integridad frente a manipulación** —
hoy los logs los puede editar quien tenga la máquina.

> **Salida anticipada:** al cerrar esta etapa estáis en posición de empezar SOC 2
> Tipo II. Si la Etapa 0 no da patrocinador, este es el sitio donde parar.

---

## Etapa 2 · Re-plataforma — 6 a 12 meses · la etapa cara

La actual no es autorizable: sobre una VM de Windows gestionada por vosotros
**no se hereda ningún control**, y son cientos los que normalmente pone la nube.

| Hoy | Por qué no vale | Destino |
|---|---|---|
| VM Windows Server 2019 + `nssm` + IIS | Sin herencia, sin línea base endurecida | Contenedores Linux sobre nube autorizada, imágenes CIS/STIG |
| PlanetScale (MySQL) | Servicio comercial fuera del límite | RDS/Aurora en la región gubernamental |
| MongoDB Atlas | ídem | DocumentDB o autogestionado dentro del límite |
| Redis | ídem | ElastiCache dentro del límite |
| SendGrid | ídem | SES en la región gubernamental |
| AWS S3 comercial | Región equivocada | S3 en la región gubernamental |
| Cloudflare (CDN, Worker de estado) | Verificar si su oferta autorizada cubre lo que usáis | CDN/WAF autorizado, o el equivalente de la nube elegida |
| **Stripe** | **El problema duro** | Ver abajo |
| Despliegue manual por PowerShell | No hay control de cambios demostrable | Infraestructura como código + canalización con aprobaciones |

### El problema de Stripe

Los cobros de una agencia federal no suelen pasar por una pasarela comercial:
van por los canales del Tesoro (**Pay.gov**). Tres salidas, y la tercera es la
sensata:

1. Meter la pasarela en el límite — inviable, no la controláis.
2. Sustituirla por el canal federal — trabajo grande, pero es lo que usa el
   cliente federal de todas formas.
3. **Que la instancia federal no cobre.** Si el módulo que se autoriza es
   inventario y cesión de equipos, la facturación se queda fuera del límite y el
   problema desaparece. Otra razón para el principio del límite reducido.

### Además

- Criptografía con módulos **validados FIPS 140**, en tránsito y en reposo.
- Datos y personal con acceso **en territorio estadounidense**.
- MFA resistente a phishing para acceso privilegiado.
- Separación de entornos y control de acceso a producción con registro.

**Lo que sobrevive:** el código de aplicación, casi entero. Node, Go, la cola,
los handlers, la lógica de negocio. Lo que se rehace es **dónde y cómo corre**.

---

## Etapa 3 · Controles y documentación — solapa con la 2

- **SSP** (System Security Plan) con sus anexos. Son varios cientos de páginas y
  se escribe **mientras** se construye, no después.
- Diagrama del límite de autorización, inventario de activos, flujos de datos.
- Los ~323 controles del baseline Moderate, cada uno marcado como heredado,
  implementado o híbrido. **La herencia es la que hace esto viable**: si la
  Etapa 2 se hizo bien, muchos vienen dados.
- POA&M vivo desde el primer día.

---

## Etapa 4 · Evaluación de preparación (3PAO) → *Ready*

Un evaluador acreditado revisa si estáis en condiciones de pasar la evaluación
completa. Sale un informe con huecos. **Se tarda meses en cerrarlos**, y es
normal.

---

## Etapa 5 · Evaluación completa → autorización

Plan de evaluación → pruebas de penetración y de controles → informe de
seguridad → POA&M → revisión del paquete por la agencia → **ATO**.

Los plazos de corrección estándar del programa (alto / medio / bajo) hay que
confirmarlos en 0.1, pero la idea es que un hallazgo alto se cierra en semanas,
no cuando se pueda.

---

## Etapa 6 · Monitorización continua — permanente

**La etapa que se olvida al presupuestar, y es la que no acaba nunca:** escaneos
mensuales de sistema operativo, web y base de datos; entrega mensual de POA&M e
inventario; evaluación anual; y solicitud formal de aprobación para cada
**cambio significativo**.

Esto último cambia cómo trabaja el equipo: en el sistema autorizado no se
despliega el viernes porque sí.

---

## Calendario y coste — órdenes de magnitud, a confirmar

| Etapa | Duración | Se puede solapar con |
|---|---|---|
| 0 · Decisiones | 4-6 semanas | — |
| 1 · Higiene | 3-6 meses | 0 y 2 |
| 2 · Re-plataforma | 6-12 meses | 3 |
| 3 · Controles y SSP | 6-9 meses | 2 |
| 4 · *Ready* | 2-4 meses | — |
| 5 · Evaluación y ATO | 6-12 meses | — |
| 6 · ConMon | para siempre | — |

**Total realista partiendo de una VM de Windows: 18 a 30 meses.** El coste del
3PAO en el sector se mueve en las seis cifras en dólares, y a eso hay que sumar
la nube gubernamental, las licencias y el personal dedicado. **Verificar con
presupuestos reales antes de comprometer fechas.**

---

## Lo que duele, dicho de antemano

- **Velocidad.** Cada cambio significativo en el sistema autorizado pasa por un
  procedimiento. El ritmo de estas dos semanas —arreglar por la mañana,
  desplegar por la tarde— no existe dentro del límite.
- **Dos sistemas que mantener**, con el riesgo de que se separen.
- **Personal.** Requisitos de nacionalidad y verificación de antecedentes para
  quien toque el sistema autorizado.
- **Proveedores.** Se pierde la libertad de elegir el mejor servicio; se elige
  entre los autorizados.

---

## Puntos de salida

El plan está ordenado para que se pueda parar con valor acumulado:

1. **Tras la Etapa 1** → postura de seguridad seria y base para SOC 2. Si 0.4 no
   da patrocinador, parad aquí.
2. **Tras la Etapa 2** → plataforma moderna y escalable, que resuelve de paso
   casi todo `BACKLOG_infra.md`.
3. **Tras la Etapa 4** → *FedRAMP Ready*, que ya es una señal comercial y
   aparece en el Marketplace.

---

## Lo que este plan no afirma

No he verificado la mecánica vigente del programa: las dos consultas al sitio
oficial devolvieron páginas índice. Sé que existen las *Consolidated Rules for
2026* y una vía **FedRAMP 20x** con servicios ya certificados por ella, y **no
sé** si esa vía cambia el requisito de patrocinio, los plazos o el papeleo — que
es justo lo que podría abaratar esto. Por eso la tarea 0.1 es la primera.

Tampoco es una evaluación de controles: es un plan de ingeniería basado en lo
que he visto del repositorio y de producción estas dos semanas.

---

# ⚠️ OBSOLETO EN TRES PUNTOS — leer antes `fedRAMP/CONTRASTE_repo_2026-09-28.md`

Este plan se escribió sobre la estructura del programa **anterior a la reforma de
2026**. El informe *Devitrak FedRAMP Readiness* (16-sep) lo corrige:

- **No hace falta patrocinador de agencia** para las Clases A, B y C: se
  autonomina. Solo la D lo exige.
- **FedRAMP Ready pasó a legado el 28-jul-2026**; la Etapa 4 de este plan ya no
  existe.
- **No hay requisito de correr sobre infraestructura certificada** en el ruleset
  de 2026. Lo que bloquea la VM de Windows es la familia PE (fuego, energía), no
  la nube. **No re-plataformar por motivos de FedRAMP.**

Y el informe aporta dos vías que este plan no contemplaba: la **exclusión por
uso de agencia** (inquilino único dentro de la nube de la propia agencia) y que
**GovRAMP vale como credencial de entrada** a la Clase A.

**La secuencia válida es la del informe.** Lo que sigue queda como registro.
