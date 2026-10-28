# FedRAMP: estado y pasos en la VM

> **Fecha:** 2026-10-28 · **Rama:** `release/observabilidad` · **Prod:** `2d220f3`
> desde el 2026-10-28 ~20:09 UTC, con Node 22.23.4 (antes `12ecf78`). La
> Parte 1 se escribió antes de ese deploy: lo que dice "sin desplegar" ya está
> en producción.
>
> Parte 1: qué está hecho y qué falta. Parte 2: los comandos para pegar en la
> VM, en orden. Todo se corre en una consola de PowerShell **de administrador**.
> El detalle del grupo B está en `RUNBOOK_vm_fedramp_grupo_B.md`.

---

## Parte 1 · Estado

### Hecho y en producción

| Commit | Qué cierra |
|---|---|
| `e871d1b` | S0.1: inyección SQL y rutas anónimas |
| `ef317c1` | transaction-audit-log sin escritura externa; lectura solo `super_user` |
| `dcff2e3` | Sesión obligatoria en consulting-item, new_stripe e `/image` |
| (VM) | Puertos 34001, WinRM y SMB cerrados en el firewall (2026-10-26) |

### Hecho en código, en `origin/release/observabilidad`, SIN desplegar (38 commits)

| Commit | Tarea | Control |
|---|---|---|
| `603cf66` | Bloqueo por intentos fallidos, login fallido auditado, contraseña de 12 | AC-7, AU-2, IA-5 |
| `fc6bf34`, `31ade10` | CI: tests, `npm audit` desde *high*, govulncheck, Semgrep, SBOM | SA-11, RA-5 |
| `de3c5a2` | Fuera 3 handlers SQL sin montar | CM-7 |
| `389fd39` | Sesión de 12 h como máximo, sin "recordarme" | AC-12 |
| `6d139a1`...`c3ba26d` | Deniega por defecto: receiver, db_event, db_company, db_item, event, document | AC-3 |
| `d9a155b` | A1: Node y Go solo en loopback | SC-7 |
| `d9a155b`, `feb4c99` | A2: 66 rutas más exigen sesión, y las previas al login | AC-3, AC-14 |
| `c89d43a` | A3: cambio de email de staff sin mover membresías ajenas | AC-6 |
| `db71170` | A5: recuperación de MFA por pérdida del dispositivo | IA-2 |
| `7d8cb0e` | A6: la sesión de staff se cierra en el servidor | AC-12 |
| `e18c416` | A7: resumen de los modos *warn* en los logs | AU-6 |
| `b7058e0`...`90fa6e5` | A8: Stripe y `/api/transaction` solo de la propia compañía | AC-3 |
| `19d1dd9` | A9: Node 22.12.0 como mínimo | SI-2 |
| `3ed0c58` | A10: logs JSON de una línea y medición de RAM | AU-3 |
| `0247ae0` | Grupo B: scripts de la VM y runbook | - |

Documentación (grupo C): borrador en el *Documentation Package* (Claude Doc),
con los `[confirm]` por rellenar.

### Pendiente

**Decisiones del equipo (Fase 0)**
- [ ] Hosting: AWS, Oracle o seguir en IT Masters
- [ ] Ruta: GovRAMP Core, luego Ready; SOC 2 opcional
- [ ] Responsable de cumplimiento (ISSO) y responsable técnico
- [ ] Presupuesto (unos $60k-150k el primer año)
- [ ] Inscripción en GovRAMP ($500 al año)
- [ ] Al menos 3 cotizaciones de 3PAO
- [ ] Cuestionario a IT Masters
- [ ] Estado FedRAMP / SOC 2 de Mongo Atlas, Redis, PlanetScale y AWS (el riesgo mayor)

**VM (Parte 2 de este documento)**
- [ ] Desplegar los 38 commits, con Node 22 (paso 2)
- [ ] B4 cuentas personales · B3 backups · B2 certificado IIS · B1 parches (paso 3)
- [ ] RDP solo por VPN o bastión (AC-17)
- [ ] Quitar credenciales de prueba del `.env` y rotar las demás (IA-5)
- [ ] Si nos quedamos en IT Masters: cuenta de servicio, sacar la app del perfil
      de CGAdmin, BitLocker, logs centralizados, línea base CIS (ver runbook)

