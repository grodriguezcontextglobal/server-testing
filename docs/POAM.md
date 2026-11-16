# POA&M: plan de acción e hitos

> **Sistema:** Devitrak (API Node + Go worker + dashboard y app web), alojado en IT Masters Ltd.
> **Fecha de estado:** 2026-11-16 · **Responsable (POC):** Gustavo Rodriguez
> **Alcance:** infraestructura del proveedor, VMs de producción y aplicación.
> Las vulnerabilidades de dependencias de terceros van aparte, en
> [`POAM_dependencias.md`](POAM_dependencias.md) (DEP-2026-001 a 003).
>
> **Fuentes de detección de esta ronda:**
> - Inventario de red de solo lectura en las dos VMs, 2026-11-13 (`scripts/inventario-red-vm.ps1`).
> - Respuestas de IT Masters al cuestionario, 2026-11-13.
> - Verificación propia de los certificados públicos, 2026-11-13.
> - Ejecución de los informes de cuentas y modos en la VM, 2026-11-16.
> - Informes de endurecimiento de las dos VMs, 2026-11-16, con las mismas 30
>   comprobaciones: DEVITRACKDB con `scripts/vm-hardening-report.ps1` (11 en `OK` y 19
>   en `REVIEW`) y DEVITRACKAPP con `deploy/it/endurecimiento-vm.ps1` del repo del
>   dashboard (9 y 21). La primera pasada de DEVITRACKDB midió solo 28: `IA5-02` y
>   `AU2-02` se añadieron después, al ver que la caducidad de contraseña declarada no
>   se aplicaba, y se repitió la medición.
>   **Las dos máquinas salen idénticas salvo en tres puntos**, lo que confirma que
>   la configuración es del proveedor y no de una máquina: DEVITRACKAPP tiene un
>   certificado vencido todavía atado a un binding, cinco componentes ajenos a
>   producción en vez de dos, y un adaptador de red virtual.
>
> **Plazos aplicados desde la detección:** 30 días para alto, 90 para moderado, 180 para bajo.
> **Revisión:** mensual, con el paquete de ConMon.

Dos avisos sobre este documento. Todavía **no hay un escaneo de vulnerabilidades**
de las VMs, así que la lista sale de una revisión manual, no de una herramienta: por
eso existe APP-2026-007, que es precisamente la falta de ese escaneo. Y la mitad de
los hallazgos **no los podemos cerrar nosotros**: dependen de IT Masters, que presta
las VMs y la red. Para esos, nuestro hito es obtener su compromiso con una fecha.

---

## Resumen

| ID | Debilidad | Control | Riesgo | Responsable | Fecha programada | Estado |
|---|---|---|---|---|---|---|
| IM-2026-001 | RDP abierto a internet, bajo fuerza bruta | AC-17, AC-7 | **Alto** | IT Masters | 2026-12-16 | Abierto |
| IM-2026-002 | Windows sin bloqueo de cuenta ni longitud mínima | AC-7, IA-5 | **Alto** | IT Masters | 2026-12-16 | Abierto |
| IM-2026-003 | vSphere 8 con licencia vencida: hipervisor sin parches | SI-2, RA-5 | **Alto** | IT Masters | 2026-12-16 | Abierto |
| IM-2026-004 | Sin cifrado en reposo | SC-28 | Moderado | IT Masters | 2027-02-14 | Abierto |
| IM-2026-005 | Red plana: las VMs comparten /24 con unos 20 equipos | SC-7 | Moderado | IT Masters | 2027-02-14 | Abierto |
| IM-2026-006 | Respaldos sin copia fuera del sitio ni cifrado confirmado | CP-6, CP-9 | Moderado | IT Masters | 2027-02-14 | Abierto |
| IM-2026-007 | Tramo proxy a IIS en HTTP sin cifrar | SC-8 | Moderado | Compartido | 2027-02-14 | Abierto |
| IM-2026-008 | Sin registros centralizados del perímetro | AU-6, AU-11 | Moderado | IT Masters | 2027-02-14 | Abierto |
| IM-2026-009 | Sin plan de respuesta a incidentes del proveedor | IR-4, IR-6, IR-8 | Moderado | IT Masters | 2027-02-14 | Abierto |
| IM-2026-010 | Proveedor sin SOC 2 ni ISO 27001: controles PE sin heredar | PE (familia), CA-2 | Moderado | Compartido | 2027-02-14 | Abierto |
| APP-2026-001 | Estado de cumplimiento de los servicios externos sin documentar | SA-9 | **Alto** | Devitrak | 2026-12-16 | Abierto |
| APP-2026-002 | Retención de logs de la aplicación: 84 horas y con huecos | AU-11, AU-4 | Moderado | Devitrak | 2027-02-14 | Abierto |
| APP-2026-003 | 47 cuentas activas, 38 sin MFA y unas 20 de prueba | AC-2, IA-2(1) | Moderado | Devitrak | 2027-02-14 | Abierto |
| APP-2026-004 | Tres controles de autorización todavía en modo `warn` | AC-3, AC-6 | Moderado | Devitrak | 2027-02-14 | Abierto |
| APP-2026-005 | Aplicación en el perfil de CGAdmin, servicios como LocalSystem | AC-6, CM-6 | Moderado | Devitrak | 2027-02-14 | Abierto |
| APP-2026-006 | Sin alertas de seguridad sobre los eventos del audit trail | SI-4, AU-6 | Moderado | Devitrak | 2027-02-14 | Abierto |
| APP-2026-007 | Sin escaneo de vulnerabilidades de las VMs | RA-5 | Moderado | Devitrak | 2027-02-14 | Abierto |
| APP-2026-008 | 17 de 28 ajustes CIS L1 fuera de la línea base | CM-6 | Moderado | Devitrak | 2027-02-14 | Abierto |
| APP-2026-009 | Software ajeno a producción en las dos VMs, con Docker en marcha | CM-7 | Moderado | Devitrak | 2027-02-14 | Abierto |
| APP-2026-010 | `/health` sin sonda real: el monitor no detecta degradación | SI-4 | Bajo | Devitrak | 2027-05-15 | Abierto |
| APP-2026-011 | Protección de la rama `main` no aplicada | CM-3, CM-5 | Bajo | Devitrak | 2027-05-15 | Abierto |
| APP-2026-012 | Retransmisión NTLM posible en la red plana | SC-8, IA-2, CM-6 | Moderado | Compartido | 2027-02-14 | Abierto |

