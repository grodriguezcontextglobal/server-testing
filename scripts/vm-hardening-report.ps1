<#
.SYNOPSIS
  Hardening report of this machine (FedRAMP CM-6, CM-7, SC-8, AC-7, AU-2).
  Read-only unless -RemoveExpiredCerts and -Apply are given together.

.DESCRIPTION
  Four sections:

    1. Certificates     every certificate in LocalMachine\My and \WebHosting,
                        whether it is expired and whether an IIS binding still
                        uses it. Expired and unused ones are dead weight
                        (POA&M IM-2026-007).
    2. Components       software that does not belong on a production server:
                        Memurai, Figma agent, WSL, Docker, Hyper-V adapters
                        (CM-7, POA&M APP-2026-009).
    3. Accounts         net accounts policy, local administrators, and the
                        Windows audit policy (AC-7, IA-5, AU-2).
    4. CIS L1           about twenty key settings of the CIS Windows Server
                        2019 Level 1 benchmark, each OK or REVIEW. This is NOT
                        the full benchmark: for that use CIS-CAT Lite or
                        Microsoft Policy Analyzer (POA&M APP-2026-008).

  Runs on both VMs. DEVITRACKAPP has no copy of the repository, so copy this
  single file over and run it: when it cannot find the repository it writes the
  report to the Desktop instead of logs\evidence.

  The report names accounts and IP addresses. Do not send it as it is.

.PARAMETER RemoveExpiredCerts
  With -Apply, deletes the certificates that are BOTH expired AND not used by
  any IIS binding. Each one is exported first (public part only) to the
  evidence folder, so the deletion can be undone and shown to an assessor.

.PARAMETER OutDir
  Where to write the report. Defaults to logs\evidence of the repository, or
  the Desktop when the script runs outside it.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\vm-hardening-report.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\vm-hardening-report.ps1 -RemoveExpiredCerts -Apply

.NOTES
  Run it elevated. Pure ASCII on purpose (Windows PowerShell 5.1 reads a file
  without BOM as ANSI, and a non-ASCII character breaks the parser).
#>

[CmdletBinding()]
param(
    [switch] $RemoveExpiredCerts,
    [switch] $Apply,
    [string] $OutDir = ''
)

$ErrorActionPreference = 'Stop'

if (-not $OutDir) {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    if ($repoRoot -and (Test-Path (Join-Path $repoRoot 'package.json'))) {
        $OutDir = Join-Path $repoRoot 'logs\evidence'
    } else {
        $OutDir = [Environment]::GetFolderPath('Desktop')
    }
}
New-Item -ItemType Directory -Force $OutDir | Out-Null
$reportPath = Join-Path $OutDir ("hardening-{0}-{1}.txt" -f $env:COMPUTERNAME, (Get-Date -Format 'yyyyMMdd-HHmm'))
Start-Transcript -Path $reportPath | Out-Null

$script:checks = @()

function Add-Check([string] $Id, [string] $Name, [object] $Pass, [string] $Found, [string] $Want) {
    $status = 'REVIEW'
    if ($Pass -eq $true) { $status = 'OK' }
    $script:checks += [pscustomobject]@{ Id = $Id; Name = $Name; Status = $status; Found = $Found; Want = $Want }
}

function Get-RegValue([string] $Path, [string] $Name) {
    try { return (Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop).$Name } catch { return $null }
}

function Show-Value($v) {
    if ($null -eq $v) { return '(not set)' }
    return "$v"
}

