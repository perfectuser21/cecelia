#!/bin/bash
# Evidence Archiver - Archive all evidence files to database

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUN_DIR="$1"

if [[ ! -d "$RUN_DIR" ]]; then
  echo "ERROR: Run directory not found: $RUN_DIR"
  exit 1
fi

EVIDENCE_DIR="$RUN_DIR/evidence"
RUN_ID=$(basename "$RUN_DIR")

# Get task_id from task.json
if [[ ! -f "$RUN_DIR/task.json" ]]; then
  echo "ERROR: task.json not found in $RUN_DIR"
  exit 1
fi

TASK_ID=$(jq -r '.taskId' "$RUN_DIR/task.json")

echo "Archiving evidence for run $RUN_ID (task: $TASK_ID)"

# Check if evidence directory exists
if [[ ! -d "$EVIDENCE_DIR" ]]; then
  echo "No evidence directory found, skipping"
  exit 0
fi

# Iterate over all files in evidence directory
count=0
for file in "$EVIDENCE_DIR"/*; do
  if [[ -f "$file" ]]; then
    basename_file=$(basename "$file")
    size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
    type="unknown"

    # Determine evidence type
    case "$basename_file" in
      QA-DECISION.md) type="qa_report" ;;
      AUDIT-REPORT.md) type="audit_report" ;;
      *.log) type="log" ;;
      test-results.* | coverage.*) type="test_result" ;;
      *.png | *.jpg | *.jpeg) type="screenshot" ;;
      *.json) type="artifact" ;;
    esac

    # Generate evidence ID
    evidence_id=$(uuidgen | tr '[:upper:]' '[:lower:]')

    # Add to database
    bash "$PROJECT_ROOT/scripts/db-api.sh" evidence:add \
      "$evidence_id" \
      "$RUN_ID" \
      "$TASK_ID" \
      "$type" \
      "evidence/$basename_file" \
      "" || echo "  Warning: Failed to add $basename_file to DB"

    echo "  ✅ Archived: $basename_file ($type, $size bytes)"
    ((count++))
  fi
done

echo "✅ Archived $count evidence files"
exit 0