Cuatro altos, dieciséis moderados y dos bajos. Los tres altos de infraestructura son el
mismo problema visto desde tres lados: cualquiera en internet puede intentar entrar a
las VMs, nada lo frena y la capa de virtualización no recibe parches.

---

## Hallazgos de infraestructura (IT Masters)

Todos están pedidos en el correo de seguimiento al Sr. Cesar Caminero, representante
de IT Masters. El número entre paréntesis es el punto del correo.

**Respuesta recibida el 2026-11-16:** el Sr. Caminero confirma que trabajará primero
en el punto 1, el urgente, y responderá el resto más adelante. Añade que está
evaluando **mover los servidores a un proveedor cloud con SOC 2 e ISO 27001**. Eso
reabre la decisión de hosting que se cerró el 2026-11-11 y afecta a seis de estos diez
hallazgos: IM-2026-003, 004, 005, 006 y 010 dejarían de existir en vez de resolverse,
y IM-2026-001 cambiaría de forma. Antes de comprometer fechas que dependan de la
infraestructura actual hay que pedirle qué proveedor y en qué plazo. Mientras tanto,
los plazos de abajo siguen corriendo: nada de lo que se haga se pierde en una mudanza.

### IM-2026-001 · RDP abierto a internet, bajo fuerza bruta (1.1, 1.2)

| Campo | Valor |
|---|---|
| **Debilidad** | Los puertos 63980 (DEVITRACKAPP) y 63981 (DEVITRACKDB) están reenviados desde 108.18.55.2 a cualquier IP de origen. El cambio de puerto no actúa como control: los registros muestran **2.315 inicios de sesión fallidos en DEVITRACKDB y 2.383 en DEVITRACKAPP desde 85.239.151.10**. No hay MFA en el acceso remoto |
| **Detectado por** | Inventario del 2026-11-13; confirmado por IT Masters el mismo día ("abierto para el programador") |
| **Activo** | Las dos VMs de producción |
| **Riesgo** | **Alto.** Es acceso remoto con privilegios, expuesto, sin segundo factor y con el bloqueo de cuenta desactivado (IM-2026-002). Un ataque de diccionario no tiene nada que lo detenga |
| **Responsable** | IT Masters (firewall pfSense). Devitrak aporta la IP de origen |
| **Plan** | 1) Contratar una IP dedicada en la VPN del único usuario que entra por RDP y enviársela a IT Masters. 2) Limitar 63980 y 63981 a esa IP. 3) Como solución definitiva, acceso por VPN del proveedor en el pfSense con MFA (OpenVPN o WireGuard), que no depende de ninguna IP fija |
| **Mitigación mientras tanto** | El bloqueo de cuenta de IM-2026-002 es lo que más reduce el riesgo sin cerrar el puerto, y es independiente |
| **Hitos** | 2026-11-18: enviar el correo. 2026-11-25: IP dedicada contratada y enviada. 2026-12-05: puertos limitados a esa IP. 2026-12-16: fecha comprometida para la VPN con MFA |
| **Fecha programada** | 2026-12-16 (30 días) |
| **Estado** | Abierto |

### IM-2026-002 · Windows sin bloqueo de cuenta ni longitud mínima (1.3)

| Campo | Valor |
|---|---|
| **Debilidad** | `net accounts` en las dos VMs devuelve `Lockout threshold: Never`, longitud mínima de contraseña 0 e historial `None`, así que se puede reutilizar la misma contraseña. La política declara caducidad a los 42 días, pero **no se aplica**: `IA5-02` confirma que en cada VM hay 2 cuentas activas marcadas con contraseña que nunca caduca, `Administrator` y `CGAdmin`. Sus contraseñas son del 2022-08-18 y el 2022-09-06 **en las dos máquinas, el mismo día cada una**, lo que apunta a que se pusieron a la vez y probablemente son la misma: comprometer una VM daría la otra |
| **Detectado por** | Inventario del 2026-11-13; caducidad e historial, informe de endurecimiento del 2026-11-16 (`AC7-01`, `IA5-01`, `IA5-02`) |
| **Activo** | Cuentas locales de las dos VMs |
| **Riesgo** | **Alto.** Es lo que convierte IM-2026-001 en explotable: intentos ilimitados contra contraseñas sin requisito de longitud. Una política de caducidad que no se aplica es peor que no tenerla, porque en una revisión figura como cumplida |
| **Responsable** | IT Masters (son sus cuentas y su política) |
| **Plan** | Bloqueo tras 10 intentos fallidos, longitud mínima de 12 caracteres, historial de contraseñas, retirar la marca de "nunca caduca" de las cuentas activas, y cambio coordinado de las contraseñas actuales. Coordinado porque un cambio mal sincronizado deja sin acceso al único usuario o al propio proveedor |
| **Hitos** | 2026-11-18: enviar el correo. 2026-12-02: política aplicada y verificada con `net accounts` y con `Get-LocalUser \| Select-Object Name, PasswordExpires`. 2026-12-16: contraseñas cambiadas |
| **Fecha programada** | 2026-12-16 (30 días) |
| **Estado** | Abierto |

### IM-2026-003 · vSphere 8 con licencia vencida (2)

