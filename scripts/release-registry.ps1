<#
.SYNOPSIS
  Release registry (CM-3, change control): one record per deploy on this box.

.DESCRIPTION
  Dot-sourced by deploy-node.ps1 and restart-go-worker.ps1, and runnable on its
  own after a manual `git pull` + `nssm restart`:

      powershell -ExecutionPolicy Bypass -File scripts\release-registry.ps1 -Component node -Result OK -Note "manual restart"

  Each deploy appends ONE JSON line to logs\releases.jsonl with:
    when (UTC), host, operator, component, mode, result,
    commit + subject + branch, the previous deployed commit of that component,
    the commits and PR numbers between them, whether the tree on disk had
    uncommitted changes, and the tag created.

  On a successful deploy (OK or WARNINGS) it also creates an annotated tag on
  the deployed commit, `deploy-<component>-<yyyyMMdd-HHmmss>` (UTC). The tag
  is LOCAL: the record of truth is releases.jsonl, which is on the box. Pass
  -PushTag to also push it to origin; a push that fails (no credentials on the
  VM, no network) is reported and never fails the deploy.

  Nothing in here may break a deploy: every git call and the file write are
  wrapped, and a failure becomes a warning plus a partial record.

  git runs with `-c safe.directory=<repo>`: the repo is owned by the account
  that cloned it, and an elevated shell from another account otherwise gets
  "detected dubious ownership" and no output at all.

  It never runs `git fetch`, `pull` or anything that changes the working tree.

  Pure ASCII on purpose (Windows PowerShell 5.1, see powershellScripts.test.js).
#>

[CmdletBinding()]
param(
    # Prefixed names: this file is also dot-sourced, and a param named $Result
    # would overwrite the caller's $result (PowerShell names are case-insensitive).
    [Alias('Component')] [ValidateSet('node', 'go-worker')] [string] $RegComponent,
    [Alias('Result')] [ValidateSet('OK', 'WARNINGS', 'FAILED')] [string] $RegResult,
    [Alias('Mode')] [string] $RegMode = 'manual',
    [Alias('Note')] [string] $RegNote = '',
    [Alias('PushTag')] [switch] $RegPushTag
)

function Invoke-RegistryGit([string]$RepoRoot, [string[]]$GitArgs) {
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git -c "safe.directory=$($RepoRoot -replace '\\', '/')" -C $RepoRoot @GitArgs 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return (@($out) -join "`n").Trim()
    } catch {
        return $null
    }
}

function Get-LastRelease([string]$RegistryFile, [string]$Component) {
    if (-not (Test-Path $RegistryFile)) { return $null }
    $last = $null
    foreach ($line in (Get-Content -Path $RegistryFile -Encoding utf8)) {
        if (-not $line.Trim()) { continue }
        try { $rec = $line | ConvertFrom-Json } catch { continue }
        if ($rec.component -eq $Component -and $rec.result -ne 'FAILED' -and $rec.commit) { $last = $rec }
    }
    return $last
}

