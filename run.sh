#!/usr/bin/env bash
# Cecelia Quality - Unified Entry Point
# Loads appropriate profile and runs quality checks

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${QUALITY_PROFILE:-engine}"  # Default to engine profile
PROFILE_FILE="$SCRIPT_DIR/profiles/$PROFILE.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
    cat <<EOF
Usage: ./run.sh [COMMAND] [OPTIONS]

Commands:
  check           Run quality checks based on profile
  export          Export quality status to JSON
  init            Initialize quality for new project
  validate        Validate profile configuration

Options:
  --profile=TYPE  Specify profile (engine|web|api|minimal)
  --format=TYPE   Output format (text|json)
  --export-path   Path to export quality-status.json

Profiles:
  engine          Heavy workflow (PRD/DoD/QA/Audit required)
  web             Light workflow (Build + Type check only)
  api             Medium workflow (Tests + API contracts)
  minimal         Bare minimum (Lint + Build)

Environment Variables:
  QUALITY_PROFILE Profile to use (default: engine)
  QUALITY_EXPORT  Path to export quality-status.json

Examples:
  # Run web profile checks
  ./run.sh check --profile=web

  # Export quality status for dashboard
  ./run.sh export --profile=engine --export-path=./quality-status.json

  # Initialize quality for new frontend project
  ./run.sh init --profile=web
EOF
    exit 0
}

load_profile() {
    local profile=$1

    if [[ ! -f "$SCRIPT_DIR/profiles/$profile.yml" ]]; then
        echo -e "${RED}✗ Profile not found: $profile${NC}"
        echo "Available profiles:"
        ls -1 "$SCRIPT_DIR/profiles/"*.yml 2>/dev/null | xargs -n1 basename | sed 's/.yml$//' | sed 's/^/  - /' || echo "  (none)"
        exit 1
    fi

    echo -e "${BLUE}→ Loading profile: $profile${NC}"
    PROFILE_FILE="$SCRIPT_DIR/profiles/$profile.yml"
}

parse_yaml() {
    local file=$1
    local prefix=$2

    # Simple YAML parser using node if available, fallback to grep
    if command -v node >/dev/null 2>&1 && [[ -f "$SCRIPT_DIR/package.json" ]]; then
        node -e "
        const yaml = require('js-yaml');
        const fs = require('fs');
        const data = yaml.load(fs.readFileSync('$file', 'utf8'));
        console.log(JSON.stringify(data, null, 2));
        "
    else
        # Fallback: just grep for specific keys
        cat "$file"
    fi
}

run_check() {
    local profile=$1
    local format=${2:-text}

    load_profile "$profile"

    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Cecelia Quality Check - Profile: $profile${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Parse profile config
    local config
    config=$(parse_yaml "$PROFILE_FILE" "")

    # Run gates based on profile
    case "$profile" in
        web)
            run_web_checks
            ;;
        engine)
            run_engine_checks
            ;;
        api)
            run_api_checks
            ;;
        minimal)
            run_minimal_checks
            ;;
        *)
            echo -e "${RED}✗ Unknown profile: $profile${NC}"
            exit 1
            ;;
    esac

    echo ""
    echo -e "${GREEN}✓ Quality check completed${NC}"
}

run_web_checks() {
    echo -e "${YELLOW}[G1]${NC} Checking TypeScript errors..."
    if command -v tsc >/dev/null 2>&1; then
        if tsc --noEmit 2>&1 | grep -q "error TS"; then
            echo -e "${YELLOW}  ⚠ TypeScript warnings found${NC}"
        else
            echo -e "${GREEN}  ✓ No TypeScript errors${NC}"
        fi
    else
        echo -e "${YELLOW}  ⊘ tsc not found, skipping${NC}"
    fi

    echo -e "${YELLOW}[G2]${NC} Running build..."
    if [[ -f "package.json" ]] && grep -q '"build"' package.json; then
        if npm run build >/dev/null 2>&1; then
            echo -e "${GREEN}  ✓ Build succeeded${NC}"
        else
            echo -e "${RED}  ✗ Build failed${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}  ⊘ No build script found${NC}"
    fi
}

