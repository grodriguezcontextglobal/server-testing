<#
.SYNOPSIS
  Samples RAM and CPU of the whole machine and of each service, to size the
  migration target (Oracle, AWS or Azure) from measured data. READ-ONLY.

.DESCRIPTION
  Every -IntervalSec it appends one CSV row per group to -OutFile:

    MACHINE    the whole box: used and committed memory, total CPU
    service    each Windows service of interest (Devitrak*, UptimeKuma, MySQL,
               MongoDB, Redis, SQL Server...) with ALL its child processes:
               nssm -> pm2 -> four node.exe are summed under DevitrakServer
    process    everything else, grouped by process name (w3wp, Code, ...);
               the 10 largest by working set, the rest as (other)

  Columns: timestamp_utc, kind, group, processes, working_set_mb, private_mb,
  cpu_pct, total_mb, cores.
    working_set_mb  RAM the group holds right now (what a smaller VM must fit)
    private_mb      memory committed to the group (includes paged-out pages)
    cpu_pct         % of the WHOLE machine (all cores) since the previous sample
    total_mb        only on MACHINE rows: physical RAM installed
    cores           only on MACHINE rows: logical processors

  Nothing is stopped, started or changed. Each sample is appended as it is
  taken, so stopping the script with Ctrl+C loses nothing. Cost: one WMI query
  per sample, well under a second of CPU.

  Summarize with:  node scripts\summarize-ram.js logs\ram-*.csv logs\runtime-metrics.log

  Run it for at least a full week that includes an event day: sizing from a
  quiet Tuesday under-sizes the machine for the day that matters.

.PARAMETER IntervalSec
  Seconds between samples. Default 60.

.PARAMETER Hours
  How long to run. Default 168 (7 days). 0 = until stopped.

.PARAMETER OutFile
  CSV to append to. Default logs\ram-<yyyyMMdd-HHmm>.csv in the repo.

