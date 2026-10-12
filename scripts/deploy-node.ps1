<#
.SYNOPSIS
  Stop every Node service, reinstall dependencies from the lockfile, start them
  again, verify. This is the supported way to deploy a change that touched
  package-lock.json.

.DESCRIPTION
  The manual sequence for this has five separate traps on this box, and the
  deploy of 2026-09-09 hit four of them in a row. Each one is handled here so
  the correct order stops depending on anyone remembering it:

  1. `npm ci` deletes node_modules, and a running Node service holds files open
     in there, so the install dies with EBUSY/EPERM halfway. All the Node
     services are stopped first. The Go worker is NOT touched: it is a compiled
     binary that does not use node_modules.

  2. Stopping the services is not enough. The pm2 daemon is a separate process
     that survives `nssm stop` and keeps its own handles inside node_modules,
     which shows up as `ENOTEMPTY: rmdir node_modules\<something>`. Any node
     process whose command line points at this repo is killed as well.

  3. A previous interrupted `npm ci` leaves a tree npm cannot repair on its own
     and then spends its time retrying renames that keep failing. That is what
     turned a 2-minute install into 26 minutes. node_modules is therefore always
     deleted outright before installing, and the deletion is verified.

  4. PowerShell's `Remove-Item -Recurse` chokes on deep node_modules trees and
     reports "directory is not empty" in cascade. `rmdir /s /q` via cmd is used
     instead, with a robocopy mirror as the fallback for whatever survives.

  5. A single health check right after `nssm start` fires before the cluster is
     listening and reports a working deploy as broken. It is retried for ~30s.

  After the install it runs one check npm does not do: whether any DIRECT
  dependency is ESM-only. `uuid` was pinned to an ESM-only major and took
  production down with ERR_REQUIRE_ESM the first time the lockfile was really
  installed, because the repo loads it with require(). npm itself already
  enforces the engines floor (`.npmrc` sets engine-strict=true), so that side
  needs no extra check here.

  Requires an elevated (Administrator) shell, because nssm start/stop does.

.PARAMETER SkipInstall
  Restart the services and run the health check without touching node_modules.
  For deploys that only changed application code.

.PARAMETER KeepGoing
  Start the services even if the install failed. Off by default: bringing the
  cluster up on a half-installed tree is how a 502 loop starts.

.NOTES
  Usage, from anywhere, in an elevated shell:
      powershell -ExecutionPolicy Bypass -File scripts\deploy-node.ps1
      powershell -ExecutionPolicy Bypass -File scripts\deploy-node.ps1 -SkipInstall

  Pull first: this script never runs git, so what it installs is whatever is on
  disk right now.

  This file is deliberately pure ASCII: Windows PowerShell 5.1 reads .ps1 as
  ANSI without a BOM, and mangled non-ASCII punctuation breaks the parser.
#>

[CmdletBinding()]
param(
    [switch] $SkipInstall,
    [switch] $KeepGoing
)

$ErrorActionPreference = 'Stop'

$repoRoot     = Split-Path -Parent $PSScriptRoot
$nodeModules  = Join-Path $repoRoot 'node_modules'
$deployLog    = Join-Path $repoRoot 'logs\deploy-node.log'
$healthUrl    = 'http://localhost:34001/health'
$minFreeGB    = 3

# Order matters on the way down (API first, so it stops taking traffic) and on
# the way up (API last, so the queue workers are already draining).
$services     = @(
    'DevitrakServer',
    'DevitrakEmailWorker',
    'DevitrakBulkWorker',
    'DevitrakDeleteWorker',
    'DevitrakHeavyWorker'
)

function Write-DeployLog([string]$Message) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $deployLog -Value $line -Encoding utf8
}

function Fail([string]$Message) {
    Write-Host "FAILED: $Message" -ForegroundColor Red
    Write-DeployLog "FAILED: $Message"
    exit 1
}

function Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
    Write-DeployLog $Message
}

