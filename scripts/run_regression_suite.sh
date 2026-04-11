#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

echo "[RegressionSuite] Repo root: ${REPO_ROOT}"

ARGS=("scripts/regression_suite.py")

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list-suites)
      ARGS+=("--list-suites")
      shift
      ;;
    --update-contracts)
      ARGS+=("--update-contracts")
      shift
      ;;
    --suite)
      if [[ $# -lt 2 ]]; then
        echo "--suite requires a suite name" >&2
        exit 1
      fi
      ARGS+=("--suite" "$2")
      shift 2
      ;;
    --json-out)
      if [[ $# -lt 2 ]]; then
        echo "--json-out requires a path argument" >&2
        exit 1
      fi
      ARGS+=("--json-out" "$2")
      shift 2
      ;;
    --markdown-out)
      if [[ $# -lt 2 ]]; then
        echo "--markdown-out requires a path argument" >&2
        exit 1
      fi
      ARGS+=("--markdown-out" "$2")
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

python "${ARGS[@]}"

echo
echo "[RegressionSuite] All checks passed."