**Aplicación (Fase 2)**
- [ ] Pasar los modos de *warn* a *enforce* después de leer los logs (paso 4)
- [ ] Medir la cobertura de MFA en prod (el 2026-10-05, 41 de 47 sin MFA)
- [ ] Stripe: dueño del pago (Fase 0.1) e idempotencia en Stripe (Fase 1)
- [ ] Protección de la rama `main` verificada por un admin de la org (CM-3)
- [ ] Registro de releases: fecha, commit y quién lo aprobó

**ConMon y documentación (Fases 3-4)**
- [ ] Primer escaneo base y POA&M con los hallazgos reales
- [ ] Alertas: logins fallidos, bloqueos, cambios de admin, picos de 5xx
- [ ] Paquete mensual de ConMon
- [ ] Cerrar los `[confirm]` del Documentation Package

**Fases 5-7:** evaluación del 3PAO, GovRAMP Ready, FedRAMP. Sin empezar.

### Respuesta de los administradores: topología de red

Fuente: `reports/DeviTrak_network_topology.pptx` (1 diapositiva, recibida el
2026-10-28). La propia diapositiva dice que es una topología **lógica** y que
los equipos de la LAN y los nombres de las VM son ilustrativos.

**Lo que muestra, de fuera hacia dentro:**

| # | Elemento | Detalle |
|---|---|---|
| 1 | Internet | Verizon FIOS, fibra de 2 Gb, un solo proveedor |
| 2 | Firewall / router | pfSense, IP pública `108.18.55.2`, NAT hacia la LAN |
| 3 | Proxy | NGINX SSL proxy, entre pfSense y el switch; sirve `app.devitrak.net` y `db.devitrak.net` |
| 4 | LAN switch | Un solo switch para todo |
| 5 | En ese mismo switch | Estaciones de trabajo y dispositivos de usuarios, impresora de red, y el clúster de virtualización |
| 6 | Clúster de virtualización | 3 servidores físicos (Virtual Server 01-03) |
| 7 | VMs | "DeviTrak App" (aplicación), "DeviTrak DB" (base de datos), VM 03 y VM 04 (otros servicios) |

**Lo que cambia para el plan:**

- **El TLS se termina dos veces.** NGINX termina el TLS de internet y luego
  habla con IIS. Lo más probable es que el certificado caducado de la tarea B2
  sea el de ese salto NGINX → IIS. Si NGINX ya hace el TLS hacia fuera, una
  opción más simple es que NGINX hable con IIS por HTTP dentro de una red
  aislada, o directamente con Node. Eso hay que decidirlo con ellos antes de
  renovar el certificado.
- **No hay segmentación (SC-7).** Los servidores comparten switch y red con las
  estaciones de trabajo y la impresora. Un equipo de usuario comprometido llega
  directo a la VM de producción. Hace falta como mínimo una VLAN o DMZ para los
  servidores, con reglas en pfSense entre segmentos.
- **Es una instalación propia, no un centro de datos.** Un solo ISP, un solo
  firewall y un solo switch. Afecta a los controles físicos y ambientales (PE)
  y de contingencia (CP-8, SC-5). Esto pesa en la decisión de hosting (Fase 0):
  cumplir PE aquí obliga a documentar la sala, el acceso físico, el SAI y la
  climatización.
- **La IP `172.16.40.2` del error `ERR_ERL_INVALID_IP_ADDRESS`** del rate
  limiter es casi seguro el NGINX o el IIS de esta cadena: alguno de los dos
  manda la IP del cliente con el puerto pegado en `X-Forwarded-For`.
- **El nombre de la VM no cuadra.** Nuestra VM de producción se llama
  `DeviTrackDB` y en ella corre la API (Node, el Go worker y los workers),
  mientras que las bases de datos están en PlanetScale y Atlas. En la diapositiva,
  "DeviTrak DB" figura como VM de base de datos. Hay que confirmar si es la misma
  máquina y qué hay en "DeviTrak App".

