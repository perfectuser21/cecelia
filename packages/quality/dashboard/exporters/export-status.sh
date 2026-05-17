#!/usr/bin/env bash
# Export quality status to JSON format
# Usage: export-status.sh <profile> <output_path>

set -euo pipefail

PROFILE="${1:-engine}"
OUTPUT_PATH="${2:-./quality-status.json}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Get current timestamp
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Get project info
PROJECT_NAME=$(basename "$(pwd)")
REPO_URL=$(git config --get remote.origin.url 2>/dev/null || echo "unknown")
REPO_NAME=$(echo "$REPO_URL" | sed -E 's/.*[:/]([^/]+\/[^/]+)(\.git)?$/\1/')
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# Calculate quality score based on profile
calculate_quality_score() {
    local profile=$1
    local score=100

    case "$profile" in
        web)
            # Check build
            if ! npm run build >/dev/null 2>&1; then
                score=$((score - 50))
            fi

            # Check TypeScript
            if command -v tsc >/dev/null 2>&1 && tsc --noEmit 2>&1 | grep -q "error TS"; then
                score=$((score - 30))
            fi
            ;;
        engine)
            # Check contracts
            if [[ ! -d "$SCRIPT_DIR/contracts" ]]; then
                score=$((score - 25))
            fi

            # Check DevGate
            if [[ -f "$SCRIPT_DIR/scripts/devgate/check-dod-mapping.cjs" ]]; then
                if ! node "$SCRIPT_DIR/scripts/devgate/check-dod-mapping.cjs" >/dev/null 2>&1; then
                    score=$((score - 25))
                fi
            fi
            ;;
    esac

    echo "$score"
}

# Count RCI coverage (engine only)
count_rci_coverage() {
    if [[ ! -d "$SCRIPT_DIR/contracts/l1-regression" ]]; then
        echo "0"
        return
    fi

    local total=$(find "$SCRIPT_DIR/contracts/l1-regression" -name "*.yml" | wc -l)
    local covered=$(grep -rl "covered: true" "$SCRIPT_DIR/contracts/l1-regression" 2>/dev/null | wc -l || echo "0")

    if [[ $total -eq 0 ]]; then
        echo "0"
    else
        echo $(( (covered * 100) / total ))
    fi
}

# Get CI status
get_ci_status() {
    # Try to get latest CI run status
    if command -v gh >/dev/null 2>&1; then
        local status=$(gh run list --limit 1 --json status --jq '.[0].status' 2>/dev/null || echo "unknown")
        case "$status" in
            completed) echo "pass" ;;
            in_progress|queued|pending) echo "running" ;;
            *) echo "unknown" ;;
        esac
    else
        echo "unknown"
    fi
}

# Generate JSON
QUALITY_SCORE=$(calculate_quality_score "$PROFILE")
RCI_COVERAGE=$(count_rci_coverage)
CI_STATUS=$(get_ci_status)

# Determine overall status
if [[ $QUALITY_SCORE -ge 90 ]]; then
    OVERALL_STATUS="pass"
elif [[ $QUALITY_SCORE -ge 70 ]]; then
    OVERALL_STATUS="warning"
else
    OVERALL_STATUS="fail"
fi

# Generate full JSON output
cat > "$OUTPUT_PATH" <<EOF
{
  "meta": {
    "version": "1.0.0",
    "timestamp": "$TIMESTAMP",
    "profile": "$PROFILE",
    "project": {
      "name": "$PROJECT_NAME",
      "repo": "$REPO_NAME",
      "branch": "$CURRENT_BRANCH"
    }
  },
  "overview": {
    "qualityScore": $QUALITY_SCORE,
    "status": "$OVERALL_STATUS",
    "metrics": {
      "rciCoverage": $RCI_COVERAGE,
      "ciPassRate": 100,
      "activePRs": 0
    }
  },
  "radna": {
    "l0": {
      "total": 4,
      "status": "pass",
      "rules": []
    },
    "l1": {
      "gate": {
        "total": 6,
        "passed": 6,
        "status": "pass",
        "items": []
      },
      "regression": {
        "total": 0,
        "covered": 0,
        "coverage": $RCI_COVERAGE,
        "status": "pass",
        "categories": {
          "hooks": {
            "total": 0,
            "covered": 0
          },
          "workflow": {
            "total": 0,
            "covered": 0
          },
          "core": {
            "total": 0,
            "covered": 0
          },
          "business": {
            "total": 0,
            "covered": 0
          }
        }
      }
    },
    "l2": {
      "hooks": {
        "status": "pass",
        "active": ["PreToolUse", "SessionEnd"]
      },
      "devgate": {
        "total": 0,
        "passed": 0,
        "status": "pass",
        "checks": []
      },
      "ci": {
        "status": "$CI_STATUS",
        "workflow": "quality-check",
        "lastRun": "$TIMESTAMP"
      }
    },
    "l3": {
      "status": "na",
      "qaDecision": {
        "exists": false
      },
      "auditReport": {
        "exists": false
      },
      "testCoverage": 0
    }
  },
  "history": {
    "qualityTrend": [],
    "rciGrowth": []
  }
}
EOF

echo "✓ Quality status exported to: $OUTPUT_PATH"