try {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw "run this script in an elevated (Administrator) PowerShell." }

    $now = Get-Date
    $os = Get-CimInstance Win32_OperatingSystem
    Write-Host "==> Machine" -ForegroundColor Cyan
    Write-Host ("    {0}  {1} (build {2})" -f $os.CSName, $os.Caption, $os.Version)
    Write-Host ("    last boot {0:yyyy-MM-dd HH:mm}  report {1:yyyy-MM-dd HH:mm}" -f $os.LastBootUpTime, $now)

    # ------------------------------------------------------------------ 1. Certificates
    Write-Host "==> 1. Certificates in LocalMachine\My and \WebHosting" -ForegroundColor Cyan

    $boundHashes = @()
    $iisAvailable = $false
    if (Get-Module -ListAvailable WebAdministration) {
        Import-Module WebAdministration
        $iisAvailable = $true
        foreach ($site in (Get-ChildItem IIS:\Sites)) {
            foreach ($b in ($site.Bindings.Collection | Where-Object { $_.protocol -eq 'https' })) {
                $h = "$($b.certificateHash)"
                if ($h) { $boundHashes += $h.ToUpper() }
            }
        }
    } else {
        Write-Host "    IIS is not installed on this machine" -ForegroundColor DarkGray
    }

    $certs = @()
    foreach ($store in @('My', 'WebHosting')) {
        $items = @(Get-ChildItem "Cert:\LocalMachine\$store" -ErrorAction SilentlyContinue)
        foreach ($c in $items) {
            $expired = $c.NotAfter -lt $now
            $inUse = $boundHashes -contains $c.Thumbprint.ToUpper()
            $certs += [pscustomobject]@{
                Store = $store; Thumbprint = $c.Thumbprint; Subject = $c.Subject
                NotAfter = $c.NotAfter; Expired = $expired; InUse = $inUse; Cert = $c
            }
        }
    }

    if (-not $certs.Count) {
        Write-Host "    no certificate in either store"
    }
    foreach ($c in ($certs | Sort-Object NotAfter)) {
        $state = 'OK'
        $color = 'Green'
        if ($c.Expired -and $c.InUse) { $state = 'EXPIRED AND IN USE'; $color = 'Red' }
        elseif ($c.Expired) { $state = 'EXPIRED, UNUSED'; $color = 'Yellow' }
        elseif (($c.NotAfter - $now).TotalDays -lt 30) { $state = 'EXPIRES SOON'; $color = 'Yellow' }
        Write-Host ("    [{0}] {1}  {2:yyyy-MM-dd}  {3}" -f $state, $c.Store, $c.NotAfter, $c.Subject) -ForegroundColor $color
        Write-Host ("        thumbprint {0}" -f $c.Thumbprint) -ForegroundColor DarkGray
    }

    $deletable = @($certs | Where-Object { $_.Expired -and -not $_.InUse })
    $expiredInUse = @($certs | Where-Object { $_.Expired -and $_.InUse })
    Write-Host ("    {0} certificate(s), {1} expired and unused, {2} expired and still bound" -f $certs.Count, $deletable.Count, $expiredInUse.Count)
    Add-Check 'CERT-01' 'No expired certificate bound in IIS' ($expiredInUse.Count -eq 0) "$($expiredInUse.Count) bound" '0'
    Add-Check 'CERT-02' 'No expired certificate left in the stores' ($deletable.Count -eq 0) "$($deletable.Count) unused" '0'

    if ($RemoveExpiredCerts) {
        if (-not $deletable.Count) {
            Write-Host "    nothing to delete" -ForegroundColor DarkGray
        } elseif (-not $Apply) {
            Write-Host "    Plan (nothing changed, add -Apply):" -ForegroundColor Yellow
            foreach ($c in $deletable) { Write-Host ("        delete {0}\{1}  {2}" -f $c.Store, $c.Thumbprint, $c.Subject) }
        } else {
            foreach ($c in $deletable) {
                $backup = Join-Path $OutDir ("cert-{0}-{1}.cer" -f $c.Store, $c.Thumbprint)
                Export-Certificate -Cert $c.Cert -FilePath $backup -Type CERT | Out-Null
                Remove-Item -Path ("Cert:\LocalMachine\{0}\{1}" -f $c.Store, $c.Thumbprint) -Force
                Write-Host ("    deleted {0}\{1} (exported to {2})" -f $c.Store, $c.Thumbprint, $backup) -ForegroundColor Green
            }
        }
    } elseif ($deletable.Count) {
        Write-Host "    Add -RemoveExpiredCerts to see the deletion plan." -ForegroundColor Yellow
    }

    # ------------------------------------------------------------------ 2. Components
    Write-Host "==> 2. Components that do not belong on a production server (CM-7)" -ForegroundColor Cyan

    $unwanted = @(
        @{ Name = 'Memurai (Redis for Windows)'; Service = 'Memurai*'; Hint = 'Uninstall from Programs and Features; the app uses Redis Cloud' },
        @{ Name = 'Figma agent'; Service = 'figma*'; Process = 'figma_agent'; Hint = 'Uninstall the Figma desktop app' },
        @{ Name = 'Docker'; Service = 'docker*'; Hint = 'Uninstall Docker Desktop or the engine' },
        @{ Name = 'WSL'; Service = 'LxssManager'; Hint = 'Disable the Windows Subsystem for Linux feature' },
        @{ Name = 'Hyper-V'; Service = 'vmms'; Hint = 'Only needed to host VMs; this machine is a guest' },
        @{ Name = 'Print spooler'; Service = 'Spooler'; Hint = 'CIS L1 asks to disable it on a server that does not print' }
    )
    $found = 0
    foreach ($u in $unwanted) {
        $svc = @(Get-Service -Name $u.Service -ErrorAction SilentlyContinue)
        $proc = @()
        if ($u.Process) { $proc = @(Get-Process -Name $u.Process -ErrorAction SilentlyContinue) }
        if ($svc.Count -or $proc.Count) {
            $found++
            $detail = ($svc | ForEach-Object { "$($_.Name)=$($_.Status)" }) -join ', '
            if ($proc.Count -and -not $detail) { $detail = "process running" }
            Write-Host ("    [PRESENT] {0}: {1}" -f $u.Name, $detail) -ForegroundColor Yellow
            Write-Host ("              {0}" -f $u.Hint) -ForegroundColor DarkGray
        } else {
            Write-Host ("    [absent]  {0}" -f $u.Name) -ForegroundColor DarkGray
        }
    }
    Add-Check 'CM7-01' 'No software outside the production role' ($found -eq 0) "$found present" '0'

    Write-Host "    Virtual network adapters (WSL, Docker and Hyper-V create these):"
    $virt = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'vEthernet|WSL|Docker' })
    if ($virt.Count) {
        foreach ($a in $virt) { Write-Host ("        [PRESENT] {0}  {1}" -f $a.Name, $a.Status) -ForegroundColor Yellow }
    } else {
        Write-Host "        none" -ForegroundColor DarkGray
    }
    Add-Check 'CM7-02' 'No virtual network adapter' ($virt.Count -eq 0) "$($virt.Count) adapter(s)" '0'

    # ------------------------------------------------------------------ 3. Accounts
    Write-Host "==> 3. Accounts, password policy and audit policy" -ForegroundColor Cyan
    $netAccounts = (net accounts) -join "`n"
    Write-Host $netAccounts

    $lockout = $null
    $minLen = $null
    foreach ($line in ($netAccounts -split "`n")) {
        if ($line -match 'threshold[^:]*:\s*(\S+)') { $lockout = $Matches[1] }
        if ($line -match 'Minimum password length[^:]*:\s*(\S+)') { $minLen = $Matches[1] }
    }
    $lockoutOk = ($lockout -and $lockout -ne 'Never' -and [int]($lockout -replace '\D', '0') -le 10 -and [int]($lockout -replace '\D', '0') -gt 0)
    Add-Check 'AC7-01' 'Account lockout threshold set (10 or fewer)' $lockoutOk (Show-Value $lockout) '1 to 10'
    $minLenOk = ($minLen -and [int]($minLen -replace '\D', '0') -ge 12)
    Add-Check 'IA5-01' 'Minimum password length 12 or more' $minLenOk (Show-Value $minLen) '12 or more'

    Write-Host "    Local administrators:"
    Get-LocalGroupMember -Group Administrators -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host ("        {0}  ({1})" -f $_.Name, $_.PrincipalSource) }

    Write-Host "    Local accounts and password age:"
    Get-LocalUser | Sort-Object Name | ForEach-Object {
        $age = '(never set)'
        if ($_.PasswordLastSet) { $age = "{0:yyyy-MM-dd} ({1} days)" -f $_.PasswordLastSet, [int]($now - $_.PasswordLastSet).TotalDays }
        Write-Host ("        {0,-20} enabled={1,-5} password {2}" -f $_.Name, $_.Enabled, $age)
    }
    $guest = Get-LocalUser -Name 'Guest' -ErrorAction SilentlyContinue
    Add-Check 'AC2-01' 'Guest account disabled' ($guest -and -not $guest.Enabled) $(if ($guest) { "enabled=$($guest.Enabled)" } else { 'not present' }) 'disabled'

    Write-Host "    Audit policy:"
    $audit = (auditpol /get /category:* | Out-String)
    Write-Host $audit
    $logonAudited = ($audit -match 'Logon\s+Success and Failure')
    Add-Check 'AU2-01' 'Logon events audited for success and failure' $logonAudited $(if ($logonAudited) { 'Success and Failure' } else { 'incomplete' }) 'Success and Failure'

    # ------------------------------------------------------------------ 4. CIS L1
    Write-Host "==> 4. CIS Windows Server 2019 Level 1: key settings" -ForegroundColor Cyan

    $lsa = 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa'
    $srv = 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters'
    $wks = 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters'
    $rdp = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp'
    $pol = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'

    $smb1 = Get-RegValue $srv 'SMB1'
    $smb1Feature = $null
    try { $smb1Feature = (Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -ErrorAction Stop).State } catch { }
    Add-Check 'CIS-01' 'SMBv1 disabled' (($smb1 -eq 0) -or ($smb1Feature -eq 'Disabled')) ("SMB1=" + (Show-Value $smb1) + " feature=" + (Show-Value $smb1Feature)) 'SMB1=0 or feature Disabled'

    $sign = Get-RegValue $srv 'RequireSecuritySignature'
    Add-Check 'CIS-02' 'SMB signing required (server)' ($sign -eq 1) (Show-Value $sign) '1'
    $signW = Get-RegValue $wks 'RequireSecuritySignature'
    Add-Check 'CIS-03' 'SMB signing required (client)' ($signW -eq 1) (Show-Value $signW) '1'

    $llmnr = Get-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient' 'EnableMulticast'
    Add-Check 'CIS-04' 'LLMNR disabled' ($llmnr -eq 0) (Show-Value $llmnr) '0'

    $lmc = Get-RegValue $lsa 'LmCompatibilityLevel'
    Add-Check 'CIS-05' 'NTLMv2 only, LM and NTLM refused' ($lmc -ge 5) (Show-Value $lmc) '5'

    $ra = Get-RegValue $lsa 'RestrictAnonymous'
    Add-Check 'CIS-06' 'Anonymous enumeration of shares blocked' ($ra -eq 1) (Show-Value $ra) '1'
    $ras = Get-RegValue $lsa 'RestrictAnonymousSAM'
    Add-Check 'CIS-07' 'Anonymous enumeration of SAM accounts blocked' ($ras -eq 1) (Show-Value $ras) '1'

    $ppl = Get-RegValue $lsa 'RunAsPPL'
    Add-Check 'CIS-08' 'LSA protection enabled' ($ppl -eq 1) (Show-Value $ppl) '1'

    $wdigest = Get-RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest' 'UseLogonCredential'
    Add-Check 'CIS-09' 'WDigest does not cache plaintext credentials' (($null -eq $wdigest) -or ($wdigest -eq 0)) (Show-Value $wdigest) '0 or not set'

    $cached = Get-RegValue 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' 'CachedLogonsCount'
    Add-Check 'CIS-10' 'Cached logons 4 or fewer' (($null -ne $cached) -and ([int]$cached -le 4)) (Show-Value $cached) '4 or fewer'

    $lua = Get-RegValue $pol 'EnableLUA'
    Add-Check 'CIS-11' 'UAC enabled' ($lua -eq 1) (Show-Value $lua) '1'
    $consent = Get-RegValue $pol 'ConsentPromptBehaviorAdmin'
    Add-Check 'CIS-12' 'UAC prompts administrators for consent' (($consent -eq 1) -or ($consent -eq 2)) (Show-Value $consent) '1 or 2'

    $aie = Get-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Installer' 'AlwaysInstallElevated'
    Add-Check 'CIS-13' 'Windows Installer does not always install elevated' (($null -eq $aie) -or ($aie -eq 0)) (Show-Value $aie) '0 or not set'

    $autorun = Get-RegValue 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer' 'NoDriveTypeAutoRun'
    Add-Check 'CIS-14' 'Autorun disabled on every drive' ($autorun -eq 255) (Show-Value $autorun) '255'

    $nla = Get-RegValue $rdp 'UserAuthentication'
    Add-Check 'CIS-15' 'RDP requires Network Level Authentication' ($nla -eq 1) (Show-Value $nla) '1'
    $enc = Get-RegValue $rdp 'MinEncryptionLevel'
    Add-Check 'CIS-16' 'RDP encryption level High' ($enc -ge 3) (Show-Value $enc) '3'

    $profiles = @(Get-NetFirewallProfile)
    $fwOn = @($profiles | Where-Object { -not $_.Enabled }).Count -eq 0
    Add-Check 'CIS-17' 'Windows firewall enabled on all profiles' $fwOn (($profiles | ForEach-Object { "$($_.Name)=$($_.Enabled)" }) -join ' ') 'all True'
    # NotConfigured is not a hole: Windows blocks inbound by default. CIS still
    # wants it set explicitly, so it is reported, with the difference spelled out.
    $fwBlock = @($profiles | Where-Object { $_.DefaultInboundAction -ne 'Block' }).Count -eq 0
    Add-Check 'CIS-18' 'Firewall blocks inbound by default' $fwBlock (($profiles | ForEach-Object { "$($_.Name)=$($_.DefaultInboundAction)" }) -join ' ') 'Block set explicitly; NotConfigured already blocks, but CIS asks for it to be set'

    $secLog = Get-WinEvent -ListLog Security
    $secMb = [math]::Round($secLog.MaximumSizeInBytes / 1MB)
    Add-Check 'CIS-19' 'Security log 192 MB or larger' ($secLog.MaximumSizeInBytes -ge 201326592) "$secMb MB, $($secLog.LogMode)" '192 MB or more'

    $sbl = Get-RegValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging' 'EnableScriptBlockLogging'
    Add-Check 'CIS-20' 'PowerShell script block logging enabled' ($sbl -eq 1) (Show-Value $sbl) '1'

    # ------------------------------------------------------------------ Summary
    Write-Host "==> Summary" -ForegroundColor Cyan
    foreach ($c in $script:checks) {
        $color = 'Green'
        if ($c.Status -ne 'OK') { $color = 'Yellow' }
        Write-Host ("    [{0,-6}] {1}  {2}" -f $c.Status, $c.Id, $c.Name) -ForegroundColor $color
        if ($c.Status -ne 'OK') { Write-Host ("             found: {0}   want: {1}" -f $c.Found, $c.Want) -ForegroundColor DarkGray }
    }
    $ok = @($script:checks | Where-Object { $_.Status -eq 'OK' }).Count
    $review = @($script:checks | Where-Object { $_.Status -ne 'OK' }).Count
    Write-Host ""
    Write-Host ("    {0} OK, {1} to review, out of {2}" -f $ok, $review, $script:checks.Count)
    Write-Host "    Every REVIEW line is a candidate entry for docs\POAM.md (APP-2026-008)."
    Write-Host "    This is a subset of CIS L1. The full benchmark needs CIS-CAT Lite or Microsoft Policy Analyzer."
    Write-Host ("    Report saved to {0}" -f $reportPath)
} finally {
    Stop-Transcript | Out-Null
}
