<#
.SYNOPSIS
  Backs up the configuration of this machine that is NOT in git, and verifies
  a backup can be restored (FedRAMP CP-9, CP-10, CM-2, CM-8).

.DESCRIPTION
  The data lives in PlanetScale (MySQL) and MongoDB Atlas, with their own
  backups (their restore test is in RUNBOOK_vm_fedramp_grupo_B.md, B3). The
  code is in git. What only exists on this VM, and what rebuilding it needs:

    iis\              IIS configuration (appcmd backup + applicationHost.config
                      + the sites' web.config)
    services\         nssm definition of each service (Devitrak*, UptimeKuma),
                      with values of secret-looking variables masked
    tasks\            scheduled tasks outside \Microsoft\
    firewall.csv      enabled inbound rules with their ports
    software.csv      installed software and versions (also CM-8 inventory)
    certificates.csv  certificates in LocalMachine\My (no private keys)
    env-keys.txt      NAMES of the variables in .env, and which of
                      .env.example are missing; never the values
    repo.txt          git commit and local changes of the repo
    releases.jsonl    the release registry (logs\releases.jsonl, CM-3)
    MANIFEST.txt      SHA-256 of every file above

  .env itself is NOT copied: it holds every credential. Keep it in a password
  manager or vault; env-keys.txt says what it must contain.

  Default target: C:\Backups\devitrak-config\<yyyyMMdd-HHmm>. A backup that
  only lives on the machine it protects is not a backup (CP-9): use -CopyTo
  with a share or disk outside the VM.

  -Verify <folder> is the restore test: checks every hash in MANIFEST.txt,
  that the XML files parse, that the IIS backup exists for appcmd restore, and
  that every service has a definition. It changes nothing.

.PARAMETER Destination
  Root folder for backups. Default C:\Backups\devitrak-config.

.PARAMETER CopyTo
  Also copy the backup there (UNC share or another disk), with robocopy.

.PARAMETER Keep
  Keep this many backups under -Destination and delete older ones (only
  folders named like yyyyMMdd-HHmm). Default 30. 0 keeps all.

.PARAMETER Verify
  Verify an existing backup folder instead of making one.

.NOTES
  Run it elevated. Pure ASCII on purpose (Windows PowerShell 5.1).
  Daily, as a scheduled task (as SYSTEM, at 03:30):
    schtasks /Create /TN "Devitrak\BackupConfig" /RU SYSTEM /SC DAILY /ST 03:30 /TR ^
      "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\CGAdmin\Documents\Github\server-testing\scripts\vm-backup-config.ps1 -CopyTo \\server\share\devitrak"
#>

[CmdletBinding()]
param(
    [string] $Destination = 'C:\Backups\devitrak-config',
    [string] $CopyTo = '',
    [int] $Keep = 30,
    [string] $Verify = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$servicePattern = '^(Devitrak|UptimeKuma)'
$secretPattern = 'SECRET|PASS|PWD|TOKEN|KEY|CNN|CONNECTION|CREDENTIAL|DSN'
$appcmd = Join-Path $env:windir 'System32\inetsrv\appcmd.exe'

function Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Run-Native([string]$exe, [string[]]$argv) {
    $ErrorActionPreference = 'Continue'
    $out = & $exe @argv 2>&1 | ForEach-Object { "$_" }
    return (($out -join "`r`n") -replace "`0", '')
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host "FAILED: run this script elevated." -ForegroundColor Red; exit 1 }

# ------------------------------------------------------------------ verify ---
if ($Verify) {
    Step "Verifying $Verify"
    $problems = @()
    $manifest = Join-Path $Verify 'MANIFEST.txt'
    if (-not (Test-Path $manifest)) { Write-Host "FAILED: no MANIFEST.txt" -ForegroundColor Red; exit 1 }
    $count = 0
    foreach ($line in (Get-Content $manifest)) {
        if ($line -notmatch '^([0-9A-F]{64})  (.+)$') { continue }
        $count++
        $file = Join-Path $Verify $Matches[2]
        if (-not (Test-Path $file)) { $problems += "missing: $($Matches[2])"; continue }
        if ((Get-FileHash $file -Algorithm SHA256).Hash -ne $Matches[1]) { $problems += "changed: $($Matches[2])" }
    }
    Write-Host "    $count files in the manifest"
    foreach ($xml in (Get-ChildItem $Verify -Recurse -Include *.xml, *.config)) {
        try { [xml](Get-Content $xml.FullName -Raw) | Out-Null } catch { $problems += "unreadable XML: $($xml.Name)" }
    }
    $iisName = (Get-Content (Join-Path $Verify 'iis\appcmd-backup-name.txt') -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($iisName) {
        $list = Run-Native $appcmd @('list', 'backup', $iisName)
        if ($list -match [regex]::Escape($iisName)) { Write-Host "    IIS backup '$iisName' present: restore with  appcmd restore backup `"$iisName`"" }
        else { Write-Host "    IIS backup '$iisName' not in inetsrv\backup on THIS machine: restore from iis\applicationHost.config" -ForegroundColor Yellow }
    } else { $problems += 'no IIS backup name' }
    $services = @(Get-ChildItem (Join-Path $Verify 'services') -Filter *.txt -ErrorAction SilentlyContinue)
    foreach ($s in $services) {
        if (-not (Select-String -Path $s.FullName -Pattern ' install ' -Quiet)) { $problems += "service definition without install line: $($s.Name)" }
    }
    Write-Host "    $($services.Count) service definitions"
    if ($problems.Count) {
        $problems | ForEach-Object { Write-Host "    PROBLEM: $_" -ForegroundColor Red }
        Write-Host "FAILED: the backup is not restorable as is." -ForegroundColor Red
        exit 1
    }
    Write-Host "OK: backup verified (hashes, XML, IIS backup, services)." -ForegroundColor Green
    exit 0
}

# ------------------------------------------------------------------ backup ---
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$out = Join-Path $Destination $stamp
New-Item -ItemType Directory -Force $out, (Join-Path $out 'iis'), (Join-Path $out 'services'), (Join-Path $out 'tasks') | Out-Null
Write-Host "Backup into $out"

Step "IIS"
if (Test-Path $appcmd) {
    $name = "devitrak-$stamp"
    Write-Host ("    " + (Run-Native $appcmd @('add', 'backup', $name)))
    Set-Content -Path (Join-Path $out 'iis\appcmd-backup-name.txt') -Value $name -Encoding ascii
    Copy-Item (Join-Path $env:windir 'System32\inetsrv\config\applicationHost.config') (Join-Path $out 'iis\applicationHost.config')
    Import-Module WebAdministration
    foreach ($site in (Get-ChildItem IIS:\Sites)) {
        $root = [Environment]::ExpandEnvironmentVariables($site.physicalPath)
        $wc = Join-Path $root 'web.config'
        if (Test-Path $wc) { Copy-Item $wc (Join-Path $out ("iis\web.config.{0}.config" -f ($site.Name -replace '[^\w.-]', '_'))) }
    }
} else { Write-Host "    IIS not installed" -ForegroundColor Yellow }

Step "Services (nssm)"
$services = @(Get-CimInstance Win32_Service | Where-Object { $_.Name -match $servicePattern })
foreach ($svc in $services) {
    $dump = Run-Native 'nssm' @('dump', $svc.Name)
    # AppEnvironmentExtra KEY=value pairs: keep the key, mask secret-looking values.
    $masked = ($dump -split "`r`n" | ForEach-Object {
        [regex]::Replace($_, "(?i)\b([A-Z0-9_]*($secretPattern)[A-Z0-9_]*)=([^\s`"]+)", '$1=***')
    }) -join "`r`n"
    $header = "# service $($svc.Name)  runs as: $($svc.StartName)  start: $($svc.StartMode)`r`n"
    Set-Content -Path (Join-Path $out "services\$($svc.Name).txt") -Value ($header + $masked) -Encoding ascii
    Write-Host "    $($svc.Name) ($($svc.StartName))"
}

Step "Scheduled tasks"
foreach ($t in (Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' })) {
    $file = Join-Path $out ("tasks\{0}{1}.xml" -f (($t.TaskPath.Trim('\') -replace '\\', '_') + $(if ($t.TaskPath.Trim('\')) { '_' } else { '' })), ($t.TaskName -replace '[^\w.-]', '_'))
    Export-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath | Set-Content -Path $file -Encoding unicode
    Write-Host "    $($t.TaskPath)$($t.TaskName)"
}

Step "Firewall, software, certificates"
Get-NetFirewallRule -Enabled True -Direction Inbound | ForEach-Object {
    $pf = $_ | Get-NetFirewallPortFilter
    $af = $_ | Get-NetFirewallAddressFilter
    [pscustomobject]@{ Name = $_.DisplayName; Action = $_.Action; Profile = $_.Profile; Protocol = $pf.Protocol; LocalPort = ($pf.LocalPort -join ' '); RemoteAddress = ($af.RemoteAddress -join ' ') }
} | Export-Csv -Path (Join-Path $out 'firewall.csv') -NoTypeInformation -Encoding UTF8
$uninstall = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
Get-ItemProperty $uninstall -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } |
    Select-Object DisplayName, DisplayVersion, Publisher, InstallDate | Sort-Object DisplayName -Unique |
    Export-Csv -Path (Join-Path $out 'software.csv') -NoTypeInformation -Encoding UTF8
Get-ChildItem Cert:\LocalMachine\My | Select-Object Subject, Issuer, Thumbprint, NotBefore, NotAfter, HasPrivateKey |
    Export-Csv -Path (Join-Path $out 'certificates.csv') -NoTypeInformation -Encoding UTF8

Step ".env (names only) and repo"
$envFile = Join-Path $repoRoot '.env'
$keysOf = { param($p) if (Test-Path $p) { Get-Content $p | Where-Object { $_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=' } | ForEach-Object { ($_ -split '=', 2)[0].Trim() } } }
$have = @(& $keysOf $envFile | Sort-Object -Unique)
$want = @(& $keysOf (Join-Path $repoRoot '.env.example') | Sort-Object -Unique)
$missing = @($want | Where-Object { $have -notcontains $_ })
@("# Variables defined in $envFile (names only, never values): $($have.Count)") + $have +
  @('', "# In .env.example but NOT in .env: $($missing.Count)") + $missing |
    Set-Content -Path (Join-Path $out 'env-keys.txt') -Encoding ascii
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
    $repoInfo = @("repo: $repoRoot",
        ("commit: " + (Run-Native 'git' @('-C', $repoRoot, 'rev-parse', 'HEAD'))),
        ("branch: " + (Run-Native 'git' @('-C', $repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD'))),
        'local changes:', (Run-Native 'git' @('-C', $repoRoot, 'status', '--short')))
    Set-Content -Path (Join-Path $out 'repo.txt') -Value $repoInfo -Encoding ascii
}
# Release registry (CM-3): logs\ is not in git, so this is its only copy off the box.
$releases = Join-Path $repoRoot 'logs\releases.jsonl'
if (Test-Path $releases) { Copy-Item $releases (Join-Path $out 'releases.jsonl') }

Step "Manifest"
$files = Get-ChildItem $out -Recurse -File | Where-Object { $_.Name -ne 'MANIFEST.txt' }
$lines = foreach ($f in $files) { "{0}  {1}" -f (Get-FileHash $f.FullName -Algorithm SHA256).Hash, $f.FullName.Substring($out.Length + 1) }
Set-Content -Path (Join-Path $out 'MANIFEST.txt') -Value $lines -Encoding ascii
Write-Host "    $(@($files).Count) files"

if ($CopyTo) {
    Step "Copy off the machine: $CopyTo"
    $target = Join-Path $CopyTo $stamp
    & robocopy $out $target /E /R:2 /W:5 /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { Write-Host "FAILED: robocopy exit $LASTEXITCODE" -ForegroundColor Red; exit 1 }
    Write-Host "    copied"
} else {
    Write-Host "WARNING: the backup is only on this machine. Use -CopyTo (CP-9)." -ForegroundColor Yellow
}

if ($Keep -gt 0) {
    $old = @(Get-ChildItem $Destination -Directory | Where-Object { $_.Name -match '^\d{8}-\d{4}$' } | Sort-Object Name -Descending | Select-Object -Skip $Keep)
    foreach ($d in $old) { Remove-Item -Recurse -Force $d.FullName; Write-Host "    removed old backup $($d.Name)" }
}

Write-Host "OK: $out  (verify with -Verify `"$out`")" -ForegroundColor Green
