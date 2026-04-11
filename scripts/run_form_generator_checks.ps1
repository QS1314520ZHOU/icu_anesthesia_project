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

Write-Host "[Deprecated] scripts/run_form_generator_checks.ps1 forwards to scripts/run_regression_suite.ps1" -ForegroundColor DarkYellow

$argsList = @(
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $scriptDir "run_regression_suite.ps1")
)

if ($UpdateContracts) {
    $argsList += "-UpdateContracts"
}
if ($JsonOut) {
    $argsList += "-JsonOut"
    $argsList += $JsonOut
}
if ($MarkdownOut) {
    $argsList += "-MarkdownOut"
    $argsList += $MarkdownOut
}
if ($ListSuites) {
    $argsList += "-ListSuites"
}
$normalizedSuites = @()
foreach ($suiteName in $Suite) {
    foreach ($part in ($suiteName -split ',')) {
        $trimmed = $part.Trim()
        if ($trimmed) {
            $normalizedSuites += $trimmed
        }
    }
}
if ($normalizedSuites.Count -gt 0) {
    $argsList += "-Suite"
    $argsList += ($normalizedSuites -join ",")
}

powershell @argsList
if ($LASTEXITCODE -ne 0) {
    throw "Delegated regression suite failed with exit code $LASTEXITCODE"
}
