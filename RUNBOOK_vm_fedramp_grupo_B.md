# Grupo B de FedRAMP: tareas en la VM

> **Fecha:** 2026-10-28 · **Máquina:** la VM de producción (Windows Server 2019,
> PowerShell 5.1) · **Quién:** la persona con acceso de administrador a la VM.
>
> Los scripts están en `scripts\` del repositorio de la VM. **Por defecto solo
> leen**; cualquier cambio exige un parámetro explícito (`-Install`, `-Apply`,
> `-NewAdmin`, `-DisableAccount`). Cada uno guarda lo que imprime en
> `logs\evidence\`: **esos archivos son la evidencia** que pide un auditor
> (3PAO). Cópialos a donde se guarde la documentación de la certificación.

Todos se corren desde una consola **de administrador**:

```powershell
cd C:\Users\CGAdmin\Documents\Github\server-testing
git pull
```

| | Tarea | Controles | Script | Frecuencia |
|---|---|---|---|---|
| B1 | Parches de Windows | SI-2, RA-5 | `vm-patch-status.ps1` | mensual |
| B2 | Certificado TLS de IIS (caducado) | SC-8, SC-12, SC-17 | `vm-iis-certificates.ps1` | ahora, y aviso a 30 días |
| B3 | Backups y prueba de restauración | CP-9, CP-10, CM-2 | `vm-backup-config.ps1` | diario + prueba trimestral |
| B4 | Cuentas de administrador personales | AC-2, AC-6, IA-2 | `vm-admin-accounts.ps1` | ahora, y revisión trimestral |

Orden recomendado: **B4 → B3 → B2 → B1**. Con B4 primero, cada cambio
posterior lo hace una persona con nombre. Y con B3 hecho antes de B1, hay
backup antes de reiniciar por parches.

---

## B4 · Cuentas personales

Hoy se entra como `CGAdmin`, una cuenta compartida. En los logs de Windows,
cualquier acción aparece como "CGAdmin", y FedRAMP (IA-2) exige saber **qué
persona** la hizo.

```powershell
.\scripts\vm-admin-accounts.ps1                                   # 1. informe
.\scripts\vm-admin-accounts.ps1 -NewAdmin grodriguez -FullName "Gustavo Rodriguez"
.\scripts\vm-admin-accounts.ps1 -NewAdmin <otra> -FullName "<otra persona>"
```

1. Crea **al menos dos** cuentas personales. Así, si una persona falta, nadie se
   queda fuera. La contraseña la pide el script (mínimo 15 caracteres) y caduca.
2. **Entra por RDP con tu cuenta nueva** y comprueba que puedes abrir una
   consola de administrador.
3. Desde tu cuenta personal, desactiva la compartida:
   ```powershell
   .\scripts\vm-admin-accounts.ps1 -DisableAccount CGAdmin
   ```
   El script se niega en tres casos: si estás dentro como CGAdmin, si un
   servicio o tarea programada corre con esa cuenta, o si quedarían menos de
   dos administradores. **El repositorio sigue en `C:\Users\CGAdmin\...`:**
   desactivar la cuenta no borra el perfil, y los servicios corren como
   LocalSystem. Moverlo es una de las tareas condicionales (abajo).
4. Si el informe marca la cuenta integrada `Administrator` (SID -500), pide a
   IT Masters que la renombre o desactive. Puede que la usen ellos.

Si la VM está en un dominio de IT Masters, sus cuentas de dominio con acceso
no salen en el informe. **Pídeles la lista** (entra en el POA&M si no la dan).

---

## B3 · Backups y prueba de restauración

**Qué hay que respaldar.** Los datos no están en la VM: MySQL está en
PlanetScale y Mongo en Atlas, con sus propios backups. El código está en git.
Lo único que solo existe en la VM es su **configuración**: IIS, los servicios
nssm, las tareas programadas, el cortafuegos y los certificados. Eso es lo que
guarda el script.

```powershell
.\scripts\vm-backup-config.ps1 -CopyTo \\<servidor>\<recurso>\devitrak   # backup
.\scripts\vm-backup-config.ps1 -Verify C:\Backups\devitrak-config\<fecha> # prueba
```

- **`.env` NO se copia**, porque tiene todas las credenciales. Guárdalo en el
  gestor de contraseñas o en un vault. `env-keys.txt` lista los **nombres** de
  las variables y cuáles de `.env.example` faltan.
- **`-CopyTo` fuera de la VM.** Un backup que solo vive en la máquina que
  protege no cuenta (CP-9). Sirve un recurso de red, un disco de IT Masters o
  un bucket montado.
- **Diario**, como tarea programada (la línea exacta está en la cabecera del
  script): `schtasks /Create /TN "Devitrak\BackupConfig" /RU SYSTEM /SC DAILY /ST 03:30 ...`

### Prueba de restauración de las bases de datos (trimestral)

Un backup que nunca se restauró no está probado (CP-4, CP-9(1)). Se hace en
las consolas de cada proveedor, **contra una copia nueva, nunca sobre producción**:

| | Atlas (Mongo) | PlanetScale (MySQL) |
|---|---|---|
| 1 | *Backup* → confirmar que la política está activa y anotar la retención | *Backups* → confirmar la frecuencia y la retención del plan |
| 2 | *Restore* del último snapshot a un **cluster nuevo y temporal** | *Restore* del último backup a una **rama nueva** |
| 3 | Contar documentos de 3 colecciones (`transactions`, `adminusers`, `companies`) y compararlos con producción | `SELECT COUNT(*)` de 3 tablas (`item_inv`, `members_info`, `staff_member`) y compararlos con producción |
| 4 | Anotar cuánto tardó (eso es el RTO real) y la hora del snapshot (el RPO) | Igual |
| 5 | **Borrar** el cluster temporal (cuesta dinero) | **Borrar** la rama |

Anota fecha, persona, tiempos y resultado en el registro de pruebas de
contingencia (grupo C). La prueba de la configuración de la VM es `-Verify`.

---

## B2 · Certificado TLS de IIS

```powershell
.\scripts\vm-iis-certificates.ps1
```

El informe lista cada binding https con su certificado, la fecha de caducidad
y el estado: `EXPIRED`, `EXPIRES SOON` (menos de 30 días) u `OK`. El campo
**issuer** dice quién emitió el actual, y eso decide de dónde sacar el nuevo:

| Si el emisor es… | Cómo renovarlo |
|---|---|
| Una CA comercial (DigiCert, Sectigo, GoDaddy…) | Renovarlo en esa cuenta; descargar el `.pfx` (con clave privada) |
| Let's Encrypt | Instalar **win-acme** en la VM: emite y **renueva solo** con una tarea programada. Pide el puerto 80 abierto o validación por DNS |
| Cloudflare Origin CA | Solo vale si el DNS de `db.devitrak.net` está **proxied** (nube naranja) en Cloudflare; se genera en *SSL/TLS → Origin Server* y dura hasta 15 años |

Después:

```powershell
Import-PfxCertificate -FilePath C:\ruta\nuevo.pfx -CertStoreLocation Cert:\LocalMachine\My -Password (Read-Host -AsSecureString)
.\scripts\vm-iis-certificates.ps1 -Thumbprint <huella nueva> -HostName db.devitrak.net          # plan
.\scripts\vm-iis-certificates.ps1 -Thumbprint <huella nueva> -HostName db.devitrak.net -Apply   # aplica
```

El script solo cambia los bindings cuyo nombre cubre el certificado nuevo, y
exige que sea válido hoy y que tenga clave privada. IIS no necesita reinicio.
**Compruébalo desde fuera de la VM** (`https://db.devitrak.net/health`), porque
desde dentro no se resuelve (DEPLOY.md, C.1). Borra el `.pfx` del disco cuando
termines.

