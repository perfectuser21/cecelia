#!/usr/bin/env bash
# install-hooks.sh - Install hook-core to target project
# Version: 1.0.0

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory (zenithjoy-engine root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(dirname "$SCRIPT_DIR")"

# L1 fix: Use hooks/ and skills/ directories directly (hook-core directory was removed)
# Source directories for installation
HOOKS_SRC_DIR="$ENGINE_ROOT/hooks"
SKILLS_SRC_DIR="$ENGINE_ROOT/skills"

# Version from package.json
VERSION_FILE="$ENGINE_ROOT/package.json"
if [[ -f "$VERSION_FILE" ]]; then
    HOOK_CORE_VERSION=$(grep '"version"' "$VERSION_FILE" | head -1 | sed 's/.*"version".*"\([^"]*\)".*/\1/')
else
    echo -e "${RED}ERROR: package.json not found at $VERSION_FILE${NC}"
    exit 1
fi

# Usage
usage() {
    echo "Usage: $0 [OPTIONS] [TARGET_DIR]"
    echo ""
    echo "Install hook-core to a target project directory."
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  -v, --version  Show hook-core version"
    echo "  -f, --force    Overwrite existing files"
    echo "  --dry-run      Show what would be installed without doing it"
    echo ""
    echo "Arguments:"
    echo "  TARGET_DIR     Target project directory (default: current directory)"
    echo ""
    echo "Examples:"
    echo "  $0                    # Install to current directory"
    echo "  $0 /path/to/project   # Install to specified project"
    echo "  $0 --dry-run .        # Preview installation"
}

# Parse arguments
FORCE=false
DRY_RUN=false
TARGET_DIR=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--version)
            echo "hook-core version: $HOOK_CORE_VERSION"
            exit 0
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -*)
            echo -e "${RED}Unknown option: $1${NC}"
            usage
            exit 1
            ;;
        *)
            TARGET_DIR="$1"
            shift
            ;;
    esac
done

# Default to current directory
if [[ -z "$TARGET_DIR" ]]; then
    TARGET_DIR="$(pwd)"
fi

# Resolve to absolute path
TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd)" || {
    echo -e "${RED}ERROR: Target directory does not exist: $TARGET_DIR${NC}"
    exit 1
}

# Check if target is a git repo
if [[ ! -d "$TARGET_DIR/.git" ]]; then
    echo -e "${YELLOW}WARNING: Target directory is not a git repository${NC}"
fi

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  hook-core Installer v$HOOK_CORE_VERSION${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""
echo -e "Source:  ${GREEN}$ENGINE_ROOT${NC}"
echo -e "Target:  ${GREEN}$TARGET_DIR${NC}"
echo ""

# Directories to create
TARGET_HOOKS_DIR="$TARGET_DIR/hooks"
TARGET_SCRIPTS_DIR="$TARGET_DIR/scripts/devgate"
TARGET_CLAUDE_DIR="$TARGET_DIR/.claude"

# Function to install file
# L3 fix: Avoid hiding errors in local command substitution
install_file() {
    local src="$1"
    local dst="$2"
    local dst_dir
    dst_dir="$(dirname "$dst")"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "  [DRY-RUN] Would copy: $(basename "$src") -> $dst"
        return
    fi

    # Create directory if needed
    mkdir -p "$dst_dir"

    # Check if file exists
    if [[ -f "$dst" && "$FORCE" != "true" ]]; then
        echo -e "  ${YELLOW}[SKIP]${NC} $dst (already exists, use --force to overwrite)"
        return
    fi

    # Copy file (dereference symlinks)
    cp -L "$src" "$dst"
    chmod +x "$dst" 2>/dev/null || true
    echo -e "  ${GREEN}[OK]${NC} $dst"
}

# Install hooks
# L1 fix: Check directory exists before iterating
echo -e "${BLUE}Installing hooks...${NC}"
if [[ -d "$HOOKS_SRC_DIR" ]]; then
    for hook in "$HOOKS_SRC_DIR/"*.sh; do
        # L1 fix: Handle glob no-match case
        [[ -e "$hook" ]] || continue
        if [[ -f "$hook" || -L "$hook" ]]; then
            install_file "$hook" "$TARGET_HOOKS_DIR/$(basename "$hook")"
        fi
    done
else
    echo -e "  ${YELLOW}[WARN]${NC} hooks/ directory not found at $HOOKS_SRC_DIR"
fi

# Install skills (formerly devgate scripts)
# L1 fix: Check directory exists before iterating
echo ""
echo -e "${BLUE}Installing skills...${NC}"
if [[ -d "$SKILLS_SRC_DIR" ]]; then
    # Copy entire skills directory structure
    for skill_dir in "$SKILLS_SRC_DIR/"*/; do
        [[ -e "$skill_dir" ]] || continue
        if [[ -d "$skill_dir" ]]; then
            skill_name=$(basename "$skill_dir")
            target_skill="$TARGET_DIR/skills/$skill_name"
            if [[ "$DRY_RUN" == "true" ]]; then
                echo -e "  [DRY-RUN] Would copy: $skill_name/"
            else
                mkdir -p "$target_skill"
                cp -r "$skill_dir"* "$target_skill/" 2>/dev/null || true
                echo -e "  ${GREEN}[OK]${NC} $skill_name/"
            fi
        fi
    done
else
    echo -e "  ${YELLOW}[WARN]${NC} skills/ directory not found at $SKILLS_SRC_DIR"
fi

# Create/update .claude/settings.json
echo ""
echo -e "${BLUE}Configuring Claude Code settings...${NC}"

SETTINGS_FILE="$TARGET_CLAUDE_DIR/settings.json"

if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "  [DRY-RUN] Would create: $SETTINGS_FILE"
else
    mkdir -p "$TARGET_CLAUDE_DIR"

    if [[ -f "$SETTINGS_FILE" && "$FORCE" != "true" ]]; then
        echo -e "  ${YELLOW}[SKIP]${NC} $SETTINGS_FILE (already exists)"
        echo -e "  ${YELLOW}       Add hooks configuration manually if needed${NC}"
    else
        cat > "$SETTINGS_FILE" << 'EOF'
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "./hooks/branch-protect.sh \"$TOOL_INPUT\""
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./hooks/pr-gate-v2.sh \"$TOOL_INPUT\""
          }
        ]
      }
    ]
  }
}
EOF
        echo -e "  ${GREEN}[OK]${NC} $SETTINGS_FILE"
    fi
fi

# Create VERSION marker
VERSION_MARKER="$TARGET_DIR/.hook-core-version"
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "  [DRY-RUN] Would write version to: $VERSION_MARKER"
else
    echo "$HOOK_CORE_VERSION" > "$VERSION_MARKER"
    echo -e "  ${GREEN}[OK]${NC} $VERSION_MARKER"
fi

# Summary
echo ""
echo -e "${GREEN}======================================${NC}"
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${GREEN}  Dry run complete!${NC}"
else
    echo -e "${GREEN}  Installation complete!${NC}"
fi
echo -e "${GREEN}  hook-core version: $HOOK_CORE_VERSION${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Review the installed files"
echo "  2. Commit the changes: git add -A && git commit -m 'chore: install zenithjoy-engine v$HOOK_CORE_VERSION'"
echo "  3. Start developing with /dev"
