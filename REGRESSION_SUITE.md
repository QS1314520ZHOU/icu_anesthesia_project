# Regression Suite

## Goal

The regression suite provides one unified entry point for the static and structural checks that now cover the main product surfaces.

It is meant to be:

- easy to run locally
- easy to attach to release checks
- easy to export into machine-readable JSON

## Main Entrances

### Python runner

```bash
python scripts/regression_suite.py
```

List available smoke suites:

```bash
python scripts/regression_suite.py --list-suites
```

Run only selected suites:

```bash
python scripts/regression_suite.py --suite core_workbench --suite project_detail
```

### PowerShell wrapper

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_regression_suite.ps1
```

List available smoke suites:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_regression_suite.ps1 -ListSuites
```

Run only selected suites:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_regression_suite.ps1 -Suite core_workbench,project_detail
```

### Shell wrapper

```bash
bash scripts/run_regression_suite.sh
```

List available smoke suites:

```bash
bash scripts/run_regression_suite.sh --list-suites
```

Run only selected suites:

```bash
bash scripts/run_regression_suite.sh --suite core_workbench --suite project_detail
```

Legacy wrapper is still accepted:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_form_generator_checks.ps1
```

## JSON Output

To write a machine-readable report:

```bash
python scripts/regression_suite.py --json-out regression_report.json
```

To write both JSON and Markdown summary:

```bash
python scripts/regression_suite.py --json-out regression_report.json --markdown-out regression_report.md
```

Or with the shell wrapper:

```bash
bash scripts/run_regression_suite.sh --json-out regression_report.json --markdown-out regression_report.md
```

The JSON payload includes:

- `summary.total`
- `summary.passed`
- `summary.failed`
- `results[]`
  - `name`
  - `command`
  - `returncode`
  - `duration_sec`
  - `stdout`
  - `stderr`
  - `ok`

## Contract Update

When a validated Form Generator behavior change is intentional, update the stored contract baseline with:

```bash
python scripts/regression_suite.py --update-contracts
```

Or through the PowerShell wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_regression_suite.ps1 -UpdateContracts
```

## GitHub Actions

The repository now includes:

- `.github/workflows/regression-suite.yml`

This workflow installs dependencies, runs the unified regression suite, and uploads the JSON report artifact.

## Covered Suites

The unified suite currently runs:

- Core workbench
- Insight / reporting
- Advanced governance
- Delivery data domains
- Auth / async / WeCom
- Form Generator
- Project Detail
- Alignment Center
- Interface spec workbench
- Knowledge Base / Asset Management / Mobile auxiliary surfaces
- Platform Admin / Share surfaces
- Collaboration center

The suite list, Python compile targets and frontend syntax targets are defined in:

- `scripts/regression_suite_manifest.json`

## Notes

- This suite is intentionally structural/static first.
- A green result means route surfaces, template nodes, and key frontend entry points are still present.
- It does not replace manual browser validation for critical flows.
