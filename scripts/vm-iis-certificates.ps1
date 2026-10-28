<#
.SYNOPSIS
  TLS certificates of the IIS HTTPS bindings (FedRAMP SC-8, SC-12, SC-17).
  Read-only unless -Thumbprint and -Apply are given.

.DESCRIPTION
  Reports, for every https binding in IIS:
    site, host name, port, certificate subject, issuer, expiry, days left
    and EXPIRED / EXPIRES SOON (under 30 days) / OK
  and the certificates in LocalMachine\My that have a private key, as
  candidates to bind.

  To replace an expired certificate: import the new one first (with its
  private key) into LocalMachine\My, then
      .\vm-iis-certificates.ps1 -Thumbprint <new> -HostName db.devitrak.net
  shows what would change, and adding -Apply changes it. Only bindings whose
  host name the new certificate covers are touched, and the new certificate
  must be valid today and have its private key. IIS picks the change up
  without a restart; the old certificate is left in the store.

  How to get the certificate is in RUNBOOK_vm_fedramp_grupo_B.md (B2).

  Everything printed is saved to logs\evidence\iis-certificates-<date>.txt.

.NOTES
  Run it elevated. Pure ASCII on purpose (Windows PowerShell 5.1).
#>

[CmdletBinding()]
param(
    [string] $Thumbprint = '',
    [string] $HostName = '',
    [switch] $Apply
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$evidenceDir = Join-Path $repoRoot 'logs\evidence'
New-Item -ItemType Directory -Force $evidenceDir | Out-Null
Start-Transcript -Path (Join-Path $evidenceDir ("iis-certificates-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmm'))) | Out-Null

function Get-DnsNames($cert) {
    $names = @()
    foreach ($n in $cert.DnsNameList) { $names += "$($n.Unicode)".ToLower() }
    if (-not $names.Count -and $cert.Subject -match 'CN=([^,]+)') { $names += $Matches[1].Trim().ToLower() }
    return $names
}
function Test-Covers($cert, [string]$name) {
    if (-not $name) { return $false }
    $name = $name.ToLower()
    foreach ($n in (Get-DnsNames $cert)) {
        if ($n -eq $name) { return $true }
        if ($n.StartsWith('*.') -and $name.EndsWith($n.Substring(1)) -and
            ($name.Split('.').Count -eq $n.Split('.').Count)) { return $true }
    }
    return $false
}

try {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw "run this script in an elevated (Administrator) PowerShell." }
    Import-Module WebAdministration

    $now = Get-Date
    Write-Host "==> HTTPS bindings in IIS" -ForegroundColor Cyan
    $rows = @()
    foreach ($site in (Get-ChildItem IIS:\Sites)) {
        foreach ($b in ($site.Bindings.Collection | Where-Object { $_.protocol -eq 'https' })) {
            $parts = $b.bindingInformation.Split(':')
            $hostHeader = if ($parts.Count -ge 3) { $parts[2] } else { '' }
            $hash = "$($b.certificateHash)"
            $store = if ($b.certificateStoreName) { $b.certificateStoreName } else { 'My' }
            $cert = $null
            if ($hash) { $cert = Get-Item -Path "Cert:\LocalMachine\$store\$hash" -ErrorAction SilentlyContinue }
            $state = 'NO CERTIFICATE'
            $days = $null
            if ($cert) {
                $days = [int]($cert.NotAfter - $now).TotalDays
                $state = if ($cert.NotAfter -lt $now) { 'EXPIRED' } elseif ($days -lt 30) { 'EXPIRES SOON' } else { 'OK' }
            }
            $rows += [pscustomobject]@{ Site = $site.Name; Host = $hostHeader; Port = $parts[1]; Binding = $b; Cert = $cert; State = $state; Days = $days }
            $color = @{ 'OK' = 'Green'; 'EXPIRES SOON' = 'Yellow' }[$state]
            if (-not $color) { $color = 'Red' }
            Write-Host ("    [{0}] {1}  {2}:{3}" -f $state, $site.Name, $(if ($hostHeader) { $hostHeader } else { '*' }), $parts[1]) -ForegroundColor $color
            if ($cert) {
                Write-Host ("        {0}  issuer {1}" -f $cert.Subject, $cert.Issuer)
                Write-Host ("        expires {0:yyyy-MM-dd} ({1} days)  thumbprint {2}  SNI={3}" -f $cert.NotAfter, $days, $cert.Thumbprint, $b.sslFlags)
            }
        }
    }
    if (-not $rows.Count) { Write-Host "    no https binding found" -ForegroundColor Yellow }

    Write-Host "==> Candidates in LocalMachine\My (with private key)" -ForegroundColor Cyan
    $candidates = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.HasPrivateKey } | Sort-Object NotAfter -Descending)
    foreach ($c in $candidates) {
        $valid = ($c.NotBefore -le $now -and $c.NotAfter -gt $now)
        Write-Host ("    {0}  {1:yyyy-MM-dd}  {2}  [{3}]" -f $c.Thumbprint, $c.NotAfter, ((Get-DnsNames $c) -join ','), $(if ($valid) { 'valid' } else { 'not valid now' })) -ForegroundColor $(if ($valid) { 'Gray' } else { 'DarkGray' })
    }

    if (-not $Thumbprint) {
        if ($rows | Where-Object { $_.State -ne 'OK' }) {
            Write-Host "    To replace one: import the new certificate, then run with -Thumbprint <new> [-HostName <host>] and, after checking, -Apply." -ForegroundColor Yellow
        }
        return
    }

    $Thumbprint = ($Thumbprint -replace '[^0-9A-Fa-f]', '').ToUpper()
    $new = Get-Item -Path "Cert:\LocalMachine\My\$Thumbprint" -ErrorAction SilentlyContinue
    if (-not $new) { throw "certificate $Thumbprint is not in LocalMachine\My. Import it first (with its private key)." }
    if (-not $new.HasPrivateKey) { throw "certificate $Thumbprint has no private key: IIS cannot use it." }
    if ($new.NotBefore -gt $now -or $new.NotAfter -le $now) { throw "certificate $Thumbprint is not valid today ($($new.NotBefore) - $($new.NotAfter))." }

    Write-Host "==> Plan: bind $Thumbprint (expires $($new.NotAfter.ToString('yyyy-MM-dd')), $((Get-DnsNames $new) -join ','))" -ForegroundColor Cyan
    $targets = @($rows | Where-Object {
        (-not $HostName -or $_.Host -eq $HostName) -and (-not $_.Cert -or $_.Cert.Thumbprint -ne $Thumbprint)
    })
    $plan = @()
    foreach ($t in $targets) {
        $name = if ($t.Host) { $t.Host } else { $HostName }
        if (-not (Test-Covers $new $name)) {
            Write-Host "    skip $($t.Site) $($t.Host):$($t.Port): the new certificate does not cover '$name'" -ForegroundColor Yellow
            continue
        }
        Write-Host "    $($t.Site) $($t.Host):$($t.Port)  $(if ($t.Cert) { $t.Cert.Thumbprint } else { '(none)' }) -> $Thumbprint"
        $plan += $t
    }
    if (-not $plan.Count) { Write-Host "    nothing to change"; return }
    if (-not $Apply) { Write-Host "    Nothing changed. Add -Apply to bind." -ForegroundColor Yellow; return }

    foreach ($t in $plan) {
        $t.Binding.AddSslCertificate($Thumbprint, 'My')
        Write-Host "    bound: $($t.Site) $($t.Host):$($t.Port)" -ForegroundColor Green
    }
    Write-Host "    Check from OUTSIDE the VM (hairpin NAT, see DEPLOY.md C.1): https://$($plan[0].Host)/health"
} finally {
    Stop-Transcript | Out-Null
}
