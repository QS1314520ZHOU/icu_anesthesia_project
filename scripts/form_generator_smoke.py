import sys
import json
import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.file_parser import extract_text_from_file
from routes.form_generator_routes import (
    _extract_form_candidates,
    _extract_textual_tables,
    _find_reference_form,
    _build_score_matrix_candidates,
    _should_use_semantic_parser_directly,
    _build_smartcare_text_table_form,
    _build_smartcare_form,
)


CONTRACT_PATH = ROOT / "scripts" / "form_generator_contracts.json"


def detect_strategy(path: Path):
    text = extract_text_from_file(str(path))
    reference = _find_reference_form(path.name, text or "")
    if reference:
        return "reference", text, reference["data"]

    tables = _extract_textual_tables(text)
    if tables:
        score_items = _build_score_matrix_candidates(tables[0], source_text=text)
        if score_items:
            return "score_table", text, _build_smartcare_form(score_items, path.stem)
        return "text_table", text, _build_smartcare_text_table_form(tables[0], source_name=path.stem, source_text=text)

    candidates = _extract_form_candidates(text)
    if _should_use_semantic_parser_directly(candidates):
        return "semantic", text, _build_smartcare_form(candidates, path.stem)

    return "ai", text, None


def collect_metrics(form):
    comps = form.get("pages", [{}])[0].get("components", []) if form else []
    type_counts = {}
    for comp in comps:
        comp_type = comp.get("type") or "unknown"
        type_counts[comp_type] = type_counts.get(comp_type, 0) + 1

    return {
        "component_count": len(comps),
        "overlay_count": sum(1 for comp in comps if comp.get("category") == "table_overlay"),
        "readonly_count": sum(1 for comp in comps if comp.get("readonly") is True),
        "type_counts": type_counts,
        "values": [comp.get("value") for comp in comps if comp.get("value")],
        "codes": [comp.get("code") for comp in comps if comp.get("code")],
        "labels": [comp.get("text") for comp in comps if comp.get("type") == "label" and comp.get("text")]
    }


def ensure_contains(actual, required):
    required_set = set(required or [])
    actual_set = set(actual or [])
    return required_set.issubset(actual_set), sorted(required_set - actual_set)


def build_contract_sample(sample):
    path = ROOT / sample["path"]
    strategy, text, form = detect_strategy(path)
    metrics = collect_metrics(form)
    return {
        "path": sample["path"],
        "expected_strategy": strategy,
        "component_count": metrics["component_count"],
        "overlay_count": metrics["overlay_count"],
        "readonly_count": metrics["readonly_count"],
        "type_counts": metrics["type_counts"],
        "required_values": metrics["values"][:8],
        "required_codes": metrics["codes"][:8],
        "required_labels": metrics["labels"][:10]
    }


def write_contracts():
    existing = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    generated = {
        "samples": [build_contract_sample(sample) for sample in existing.get("samples", [])]
    }
    CONTRACT_PATH.write_text(json.dumps(generated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[SMOKE] Contracts updated: {CONTRACT_PATH}")


def main():
    parser = argparse.ArgumentParser(description="Form Generator smoke / contract checker")
    parser.add_argument(
        "--write-contracts",
        action="store_true",
        help="Regenerate scripts/form_generator_contracts.json from current outputs"
    )
    args = parser.parse_args()

    if args.write_contracts:
        write_contracts()
        return

    contracts = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    failed = False
    for sample in contracts.get("samples", []):
        path = ROOT / sample["path"]
        expected = sample["expected_strategy"]
        strategy, text, form = detect_strategy(path)
        metrics = collect_metrics(form)

        print(f"[SMOKE] {path.name}")
        print(f"  strategy: {strategy}")
        print(f"  expected: {expected}")
        print(f"  text_len : {len(text or '')}")
        print(f"  components: {metrics['component_count']}")

        missing_values_ok, missing_values = ensure_contains(metrics["values"], sample.get("required_values"))
        missing_codes_ok, missing_codes = ensure_contains(metrics["codes"], sample.get("required_codes"))
        missing_labels_ok, missing_labels = ensure_contains(metrics["labels"], sample.get("required_labels"))

        checks_ok = (
            strategy == expected and
            metrics["component_count"] == sample.get("component_count") and
            metrics["overlay_count"] == sample.get("overlay_count") and
            metrics["readonly_count"] == sample.get("readonly_count") and
            metrics["type_counts"] == sample.get("type_counts") and
            missing_values_ok and
            missing_codes_ok and
            missing_labels_ok
        )

        if not checks_ok:
            failed = True
            print("  result: FAIL")
            if strategy != expected:
                print(f"  mismatch.strategy: actual={strategy} expected={expected}")
            if metrics["component_count"] != sample.get("component_count"):
                print(f"  mismatch.component_count: actual={metrics['component_count']} expected={sample.get('component_count')}")
            if metrics["overlay_count"] != sample.get("overlay_count"):
                print(f"  mismatch.overlay_count: actual={metrics['overlay_count']} expected={sample.get('overlay_count')}")
            if metrics["readonly_count"] != sample.get("readonly_count"):
                print(f"  mismatch.readonly_count: actual={metrics['readonly_count']} expected={sample.get('readonly_count')}")
            if metrics["type_counts"] != sample.get("type_counts"):
                print(f"  mismatch.type_counts: actual={metrics['type_counts']} expected={sample.get('type_counts')}")
            if missing_values:
                print(f"  missing.values: {missing_values}")
            if missing_codes:
                print(f"  missing.codes: {missing_codes}")
            if missing_labels:
                print(f"  missing.labels: {missing_labels}")
        else:
            print("  result: OK")

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