Para que no vuelva a caducar sin aviso: con win-acme, la renovación es
automática. Además, añade en Uptime Kuma, **desde fuera**, un monitor HTTP de
`https://db.devitrak.net/health` con *Certificate Expiry Notification*.

---

## B1 · Parches de Windows

```powershell
.\scripts\vm-patch-status.ps1                 # informe (busca en línea: unos minutos)
.\scripts\vm-patch-status.ps1 -SkipSearch     # informe rápido, sin buscar
```

Marca en rojo:
- más de 30 días desde el último parche;
- parches de seguridad publicados hace más de 30 días y sin instalar (SI-2
  pide los críticos y altos en 30 días);
- un reinicio pendiente.

Si sale `WSUS`, los parches los aprueba IT Masters: el informe es lo que hay
que enviarles.

**Instalar, dentro de una ventana de mantenimiento:**

```powershell
.\scripts\vm-backup-config.ps1 -CopyTo \\<servidor>\<recurso>\devitrak   # B3 antes
.\scripts\vm-patch-status.ps1 -Install -SecurityOnly
Restart-Computer                                                          # si lo pide
```

El script **nunca reinicia**. Tras el reinicio, nssm arranca los servicios
solo. Compruébalo:

```powershell
nssm status DevitrakServer; Invoke-WebRequest http://127.0.0.1:34001/health -UseBasicParsing
```

Repítelo **cada mes**. El informe de `logs\evidence\patch-status-*.txt` es la
evidencia de la revisión mensual.

---

## Condicionales: solo si nos quedamos en IT Masters

Dependen de la decisión de hosting (grupo D). Si migramos a Oracle, AWS o
Azure, se resuelven al construir la máquina nueva, no aquí.

| Tarea | Control | Qué implica |
|---|---|---|
| Cuenta de servicio en vez de LocalSystem | AC-6 | Crear una cuenta virtual o gMSA para los servicios nssm, con permisos solo sobre la carpeta de la app y `logs\` |
| Sacar la app del perfil de CGAdmin | AC-6, CM-6 | Moverla a `C:\Services\devitrak` y dar permisos sobre `.env` solo a la cuenta de servicio y a Administrators |
| BitLocker en el disco | SC-28 | Cifrado en reposo. Lo activa el proveedor del hipervisor o se hace dentro de la VM, con TPM virtual |
| Logs centralizados | AU-4, AU-9 | Enviar `logs\` (ya en JSON desde A10) y el Event Log a un almacén fuera de la VM |
| Línea base CIS de Windows Server 2019 | CM-6 | Aplicar el benchmark CIS L1 y documentar las excepciones |