**Preguntas que siguen abiertas para los administradores:**

- [ ] ¿Dónde está físicamente el clúster? ¿Hay control de acceso, SAI, generador y climatización? (PE)
- [ ] ¿Qué hipervisor usa el clúster (VMware, Hyper-V, Proxmox)? ¿Qué versión tiene y cómo se parchea? (SI-2, CM-8)
- [ ] ¿NGINX es un equipo físico, una VM o un servicio en pfSense? ¿Quién lo administra y dónde están su configuración y su certificado?
- [ ] ¿Qué es exactamente "DeviTrak App" y qué es "DeviTrak DB"? ¿`DeviTrackDB` es una de las dos? ¿Qué corre en VM 03 y VM 04?
- [ ] ¿Hay VLANs, o es una red plana? ¿Qué reglas tiene pfSense entre la LAN de usuarios y los servidores?
- [ ] ¿Se hacen backups o snapshots a nivel de hipervisor? ¿Dónde se guardan y con qué retención? (CP-9)
- [ ] ¿Hay un ISP o un firewall de respaldo? (CP-8)
- [ ] ¿Los logs de pfSense y de NGINX se conservan? ¿Dónde y cuánto tiempo? (AU-11)
- [ ] ¿Qué IP es `172.16.40.2`? ¿NGINX está configurado con `X-Forwarded-For` y `X-Real-IP`?

---

## Parte 2 · Comandos en la VM

### Paso 0 · Antes de empezar

- **Cierra VS Code en la VM.** Si está abierto sobre el repo, bloquea
  `node_modules` y el deploy se aborta (así se cayó la API el 2026-10-20).
- Avisa al frontend: A2, A3, A5, A6 y Stripe cambian contratos. Las notas están
  en `reports/FRONTEND_fedramp_*` de la máquina de desarrollo.
- Hazlo en una ventana de mantenimiento: el paso 2 para la API unos minutos.

```powershell
cd C:\Users\CGAdmin\Documents\Github\server-testing
git status
git log --oneline -1
```

`git log` debería mostrar `12ecf78`. Si muestra otra cosa, hubo un deploy
que no está registrado aquí: revisa antes de seguir.

### Paso 1 · Comprobaciones previas (solo leen)

```powershell
# 1a. Version de Node (tiene que ser >= 22.12.0 para este deploy)
node -v

# 1b. El proxy de IIS debe apuntar a 127.0.0.1:34001, no a localhost
#     (Node pasa a escuchar solo en 127.0.0.1; localhost puede resolver a ::1 -> 502)
Import-Module WebAdministration
Get-Website | ForEach-Object {
  $p = [Environment]::ExpandEnvironmentVariables($_.physicalPath)
  Select-String -Path (Join-Path $p 'web.config') -Pattern ':34001' -ErrorAction SilentlyContinue
}

# 1c. Variables de .env.example que faltan en .env
$ex = Get-Content .env.example | Where-Object { $_ -match '^[A-Za-z0-9_]+=' } | ForEach-Object { ($_ -split '=',2)[0] }
$en = Get-Content .env         | Where-Object { $_ -match '^[A-Za-z0-9_]+=' } | ForEach-Object { ($_ -split '=',2)[0] }
$ex | Where-Object { $en -notcontains $_ }
```

- Si **1a** da v20, instala Node 22 LTS (paso 2a).
- Si **1b** muestra `localhost:34001`, edita ese `web.config` y cámbialo por
  `127.0.0.1:34001` (el del repo, `public/web.config`, ya está así).
- **1c** lista lo que el paso 2b va a añadir.

### Paso 2 · Deploy

**2a. Node 22 LTS** (solo si `node -v` da menos de 22.12.0)

Descarga el instalador `.msi` x64 de Node 22 LTS desde
https://nodejs.org/en/download e instálalo. Luego, **en una consola nueva**:

```powershell
node -v
npm -v
# pm2-runtime tiene que seguir donde lo busca el servicio
nssm get DevitrakServer Application
nssm get DevitrakServer AppParameters
```

