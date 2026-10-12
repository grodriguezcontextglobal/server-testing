<#
.SYNOPSIS
  Create (or re-create) the dedicated task-queue worker services: Bulk, Delete
  and Heavy. Idempotent: safe to run again on a box where they already exist.

.DESCRIPTION
  Each worker is the same `node queue\standalone.js`; what makes them different
  is the env, which picks the job GROUP from constants/queueTypeGroups.js:

    DevitrakBulkWorker    QUEUE_GROUP=bulk    QUEUE_POLL_MS=300
    DevitrakDeleteWorker  QUEUE_GROUP=delete  QUEUE_POLL_MS=300
    DevitrakHeavyWorker   QUEUE_GROUP=heavy   (default poll)

  Why three and not one:
  - bulk and delete back endpoints that WAIT up to 4s for the job
    (waitForJobOutcome in helpers/queuedController.js) to keep a synchronous
    response. They need the fast poll, and they must not sit behind each other.
  - heavy (exports, spreadsheet imports, alphanumeric ranges) answers
    202 + jobId and nobody waits for it, but one job can run for minutes. The
    worker drains jobs one at a time, so sharing a service with bulk made every
    waiting bulk call fall back to 202 while an export ran.

  DevitrakServer is NOT touched. It must already run with
  QUEUE_EXCLUDE_GROUPS=dedicated so it leaves these groups alone; the script
  only checks that and warns. Editing its AppEnvironmentExtra replaces the whole
  block, which is how GO_WORKER_PORT got wiped on 2026-09-22 - do that by hand,
  starting from `nssm get`.

  The env set here OWNS the whole AppEnvironmentExtra of each worker. Shared
  config (Mongo, AWS for inventory:export, HEARTBEAT_URL_QUEUE_*) comes from the
  repo .env, which standalone.js loads with dotenv.

  Requires an elevated (Administrator) shell, because nssm does.

.PARAMETER Only
  Limit the run to some of the workers, e.g. -Only DevitrakHeavyWorker.

.NOTES
  Usage, in an elevated shell:
      powershell -ExecutionPolicy Bypass -File scripts\install-queue-workers.ps1
      powershell -ExecutionPolicy Bypass -File scripts\install-queue-workers.ps1 -Only DevitrakHeavyWorker

  Remove one: nssm stop <name>; nssm remove <name> confirm
  Its jobs are not lost while it is gone: they stay `pending` until a worker
  that serves the group starts again.

  This file must stay pure ASCII: Windows PowerShell 5.1 reads .ps1 files as
  ANSI without a BOM, and mangled non-ASCII punctuation breaks the parser.
#>

[CmdletBinding()]
param(
    [string[]] $Only
)

$ErrorActionPreference = 'Stop'

$repoRoot  = Split-Path -Parent $PSScriptRoot
$logsDir   = Join-Path $repoRoot 'logs'
$appLog    = Join-Path $logsDir 'combined.log'

# Heavy goes FIRST on purpose: today DevitrakBulkWorker still serves bulk,heavy,
# and reconfiguring it drops heavy. Starting the Heavy consumer before that leaves
# no window where heavy jobs have nobody to claim them (DEPLOY.md: "arranca el
# consumidor nuevo antes"). While both serve heavy they just compete - the claim
# is atomic.
$workers = @(
    @{ Name = 'DevitrakHeavyWorker';  Group = 'heavy';  Env = 'QUEUE_GROUP=heavy NODE_ENV=production';
       Display = 'Devitrak Heavy Worker';  Desc = 'Task-queue worker for long async jobs: exports, spreadsheet imports (queue/standalone.js, group heavy).' },
    @{ Name = 'DevitrakBulkWorker';   Group = 'bulk';   Env = 'QUEUE_GROUP=bulk QUEUE_POLL_MS=300 NODE_ENV=production';
       Display = 'Devitrak Bulk Worker';   Desc = 'Fast-poll task-queue worker for bulk-write jobs (queue/standalone.js, group bulk).' },
    @{ Name = 'DevitrakDeleteWorker'; Group = 'delete'; Env = 'QUEUE_GROUP=delete QUEUE_POLL_MS=300 NODE_ENV=production';
       Display = 'Devitrak Delete Worker'; Desc = 'Fast-poll task-queue worker for bulk delete jobs (queue/standalone.js, group delete).' }
)

if ($Only) {
    $workers = @($workers | Where-Object { $Only -contains $_.Name })
    if ($workers.Count -eq 0) { throw "-Only matched no worker. Valid: DevitrakBulkWorker, DevitrakDeleteWorker, DevitrakHeavyWorker" }
}

function Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

function Get-NssmStatus([string]$Name) { ((& nssm status $Name) -join '') -replace "`0", '' }