| Campo | Valor |
|---|---|
| **Debilidad** | El hipervisor corre con la licencia vencida, así que no recibe parches de seguridad. IT Masters está migrando a Proxmox 9.2, sin fecha comprometida |
| **Detectado por** | Respuesta de IT Masters, 2026-11-13 |
| **Activo** | Clúster de virtualización que aloja las dos VMs |
| **Riesgo** | **Alto.** Un fallo del hipervisor rompe el aislamiento entre máquinas virtuales, y no hay forma de corregirlo mientras no haya licencia. Afecta a todo lo que corre encima |
| **Responsable** | IT Masters |
| **Plan** | Obtener fecha de la migración a Proxmox 9.2, ventana de corte de nuestras VMs, aviso previo, si cambian IPs o nombres, y plan de vuelta atrás. Registrar el corte como cambio (CM-3) y verificar la aplicación después (CM-4) |
| **Hitos** | 2026-11-18: enviar el correo. 2026-12-16: fecha de migración comprometida por escrito. La fecha de cierre se ajustará a la suya |
| **Fecha programada** | 2026-12-16 (compromiso de fecha; el cierre depende de su calendario) |
| **Estado** | Abierto |

### IM-2026-004 · Sin cifrado en reposo (2)

| Campo | Valor |
|---|---|
| **Debilidad** | Los discos de las VMs no están cifrados. IT Masters indica que el cifrado llegará con Proxmox |
| **Detectado por** | Respuesta de IT Masters, 2026-11-13 |
| **Activo** | Discos de las dos VMs y respaldos |
| **Riesgo** | Moderado. Los datos de negocio viven en PlanetScale y Atlas, no en los discos de las VMs, pero el `.env` de producción con todas las credenciales sí está en disco |
| **Responsable** | IT Masters |
| **Plan** | Confirmar el método de cifrado, quién custodia las claves y si los respaldos quedarán cifrados. Si la migración se alarga, evaluar BitLocker dentro de la VM con TPM virtual como medida intermedia |
| **Hitos** | 2026-12-16: método y custodia de claves confirmados. 2027-02-14: cifrado activo o medida intermedia aplicada |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### IM-2026-005 · Red plana sin DMZ (4)

| Campo | Valor |
|---|---|
| **Debilidad** | Las dos VMs están en 172.16.40.0/24 junto a unos 20 equipos más, entre ellos máquinas físicas de usuarios y una impresora. No hay DMZ ni VLAN propia. En las VMs escuchan en todas las interfaces los puertos 80, 135, 445, 3389, 5985 y 8081 |
| **Detectado por** | Inventario del 2026-11-13 (vecinos ARP y puertos en escucha) |
| **Activo** | Segmento de red del centro de datos |
| **Riesgo** | Moderado. Un equipo de usuario comprometido alcanza directamente los puertos SMB y WinRM de la VM de producción, sin pasar por el firewall perimetral |
| **Responsable** | IT Masters (switch y pfSense) |
| **Plan** | Mover las VMs a una DMZ o VLAN propia, donde solo entren el tráfico del proxy y el acceso administrativo, con reglas de firewall entre segmentos. Pedir que las VLANs y esas reglas figuren en el diagrama |
| **Hitos** | 2026-12-16: respuesta sobre viabilidad y qué son los otros equipos. 2027-02-14: segmentación aplicada y diagrama actualizado |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### IM-2026-006 · Respaldos sin copia fuera del sitio (5)

| Campo | Valor |
|---|---|
| **Debilidad** | Respaldos diarios a las 5:00, completos semanales, retención de 14 días, en discos externos de un servidor dedicado. No está confirmado que haya copia fuera del centro de datos de Sterling ni que los respaldos estén cifrados. Tampoco hay destino fuera de las VMs para las copias de configuración de la aplicación: la pregunta quedó sin responder |
| **Detectado por** | Respuesta de IT Masters, 2026-11-13 |
| **Activo** | Respaldos de las dos VMs |
| **Riesgo** | Moderado. Un incidente que afecte a la sala afecta a los respaldos a la vez. A favor: la última restauración se probó en junio de 2026 y tardó unas 2 horas, y los datos de negocio tienen respaldo propio en PlanetScale y Atlas |
| **Responsable** | IT Masters |
| **Plan** | Confirmar ubicación del servidor de respaldos, obtener una copia en sitio separado y el cifrado de los respaldos, y un destino de red para las copias diarias de configuración de la aplicación |
| **Hitos** | 2026-12-16: respuestas por escrito. 2027-02-14: copia fuera del sitio y destino de configuración en uso |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### IM-2026-007 · Tramo proxy a IIS en HTTP (6)