Si la ruta que da `nssm get` ya no existe tras la actualización, reinstala pm2
con `npm install -g pm2` y vuelve a comprobarlo.

**2b. Código y variables nuevas**

```powershell
cd C:\Users\CGAdmin\Documents\Github\server-testing
git pull origin release/observabilidad
git log --oneline -1          # debe ser 0247ae0 o posterior

# Copia de seguridad del .env antes de tocarlo
Copy-Item .env ".env.bak-$(Get-Date -Format yyyyMMdd-HHmm)"

# Añade solo las variables que falten, con los valores seguros (warn)
$b = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$add = [ordered]@{
  LOGIN_MAX_ATTEMPTS           = '5'
  LOGIN_ATTEMPT_WINDOW_S       = '900'
  LOGIN_LOCKOUT_S              = '1800'
  PASSWORD_MIN_LENGTH          = '12'
  DB_COMPANY_PUBLIC_MODE       = 'warn'
  CONSUMER_JWT_SECRET          = [Convert]::ToBase64String($b)
  CONSUMER_APP_URL             = 'https://app.devitrak.net'
  CONSUMER_ORIGINS             = 'https://app.devitrak.net'
  CONSUMER_TOKEN_MODE          = 'warn'
  SESSION_MODE                 = 'warn'
  SESSION_IDLE_MINUTES         = '30'
  STRIPE_OWNERSHIP_MODE        = 'warn'
  RUNTIME_METRICS_INTERVAL_SEC = '60'
}
$have = Get-Content .env | ForEach-Object { ($_ -split '=',2)[0].Trim() }
if ((Get-Content .env -Raw) -notmatch "\n$") { Add-Content .env '' -Encoding ASCII }
foreach ($k in $add.Keys) {
  if ($have -notcontains $k) { Add-Content .env "$k=$($add[$k])" -Encoding ASCII; "added $k" }
}
```

`BIND_HOST` y `GO_WORKER_BIND` se dejan sin poner: por defecto valen 127.0.0.1.

**2c. Instalar dependencias y reiniciar Node** (el lockfile cambió: va con install)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-node.ps1
```

**2d. Recompilar y reiniciar el Go worker** (A1 cambió `go-worker/main.go`)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\restart-go-worker.ps1
```

**2e. Verificación**

```powershell
# Servicios
'DevitrakServer','DevitrakGoWorker','DevitrakEmailWorker','DevitrakBulkWorker','DevitrakDeleteWorker','DevitrakHeavyWorker' |
  ForEach-Object { "{0,-22} {1}" -f $_, (nssm status $_ 2>&1 | Out-String).Trim() }

# Salud local
(Invoke-WebRequest http://127.0.0.1:34001/health -UseBasicParsing).StatusCode
(Invoke-WebRequest http://127.0.0.1:7453/health  -UseBasicParsing).StatusCode

# 34001 y 7453 deben escuchar SOLO en 127.0.0.1 (nada de 0.0.0.0 ni ::)
Get-NetTCPConnection -State Listen -LocalPort 34001,7453 | Select-Object LocalAddress,LocalPort,OwningProcess
```

Después, **desde fuera de la VM**: abre `https://db.devitrak.net/health` y
entra al dashboard con un usuario real (login, MFA, una pantalla de inventario).

**Si algo falla (rollback)**

```powershell
cd C:\Users\CGAdmin\Documents\Github\server-testing
git checkout 12ecf78
powershell -ExecutionPolicy Bypass -File scripts\deploy-node.ps1
powershell -ExecutionPolicy Bypass -File scripts\restart-go-worker.ps1
```

Node 22 se puede quedar instalado: `12ecf78` también corre con él. Las
variables nuevas del `.env` no molestan al código anterior. Para volver a la
rama después: `git checkout release/observabilidad`.

### Paso 3 · Grupo B (orden B4, B3, B2, B1)

