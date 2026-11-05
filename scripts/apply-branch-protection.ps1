<#
  Aplica (o actualiza) el ruleset que cierra main (CM-3, CM-5; 2026-11-05).

  Regla: a main solo se llega por pull request (sin aprobacion obligatoria:
  decision del 2026-11-05, hay un solo desarrollador), conversaciones resueltas y los checks de CI
  test, audit y go en verde sobre la rama actualizada. Sin push directo, sin
  force-push, sin borrar la rama, y sin bypass (ni para admins).

  Definicion: .github/rulesets/protect-main.json (versionada: el cambio de la
  regla tambien pasa por PR).

  Requisito: GitHub Pro (cuenta personal) o un plan de organizacion. En un repo
  privado del plan Free la API responde 403 "Upgrade to GitHub Pro"; mientras
  tanto, .github/workflows/main-guard.yml marca en rojo cualquier push a main
  que no venga de un PR mergeado (control detectivo, no preventivo).

  Uso (desde la raiz del repo, con gh autenticado como admin del repo):
    powershell -ExecutionPolicy Bypass -File scripts\apply-branch-protection.ps1
    powershell -ExecutionPolicy Bypass -File scripts\apply-branch-protection.ps1 -Repo owner/name
#>
param(
  [string]$Repo = "grodriguezcontextglobal/server-testing",
  [string]$RulesetFile = ".github/rulesets/protect-main.json"
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path $RulesetFile)) { throw "No existe $RulesetFile (corre el script desde la raiz del repo)" }
$name = (Get-Content $RulesetFile -Raw | ConvertFrom-Json).name

$existing = gh api "repos/$Repo/rulesets" --jq ".[] | select(.name == `"$name`") | .id"
if ($LASTEXITCODE -ne 0) { throw "No se pudieron leer los rulesets de $Repo (plan Free en repo privado? ver la cabecera)" }

if ($existing) {
  gh api -X PUT "repos/$Repo/rulesets/$existing" --input $RulesetFile | Out-Null
  $action = "actualizado (id $existing)"
} else {
  gh api -X POST "repos/$Repo/rulesets" --input $RulesetFile | Out-Null
  $action = "creado"
}
if ($LASTEXITCODE -ne 0) { throw "GitHub rechazo el ruleset" }

Write-Host "Ruleset '$name' $action en $Repo. Comprobacion:"
gh api "repos/$Repo/rules/branches/main" --jq '.[].type'