| Campo | Valor |
|---|---|
| **Debilidad** | El TLS termina en el NGINX del proveedor. De ahí a IIS el tráfico va en HTTP por el puerto 80, a través de la red compartida de IM-2026-005. En las VMs, IIS solo tiene bindings HTTP salvo `admin.devitrak.net`, que conserva uno en 443 con un certificado vencido. Los certificados `*.devitrak.net` de los almacenes están todos vencidos, el último el 2026-04-03 |
| **Detectado por** | Inventario del 2026-11-13. Los certificados públicos sí son válidos: Let's Encrypt hasta el 2027-01-26 en los tres dominios |
| **Dato nuevo (2026-11-16)** | Las dos VMs tenían **los mismos 4 certificados vencidos**, con idénticas huellas y fechas: tres `*.devitrak.net` (2024-02-19, 2025-03-25, 2026-04-03) y uno `*.itmastersltd.com` vencido el 2023-02-10. Dos cosas que preguntar a IT Masters: cómo llegó su comodín `*.itmastersltd.com` al almacén de nuestras dos máquinas, y por qué el comodín `*.devitrak.net` está duplicado en ambas, lo que significa que su clave privada vive en dos sitios |
| **Avance (2026-11-16)** | **Siete certificados vencidos retirados**, cada uno exportado antes de borrarlo. En DEVITRACKDB los 4, a las 15:39, con copia en `logs\evidence\cert-My-<huella>.cer`, carpeta que el `.gitignore` ya excluye. En DEVITRACKAPP los 3 que no estaban en uso, a las 15:44, con copia en el Escritorio de `CGAdmin`. **Queda uno:** el `*.devitrak.net` vencido el 2026-04-03 (huella `D48486BA…`) sigue atado a un binding de IIS en DEVITRACKAPP, donde lleva siete meses sirviendo un certificado caducado. El script no lo retira a propósito, porque borrarlo dejaría el binding sin certificado |
| **Activo** | NGINX del proveedor e IIS de las dos VMs |
| **Riesgo** | Moderado. Las sesiones del dashboard y los datos de los eventos viajan en claro por un segmento donde hay equipos de usuario |
| **Responsable** | Compartido. El proxy es de IT Masters, IIS es nuestro |
| **Plan** | 1) Confirmar a qué puerto reenvía el NGINX del proveedor. Esa respuesta decide el certificado que queda: si reenvía al 443, el proxy lleva siete meses aceptando un certificado vencido y hay que renovar el binding; si reenvía al 80, el binding es residual y se retira entero. 2) Coordinar el paso del tramo a HTTPS. 3) Identificar qué sitio usa ese binding con `Get-Website` y sus `bindingInformation`, para saber qué se renueva |
| **Hitos** | ~~2026-11-30: certificados sin usar retirados en las dos VMs~~ (hecho el 2026-11-16: 7 de 8). 2026-11-30: pregunta del destino del proxy enviada. 2026-12-16: confirmación del destino del proxy. 2027-01-15: binding de DEVITRACKAPP renovado o retirado. 2027-02-14: tramo en HTTPS |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### IM-2026-008 · Sin registros centralizados del perímetro (7)

| Campo | Valor |
|---|---|
| **Debilidad** | No consta qué registros guarda IT Masters del pfSense, del proxy NGINX ni del hipervisor, ni por cuánto tiempo. Los del proxy son los únicos que tienen la IP real de cada cliente, porque a IIS le llega la del proxy |
| **Detectado por** | Respuesta de IT Masters, 2026-11-13 (sin responder) |
| **Activo** | pfSense, NGINX, hipervisor y la consola McAfee ePO de 172.16.40.42 |
| **Riesgo** | Moderado. Sin esos registros no se puede reconstruir un incidente ni saber de dónde vino |
| **Responsable** | IT Masters |
| **Plan** | Obtener qué se guarda y con qué retención, quién revisa las alertas de McAfee ePO, y acordar un destino donde centralizarlos junto con los nuestros (APP-2026-002) |
| **Hitos** | 2026-12-16: inventario de registros del proveedor. 2027-02-14: retención acordada y destino común definido |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### IM-2026-009 · Sin plan de respuesta a incidentes del proveedor (3)

| Campo | Valor |
|---|---|
| **Debilidad** | IT Masters no tiene plan de respuesta a incidentes. Se ofrecieron a elaborarlo |
| **Detectado por** | Respuesta de IT Masters, 2026-11-13 |
| **Activo** | Toda la infraestructura alojada |
| **Riesgo** | Moderado. FedRAMP exige reportar un incidente en 1 hora; sin un contacto 24/7 ni un compromiso de aviso, ese plazo no se puede cumplir cuando el incidente es del lado del proveedor |
| **Responsable** | IT Masters, con integración de nuestro lado |
| **Plan** | Aceptar su oferta y pedir: contacto 24/7 y contacto de respaldo, compromiso de aviso en un máximo de 1 hora, alcance de su parte (hipervisor, red, firewall, proxy, respaldos y centro de datos) y fecha de borrador. Integrarlo después con nuestro plan |
| **Hitos** | 2026-12-16: contacto 24/7 y compromiso de aviso. 2027-01-31: borrador recibido. 2027-02-14: plan conjunto cerrado |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### IM-2026-010 · Proveedor sin SOC 2 ni ISO 27001 (8)

| Campo | Valor |
|---|---|
| **Debilidad** | IT Masters no tiene SOC 2 ni ISO 27001, así que no podemos heredar sus controles físicos y ambientales con un informe de tercero |
| **Detectado por** | Respuesta de IT Masters, 2026-11-13 |
| **Activo** | Centro de datos de Sterling, VA |
| **Riesgo** | Moderado, pero con impacto en el calendario: sin herencia, toda la familia PE hay que evidenciarla directamente, y eso alarga la evaluación |
| **Responsable** | Compartido |
| **Plan** | Acordar una visita del 3PAO al centro de datos y obtener evidencia de control de acceso físico, registro de visitantes, cámaras, y protección eléctrica, contra incendios y de temperatura. Incluir el coste de esa visita en las cotizaciones de 3PAO. **Antes de nada, resolver la vía alternativa:** el 2026-11-16 el Sr. Caminero avisó de que evalúa mover los servidores a un proveedor cloud con SOC 2 e ISO 27001, lo que cerraría este hallazgo por herencia y sin visita. Pedirle proveedor y plazo antes de contratar la visita |
| **Hitos** | 2026-11-30: proveedor cloud y plazo, o confirmación de que se sigue en Sterling. 2026-12-16: conformidad con recibir la visita. 2027-02-14: evidencia PE recopilada |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

---

## Hallazgos de la aplicación y las VMs (Devitrak)

### APP-2026-001 · Cumplimiento de los servicios externos sin documentar