.NOTES
  Run it elevated: without admin, processes of the service account
  (DEVITRACKDB$) are listed but their parent links can be missing, and a
  service's children end up under "process" instead of under the service.

  In the background, for a week, from an elevated shell:
      Start-Process powershell -WindowStyle Hidden -ArgumentList `
        '-ExecutionPolicy Bypass -File C:\Users\CGAdmin\Documents\Github\server-testing\scripts\measure-ram.ps1'
  To stop it: Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
      Where-Object CommandLine -match 'measure-ram' | ForEach-Object { Stop-Process -Id $_.ProcessId }

  This file is deliberately pure ASCII (Windows PowerShell 5.1 reads .ps1 as
  ANSI without a BOM).
#>

[CmdletBinding()]
param(
    [int] $IntervalSec = 60,
    [double] $Hours = 168,
    [string] $OutFile = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutFile) {
    New-Item -ItemType Directory -Force (Join-Path $repoRoot 'logs') | Out-Null
    $OutFile = Join-Path $repoRoot ("logs\ram-{0}.csv" -f (Get-Date -Format 'yyyyMMdd-HHmm'))
}
if (-not (Test-Path $OutFile)) {
    'timestamp_utc,kind,group,processes,working_set_mb,private_mb,cpu_pct,total_mb,cores' |
        Set-Content -Path $OutFile -Encoding ascii
}

# Services whose whole process tree is reported as one group. Anything not
# installed is simply absent.
$servicePattern = '^(Devitrak|UptimeKuma|MySQL|MariaDB|MongoDB|Redis|Memurai|MSSQL|W3SVC|WAS$)'
$topProcesses = 10
$cores = [int]((Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors)

$prevCpu = @{}      # pid -> total CPU time in 100 ns units
$prevAt = $null

function Round1([double]$v) { return [math]::Round($v, 1) }

function Add-Row($rows, $at, $kind, $group, $procs, $prevCpu, $elapsed100ns) {
    $ws = 0.0; $priv = 0.0; $cpu = 0.0
    foreach ($p in $procs) {
        $ws += [double]$p.WorkingSetSize
        $priv += [double]$p.PrivatePageCount
        $now = [double]$p.KernelModeTime + [double]$p.UserModeTime
        $key = "$($p.ProcessId)|$($p.CreationDate)"
        if ($elapsed100ns -gt 0 -and $prevCpu.ContainsKey($key)) {
            $cpu += [math]::Max(0, $now - $prevCpu[$key])
        }
    }
    $cpuPct = ''
    if ($elapsed100ns -gt 0) { $cpuPct = Round1 (100.0 * $cpu / ($elapsed100ns * $cores)) }
    $rows.Add(('{0},{1},"{2}",{3},{4},{5},{6},,' -f $at, $kind, $group, @($procs).Count,
        (Round1 ($ws / 1MB)), (Round1 ($priv / 1MB)), $cpuPct)) | Out-Null
}

$deadline = if ($Hours -gt 0) { (Get-Date).AddHours($Hours) } else { [datetime]::MaxValue }
Write-Host "Sampling every ${IntervalSec}s into $OutFile until $deadline (Ctrl+C to stop)"

while ((Get-Date) -lt $deadline) {
    $started = Get-Date
    $at = $started.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $procs = @(Get-CimInstance Win32_Process |
        Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount,
                      KernelModeTime, UserModeTime, CreationDate)
    $services = @(Get-CimInstance Win32_Service |
        Where-Object { $_.Name -match $servicePattern -and $_.ProcessId -gt 0 })
    $os = Get-CimInstance Win32_OperatingSystem
    $cpuTotal = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime

    $elapsed = 0
    if ($prevAt) { $elapsed = ($started - $prevAt).TotalSeconds * 1e7 }

    $children = @{}
    foreach ($p in $procs) {
        if (-not $children.ContainsKey($p.ParentProcessId)) { $children[$p.ParentProcessId] = New-Object System.Collections.ArrayList }
        $children[$p.ParentProcessId].Add($p) | Out-Null
    }
    $byPid = @{}
    foreach ($p in $procs) { $byPid[$p.ProcessId] = $p }

    $rows = New-Object System.Collections.ArrayList
    $claimed = @{}

    $totalMb = [double]$os.TotalVisibleMemorySize / 1KB
    $freeMb = [double]$os.FreePhysicalMemory / 1KB
    $commitMb = ([double]$os.TotalVirtualMemorySize - [double]$os.FreeVirtualMemory) / 1KB
    $rows.Add(('{0},MACHINE,"MACHINE",{1},{2},{3},{4},{5},{6}' -f $at, $procs.Count,
        (Round1 ($totalMb - $freeMb)), (Round1 $commitMb), $cpuTotal, (Round1 $totalMb), $cores)) | Out-Null

    foreach ($svc in $services) {
        if (-not $byPid.ContainsKey($svc.ProcessId)) { continue }
        # Several services can share one svchost; count each process once.
        $tree = New-Object System.Collections.ArrayList
        $queue = New-Object System.Collections.Queue
        $queue.Enqueue($byPid[$svc.ProcessId])
        while ($queue.Count -gt 0) {
            $p = $queue.Dequeue()
            if ($claimed.ContainsKey($p.ProcessId)) { continue }
            $claimed[$p.ProcessId] = $true
            $tree.Add($p) | Out-Null
            if ($children.ContainsKey($p.ProcessId)) {
                foreach ($c in $children[$p.ProcessId]) { $queue.Enqueue($c) }
            }
        }
        if ($tree.Count -gt 0) { Add-Row $rows $at 'service' $svc.Name $tree $prevCpu $elapsed }
    }

    $rest = @($procs | Where-Object { -not $claimed.ContainsKey($_.ProcessId) -and $_.ProcessId -ne 0 })
    $groups = @($rest | Group-Object Name | ForEach-Object {
        [pscustomobject]@{ Name = $_.Name; Procs = $_.Group; Ws = ($_.Group | Measure-Object WorkingSetSize -Sum).Sum }
    } | Sort-Object Ws -Descending)
    $other = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $groups.Count; $i++) {
        if ($i -lt $topProcesses) { Add-Row $rows $at 'process' $groups[$i].Name $groups[$i].Procs $prevCpu $elapsed }
        else { foreach ($p in $groups[$i].Procs) { $other.Add($p) | Out-Null } }
    }
    if ($other.Count -gt 0) { Add-Row $rows $at 'process' '(other)' $other $prevCpu $elapsed }

    Add-Content -Path $OutFile -Value $rows -Encoding ascii

    $prevCpu = @{}
    foreach ($p in $procs) {
        $prevCpu["$($p.ProcessId)|$($p.CreationDate)"] = [double]$p.KernelModeTime + [double]$p.UserModeTime
    }
    $prevAt = $started

    $wait = $IntervalSec - ((Get-Date) - $started).TotalSeconds
    if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]($wait * 1000)) }
}

Write-Host "Done: $OutFile"