function Write-ReleaseRecord {
    param(
        [Parameter(Mandatory)] [string] $RepoRoot,
        [Parameter(Mandatory)] [string] $Component,
        [Parameter(Mandatory)] [string] $Result,
        [string] $Mode = '',
        [string] $Note = '',
        [switch] $PushTag,
        # The commit on disk is not what runs (e.g. a failed Go build): record, do not tag.
        [switch] $NoTag
    )
    $registry = Join-Path $RepoRoot 'logs\releases.jsonl'
    try {
        New-Item -ItemType Directory -Force (Split-Path -Parent $registry) | Out-Null

        $now     = (Get-Date).ToUniversalTime()
        $commit  = Invoke-RegistryGit $RepoRoot @('rev-parse', 'HEAD')
        $subject = Invoke-RegistryGit $RepoRoot @('log', '-1', '--format=%s', 'HEAD')
        $branch  = Invoke-RegistryGit $RepoRoot @('rev-parse', '--abbrev-ref', 'HEAD')
        $status  = Invoke-RegistryGit $RepoRoot @('status', '--porcelain', '--untracked-files=no')
        # Not `$dirty = if (...) { @(...) }`: an if-expression unrolls the array,
        # and PS 5.1 then writes one file as a string and none as {}.
        $dirty = $null
        if ($null -ne $status) { $dirty = @($status -split "`n" | Where-Object { $_ }) }

        # Where origin was at the last pull (no fetch here). ahead > 0 means the
        # box runs commits that never went through a PR.
        $ahead = $null; $behind = $null
        $counts = Invoke-RegistryGit $RepoRoot @('rev-list', '--left-right', '--count', 'HEAD...@{upstream}')
        if ($counts -match '^(\d+)\s+(\d+)$') { $ahead = [int]$Matches[1]; $behind = [int]$Matches[2] }

        $previous = Get-LastRelease $registry $Component
        # changes: first-parent only (the merges and direct commits of the
        # deployed branch), capped; prs: from the full range, so a PR merged
        # into main and then carried over by a main -> release PR is listed too.
        $maxChanges = 40
        $changes = @(); $changeCount = 0; $prs = @()
        if ($previous -and $commit -and $previous.commit -ne $commit) {
            $range = "$($previous.commit)..$commit"
            $log = Invoke-RegistryGit $RepoRoot @('log', '--first-parent', '--format=%h %s', $range)
            if ($log) { $changes = @($log -split "`n" | Where-Object { $_ }) }
            $changeCount = $changes.Count
            if ($changeCount -gt $maxChanges) { $changes = @($changes[0..($maxChanges - 1)]) }
            $all = Invoke-RegistryGit $RepoRoot @('log', '--format=%s', $range)
            if ($all) {
                $prs = @($all -split "`n" | ForEach-Object { if ($_ -match 'Merge pull request #(\d+)') { [int]$Matches[1] } } | Sort-Object -Unique)
            }
        }

        $tag = $null
        if ($commit -and $Result -ne 'FAILED' -and -not $NoTag) {
            $name = "deploy-$Component-" + $now.ToString('yyyyMMdd-HHmmss')
            $who  = "$env:USERDOMAIN\$env:USERNAME"
            $msg  = "deploy $Component ($Mode) $Result on $env:COMPUTERNAME by $who"
            $made = Invoke-RegistryGit $RepoRoot @(
                '-c', "user.name=$who", '-c', "user.email=$env:USERNAME@$env:COMPUTERNAME",
                'tag', '-a', $name, '-m', $msg, $commit)
            if ($null -ne $made) {
                $tag = $name
                if ($PushTag) {
                    $pushed = Invoke-RegistryGit $RepoRoot @('push', 'origin', "refs/tags/$name")
                    if ($null -eq $pushed) { Write-Host "    tag $name created locally; push to origin FAILED (not fatal)" -ForegroundColor Yellow }
                }
            } else {
                Write-Host "    could not create tag $name (not fatal)" -ForegroundColor Yellow
            }
        }

        $record = [ordered]@{
            when            = $now.ToString('yyyy-MM-ddTHH:mm:ssZ')
            host            = $env:COMPUTERNAME
            operator        = "$env:USERDOMAIN\$env:USERNAME"
            component       = $Component
            mode            = $Mode
            result          = $Result
            commit          = $commit
            subject         = $subject
            branch          = $branch
            ahead_of_origin = $ahead
            behind_origin   = $behind
            dirty_files     = $dirty
            previous_commit = if ($previous) { $previous.commit } else { $null }
            previous_when   = if ($previous) { $previous.when } else { $null }
            change_count    = $changeCount
            changes         = $changes
            prs             = $prs
            tag             = $tag
            note            = $Note
        }
        $json = $record | ConvertTo-Json -Compress -Depth 4
        Add-Content -Path $registry -Value $json -Encoding utf8

        $short = if ($commit) { $commit.Substring(0, 7) } else { '(no git)' }
        $prText = if ($prs.Count) { ' PRs ' + (($prs | ForEach-Object { "#$_" }) -join ' ') } else { '' }
        Write-Host "    release registry: $Component $Result at $short$prText$(if ($tag) { ", tag $tag" })"
        if ($dirty -and $dirty.Count) {
            Write-Host "    WARNING: $($dirty.Count) tracked file(s) modified on disk; recorded in the registry." -ForegroundColor Yellow
        }
        if ($ahead) {
            Write-Host "    WARNING: HEAD is $ahead commit(s) ahead of origin (not reviewed by PR)." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "    release registry not written (not fatal): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Run directly (not dot-sourced): record one release from the arguments.
if ($MyInvocation.InvocationName -ne '.') {
    if (-not $RegComponent -or -not $RegResult) {
        Write-Host 'usage: release-registry.ps1 -Component node|go-worker -Result OK|WARNINGS|FAILED [-Mode x] [-Note x] [-PushTag]'
        exit 2
    }
    Write-ReleaseRecord -RepoRoot (Split-Path -Parent $PSScriptRoot) -Component $RegComponent -Result $RegResult `
        -Mode $RegMode -Note $RegNote -PushTag:$RegPushTag
}