| Campo | Valor |
|---|---|
| **Debilidad** | El sistema depende de MongoDB Atlas, PlanetScale, Redis Cloud, SendGrid, Cloudinary, Amazon S3 y Stripe. No está documentado el estado de autorización FedRAMP, GovRAMP o SOC 2 de cada uno, ni qué controles heredamos de ellos |
| **Detectado por** | Revisión de la Fase 0, pendiente desde el 2026-10-28 |
| **Activo** | Los siete servicios externos y los datos que salen hacia ellos |
| **Riesgo** | **Alto**, por alcance. Si alguno no tiene autorización, no puede quedar dentro del límite del sistema sin un plan: eso puede obligar a cambiar de proveedor, lo que es trabajo de meses. Es el hallazgo con más capacidad de alterar el calendario entero |
| **Responsable** | Devitrak |
| **Plan** | 1) Por cada servicio, recoger su estado publicado por el propio proveedor, con enlace y fecha de consulta, y qué controles se heredan (SA-9). 2) Diagrama de flujo de datos del SSP: qué datos salen, hacia dónde, por qué puerto y con qué cifrado, desde qué proceso. 3) Para el que no tenga autorización, entrada propia en este POA&M con alternativa evaluada |
| **Hitos** | 2026-11-30: estado de los siete servicios recopilado. 2026-12-16: diagrama de flujo de datos y decisión sobre los que no cumplan |
| **Fecha programada** | 2026-12-16 (30 días) |
| **Estado** | Abierto |

### APP-2026-002 · Retención de los registros de la aplicación

