#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/validate-requirements-doc.sh <requirements.md>" >&2
  exit 1
fi

requirements_file="$1"
if [ ! -f "$requirements_file" ]; then
  echo "Requirements doc failed: file not found: $requirements_file" >&2
  exit 1
fi

require_literal() {
  local text="$1"
  local message="$2"
  if ! grep -Fq "$text" "$requirements_file"; then
    echo "Requirements doc failed: $message" >&2
    exit 1
  fi
}

extract_section() {
  local start_heading="$1"
  local end_heading="$2"
  awk -v start="$start_heading" -v end="$end_heading" '
    $0 == start { capture=1; next }
    capture && $0 == end { capture=0; exit }
    capture { print }
  ' "$requirements_file"
}

normalize_title_list() {
  tr ',' '\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | sed '/^$/d'
}

if ! grep -Eq '^# .+ - Requirements$' "$requirements_file"; then
  echo "Requirements doc failed: title must match '# <AppName> - Requirements'" >&2
  exit 1
fi

required_sections=(
  "## 1. Business context"
  "## 2. Users, access and ownership"
  "## 3. Core process and business logic"
  "## 4. Data model"
  "## 5. UX assumptions"
  "## Assumptions used for the draft requirements"
)

for section in "${required_sections[@]}"; do
  require_literal "$section" "missing required section: $section"
done

if grep -Fq "## 6. Implementation-shaping decisions and assumptions" "$requirements_file"; then
  echo "Requirements doc failed: obsolete section 6 must not appear in the BA draft" >&2
  exit 1
fi

required_markers=(
  "System value:"
  "MVP success criteria:"
  "Primary roles:"
  "Access model:"
  "Typical process:"
  "Lifecycle:"
  "Key business logic:"
  "Operational metrics:"
  "What should feel easy in the MVP:"
  "Minimum to create:"
  "default list columns:"
  "default main filters:"
)

for marker in "${required_markers[@]}"; do
  require_literal "$marker" "missing required marker: $marker"
done

if ! grep -Eq '^#{3,6} 4\.[0-9]+ Main entity:' "$requirements_file"; then
  echo "Requirements doc failed: missing 'Main entity' subsection in section 4" >&2
  exit 1
fi

if ! grep -Eq '^#{3,6} 4\.[0-9]+ Lookups$' "$requirements_file"; then
  echo "Requirements doc failed: missing Lookups subsection in section 4" >&2
  exit 1
fi

if ! grep -Eq '^#{3,6} 4\.[0-9]+ Relationships$' "$requirements_file"; then
  echo "Requirements doc failed: missing Relationships subsection in section 4" >&2
  exit 1
fi

section1_text="$(extract_section "## 1. Business context" "## 2. Users, access and ownership")"
section2_text="$(extract_section "## 2. Users, access and ownership" "## 3. Core process and business logic")"
section3_text="$(extract_section "## 3. Core process and business logic" "## 4. Data model")"
section4_text="$(extract_section "## 4. Data model" "## 5. UX assumptions")"
section5_text="$(extract_section "## 5. UX assumptions" "## Assumptions used for the draft requirements")"
assumptions_text="$(extract_section "## Assumptions used for the draft requirements" "__NO_END_HEADING__")"

for section_name in section1_text section2_text section3_text section5_text assumptions_text; do
  if printf '%s\n' "${!section_name}" | grep -Eq '^[[:space:]]*\|'; then
    echo "Requirements doc failed: markdown tables are allowed only in section 4 data model" >&2
    exit 1
  fi
done

if ! printf '%s\n' "$section4_text" | grep -Eq '^[[:space:]]*\|[[:space:]]*(Title|Назва)[[:space:]]*\|[[:space:]]*(Code|Код)[[:space:]]*\|[[:space:]]*(Description|Опис)[[:space:]]*\|'; then
  echo "Requirements doc failed: section 4 must include a field table with the required columns" >&2
  exit 1
fi

SECTION4_TEXT="$section4_text" python - <<'PY'
import os
import re
import sys

text = os.environ["SECTION4_TEXT"]
lines = text.splitlines()
entity_heading_re = re.compile(r'^\s*#{3,6}\s+4\.\d+\s+(Main|Supporting) entity:')
table_header_re = re.compile(
    r'^\s*\|\s*(Title|Назва)\s*\|\s*(Code|Код)\s*\|\s*(Description|Опис)\s*\|\s*(Data type|Тип)\s*\|\s*(Required|Обов’язкове)\s*\|\s*Default\s*\|',
    re.IGNORECASE,
)

entity_indices = [i for i, line in enumerate(lines) if entity_heading_re.search(line)]
if not entity_indices:
    print("Requirements doc failed: section 4 must contain at least one main or supporting entity heading", file=sys.stderr)
    sys.exit(1)

for pos, start in enumerate(entity_indices):
    end = entity_indices[pos + 1] if pos + 1 < len(entity_indices) else len(lines)
    block = lines[start:end]
    block_text = "\n".join(block)
    for marker in ["Title:", "Code:", "Entity role:", "Primary display field:", "Description:", "Purpose:"]:
        if marker not in block_text:
            print(
                f"Requirements doc failed: entity block starting at '{lines[start]}' is missing metadata marker '{marker}'",
                file=sys.stderr,
            )
            sys.exit(1)
    if not any(table_header_re.search(line) for line in block):
        print(
            f"Requirements doc failed: entity block starting at '{lines[start]}' must include its own field table",
            file=sys.stderr,
        )
        sys.exit(1)

table_count = sum(1 for line in lines if table_header_re.search(line))
if table_count < len(entity_indices):
    print("Requirements doc failed: every main and supporting entity must have a dedicated field table", file=sys.stderr)
    sys.exit(1)
PY

if printf '%s\n' "$section5_text" | grep -Eq '\bUsr[A-Za-z0-9_]+\b'; then
  echo "Requirements doc failed: section 5 must use business titles instead of Usr* codes" >&2
  exit 1
fi

if grep -Eiq '\bconfirmed\b|\bassumed\b|complete=true|source=' "$requirements_file"; then
  echo "Requirements doc failed: business plan must not expose checklist-source or validation markers" >&2
  exit 1
fi

ux_carrier_lines="$(printf '%s\n' "$section5_text" | grep -Ei '^[[:space:]-]*default (list columns|main filters):' || true)"
if [ -n "$ux_carrier_lines" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    printf '%s' "$line" \
      | sed 's/^[[:space:]-]*default [^:]*:[[:space:]]*//' \
      | normalize_title_list \
      | while IFS= read -r title; do
          case "$title" in
            Name) continue ;;
          esac
          if ! printf '%s\n' "$section4_text" | grep -Fqi "$title"; then
            echo "Requirements doc failed: UX title '$title' must have a carrier in section 4 data model" >&2
            exit 1
          fi
        done || exit 1
  done <<EOF
$ux_carrier_lines
EOF
fi

echo "REQUIREMENTS_DOC_OK ${requirements_file}"
