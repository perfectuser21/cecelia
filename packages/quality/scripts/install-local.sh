#!/bin/bash
# Cecelia Quality Platform - 项目级安装脚本

set -e

# 检测脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUALITY_ROOT="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(cd "$QUALITY_ROOT/../.." && pwd)"

VERSION=$(cat "$QUALITY_ROOT/VERSION" 2>/dev/null || echo "unknown")

echo "=================================================="
echo "  Cecelia Quality Platform - Local Setup"
echo "  Version: $VERSION"
echo "=================================================="
echo ""
echo "Quality Platform: $QUALITY_ROOT"
echo "Project Root: $PROJECT_ROOT"
echo ""

# 创建项目级配置
echo "Setting up project configuration..."

# 创建 .claude/settings.json
mkdir -p "$PROJECT_ROOT/.claude"

if [ -f "$PROJECT_ROOT/.claude/settings.json" ]; then
    echo "⚠️  .claude/settings.json already exists"
    echo "Please manually add the following to your settings:"
    echo ""
    echo '{
  "skills": {
    "paths": ["./infra/quality/skills", "./skills"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{"type": "command", "command": "./infra/quality/hooks/branch-protect.sh"}]
      },
      {
        "matcher": "Bash",
        "hooks": [{"type": "command", "command": "./infra/quality/hooks/pr-gate-v2.sh"}]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [{"type": "command", "command": "./infra/quality/hooks/stop.sh"}]
      }
    ]
  }
}'
else
    cat > "$PROJECT_ROOT/.claude/settings.json" << 'EOF'
{
  "skills": {
    "paths": ["./infra/quality/skills", "./skills"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "./infra/quality/hooks/branch-protect.sh"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./infra/quality/hooks/pr-gate-v2.sh"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "./infra/quality/hooks/stop.sh"
          }
        ]
      }
    ]
  }
}
EOF
    echo "✅ Created .claude/settings.json"
fi

# 创建 contracts 目录（如果不存在）
if [ ! -d "$PROJECT_ROOT/contracts" ]; then
    echo "Creating contracts directory..."
    mkdir -p "$PROJECT_ROOT/contracts"
    cp "$QUALITY_ROOT/contracts/gate-contract.template.yaml" "$PROJECT_ROOT/contracts/gate-contract.yaml"
    cp "$QUALITY_ROOT/contracts/regression-contract.template.yaml" "$PROJECT_ROOT/contracts/regression-contract.yaml"
    echo "✅ Created contracts from templates"
else
    echo "⚠️  contracts/ already exists, skipping template copy"
fi

echo ""
echo "=================================================="
echo "  ✅ Local Setup Complete!"
echo "=================================================="
echo ""
echo "Configured:"
echo "  - .claude/settings.json (skills + hooks)"
echo "  - contracts/ (gate + regression)"
echo ""
echo "Hooks enabled:"
echo "  - branch-protect.sh (on Write/Edit)"
echo "  - pr-gate-v2.sh (on Bash)"
echo "  - stop.sh (on SessionEnd)"
echo ""
echo "Skills available:"
echo "  - /audit"
echo "  - /qa"
echo "  - /assurance"
echo ""
echo "Next steps:"
echo "  1. Review contracts/gate-contract.yaml"
echo "  2. Review contracts/regression-contract.yaml"
echo "  3. Start Claude Code in this project"
echo ""