# ---------------------------------------------------------------- preflight ---

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Fail "this script must run in an elevated (Administrator) PowerShell."
}

New-Item -ItemType Directory -Force (Join-Path $repoRoot 'logs') | Out-Null
Write-DeployLog "--- deploy-node.ps1 start (SkipInstall=$SkipInstall) ---"

if (-not (Test-Path (Join-Path $repoRoot 'package-lock.json'))) {
    Fail "package-lock.json not found in $repoRoot"
}

# The C: drive on this box runs close to full, and an install that runs out of
# space mid-reify leaves exactly the corrupt tree trap #3 is about.
$freeGB = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
Write-Host "    free space on C: ${freeGB} GB"
Write-DeployLog "free space on C: ${freeGB} GB"
if (-not $SkipInstall -and $freeGB -lt $minFreeGB) {
    Fail "only ${freeGB} GB free on C:, need at least ${minFreeGB} GB for an install. Clear space (start with logs\) and retry."
}

# ------------------------------------------------------------------- stop -----

Step "Stopping Node services"
foreach ($svc in $services) {
    $status = (& nssm status $svc) -join ''
    if ($status -match 'SERVICE_STOPPED') {
        Write-Host "    $svc already stopped"
        continue
    }
    if ($status -match 'does not exist') {
        Write-Host "    $svc not installed, skipping" -ForegroundColor Yellow
        Write-DeployLog "$svc not installed, skipped"
        continue
    }
    & nssm stop $svc | Out-Null
    Write-Host "    $svc stopped"
}
Write-Host "    DevitrakGoWorker left running on purpose (compiled binary, does not use node_modules)"

if (-not $SkipInstall) {

    # Trap #2: the pm2 daemon outlives `nssm stop`. Matching on the command line
    # keeps this from killing node processes that have nothing to do with us.
    Step "Clearing leftover node processes for this repo"
    $stray = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$repoRoot*" })
    if ($stray.Count -eq 0) {
        Write-Host "    none found"
    }
    foreach ($proc in $stray) {
        Write-Host "    killing pid $($proc.ProcessId)"
        Write-DeployLog "killed stray node pid $($proc.ProcessId)"
        try { Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop } catch {
            Write-Host "    could not kill pid $($proc.ProcessId): $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    # ------------------------------------------------------------- clean ------

    # Traps #3 and #4: always start from no tree at all, and do not use
    # Remove-Item -Recurse to get there.
    if (Test-Path $nodeModules) {
        Step "Deleting node_modules"
        & cmd /c "rmdir /s /q `"$nodeModules`"" 2>$null

        if (Test-Path $nodeModules) {
            Write-Host "    survivors left, mirroring an empty folder over it" -ForegroundColor Yellow
            $empty = Join-Path $env:TEMP ("empty-" + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Force $empty | Out-Null
            & robocopy $empty $nodeModules /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
            & cmd /c "rmdir /s /q `"$nodeModules`"" 2>$null
            Remove-Item -Recurse -Force $empty -ErrorAction SilentlyContinue
        }

        if (Test-Path $nodeModules) {
            Fail "node_modules could not be deleted. Something still holds it open: check `Get-CimInstance Win32_Process -Filter ""Name='node.exe'""` and any editor or shell sitting in that folder."
        }
        Write-Host "    gone"
    }

    # ----------------------------------------------------------- install ------

    Step "Running npm ci --omit=dev (expect ~2 min; much longer means the tree was not clean)"
    $started = Get-Date
    Push-Location $repoRoot
    try {
        & npm ci --omit=dev --no-audit --no-fund
        $npmExit = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 0)
    Write-Host "    npm exit=$npmExit in ${elapsed}s"
    Write-DeployLog "npm ci exit=$npmExit in ${elapsed}s"

    if ($npmExit -ne 0) {
        if (-not $KeepGoing) {
            Fail "npm ci failed (exit $npmExit). Services are left STOPPED on purpose: starting the cluster on a half-installed tree only produces a 502 loop. Fix the install, then run this script again."
        }
        Write-Host "    continuing anyway because -KeepGoing was passed" -ForegroundColor Yellow
    }

    # ------------------------------------------------------------ verify ------

    # The one class of breakage npm does not catch: a direct dependency that is
    # ESM-only, loaded with require() by this codebase.
    Step "Checking for ESM-only direct dependencies"
    $checkFile = Join-Path $env:TEMP ("esmcheck-" + [guid]::NewGuid().ToString('N') + ".js")
    $checkJs = @'
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2]);
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const deps = Object.keys(rootPkg.dependencies || {});
const bad = [];
for (const name of deps) {
  const file = path.join(root, 'node_modules', name, 'package.json');
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { continue; }
  const dot = pkg.exports && pkg.exports['.'];
  const hasRequire = dot && typeof dot === 'object' && Object.prototype.hasOwnProperty.call(dot, 'require');
  if (pkg.type === 'module' && !hasRequire && !pkg.main) {
    bad.push(name + '@' + pkg.version);
  }
}
if (bad.length) {
  console.error('ESM-ONLY: ' + bad.join(', '));
  process.exit(1);
}
console.log('none');
'@
    Set-Content -Path $checkFile -Value $checkJs -Encoding ascii
    & node $checkFile $repoRoot
    $esmExit = $LASTEXITCODE
    Remove-Item $checkFile -Force -ErrorAction SilentlyContinue
    if ($esmExit -ne 0) {
        Write-DeployLog "ESM-only direct dependency detected"
        if (-not $KeepGoing) {
            Fail "a direct dependency is ESM-only and this codebase uses require(). It will throw ERR_REQUIRE_ESM at startup. Pin that package to a CommonJS version or replace it before starting the services."
        }
        Write-Host "    continuing anyway because -KeepGoing was passed" -ForegroundColor Yellow
    }
}

