param(
    [switch]$UpdateContracts,
    [string]$JsonOut = "",
    [string]$MarkdownOut = "",
    [string[]]$Suite = @(),
    [switch]$ListSuites
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

Write-Host "[RegressionSuite] Repo root: $repoRoot" -ForegroundColor Cyan

$argsList = @("scripts/regression_suite.py")
if ($ListSuites) {
    $argsList += "--list-suites"
}
if ($UpdateContracts) {
    $argsList += "--update-contracts"
}
if ($JsonOut) {
    $argsList += "--json-out"
    $argsList += $JsonOut
}
if ($MarkdownOut) {
    $argsList += "--markdown-out"
    $argsList += $MarkdownOut
}
foreach ($suiteName in $Suite) {
    foreach ($part in ($suiteName -split ',')) {
        $trimmed = $part.Trim()
        if ($trimmed) {
            $argsList += "--suite"
            $argsList += $trimmed
        }
    }
}

python @argsList
if ($LASTEXITCODE -ne 0) {
    throw "Regression suite failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "[RegressionSuite] All checks passed." -ForegroundColor Cyan
