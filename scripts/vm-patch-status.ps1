<#
.SYNOPSIS
  Windows patch status of this machine (FedRAMP SI-2, RA-5). Read-only unless
  -Install is given.

.DESCRIPTION
  Reports:
    - OS build and revision (UBR), and the last installed updates
    - days since the last update: SI-2 expects high/critical fixes within 30
      days, so more than 30 is flagged
    - whether a reboot is pending (an installed patch that is not active yet)
    - where updates come from (WSUS or Microsoft Update)
    - updates that are available and not installed, with their severity
      (this search goes online and can take a few minutes)

  With -Install, downloads and installs the updates found (only Security and
  Critical with -SecurityOnly). It NEVER reboots: it says whether a reboot is
  needed and leaves it to you, inside a maintenance window. The services keep
  running until that reboot, and nssm starts them again after it (check with
  `nssm status DevitrakServer` and the /health URL).

  Everything printed is also saved to logs\evidence\patch-status-<date>.txt
  in the repo: that file is the evidence for the monthly SI-2 review.

.PARAMETER Install
  Install the available updates (no reboot).

.PARAMETER SecurityOnly
  With -Install: only updates classified Security Updates or Critical Updates.

.PARAMETER SkipSearch
  Do not search online for available updates (fast, offline report).

.NOTES
  Run it elevated. Pure ASCII on purpose (Windows PowerShell 5.1).
#>

[CmdletBinding()]
param(
    [switch] $Install,
    [switch] $SecurityOnly,
    [switch] $SkipSearch
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$evidenceDir = Join-Path $repoRoot 'logs\evidence'
New-Item -ItemType Directory -Force $evidenceDir | Out-Null
Start-Transcript -Path (Join-Path $evidenceDir ("patch-status-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmm'))) | Out-Null

try {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw "run this script in an elevated (Administrator) PowerShell." }

    Write-Host "==> System" -ForegroundColor Cyan
    $os = Get-CimInstance Win32_OperatingSystem
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    Write-Host ("    {0}  build {1}.{2}  ({3})" -f $os.Caption, $cv.CurrentBuildNumber, $cv.UBR, $env:COMPUTERNAME)
    Write-Host ("    last boot: {0}" -f $os.LastBootUpTime)

    Write-Host "==> Last installed updates" -ForegroundColor Cyan
    $hotfixes = @(Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending)
    $hotfixes | Select-Object -First 10 | ForEach-Object {
        Write-Host ("    {0:yyyy-MM-dd}  {1,-10} {2}" -f $_.InstalledOn, $_.HotFixID, $_.Description)
    }
    if ($hotfixes.Count -gt 0) {
        $days = [int]((Get-Date) - $hotfixes[0].InstalledOn).TotalDays
        $color = if ($days -gt 30) { 'Red' } else { 'Green' }
        Write-Host "    days since the last update: $days (SI-2: at most 30 for high/critical)" -ForegroundColor $color
    } else {
        Write-Host "    no update with an install date found" -ForegroundColor Red
    }

    Write-Host "==> Pending reboot" -ForegroundColor Cyan
    $reasons = @()
    if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') { $reasons += 'component servicing' }
    if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') { $reasons += 'Windows Update' }
    $pfro = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue).PendingFileRenameOperations
    if ($pfro) { $reasons += 'pending file renames' }
    if ($reasons.Count) { Write-Host "    YES: $($reasons -join ', '). Installed patches are not active until the reboot." -ForegroundColor Yellow }
    else { Write-Host "    no" -ForegroundColor Green }

    Write-Host "==> Update source" -ForegroundColor Cyan
    $wu = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate' -ErrorAction SilentlyContinue
    if ($wu -and $wu.WUServer) { Write-Host "    WSUS: $($wu.WUServer)  (the provider decides what gets approved)" }
    else { Write-Host "    Microsoft Update directly (no WSUS policy)" }
    $au = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' -ErrorAction SilentlyContinue
    if ($au -and $null -ne $au.AUOptions) { Write-Host "    automatic updates policy AUOptions=$($au.AUOptions) (2 notify, 3 download, 4 install on schedule)" }

    if ($SkipSearch) { return }

    Write-Host "==> Available updates (online search, may take minutes)" -ForegroundColor Cyan
    $session = New-Object -ComObject Microsoft.Update.Session
    $searcher = $session.CreateUpdateSearcher()
    $result = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
    $updates = @()
    foreach ($u in $result.Updates) {
        $cats = @($u.Categories | ForEach-Object { $_.Name })
        $updates += [pscustomobject]@{
            Update   = $u
            Title    = $u.Title
            Severity = if ($u.MsrcSeverity) { $u.MsrcSeverity } else { '-' }
            Security = [bool]($cats -match '^(Security Updates|Critical Updates)$')
            Released = $u.LastDeploymentChangeTime
        }
    }
    if (-not $updates.Count) {
        Write-Host "    none: the machine is up to date with its update source" -ForegroundColor Green
        return
    }
    foreach ($u in ($updates | Sort-Object Released)) {
        $age = [int]((Get-Date) - $u.Released).TotalDays
        $color = if ($u.Security -and $age -gt 30) { 'Red' } elseif ($u.Security) { 'Yellow' } else { 'Gray' }
        Write-Host ("    {0,-9} {1,4}d  {2}" -f $u.Severity, $age, $u.Title) -ForegroundColor $color
    }
    Write-Host ("    {0} available, {1} security/critical" -f $updates.Count, @($updates | Where-Object Security).Count)

    if (-not $Install) {
        Write-Host "    Nothing installed (report only). To install: -Install [-SecurityOnly], in a maintenance window."
        return
    }

    $toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
    foreach ($u in $updates) {
        if ($SecurityOnly -and -not $u.Security) { continue }
        if (-not $u.Update.EulaAccepted) { $u.Update.AcceptEula() }
        $toInstall.Add($u.Update) | Out-Null
    }
    if ($toInstall.Count -eq 0) { Write-Host "    nothing to install with the filters given"; return }

    Write-Host "==> Downloading $($toInstall.Count) updates" -ForegroundColor Cyan
    $downloader = $session.CreateUpdateDownloader()
    $downloader.Updates = $toInstall
    $null = $downloader.Download()

    Write-Host "==> Installing (no reboot)" -ForegroundColor Cyan
    $installer = $session.CreateUpdateInstaller()
    $installer.Updates = $toInstall
    $res = $installer.Install()
    $codes = @{ 0 = 'not started'; 1 = 'in progress'; 2 = 'succeeded'; 3 = 'succeeded with errors'; 4 = 'failed'; 5 = 'aborted' }
    for ($i = 0; $i -lt $toInstall.Count; $i++) {
        $r = $res.GetUpdateResult($i)
        Write-Host ("    {0,-22} {1}" -f $codes[[int]$r.ResultCode], $toInstall.Item($i).Title)
    }
    Write-Host "    overall: $($codes[[int]$res.ResultCode])"
    if ($res.RebootRequired) {
        Write-Host "    REBOOT REQUIRED to activate them. Not done by this script: schedule it." -ForegroundColor Yellow
    }
} finally {
    Stop-Transcript | Out-Null
}
