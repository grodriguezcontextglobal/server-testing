<#
.SYNOPSIS
  Rebuilds go-worker/worker.exe from source. Designed to run as the nssm
  Start/Pre hook of DevitrakGoWorker, so a service restart always loads a
  binary built from the current source (see DEPLOY.md).

.DESCRIPTION
  Safety model - this script ALWAYS exits 0, on purpose.

  A Start/Pre hook that fails can prevent the service from starting. Restarting
  the worker is frequently an INCIDENT-RECOVERY action, so a compile error in
  half-finished source must never be the reason production cannot come back up.
  If the build fails for any reason, the existing (last known-good) worker.exe
  is left untouched, the failure is written to logs\go-worker-build.log, and the
  service starts with that older binary.

  Consequence to be aware of: a silent build failure means the worker keeps
  running OLD code. Check logs\go-worker-build.log after deploying Go changes -
  every run appends a RESULT line stating BUILT, SKIPPED or FAILED.

  The build goes to a temporary file first and only replaces worker.exe once it
  succeeds, so a broken build can never leave a corrupt/half-written binary in
  place.

  NOTE: this file is deliberately pure ASCII. Windows PowerShell 5.1 reads .ps1
  files as ANSI unless they carry a UTF-8 BOM, so non-ASCII punctuation (em
  dashes, accents) gets mangled into characters the parser treats as quotes,
  breaking the script at run time.

.NOTES
  Can also be run by hand instead of `go build -o .\worker.exe`:
      powershell -ExecutionPolicy Bypass -File scripts\build-go-worker.ps1
#>

$repoRoot    = Split-Path -Parent $PSScriptRoot
$goWorkerDir = Join-Path $repoRoot 'go-worker'
$logDir      = Join-Path $repoRoot 'logs'
$logFile     = Join-Path $logDir 'go-worker-build.log'
$target      = Join-Path $goWorkerDir 'worker.exe'
$staging     = Join-Path $goWorkerDir 'worker.build.exe'

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

function Write-BuildLog {
    param([string]$Message)
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $logFile -Value $line -Encoding utf8
}

Write-BuildLog "--- build-go-worker.ps1 start (user: $env:USERNAME) ---"

# The service typically runs as LocalSystem, whose PATH differs from the
# interactive admin's, so `go` is often NOT on it. Resolve explicitly and fall
# back to the standard install locations before giving up.
$goExe = (Get-Command go.exe -ErrorAction SilentlyContinue).Source
if (-not $goExe) {
    foreach ($candidate in @(
        "$env:ProgramFiles\Go\bin\go.exe",
        "${env:ProgramFiles(x86)}\Go\bin\go.exe",
        "$env:LOCALAPPDATA\Programs\Go\bin\go.exe",
        'C:\Go\bin\go.exe'
    )) {
        if ($candidate -and (Test-Path $candidate)) { $goExe = $candidate; break }
    }
}

if (-not $goExe) {
    Write-BuildLog "RESULT: SKIPPED - go.exe not found on PATH or in the usual install paths."
    Write-BuildLog "        Keeping the existing worker.exe. Install Go, or add it to the PATH of the service account."
    exit 0
}

Write-BuildLog "Using Go at: $goExe"

if (-not (Test-Path $goWorkerDir)) {
    Write-BuildLog "RESULT: SKIPPED - go-worker directory not found at $goWorkerDir"
    exit 0
}

# Leftover staging binary from a previous interrupted run.
if (Test-Path $staging) {
    Remove-Item $staging -Force -ErrorAction SilentlyContinue
}

Push-Location $goWorkerDir
try {
    $buildOutput = & $goExe build -o $staging . 2>&1
    $buildExitCode = $LASTEXITCODE
} catch {
    $buildOutput = $_.Exception.Message
    $buildExitCode = 1
} finally {
    Pop-Location
}

if ($buildExitCode -ne 0) {
    Write-BuildLog "go build failed (exit $buildExitCode):"
    foreach ($line in @($buildOutput)) { Write-BuildLog "        $line" }
    Write-BuildLog "RESULT: FAILED - keeping the previous worker.exe so the service can still start."
    Remove-Item $staging -Force -ErrorAction SilentlyContinue
    exit 0
}

if (-not (Test-Path $staging)) {
    Write-BuildLog "RESULT: FAILED - go build reported success but produced no binary."
    exit 0
}

# Swap in the new binary. This runs as a Start/Pre hook (the old process is
# already stopped), but if the file is still locked, keep the old one rather
# than leaving the service with nothing to run.
try {
    Move-Item -Path $staging -Destination $target -Force -ErrorAction Stop
    $sizeMb = [math]::Round((Get-Item $target).Length / 1MB, 2)
    Write-BuildLog "RESULT: BUILT - worker.exe replaced ($sizeMb MB)."
} catch {
    Write-BuildLog "Could not replace worker.exe: $($_.Exception.Message)"
    Write-BuildLog "RESULT: FAILED - the file is probably still locked by a running worker. Previous binary kept."
    Remove-Item $staging -Force -ErrorAction SilentlyContinue
}

exit 0
