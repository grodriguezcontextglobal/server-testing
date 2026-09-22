<#
.SYNOPSIS
  Stop DevitrakGoWorker, rebuild worker.exe from source, start it again, verify.
  This is the supported way to deploy Go worker changes.

.DESCRIPTION
  Replaces the plain `nssm restart DevitrakGoWorker`, so the running binary can
  never silently lag behind the source that was last pulled.

  WHY THIS EXISTS INSTEAD OF AN nssm Start/Pre HOOK: a hook was tried first and
  does not work. nssm cuts the hook off after a few seconds, while a real
  `go build` here takes 8-10s, so the build was killed every time and only the
  runs that FAILED fast (in ~4s) ever finished. Measured on the prod box
  2026-08-07. Doing the build outside the service lifecycle removes that limit
  entirely and, as a bonus, guarantees worker.exe is not locked by a running
  process when the new binary is swapped in.

  Requires an elevated (Administrator) shell, because nssm start/stop does.

.NOTES
  Usage, from anywhere:
      powershell -ExecutionPolicy Bypass -File scripts\restart-go-worker.ps1

  This file is deliberately pure ASCII: Windows PowerShell 5.1 reads .ps1 as
  ANSI without a BOM, and mangled non-ASCII punctuation breaks the parser.
#>

$ErrorActionPreference = 'Stop'

$service     = 'DevitrakGoWorker'
$repoRoot    = Split-Path -Parent $PSScriptRoot
$buildScript = Join-Path $PSScriptRoot 'build-go-worker.ps1'
$buildLog    = Join-Path $repoRoot 'logs\go-worker-build.log'
$port        = if ($env:GO_WORKER_PORT) { $env:GO_WORKER_PORT } else { '7453' }

function Fail([string]$Message) {
    Write-Host "FAILED: $Message" -ForegroundColor Red
    exit 1
}

# nssm start/stop needs elevation; without this the failure shows up as a
# confusing "OpenService(): Access is denied" halfway through.
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Fail "this script must run in an elevated (Administrator) PowerShell."
}

if (-not (Test-Path $buildScript)) {
    Fail "build script not found at $buildScript"
}

Write-Host "==> Stopping $service" -ForegroundColor Cyan
& nssm stop $service
# A stopped-but-already-stopped service is fine; only a hard failure matters,
# and the build below will refuse to swap a locked binary anyway.

Write-Host "==> Building worker.exe" -ForegroundColor Cyan
& powershell.exe -ExecutionPolicy Bypass -NoProfile -File $buildScript

# build-go-worker.ps1 always exits 0 by design (so a Start/Pre hook could never
# block a start), so the exit code says nothing. The RESULT line in its log is
# the real outcome.
$result = Select-String -Path $buildLog -Pattern '^\S+ \S+\s+RESULT: (.+)$' |
          Select-Object -Last 1

if (-not $result) {
    Fail "the build produced no RESULT line in $buildLog - check that log."
}

$resultText = $result.Matches[0].Groups[1].Value
if ($resultText -like 'BUILT*') {
    Write-Host "    $resultText" -ForegroundColor Green
} else {
    # Not fatal: the previous known-good binary is still in place, so starting
    # the service is still the right move. But say so loudly - a stale binary
    # that looks healthy is exactly the failure mode this script exists to stop.
    Write-Host "    $resultText" -ForegroundColor Yellow
    Write-Host "    WARNING: the build did not produce a new binary." -ForegroundColor Yellow
    Write-Host "    The service will start with the PREVIOUS worker.exe (old code)." -ForegroundColor Yellow
    Write-Host "    See $buildLog" -ForegroundColor Yellow
}

Write-Host "==> Starting $service" -ForegroundColor Cyan
& nssm start $service

# nssm reports SERVICE_START_PENDING when the service has not settled yet;
# poll briefly instead of reporting a half-started service as a problem.
$status = ''
foreach ($attempt in 1..10) {
    Start-Sleep -Seconds 1
    $status = (& nssm status $service) -join ''
    if ($status -match 'SERVICE_RUNNING') { break }
}
Write-Host "    status: $status"

Write-Host "==> Health check on port $port" -ForegroundColor Cyan
# A freshly replaced worker.exe is a new binary to Windows Defender, which scans it before
# letting it run: the first start after a rebuild can take well over the 10s polled above.
# Retry for ~30s so a slow-but-healthy start stops looking like a broken deploy.
$health    = $null
$lastError = ''
foreach ($attempt in 1..10) {
    try {
        $health = Invoke-WebRequest -Uri "http://localhost:$port/health" `
                                    -UseBasicParsing -TimeoutSec 5
        break
    } catch {
        $lastError = $_.Exception.Message
        if ($attempt -lt 10) { Start-Sleep -Seconds 3 }
    }
}
if ($health) {
    Write-Host "    $($health.Content)" -ForegroundColor Green
    $status = (& nssm status $service) -join ''
} else {
    Write-Host "    health check failed after ~30s: $lastError" -ForegroundColor Red
    Write-Host "    Check logs\go-worker-err.log and confirm GO_WORKER_PORT matches on BOTH services." -ForegroundColor Red
    Write-Host "    Current service status: $((& nssm status $service) -join '')" -ForegroundColor Red
    exit 1
}

if ($resultText -like 'BUILT*' -and $status -match 'SERVICE_RUNNING') {
    Write-Host "==> Done: rebuilt and running." -ForegroundColor Green
} else {
    Write-Host "==> Finished with warnings (see above)." -ForegroundColor Yellow
}