Cada script, sin parámetros, solo lee y guarda su informe en `logs\evidence\`.
Esos archivos son la evidencia para el 3PAO: cópialos a la carpeta de la
certificación.

**B4 · Cuentas personales (AC-2, IA-2)**

```powershell
.\scripts\vm-admin-accounts.ps1
.\scripts\vm-admin-accounts.ps1 -NewAdmin grodriguez -FullName "Gustavo Rodriguez"
.\scripts\vm-admin-accounts.ps1 -NewAdmin <usuario2> -FullName "<Nombre 2>"
```

Entra por RDP con tu cuenta nueva, comprueba que abres una consola de
administrador y, **desde esa cuenta**:

```powershell
cd C:\Users\CGAdmin\Documents\Github\server-testing
.\scripts\vm-admin-accounts.ps1 -DisableAccount CGAdmin
```

**B3 · Backup de la configuración (CP-9, CP-10)**

```powershell
.\scripts\vm-backup-config.ps1 -CopyTo \\<servidor>\<recurso>\devitrak
.\scripts\vm-backup-config.ps1 -Verify C:\Backups\devitrak-config\<fecha>
```

Prográmalo a diario con la línea `schtasks` de la cabecera del script. La
prueba de restauración de Atlas y PlanetScale es manual, en sus consolas
(tabla en el runbook).

**B2 · Certificado de IIS caducado (SC-8)**

```powershell
.\scripts\vm-iis-certificates.ps1
# con el .pfx nuevo:
Import-PfxCertificate -FilePath C:\ruta\nuevo.pfx -CertStoreLocation Cert:\LocalMachine\My -Password (Read-Host -AsSecureString)
.\scripts\vm-iis-certificates.ps1 -Thumbprint <huella> -HostName db.devitrak.net          # plan
.\scripts\vm-iis-certificates.ps1 -Thumbprint <huella> -HostName db.devitrak.net -Apply   # aplica
```

Borra el `.pfx` del disco al terminar. De dónde sacar el certificado según el
emisor: tabla en el runbook.

**B1 · Parches de Windows (SI-2)**

```powershell
.\scripts\vm-patch-status.ps1
.\scripts\vm-patch-status.ps1 -Install -SecurityOnly
Restart-Computer     # solo si lo pide
```

Tras el reinicio:

```powershell
nssm status DevitrakServer; (Invoke-WebRequest http://127.0.0.1:34001/health -UseBasicParsing).StatusCode
```

Repítelo cada mes.

### Paso 4 · De warn a enforce (no antes de 12 h tras el deploy)

Primero lee qué se habría rechazado:

```powershell
cd C:\Users\CGAdmin\Documents\Github\server-testing
node scripts\summarize-warn-logs.js --since 2026-10-29 --top 15 --ips
node scripts\summarize-warn-logs.js --since 2026-10-29 --json > logs\evidence\warn-summary-$(Get-Date -Format yyyyMMdd).json
```

Cambia a `enforce` **solo** los modos sin llamadas legítimas en el resumen,
uno por uno, y reinicia Node tras cada cambio:

| Variable | Pasa a enforce cuando... |
|---|---|
| `SESSION_MODE` | han pasado 12 h desde el deploy (los tokens viejos no llevan sid) |
| `STRIPE_OWNERSHIP_MODE` | el resumen no muestra accesos a recursos de otra compañía |
| `COMPANY_AUTH_MODE` | el dashboard manda la cabecera de compañía en todas las rutas |
| `CONTRACT_LINK_MODE`, `ATTENDANCE_LINK_MODE` | no quedan enlaces sin firmar en el log |
| `CONSUMER_TOKEN_MODE` | la app del consumidor ya manda el token |
| `DB_COMPANY_PUBLIC_MODE` | no hay llamadas anónimas al alta de compañía |

```powershell
# ejemplo, para una variable:
# (UTF-8 sin BOM: un BOM rompe la primera variable del .env)
$c = (Get-Content .env -Encoding UTF8) -replace '^SESSION_MODE=.*','SESSION_MODE=enforce'
[IO.File]::WriteAllLines((Join-Path $PWD '.env'), $c)
powershell -ExecutionPolicy Bypass -File scripts\deploy-node.ps1 -SkipInstall
```

### Paso 5 · Medición de RAM (A10, opcional)

```powershell
node scripts\summarize-ram.js
```
