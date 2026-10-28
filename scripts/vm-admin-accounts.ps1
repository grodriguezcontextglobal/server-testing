<#
.SYNOPSIS
  Local accounts of this machine (FedRAMP AC-2, AC-6, IA-2, IA-4). Read-only
  unless -NewAdmin or -DisableAccount is given.

.DESCRIPTION
  Reports:
    - every local account: enabled, last logon, password age, never-expires
    - who is in Administrators and Remote Desktop Users
    - SHARED accounts (CGAdmin, Administrator, admin...): FedRAMP needs every
      administrator to be a named person (IA-2), so actions in the logs can be
      tied to someone
    - enabled accounts without a logon in 90 days (AC-2(3))
    - what the Devitrak services run as, and scheduled tasks that run as a
      local account (what disabling that account would break)

  -NewAdmin <name> -FullName "<person>" creates a personal administrator: it
  asks for the password (never on the command line), the password expires,
  and the account goes into Administrators and Remote Desktop Users.

  -DisableAccount <name> disables a shared account once everyone has their
  own. It refuses when: it is the account running this script, a service or a
  scheduled task runs as it, or it would leave fewer than two other enabled
  administrators. Disabling keeps the profile and its files (the repo in
  C:\Users\CGAdmin\Documents stays where it is; the services run as
  LocalSystem and do not need the account). Undo: Enable-LocalUser <name>.

  Everything printed is saved to logs\evidence\admin-accounts-<date>.txt.

.NOTES
  Run it elevated. Pure ASCII on purpose (Windows PowerShell 5.1).
  If the machine is in a domain, the provider's domain accounts do not show
  here: ask IT Masters for that list too.
#>