| Campo | Valor |
|---|---|
| **Debilidad** | Los registros de la aplicación cubrían **84 horas** el 2026-11-16, y faltan los del 2026-11-04 al 11-12. `winston` rota a los 5 MB y guarda 5 archivos, así que la ventana depende del volumen de tráfico y no del tiempo. Los `combined1.log` a `combined4.log` eran de mayo a agosto, lo que indica que la rotación no conserva lo más reciente. En Windows, el registro de seguridad es circular de 20 MB, sin reenvío (WEF) ni agente SIEM. Del lado del sistema operativo, `auditpol` muestra que **no se audita la creación de procesos** (evento 4688), ni el acceso a objetos, ni el uso de privilegios: los inicios de sesión sí se auditan, con éxito y fallo, que es de donde salen los 4.625 de la fuerza bruta. Tampoco hay registro de bloques de PowerShell |
| **Detectado por** | Ejecución de `summarize-warn-logs.js` en la VM, 2026-11-16. Auditoría del sistema operativo: informe de endurecimiento del 2026-11-16 (`AU2-01`, `AU2-02`, `CIS-19`, `CIS-20`) |
| **Activo** | `logs\` de la VM de la API y el Event Log de las dos VMs |
| **Riesgo** | Moderado. FedRAMP pide 90 días en línea (AU-11). Además impide investigar un incidente de hace una semana, y debilita cualquier decisión que se apoye en "no hay eventos en el registro", como el paso de los modos a `enforce` (APP-2026-004) |
| **Responsable** | Devitrak, con destino a acordar con IT Masters (IM-2026-008) |
| **Plan** | 1) Revisar la rotación de `winston`: tamaño, número de archivos y por qué los antiguos sobreviven a los recientes. 2) Enviar `logs\` y el Event Log fuera de la VM, al destino que resulte de IM-2026-008. 3) Hasta tener destino, subir el tamaño y el número de archivos para cubrir 90 días. 4) En Windows: activar la auditoría de creación de procesos y el registro de bloques de PowerShell, y subir el registro de seguridad de 20 MB a 192 MB, que es lo que pide CIS |
| **Hitos** | 2026-11-30: rotación corregida y ventana medida. 2026-12-15: auditoría de procesos y tamaño del registro de seguridad aplicados en las dos VMs. 2027-01-15: destino externo acordado. 2027-02-14: 90 días de retención verificados |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### APP-2026-003 · Cuentas activas sin uso y sin MFA

| Campo | Valor |
|---|---|
| **Debilidad** | 47 cuentas de staff activas, de las cuales **38 no tienen MFA** y 8 de las 9 que sí la tienen no tienen códigos de recuperación. Unas 20 son cuentas de prueba en producción (`qaz@qaz.com`, `wsx@wsx.com`, `123456789@test.com` y similares). Tras el backfill del 2026-11-16, 32 cuentas no registran ningún acceso. Una cuenta de prueba figura como administradora de una compañía con nombre de colegio real |
| **Detectado por** | `mfa-coverage.js` y `staff-inactivity.js --report` en la VM, 2026-11-16 |
| **Activo** | Colección `AdminUser` y membresías en `Company.employees` |
| **Riesgo** | Moderado. La MFA es obligatoria desde el 2026-10-05, así que una cuenta sin MFA no puede entrar: el riesgo real no es el acceso inmediato, sino la superficie de cuentas que nadie controla y que incumple AC-2 |
| **Mitigación ya aplicada** | `STAFF_INACTIVITY_MODE=enforce` desde el 2026-11-16: el barrido diario desactivará lo que lleve 90 días sin uso. Hoy no desactiva a nadie; la primera fecha posible es el 2027-02-07 |
| **Responsable** | Devitrak |
| **Plan** | 1) Clasificar las 47 cuentas en reales, de prueba y abandonadas. 2) Desactivar las de prueba antes del 2027-02-07, sin esperar al barrido. 3) Revisar la cuenta de prueba que administra la compañía con nombre de colegio. 4) Para las reales sin MFA, confirmar que `MFA_REQUIRED` no está en `false` y exigir códigos de recuperación al enrolarse |
| **Hitos** | 2026-12-15: clasificación hecha. 2027-01-15: cuentas de prueba desactivadas. 2027-02-14: MFA y códigos de recuperación al 100% de las cuentas reales |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### APP-2026-004 · Tres controles de autorización en modo `warn`

| Campo | Valor |
|---|---|
| **Debilidad** | `CONSUMER_TOKEN_MODE`, `RECEIPT_PUBLIC_READ_MODE` y `STRIPE_OWNERSHIP_MODE` están en `warn`: registran lo que rechazarían, pero dejan pasar la petición. De los 13 modos del sistema, 8 ya están en `enforce` |
| **Detectado por** | Revisión del `.env` de la VM, 2026-11-16 |
| **Activo** | Rutas de token de consumidor, lectura pública de recibos y operaciones de Stripe |
| **Riesgo** | Moderado. Son comprobaciones de autorización que hoy no bloquean |
| **Responsable** | Devitrak |
| **Plan** | Pasarlos a `enforce` de uno en uno, tras confirmar en los registros que no llega tráfico legítimo por esa vía. Bloqueado por APP-2026-002: con 84 horas de ventana, cero eventos no es prueba suficiente. `STRIPE_OWNERSHIP` depende además de cerrar el dueño del pago en el plan de Stripe. `PLAN_LIMITS_MODE` queda fuera de este hallazgo: no es un control de seguridad y pasarlo a `enforce` bloquearía a las compañías que superan el plan Free, que es una decisión de negocio |
| **Hitos** | 2026-11-23: repetir el informe con una ventana de 7 días. 2026-12-15: `CONSUMER_TOKEN` y `RECEIPT_PUBLIC_READ` en `enforce`. 2027-02-14: `STRIPE_OWNERSHIP` en `enforce` |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### APP-2026-005 · Aplicación en el perfil de CGAdmin

| Campo | Valor |
|---|---|
| **Debilidad** | El repositorio de producción vive en `C:\Users\CGAdmin\Documents\Github\server-testing`, dentro del perfil de una cuenta de administrador interactiva y compartida. Los servicios nssm corren como LocalSystem. El `.env` con las credenciales de producción hereda los permisos del perfil |
| **Detectado por** | Inventario del 2026-11-13 |
| **Activo** | Las dos VMs: repositorio, `.env`, sitios de IIS y el `GOTOOLCHAIN` del perfil |
| **Riesgo** | Moderado. LocalSystem es más privilegio del que la aplicación necesita, y atar producción a un perfil de usuario hace que desactivar esa cuenta rompa el servicio |
| **Responsable** | Devitrak |
| **Plan** | Mover la aplicación a `C:\Services\devitrak`, crear una cuenta de servicio con permisos solo sobre la aplicación, `logs\` y `.env`, reapuntar nssm e IIS, y fijar `GOTOOLCHAIN` a nivel de máquina. Con vuelta atrás. Solo después se puede desactivar CGAdmin, que es lo que pide AC-2 de IM-2026-002 |
| **Hitos** | 2026-12-15: script preparado y probado con `-WhatIf`. 2027-01-15: aplicado en ventana de mantenimiento. 2027-02-14: CGAdmin fuera de uso |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### APP-2026-006 · Sin alertas de seguridad

| Campo | Valor |
|---|---|
| **Debilidad** | El audit trail registra toda escritura y los inicios de sesión fallidos, pero nadie recibe aviso: no hay alertas por intentos fallidos repetidos, bloqueos de cuenta, cambios de rol o de administrador, ni picos de errores 5xx |
| **Detectado por** | Revisión de la Fase 0 |
| **Activo** | Audit trail y registros de la aplicación |
| **Riesgo** | Moderado. La fuerza bruta de IM-2026-001 lleva días ocurriendo y se descubrió por un inventario manual, no por una alerta |
| **Responsable** | Devitrak |
| **Plan** | Tarea programada cada 15 minutos que lea el audit trail y los registros y encole un correo al contacto de seguridad al superar umbrales, con modo `off`/`warn`/`enforce` y umbrales configurables. Usa la cola de correo que ya existe |
| **Hitos** | 2026-12-15: implementado con tests. 2027-01-15: desplegado y con un aviso de prueba recibido. 2027-02-14: umbrales ajustados tras un mes de uso |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### APP-2026-007 · Sin escaneo de vulnerabilidades de las VMs

| Campo | Valor |
|---|---|
| **Debilidad** | Hay escaneo continuo de dependencias en el CI (`npm audit`, `govulncheck`, Semgrep, SBOM), pero ningún escaneo autenticado del sistema operativo ni de la configuración de las dos VMs. Este POA&M sale de una revisión manual |
| **Detectado por** | Revisión de la Fase 0 |
| **Activo** | Las dos VMs |
| **Riesgo** | Moderado. RA-5 pide escaneo periódico; sin él, este POA&M está incompleto por definición |
| **Responsable** | Devitrak, con IT Masters para la parte de red |
| **Plan** | Elegir herramienta (Nessus Essentials, OpenVAS o Defender for Servers), correr un escaneo base autenticado de las dos VMs, volcar los hallazgos a este documento y fijar cadencia mensual |
| **Hitos** | 2026-12-15: herramienta elegida con coste. 2027-01-15: escaneo base hecho. 2027-02-14: hallazgos incorporados y cadencia mensual en marcha |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### APP-2026-008 · 17 de 28 ajustes CIS L1 fuera de la línea base

| Campo | Valor |
|---|---|
| **Debilidad** | No hay línea base de configuración segura documentada en Windows Server 2019. Medidas las dos VMs sobre 30 comprobaciones: **11 en `OK` y 19 en `REVIEW`** en DEVITRACKDB, **9 y 21** en DEVITRACKAPP. Tras retirar los certificados vencidos ese mismo día, `CERT-02` pasa a `OK` en las dos, pendiente de confirmar en la siguiente pasada. Aparte de la cadena de APP-2026-012 y de lo que ya recogen IM-2026-002 y APP-2026-002, quedan, **idénticos en las dos máquinas**: cifrado de RDP en nivel 2 "compatible con el cliente" en vez de 3 (`CIS-16`), protección de LSA desactivada (`CIS-08`) y `LmCompatibilityLevel` sin fijar (`CIS-05`). La enumeración anónima de cuentas SAM (`CIS-07`) sí está bloqueada en las dos |
| **Detectado por** | Informes de endurecimiento del 2026-11-16 en las dos VMs |
| **Activo** | Las dos VMs |
| **Riesgo** | Moderado, no bajo como se estimó antes de medir. Dos razones concretas: el nivel 2 de cifrado de RDP está en el servicio que IM-2026-001 tiene publicado a internet, y la protección de LSA apagada es lo que convierte un acceso de administrador puntual en robo de credenciales y acceso permanente |
| **Ruido descartado** | Cuatro `REVIEW` no se van a corregir y conviene dejarlo escrito para que no vuelvan a aparecer: `CIS-10` (los inicios de sesión en caché casi no aplican fuera de un dominio, y las VMs están en WORKGROUP), `CIS-12` (el valor 5 es el de fábrica de Windows, no un agujero), `CIS-14` (autorun, sin medios extraíbles en juego) y `CIS-18` (`NotConfigured` ya bloquea la entrada). Serán excepciones documentadas de la línea base |
| **Responsable** | Devitrak |
| **Plan** | 1) Correr el benchmark completo con CIS-CAT Lite o Policy Analyzer, porque estas 30 comprobaciones son un subconjunto. 2) Aplicar por tandas en ventana de mantenimiento, empezando por `CIS-16` y `CIS-08`, con vuelta atrás y verificando entre tanda y tanda que RDP sigue accesible. 3) Como salen idénticas, una sola línea base sirve para las dos máquinas, y conviene que IT Masters la aplique a cualquier VM que provisione en adelante |
| **Hitos** | ~~2026-11-30: las dos VMs medidas y comparadas~~ (hecho el 2026-11-16). 2026-12-15: `CIS-16` y `CIS-08` aplicados. 2027-01-15: benchmark completo en modo auditoría. 2027-02-14: línea base documentada con sus excepciones |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

### APP-2026-009 · Software ajeno a producción en las dos VMs

| Campo | Valor |
|---|---|
| **Debilidad** | En **DEVITRACKAPP hay cinco componentes ajenos a producción**, tres de ellos en marcha: Memurai (`Running`), el agente de Figma (proceso activo), **Docker (`Running`)**, WSL (`LxssManager`, parado) y la cola de impresión (`Running`), más un adaptador `vEthernet (nat)`. En **DEVITRACKDB**, que se creía limpia, hay dos: WSL instalado y parado, y la cola de impresión corriendo. Nada de eso lo usa la aplicación |
| **Detectado por** | Inventario del 2026-11-13 e informes de endurecimiento del 2026-11-16 (`CM7-01`, `CM7-02`) |
| **Activo** | Las dos VMs |
| **Riesgo** | Bajo-moderado. Dos destacan sobre el resto. La **cola de impresión** es el vector de PrintNightmare (CVE-2021-34527), corre en las dos máquinas y se desactiva sin efecto alguno en la aplicación. **Docker corriendo** en la VM web es un motor de contenedores con privilegios de sistema que nadie usa ni parchea: es el componente con más superficie de los cinco |
| **Responsable** | Devitrak |
| **Plan** | 1) Desactivar la cola de impresión en las dos VMs: es inmediato y no rompe nada. 2) Parar y desinstalar Docker de DEVITRACKAPP, que es lo que más superficie quita. 3) Confirmar que Memurai y Figma no se usan y desinstalarlos; la aplicación usa Redis Cloud, no Memurai. 4) Desinstalar WSL, lo que retira de paso el adaptador virtual |
| **Hitos** | 2026-11-30: cola de impresión desactivada y Docker parado en las dos VMs. 2026-12-15: confirmación de que Memurai y Figma no se usan. 2027-01-15: los cinco desinstalados |
| **Fecha programada** | 2027-02-14 (90 días, adelantado desde 2027-05-15 por Docker en marcha) |
| **Estado** | Abierto |

### APP-2026-010 · `/health` sin sonda real

| Campo | Valor |
|---|---|
| **Debilidad** | `/health` responde siempre 200 con `"server":"standby"` escrito literal en `routes/health.js:54`. No comprueba el estado real del proceso ni de sus dependencias. `helpers/readiness.js` ya documenta el problema |
| **Detectado por** | Verificación del reinicio del servicio, 2026-11-16 |
| **Activo** | API Node y el monitor Uptime Kuma de la VM |
| **Riesgo** | Bajo para la seguridad, relevante para la disponibilidad: el monitor no distingue un servidor degradado de uno sano, así que una caída parcial pasa inadvertida |
| **Responsable** | Devitrak |
| **Plan** | Usar `helpers/readiness.js` para una sonda que compruebe las dependencias reales y apuntar ahí el monitor, dejando `/health` como está para no romper lo que ya lo consulta |
| **Hitos** | 2027-01-15: sonda disponible. 2027-03-15: monitor reapuntado |
| **Fecha programada** | 2027-05-15 (180 días) |
| **Estado** | Abierto |

### APP-2026-011 · Protección de la rama `main` no aplicada

| Campo | Valor |
|---|---|
| **Debilidad** | El ruleset está versionado en `.github/rulesets/protect-main.json`, pero GitHub responde 403 al aplicarlo porque el repositorio es privado en plan Free. `main-guard.yml` detecta los push directos pero no los impide |
| **Detectado por** | Revisión de la Fase 0 |
| **Activo** | Repositorio del servidor |
| **Riesgo** | Bajo. El equipo es pequeño y el CI corre en cada PR, pero CM-5 pide que la restricción esté impuesta, no solo acordada |
| **Responsable** | Devitrak |
| **Plan** | Pasar a GitHub Team o a una organización y aplicar el ruleset. Decidir en el mismo movimiento si la VM pasa a desplegar desde `main`, porque hoy las PRs van a `main` y producción lee `release/observabilidad` |
| **Hitos** | 2027-01-15: decisión de plan y de rama. 2027-03-15: ruleset aplicado y verificado |
| **Fecha programada** | 2027-05-15 (180 días) |
| **Estado** | Abierto |

### APP-2026-012 · Retransmisión NTLM posible en la red plana

| Campo | Valor |
|---|---|
| **Debilidad** | Tres ajustes que por separado son menores y juntos forman una cadena de ataque: la firma SMB no es obligatoria ni como servidor ni como cliente (`CIS-02`, `CIS-03`), LLMNR está activo (`CIS-04`) y la enumeración anónima de recursos compartidos está permitida (`CIS-06`). **Confirmado en las dos VMs**, con los mismos valores |
| **Detectado por** | Informes de endurecimiento del 2026-11-16 en las dos VMs |
| **Activo** | Las dos VMs, sobre el segmento 172.16.40.0/24 de IM-2026-005 |
| **Riesgo** | Moderado. En la red plana, donde el puerto 445 escucha en todas las interfaces y conviven unos 20 equipos de usuario, un atacante que controle una estación puede envenenar la resolución de nombres por LLMNR y retransmitir una autenticación NTLM contra la VM de producción. No hace falta descifrar ninguna contraseña. Lo que hace realista el ataque es la ausencia de segmentación: separado de IM-2026-005 sería un hallazgo teórico |
| **Responsable** | Compartido. Los tres ajustes son del registro de nuestras VMs, pero el riesgo lo crea la red del proveedor, y desactivar LLMNR puede afectar a cómo sus equipos resuelven nombres |
| **Plan** | 1) Avisar a IT Masters antes de tocar LLMNR, por si alguna de sus herramientas depende de él. 2) Aplicar los tres en ventana de mantenimiento y volver a medir. 3) Mantener la petición de DMZ o VLAN propia de IM-2026-005: es lo que elimina el vector de raíz, no estos tres ajustes |
| **Hitos** | 2026-11-30: aviso enviado a IT Masters. 2026-12-15: firma SMB obligatoria y enumeración anónima bloqueada. 2027-02-14: LLMNR desactivado y medición de cierre |
| **Fecha programada** | 2027-02-14 (90 días) |
| **Estado** | Abierto |

---

## Cerrados en esta ronda

| ID | Debilidad | Control | Cerrado | Evidencia |
|---|---|---|---|---|
| APP-2026-C01 | 22 de 47 cuentas tenían `AdminUser.super_user`, el permiso que se salta toda la autorización en todas las compañías. Entre ellas, 15 cuentas de prueba y 5 de personas ajenas al equipo de plataforma | AC-6, AC-2 | 2026-11-16 | `super-user-access.js --only`: 20 revocaciones y 2 concesiones, una fila por cuenta en el audit trail. `--list` devuelve las 4 previstas. Salida en `logs\evidence\super-user-cleanup-*.txt` |
| APP-2026-C02 | Las cuentas de staff no tenían fecha de último acceso, así que no se podía medir la inactividad | AC-2(3) | 2026-11-16 | `staff-inactivity.js --backfill`: 15 cuentas actualizadas desde el audit trail. Las cuentas sin acceso registrado bajaron de 46 a 32 |
| APP-2026-C03 | El control de cuentas inactivas estaba en modo `warn`: detectaba, pero no desactivaba | AC-2(3) | 2026-11-16 | `STAFF_INACTIVITY_MODE=enforce` en el `.env`, `DevitrakServer` reiniciado y `[scheduler] initialized: ... staff-inactivity (daily 03:15)` en el registro. 0 cuentas se desactivarían; la primera fecha posible es el 2027-02-07 |
| APP-2026-C04 | La entrada no validada permitía operadores NoSQL en las consultas | SI-10 | 2026-11-11 | `NOSQL_INPUT_MODE=enforce`, verificado: `?x[$ne]=1` devuelve 400 |

---

## Evidencia

- Inventario de las dos VMs, 2026-11-13: `scripts/inventario-red-vm.ps1`. Contiene cuentas e IPs, así que no se adjunta sin depurar.
- Informes de cuentas y modos, 2026-11-16: `logs\evidence\warn-modes-*.txt` y `.json`, `mfa-coverage-*.txt`, `staff-inactivity-*.txt`, `super-user-*.txt` y `super-user-cleanup-*.txt` en la VM de la API.
- Informes de endurecimiento de las dos VMs, 2026-11-16: `logs\evidence\hardening-DEVITRACKDB-20261116-1536.txt` y `-1539.txt`, de `scripts/vm-hardening-report.ps1` (PRs #63 y #64), y `hardening-DEVITRACKAPP-20261116-1406.txt` y `-1544.txt` en el Escritorio de DEVITRACKAPP, de `deploy/it/endurecimiento-vm.ps1` del repo del dashboard (entregado en `reports/BACKEND_vm_hardening_app_2026-11-16.md`). Los informes de las 15:39 y las 15:44 registran el borrado de los certificados. Todos nombran cuentas e IPs: no se adjuntan sin depurar.
- Copias de los 7 certificados retirados, 2026-11-16: `cert-My-<huella>.cer`, cuatro en `logs\evidence\` de DEVITRACKDB y tres en el Escritorio de DEVITRACKAPP. Solo la parte pública, suficiente para acreditar qué se borró.
- Respuestas de IT Masters, 2026-11-13, y el correo de seguimiento al Sr. Caminero, pendiente de enviar.
- Registro de cambios desplegados: `logs/releases.jsonl` y las etiquetas `deploy-*`.
- Revisión de pendientes que originó este documento: https://claude.ai/artifact/K675pDaLTsC2peegp9cgA8