# ---------------------------------------------------------------- preflight ---

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "run this in an elevated (Administrator) PowerShell." }

# The services run as LocalSystem, whose PATH is not the admin's: use an absolute path.
$node = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $node = $cmd.Source }
if (-not $node -and (Test-Path 'C:\Program Files\nodejs\node.exe')) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not $node) { throw "node.exe not found (looked on PATH and in C:\Program Files\nodejs)." }
Write-Host "    node: $node"

if (-not (Test-Path (Join-Path $repoRoot 'queue\standalone.js'))) {
    throw "queue\standalone.js not found under $repoRoot"
}
New-Item -ItemType Directory -Force $logsDir | Out-Null

# --------------------------------------------------------- install / config ---

foreach ($w in $workers) {
    $name = $w.Name
    Step "$name (group $($w.Group))"

    $status = Get-NssmStatus $name
    if ($status -match 'does not exist|Can.t open service') {
        & nssm install $name $node | Out-Null
        Write-Host "    installed"
    } else {
        # Printed so the previous value is never lost: the set below replaces it whole.
        $prevEnv = ((& nssm get $name AppEnvironmentExtra) -join ' ') -replace "`0", ''
        Write-Host "    already installed, re-applying config (previous env: $prevEnv)"
        if ($status -notmatch 'SERVICE_STOPPED') { & nssm stop $name | Out-Null }
    }

    & nssm set $name AppParameters 'queue\standalone.js' | Out-Null
    & nssm set $name AppDirectory $repoRoot | Out-Null
    & nssm set $name DisplayName $w.Display | Out-Null
    & nssm set $name Description $w.Desc | Out-Null
    & nssm set $name Start SERVICE_AUTO_START | Out-Null
    # One argument per variable: nssm stores each as its own line.
    $envArgs = $w.Env -split ' '
    & nssm set $name AppEnvironmentExtra @envArgs | Out-Null
    & nssm set $name AppStdout (Join-Path $logsDir "$($w.Group)-worker-out.log") | Out-Null
    & nssm set $name AppStderr (Join-Path $logsDir "$($w.Group)-worker-err.log") | Out-Null
    & nssm set $name AppExit Default Restart | Out-Null
    & nssm set $name AppRestartDelay 3000 | Out-Null

    & nssm start $name | Out-Null
    Write-Host "    env: $($w.Env)"
}

# ------------------------------------------------------------------- verify ---

# SERVICE_START_PENDING right after start is normal on this box: poll.
Step "Waiting for the workers to run"
$deadline = (Get-Date).AddSeconds(30)
do {
    $pending = @($workers | Where-Object { (Get-NssmStatus $_.Name) -notmatch 'SERVICE_RUNNING' })
    if ($pending.Count -gt 0) { Start-Sleep -Seconds 2 }
} while ($pending.Count -gt 0 -and (Get-Date) -lt $deadline)

$failed = $false
foreach ($w in $workers) {
    $st = Get-NssmStatus $w.Name
    if ($st -match 'SERVICE_RUNNING') {
        Write-Host "    $($w.Name)=$st" -ForegroundColor Green
    } else {
        Write-Host "    $($w.Name)=$st  -> read logs\$($w.Group)-worker-err.log" -ForegroundColor Red
        $failed = $true
    }
}

# Each worker logs the scope it resolved; in production the logger writes to
# logs\combined.log, not to stdout.
if (Test-Path $appLog) {
    Step "Scopes logged by the workers (last lines of logs\combined.log)"
    Select-String -Path $appLog -Pattern 'Task queue worker starting' |
        Select-Object -Last ($workers.Count + 1) |
        ForEach-Object { Write-Host "    $($_.Line.Trim())" }
}

Step "Checking DevitrakServer leaves these groups alone"
$serverEnv = ((& nssm get DevitrakServer AppEnvironmentExtra) -join ' ') -replace "`0", ''
if ($serverEnv -match 'QUEUE_EXCLUDE_GROUPS=\S*dedicated') {
    Write-Host "    OK: QUEUE_EXCLUDE_GROUPS=dedicated" -ForegroundColor Green
} else {
    Write-Host "    WARNING: DevitrakServer does not have QUEUE_EXCLUDE_GROUPS=dedicated." -ForegroundColor Yellow
    Write-Host "    It will compete for bulk/delete/heavy jobs inside the API processes (no double" -ForegroundColor Yellow
    Write-Host "    processing - the claim is atomic - but no isolation either). Fix it by hand:" -ForegroundColor Yellow
    Write-Host "    nssm get DevitrakServer AppEnvironmentExtra, then set the SAME list with that change." -ForegroundColor Yellow
    Write-Host "    Current: $serverEnv" -ForegroundColor Yellow
}

if ($failed) { exit 1 }
Write-Host "==> Done." -ForegroundColor Green
