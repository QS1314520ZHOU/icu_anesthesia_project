# Form Generator Pipeline

## Goal

Form Generator should avoid per-form manual tuning whenever possible.
The current design prefers deterministic local parsing first, then falls back only when needed.

## Strategy Order

The document pipeline runs in this order:

1. `reference`
2. `score_table`
3. `text_table`
4. `semantic`
5. `ai`

The selected branch is returned as `generation_strategy` and is shown in the UI debug panel.

## Strategy Details

### `reference`

Use when the uploaded file matches an existing JSON form in `表单/*.json`.

- Reuses the matched SmartCare form directly
- Applies light normalization such as date-control promotion
- Best for forms that already exist in the local reference library

### `score_table`

Use when extracted text contains a structured score matrix.

- Detects columns such as:
  - dimension / section
  - item
  - option / level
  - score
- Converts each scored row group into:
  - section title
  - radio-style option group
- Appends:
  - `总分`
  - `风险等级`
  when grading text is detected

Typical example:

- `ICU机械通气患者误吸风险评估量表.docx`

### `text_table`

Use when extracted text contains a normal Word table but not a score matrix.

- Extracts header metadata rows like:
  - `科室 / 床号 / 姓名 / 住院号`
  - `诊断 / 入院日期 / 责任护士 / 日期`
- Builds a SmartCare `table` component for the remaining body rows
- Creates overlay controls for empty cells inferred as fillable targets
- Marks overlay controls with:
  - `category = table_overlay`
- Uses stable naming for overlay controls:
  - `value`: `tbl_<slug>_r<c>c<r>`
  - `code`: `<slug>_r<c>c<r>`

### `semantic`

Use when the source is better represented as labeled fields and option groups than as a grid.

The parser groups lines into:

- title
- label / note
- field
- option group

This is the default path for many narrative record forms.

Typical example:

- `2.已发压疮评估及护理措施记录单（2025年第4次修订）.doc`

### `ai`

Use only when the earlier deterministic branches are not strong enough.

- AI returns a generic field array
- The array is compiled into SmartCare JSON afterward

## Naming Rules

Auto-generated values and option codes use a shared slug pipeline in `routes/form_generator_routes.py`.

Highlights:

- Chinese labels prefer pinyin-based slugs when `pypinyin` is available
- Symbols are normalized:
  - `>=` / `≥` -> `gte`
  - `<=` / `≤` -> `lte`
  - `>` -> `gt`
  - `<` -> `lt`
  - `~` -> `to`
- Score suffixes like `（2分）` are removed before option-code generation

Examples:

- field value: `cuo_shi_wan_quan_dao_wei`
- score option code: `gte_3`
- overlay value: `tbl_ti_wen_r2c2`

## Files

- Backend pipeline:
  - `routes/form_generator_routes.py`
- File extraction:
  - `services/file_parser.py`
- Frontend UI and preview:
  - `static/js/form_generator.js`
- Page container:
  - `templates/index.html`
- Smoke regression:
  - `scripts/form_generator_smoke.py`
  - `scripts/form_generator_contracts.json`

## Smoke Coverage

Run:

```bash
python scripts/form_generator_smoke.py
```

The smoke script reads its expected baseline from:

- `scripts/form_generator_contracts.json`

To intentionally refresh the baseline after a validated change:

```bash
python scripts/form_generator_smoke.py --write-contracts
```

You can also invoke the full regression runner and include the contract update in one pass:

```bash
python scripts/regression_suite.py --update-contracts
```

Or via PowerShell wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_regression_suite.ps1 -UpdateContracts
```

Current checks:

- score-table sample selects `score_table`
- real text-table sample selects `text_table`
- semantic record sample selects `semantic`
- real text-table sample creates unique overlay controls
- score-table checkboxes all have non-empty `code`
- strategy, component count, overlay count, readonly count and type distribution match the stored contract

## Extension Guidance

When a new form fails, prefer this order of fixes:

1. Improve extraction quality in `services/file_parser.py`
2. Improve branch detection in `routes/form_generator_routes.py`
3. Improve a general-purpose branch:
   - `score_table`
   - `text_table`
   - `semantic`
4. Add a new local reference JSON only if the form already exists in production and should be reused as-is
5. Avoid adding one-off logic for a single filename unless there is no broader pattern