[CmdletBinding()]
param(
    [string] $NewAdmin = '',
    [string] $FullName = '',
    [string] $DisableAccount = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$evidenceDir = Join-Path $repoRoot 'logs\evidence'
New-Item -ItemType Directory -Force $evidenceDir | Out-Null
Start-Transcript -Path (Join-Path $evidenceDir ("admin-accounts-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmm'))) | Out-Null

$sharedPattern = '^(CGAdmin|Administrator|Admin|Administrador|ITAdmin|support|soporte|user|devitrak)$'

# Group members by SID: the group names are localized (Administradores...).
function Get-GroupMembers([string]$sid) {
    $group = Get-LocalGroup -SID $sid -ErrorAction SilentlyContinue
    if (-not $group) { return @() }
    try {
        return @(Get-LocalGroupMember -Group $group -ErrorAction Stop)
    } catch {
        # Get-LocalGroupMember throws on orphaned SIDs (deleted domain accounts
        # still listed in the group). ADSI lists them anyway.
        $adsi = [ADSI]"WinNT://./$($group.Name),group"
        return @($adsi.psbase.Invoke('Members') | ForEach-Object {
            $path = $_.GetType().InvokeMember('ADsPath', 'GetProperty', $null, $_, $null)
            $class = $_.GetType().InvokeMember('Class', 'GetProperty', $null, $_, $null)
            $local = $path -match "WinNT://$($env:COMPUTERNAME)/"
            [pscustomobject]@{
                Name            = ($path -replace '^WinNT://', '' -replace '/', '\')
                ObjectClass     = $(if ($class -eq 'User') { 'User' } else { $class })
                PrincipalSource = $(if ($local) { 'Local' } else { 'Other' })
            }
        })
    }
}
function Get-EnabledAdmins {
    $machine = $env:COMPUTERNAME
    return @(Get-GroupMembers 'S-1-5-32-544' | Where-Object { $_.ObjectClass -eq 'User' -and $_.PrincipalSource -eq 'Local' } |
        ForEach-Object { Get-LocalUser -Name ($_.Name -replace "^$machine\\", '') -ErrorAction SilentlyContinue } |
        Where-Object { $_.Enabled })
}

try {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw "run this script in an elevated (Administrator) PowerShell." }

    $cs = Get-CimInstance Win32_ComputerSystem
    Write-Host "==> $($env:COMPUTERNAME)  domain-joined: $($cs.PartOfDomain)  ($($cs.Domain))" -ForegroundColor Cyan
    Write-Host "    running as: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"

    $admins = Get-GroupMembers 'S-1-5-32-544'
    $rdp = Get-GroupMembers 'S-1-5-32-555'
    Write-Host "==> Administrators" -ForegroundColor Cyan
    $admins | ForEach-Object { Write-Host "    $($_.Name)  ($($_.ObjectClass), $($_.PrincipalSource))" }
    Write-Host "==> Remote Desktop Users" -ForegroundColor Cyan
    if ($rdp.Count) { $rdp | ForEach-Object { Write-Host "    $($_.Name)" } } else { Write-Host "    (none: only Administrators can RDP)" }

    Write-Host "==> Local accounts" -ForegroundColor Cyan
    $now = Get-Date
    $adminNames = @($admins | ForEach-Object { ($_.Name -split '\\')[-1] })
    foreach ($u in (Get-LocalUser | Sort-Object Name)) {
        $flags = @()
        if ($adminNames -contains $u.Name) { $flags += 'ADMIN' }
        if ($u.SID.Value -match '-500$') { $flags += 'built-in Administrator (rename or disable)' }
        if ($u.Name -match $sharedPattern -and $u.Enabled) { $flags += 'SHARED (IA-2: needs a named person)' }
        if ($u.Enabled -and -not $u.PasswordExpires -and $u.PasswordRequired) { $flags += 'password never expires' }
        if ($u.Enabled -and -not $u.PasswordRequired) { $flags += 'NO PASSWORD REQUIRED' }
        if ($u.Enabled -and (-not $u.LastLogon -or ($now - $u.LastLogon).TotalDays -gt 90)) { $flags += 'no logon in 90 days (AC-2(3))' }
        $pwAge = if ($u.PasswordLastSet) { [int]($now - $u.PasswordLastSet).TotalDays } else { '-' }
        $last = if ($u.LastLogon) { $u.LastLogon.ToString('yyyy-MM-dd') } else { 'never' }
        $color = if (-not $u.Enabled) { 'DarkGray' } elseif ($flags -match 'SHARED|NO PASSWORD|90 days') { 'Yellow' } else { 'Gray' }
        Write-Host ("    {0,-18} {1,-8} last logon {2,-10} password {3,4} days  {4}" -f $u.Name, $(if ($u.Enabled) { 'enabled' } else { 'disabled' }), $last, $pwAge, ($flags -join '; ')) -ForegroundColor $color
    }

    Write-Host "==> What runs as which account" -ForegroundColor Cyan
    $services = @(Get-CimInstance Win32_Service | Where-Object { $_.Name -match '^(Devitrak|UptimeKuma)' })
    $services | ForEach-Object { Write-Host "    service $($_.Name): $($_.StartName)" }
    $tasks = @(Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' })
    $tasks | ForEach-Object { Write-Host "    task $($_.TaskPath)$($_.TaskName): $($_.Principal.UserId)" }

    if ($NewAdmin) {
        Write-Host "==> Creating personal administrator $NewAdmin" -ForegroundColor Cyan
        if (-not $FullName) { throw "-FullName is required: the account must name a person (IA-2)." }
        if ($NewAdmin -match $sharedPattern) { throw "'$NewAdmin' looks like a shared name. Use the person's name (e.g. jperez)." }
        if (Get-LocalUser -Name $NewAdmin -ErrorAction SilentlyContinue) { throw "account $NewAdmin already exists." }
        $pw1 = Read-Host "Password for $NewAdmin (min 15 characters)" -AsSecureString
        $pw2 = Read-Host "Repeat it" -AsSecureString
        $plain = { param($s) [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }
        if ((& $plain $pw1) -ne (& $plain $pw2)) { throw "the passwords do not match." }
        if ((& $plain $pw1).Length -lt 15) { throw "at least 15 characters." }
        New-LocalUser -Name $NewAdmin -FullName $FullName -Password $pw1 -Description "Personal admin - $FullName - created $(Get-Date -Format 'yyyy-MM-dd')" -PasswordNeverExpires:$false | Out-Null
        Add-LocalGroupMember -SID 'S-1-5-32-544' -Member $NewAdmin
        Add-LocalGroupMember -SID 'S-1-5-32-555' -Member $NewAdmin
        Write-Host "    created and added to Administrators and Remote Desktop Users. Log in with it once before disabling any shared account." -ForegroundColor Green
    }

    if ($DisableAccount) {
        Write-Host "==> Disabling $DisableAccount" -ForegroundColor Cyan
        $user = Get-LocalUser -Name $DisableAccount -ErrorAction SilentlyContinue
        if (-not $user) { throw "no local account $DisableAccount." }
        if (-not $user.Enabled) { Write-Host "    already disabled"; return }
        $me = ([Security.Principal.WindowsIdentity]::GetCurrent().Name -split '\\')[-1]
        if ($me -eq $DisableAccount) { throw "you are logged in as $DisableAccount. Log in with your personal account first." }
        $usedBy = @($services | Where-Object { ($_.StartName -split '\\')[-1] -eq $DisableAccount } | ForEach-Object { "service $($_.Name)" }) +
                  @($tasks | Where-Object { ($_.Principal.UserId -split '\\')[-1] -eq $DisableAccount } | ForEach-Object { "task $($_.TaskName)" })
        if ($usedBy.Count) { throw "$DisableAccount is used by: $($usedBy -join ', '). Move them to another account first." }
        $others = @(Get-EnabledAdmins | Where-Object { $_.Name -ne $DisableAccount })
        if ($others.Count -lt 2) { throw "only $($others.Count) other enabled administrator(s). Create personal admins first (at least two, so one person's absence does not lock you out)." }
        Disable-LocalUser -Name $DisableAccount
        Write-Host "    disabled. Profile and files kept. Undo: Enable-LocalUser $DisableAccount" -ForegroundColor Green
    }
} finally {
    Stop-Transcript | Out-Null
}
