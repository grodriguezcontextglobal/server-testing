# Deploy & Producción — devitrak-backend

Guía de despliegue del backend en el servidor de producción (Windows + IIS).
El objetivo de este documento es que cualquier dev pueda entender, operar y recuperar
el servicio sin conocimiento previo del setup.

---

## Arquitectura en producción

```
Cliente  ──►  IIS (db.devitrak.net :80/:443)  ──►  reverse proxy  ──►  Node :34001
                                                                        (cluster pm2-runtime -i max)
                                                                        supervisado por el servicio Windows "DevitrakServer" (nssm)
```

- **IIS** termina 80/443 para el host `db.devitrak.net` y reescribe **todo** el tráfico a
  `http://localhost:34001`. La regla vive en [`public/web.config`](public/web.config)
  (`ReverseProxyInboundRule1`). **IIS no ejecuta Node** — solo hace de proxy.
- **Node** (`index.js` en la raíz) escucha en el puerto **34001**.
- El proceso Node lo administra un **servicio de Windows llamado `DevitrakServer`**, creado con
  [**nssm**](https://nssm.cc/), que a su vez corre **`pm2-runtime`** para mantener el cluster multi-core (`-i max`).

### ¿Por qué nssm y no PM2 directo?

PM2 en Windows **no sobrevive a los reinicios** de la máquina de forma nativa (su `pm2 startup`
no funciona igual que en Linux). Cuando Windows Update reiniciaba el servidor, PM2 no volvía y
la app del cliente quedaba caída hasta que alguien entraba a levantarla a mano.

nssm registra el proceso como **servicio nativo de Windows** con arranque automático en el boot
(antes incluso de iniciar sesión) y reinicio automático si el proceso muere. Usamos `pm2-runtime`
(no `node index.js` a secas) para **conservar el cluster multi-core** que teníamos con `pm2 start -i max`.

---

## ⚠️ Gotcha crítico: `PM2_HOME` es obligatorio en Windows

`pm2-runtime` tiene un bug en Windows: en `node_modules/pm2/lib/binaries/Runtime4Docker.js:67`
usa `process.env.HOME` (variable de **Linux**, inexistente en Windows) para ubicar su carpeta de datos.
Sin `PM2_HOME` definido, arranca y **crashea al instante** con:

```
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received undefined
    at Object.instanciate (...\pm2\lib\binaries\Runtime4Docker.js:67:47)
```

El servicio queda en estado `SERVICE_PAUSED` (nssm lo pausa tras varios reintentos fallidos).

**Solución:** el servicio define `PM2_HOME=C:\Users\CGAdmin\Documents\Github\server-testing\.pm2`.
Con esa variable, `pm2-runtime` la usa directo y no llega al código roto.

---

## Deploy (actualizar código en producción)

Reemplaza al viejo script `pm2-pull-run` de `package.json`. Desde PowerShell **como Administrador**:

```powershell
cd "C:\Users\CGAdmin\Documents\Github\server-testing"
git pull
nssm restart DevitrakServer
```

Verifica que quedó arriba:

```powershell
nssm status DevitrakServer      # SERVICE_RUNNING
Invoke-WebRequest http://localhost:34001 -UseBasicParsing | Select-Object StatusCode   # 200
```

---

## Operación diaria

```powershell
nssm status DevitrakServer        # estado del servicio
nssm restart DevitrakServer       # reiniciar (tras un deploy)
nssm stop DevitrakServer          # detener
nssm start DevitrakServer         # arrancar
nssm edit DevitrakServer          # abrir GUI de configuración
Get-Service DevitrakServer        # estado vía Windows
```

**Logs** (stdout/stderr del servicio):

```powershell
Get-Content "C:\Users\CGAdmin\Documents\Github\server-testing\logs\service-out.log" -Tail 40
Get-Content "C:\Users\CGAdmin\Documents\Github\server-testing\logs\service-err.log" -Tail 40
```

---

## Recrear el servicio desde cero

Si hay que reinstalar el servidor o el servicio se corrompe. PowerShell **como Administrador**:

```powershell
# 0. (Si existiera un PM2 daemon viejo corriendo, sácalo del medio para que no pelee por el puerto)
pm2 delete all; pm2 kill

# 1. Carpeta de logs
New-Item -ItemType Directory -Force "C:\Users\CGAdmin\Documents\Github\server-testing\logs"

# 2. Crear el servicio (Application = ruta a node.exe)
nssm install DevitrakServer "C:\Program Files\nodejs\node.exe"

# 3. Configurar
nssm set DevitrakServer AppParameters "C:\Users\CGAdmin\Documents\Github\server-testing\node_modules\pm2\bin\pm2-runtime start index.js -i max"
nssm set DevitrakServer AppDirectory "C:\Users\CGAdmin\Documents\Github\server-testing"
nssm set DevitrakServer DisplayName "Devitrak Backend Server"
nssm set DevitrakServer Description "Node backend (cluster -i max, puerto 34001) via pm2-runtime, reverse proxy desde IIS db.devitrak.net"
nssm set DevitrakServer Start SERVICE_AUTO_START
nssm set DevitrakServer AppStdout "C:\Users\CGAdmin\Documents\Github\server-testing\logs\service-out.log"
nssm set DevitrakServer AppStderr "C:\Users\CGAdmin\Documents\Github\server-testing\logs\service-err.log"
nssm set DevitrakServer AppExit Default Restart
nssm set DevitrakServer AppRestartDelay 3000

# 4. ¡OBLIGATORIO! Sin esto pm2-runtime crashea en Windows (ver gotcha arriba)
nssm set DevitrakServer AppEnvironmentExtra PM2_HOME=C:\Users\CGAdmin\Documents\Github\server-testing\.pm2

# 5. Arrancar y verificar
nssm start DevitrakServer
nssm status DevitrakServer      # SERVICE_RUNNING
Invoke-WebRequest http://localhost:34001 -UseBasicParsing | Select-Object StatusCode   # 200
```

Para eliminar el servicio por completo: `nssm remove DevitrakServer confirm`

---

## Verificar que sobrevive a un reinicio (la prueba que importa)

Reinicia la máquina y, **sin iniciar sesión ni arrancar nada a mano**:

```powershell
Get-Service DevitrakServer      # debe estar Running tras el boot
Invoke-WebRequest http://localhost:34001 -UseBasicParsing | Select-Object StatusCode   # 200
```

Y `https://db.devitrak.net` debe responder por sí solo.

---

## Referencia rápida del setup

| Pieza            | Valor                                                                    |
|------------------|--------------------------------------------------------------------------|
| Servicio         | `DevitrakServer` (nssm, auto-start en boot)                              |
| Ejecuta          | `node node_modules\pm2\bin\pm2-runtime start index.js -i max`            |
| Working dir      | `C:\Users\CGAdmin\Documents\Github\server-testing`                       |
| Var obligatoria  | `PM2_HOME=...\server-testing\.pm2`                                        |
| Puerto Node      | `34001`                                                                  |
| IIS              | reverse proxy `db.devitrak.net:80/443` → `localhost:34001` (`public/web.config`) |
| node.exe         | `C:\Program Files\nodejs\node.exe`                                        |
| Logs             | `...\server-testing\logs\service-*.log`                                   |

---

## Limitación conocida (downtime durante el reinicio)

nssm elimina la caída **permanente** tras un reinicio (el servicio vuelve solo). Pero durante los
~30–60 s que la máquina tarda en reiniciar por Windows Update, IIS no tiene a quién reenviar y el
cliente verá errores transitorios.

Para cerrar ese hueco (trabajo futuro, no cubierto por este setup):
- Reintentos con backoff en el frontend, para absorber blips cortos.
- Una segunda instancia detrás de un balanceador (reiniciar una a la vez), o migrar a un servicio
  gestionado (Azure App Service / Container Apps) con múltiples réplicas y rolling updates.