run_engine_checks() {
    echo -e "${YELLOW}[L1]${NC} Checking contracts..."
    if [[ -d "$SCRIPT_DIR/contracts" ]]; then
        local gate_count=$(find "$SCRIPT_DIR/contracts/l1-gate" -name "*.yml" 2>/dev/null | wc -l)
        local rci_count=$(find "$SCRIPT_DIR/contracts/l1-regression" -name "*.yml" 2>/dev/null | wc -l)
        echo -e "${GREEN}  ✓ Gate Contracts: $gate_count${NC}"
        echo -e "${GREEN}  ✓ RCI Contracts: $rci_count${NC}"
    fi

    echo -e "${YELLOW}[L2]${NC} Running DevGate checks..."
    if [[ -f "$SCRIPT_DIR/scripts/devgate/check-dod-mapping.cjs" ]]; then
        if node "$SCRIPT_DIR/scripts/devgate/check-dod-mapping.cjs" >/dev/null 2>&1; then
            echo -e "${GREEN}  ✓ DoD mapping valid${NC}"
        else
            echo -e "${RED}  ✗ DoD mapping failed${NC}"
        fi
    fi
}

run_api_checks() {
    echo "API profile checks not yet implemented"
}

run_minimal_checks() {
    echo "Minimal profile checks not yet implemented"
}

export_status() {
    local profile=$1
    local export_path=${2:-./quality-status.json}

    load_profile "$profile"

    echo -e "${BLUE}→ Exporting quality status to: $export_path${NC}"

    # Use exporter script
    if [[ -f "$SCRIPT_DIR/dashboard/exporters/export-status.sh" ]]; then
        bash "$SCRIPT_DIR/dashboard/exporters/export-status.sh" "$profile" "$export_path"
    else
        # Fallback: generate basic JSON
        cat > "$export_path" <<EOF
{
  "profile": "$profile",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "unknown",
  "message": "Exporter script not found"
}
EOF
    fi

    echo -e "${GREEN}✓ Status exported${NC}"
}

init_quality() {
    local profile=$1

    echo -e "${BLUE}→ Initializing quality for profile: $profile${NC}"

    # Copy profile to project root
    cp "$SCRIPT_DIR/profiles/$profile.yml" ./.quality-profile.yml

    # Create basic .github/workflows if not exists
    mkdir -p .github/workflows

    case "$profile" in
        web)
            cat > .github/workflows/quality.yml <<'EOF'
name: Quality Check

on: [pull_request, push]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - run: npx tsc --noEmit
EOF
            ;;
        engine)
            echo "Engine profile initialization - use existing CI workflow"
            ;;
    esac

    echo -e "${GREEN}✓ Quality initialized${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Review .quality-profile.yml"
    echo "  2. Commit quality configuration"
    echo "  3. Push to trigger CI checks"
}

# Main
CMD="${1:-}"
shift || true

case "$CMD" in
    check)
        PROFILE="engine"
        FORMAT="text"

        while [[ $# -gt 0 ]]; do
            case $1 in
                --profile=*)
                    PROFILE="${1#*=}"
                    shift
                    ;;
                --format=*)
                    FORMAT="${1#*=}"
                    shift
                    ;;
                *)
                    echo "Unknown option: $1"
                    usage
                    ;;
            esac
        done

        run_check "$PROFILE" "$FORMAT"
        ;;
    export)
        PROFILE="engine"
        EXPORT_PATH="./quality-status.json"

        while [[ $# -gt 0 ]]; do
            case $1 in
                --profile=*)
                    PROFILE="${1#*=}"
                    shift
                    ;;
                --export-path=*)
                    EXPORT_PATH="${1#*=}"
                    shift
                    ;;
                *)
                    echo "Unknown option: $1"
                    usage
                    ;;
            esac
        done

        export_status "$PROFILE" "$EXPORT_PATH"
        ;;
    init)
        PROFILE="engine"

        while [[ $# -gt 0 ]]; do
            case $1 in
                --profile=*)
                    PROFILE="${1#*=}"
                    shift
                    ;;
                *)
                    echo "Unknown option: $1"
                    usage
                    ;;
            esac
        done

        init_quality "$PROFILE"
        ;;
    validate)
        echo "Validate command not yet implemented"
        ;;
    -h|--help)
        usage
        ;;
    *)
        if [[ -z "$CMD" ]]; then
            usage
        else
            echo "Unknown command: $CMD"
            usage
        fi
        ;;
esac
