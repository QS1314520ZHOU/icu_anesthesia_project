param(
    [switch]$UpdateContracts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

Write-Host "[FormGenerator] Repo root: $repoRoot" -ForegroundColor Cyan

function Run-Step {
    param(
        [string]$Title,
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "==> $Title" -ForegroundColor Yellow
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "Step failed: $Title (exit code $LASTEXITCODE)"
    }
    Write-Host "OK: $Title" -ForegroundColor Green
}

Run-Step "Python compile checks" {
    python -m py_compile routes/form_generator_routes.py services/file_parser.py scripts/form_generator_smoke.py
}

if (Get-Command node -ErrorAction SilentlyContinue) {
    Run-Step "Frontend syntax check" {
        node --check static/js/form_generator.js
    }
} else {
    Write-Host ""
    Write-Host "Skip: node not found, frontend syntax check was not executed." -ForegroundColor DarkYellow
}

Run-Step "Form Generator smoke suite" {
    python scripts/form_generator_smoke.py
}

Run-Step "Project detail smoke suite" {
    python scripts/project_detail_smoke.py
}

Run-Step "Alignment center smoke suite" {
    python scripts/alignment_center_smoke.py
}

Run-Step "Interface spec smoke suite" {
    python scripts/interface_spec_smoke.py
}

Run-Step "Core workbench smoke suite" {
    python scripts/core_workbench_smoke.py
}

Run-Step "Insight/reporting smoke suite" {
    python scripts/insight_reporting_smoke.py
}

Run-Step "Advanced governance smoke suite" {
    python scripts/advanced_governance_smoke.py
}

Run-Step "Auxiliary surfaces smoke suite" {
    python scripts/auxiliary_surfaces_smoke.py
}

Run-Step "Platform admin/share smoke suite" {
    python scripts/platform_admin_share_smoke.py
}

Run-Step "Collaboration center smoke suite" {
    python scripts/collaboration_center_smoke.py
}

if ($UpdateContracts) {
    Run-Step "Refresh Form Generator contracts" {
        python scripts/form_generator_smoke.py --write-contracts
    }
}

Write-Host ""
Write-Host "[FormGenerator] All checks passed." -ForegroundColor Cyan