# ------------------------------------------------------------------ start -----

Step "Starting Node services"
foreach ($svc in ($services[-1..-($services.Count)])) {
    $status = (& nssm status $svc) -join ''
    if ($status -match 'does not exist') { continue }
    & nssm start $svc | Out-Null
    Write-Host "    $svc start issued"
}

# Trap #5: poll instead of asking once. A cluster of four workers plus a fresh
# tree can take well over the couple of seconds nssm needs to report START.
Step "Health check on $healthUrl"
$health = $null
$lastError = ''
foreach ($attempt in 1..10) {
    try {
        $health = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
        break
    } catch {
        $lastError = $_.Exception.Message
        if ($attempt -lt 10) { Start-Sleep -Seconds 3 }
    }
}

$statuses = foreach ($svc in $services) {
    $st = (& nssm status $svc) -join ''
    "$svc=$st"
}

if (-not $health) {
    Write-Host "    no answer after ~30s: $lastError" -ForegroundColor Red
    Write-Host "    $($statuses -join '  ')" -ForegroundColor Red
    Fail "the API never answered. Read logs\service-err.log: an ERR_REQUIRE_ESM or a missing module there means the tree is wrong, and a pm2 error means the supervisor is."
}

Write-Host "    $($health.Content)" -ForegroundColor Green
Write-Host "    $($statuses -join '  ')"
Write-DeployLog "health OK: $($health.Content)"
Write-DeployLog "services: $($statuses -join '  ')"

if ($statuses -join ' ' -match 'SERVICE_STOPPED|SERVICE_PAUSED') {
    Write-Host "==> Finished, but a service is not running (see above)." -ForegroundColor Yellow
    Write-DeployLog "--- deploy-node.ps1 end: WARNINGS ---"
    exit 1
}

Write-Host "==> Done: dependencies installed and the API is answering." -ForegroundColor Green
Write-DeployLog "--- deploy-node.ps1 end: OK ---"
