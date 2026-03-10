#!/usr/bin/env bash
# local-precheck.sh — Push 前本地预检统一入口
#
# 检查项（仅 Brain 改动时触发）：
#   1. facts-check   — DEFINITION.md 与实际代码一致性
#   2. version-sync  — package.json / DEFINITION.md / .brain-versions 三方同步（macOS 兼容）
#   3. manifest-sync — brain-manifest.generated.json 与源码一致
#
# 用法：
#   bash scripts/local-precheck.sh          # 从仓库根目录调用
#   bash scripts/local-precheck.sh --force  # 强制运行（忽略 Brain 改动检测）
#
# 退出码：
#   0 — 全部通过（或 Brain 未改动，跳过）
#   1 — 存在失败项

set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

FORCE="${1:-}"
ERRORS=0
CHECKS_RUN=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  本地预检 (local-precheck)${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# ── 检测 Brain 是否有改动（用 wc -l 避免 grep -c exit=1 的双行问题）────────────
if [[ "$FORCE" == "--force" ]]; then
    BRAIN_CHANGED=99
    echo -e "${YELLOW}⚡ --force 模式：强制运行所有预检${RESET}"
else
    MERGE_BASE=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || echo "")
    if [[ -z "$MERGE_BASE" ]]; then
        BRAIN_CHANGED=0
    else
        BRAIN_CHANGED=$(git diff --name-only "$MERGE_BASE" HEAD 2>/dev/null \
            | grep '^packages/brain/' 2>/dev/null \
            | wc -l | tr -d ' ')
    fi
    BRAIN_CHANGED=${BRAIN_CHANGED:-0}
fi

if [[ "$BRAIN_CHANGED" -eq 0 ]]; then
    echo -e "${GREEN}✅ Brain 无改动，跳过预检${RESET}"
    echo ""
    exit 0
fi

echo -e "🔍 检测到 Brain 改动 ${BOLD}${BRAIN_CHANGED}${RESET} 个文件，开始预检..."
echo ""

# ── Check 1: facts-check ──────────────────────────────────────────────────────
echo -e "${BOLD}[1/3] facts-check${RESET} — DEFINITION.md 与代码一致性"
if [[ ! -f "scripts/facts-check.mjs" ]]; then
    echo -e "  ${YELLOW}⚠️  scripts/facts-check.mjs 不存在，跳过${RESET}"
else
    CHECKS_RUN=$((CHECKS_RUN + 1))
    set +e
    node scripts/facts-check.mjs 2>&1
    FACT_EXIT=$?
    set -e
    if [[ $FACT_EXIT -eq 0 ]]; then
        echo -e "  ${GREEN}✅ facts-check 通过${RESET}"
    else
        echo -e "  ${RED}❌ facts-check 失败${RESET}"
        echo -e "  ${RED}   请更新 DEFINITION.md 使其与源码一致${RESET}"
        ERRORS=$((ERRORS + 1))
    fi
fi
echo ""

# ── Check 2: version-sync (macOS 兼容，不用 grep -P) ─────────────────────────
echo -e "${BOLD}[2/3] version-sync${RESET} — 版本文件三方同步"
if [[ ! -f "packages/brain/package.json" ]]; then
    echo -e "  ${YELLOW}⚠️  packages/brain/package.json 不存在，跳过${RESET}"
else
    CHECKS_RUN=$((CHECKS_RUN + 1))
    set +e
    node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('packages/brain/package.json', 'utf8'));
const BASE = pkg.version;
let errors = 0;
console.log('  基准版本 (packages/brain/package.json): ' + BASE);
if (fs.existsSync('DEFINITION.md')) {
  const def = fs.readFileSync('DEFINITION.md', 'utf8');
  const m = def.match(/Brain\\s+版本[^:]*:\\s*\\*{0,2}(\\d+\\.\\d+\\.\\d+)\\*{0,2}/);
  if (!m) { console.log('  ⚠️  DEFINITION.md: 未找到 Brain 版本行，跳过'); }
  else if (m[1] !== BASE) { console.log('  ❌ DEFINITION.md: ' + m[1] + ' (期望: ' + BASE + ')'); errors++; }
  else { console.log('  ✅ DEFINITION.md: ' + m[1]); }
} else { console.log('  ⚠️  DEFINITION.md 不存在，跳过'); }
if (fs.existsSync('.brain-versions')) {
  const lines = fs.readFileSync('.brain-versions', 'utf8').trim().split('\n');
  const last = lines[lines.length - 1].trim();
  if (last !== BASE) { console.log('  ❌ .brain-versions: ' + last + ' (期望: ' + BASE + ')'); errors++; }
  else { console.log('  ✅ .brain-versions: ' + last); }
} else { console.log('  ⚠️  .brain-versions 不存在，跳过'); }
process.exit(errors > 0 ? 1 : 0);
" 2>&1
    VS_EXIT=$?
    set -e
    if [[ $VS_EXIT -eq 0 ]]; then
        echo -e "  ${GREEN}✅ version-sync 通过${RESET}"
    else
        echo -e "  ${RED}❌ version-sync 失败${RESET}"
        echo -e "  ${RED}   请同步更新 DEFINITION.md 和 .brain-versions${RESET}"
        ERRORS=$((ERRORS + 1))
    fi
fi
echo ""

# ── Check 3: manifest-sync ────────────────────────────────────────────────────
echo -e "${BOLD}[3/3] manifest-sync${RESET} — brain-manifest.generated.json 与源码一致"
if [[ ! -f "packages/brain/scripts/generate-manifest.mjs" ]]; then
    echo -e "  ${YELLOW}⚠️  generate-manifest.mjs 不存在，跳过${RESET}"
else
    CHECKS_RUN=$((CHECKS_RUN + 1))
    set +e
    node packages/brain/scripts/generate-manifest.mjs --check 2>&1
    MF_EXIT=$?
    set -e
    if [[ $MF_EXIT -eq 0 ]]; then
        echo -e "  ${GREEN}✅ manifest-sync 通过${RESET}"
    else
        echo -e "  ${RED}❌ manifest-sync 失败${RESET}"
        echo -e "  ${RED}   请运行: node packages/brain/scripts/generate-manifest.mjs${RESET}"
        ERRORS=$((ERRORS + 1))
    fi
fi
echo ""

# ── Engine 检查（仅 Engine 改动时触发）────────────────────────────────────────
if [[ "$FORCE" == "--force" ]]; then
    ENGINE_CHANGED=99
else
    MERGE_BASE_E=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || echo "")
    if [[ -z "$MERGE_BASE_E" ]]; then
        ENGINE_CHANGED=0
    else
        ENGINE_CHANGED=$(git diff --name-only "$MERGE_BASE_E" HEAD 2>/dev/null \
            | grep "^packages/engine/" 2>/dev/null \
            | wc -l | tr -d " ")
    fi
    ENGINE_CHANGED=${ENGINE_CHANGED:-0}
fi

if [[ "$ENGINE_CHANGED" -eq 0 ]]; then
    echo -e "${GREEN}✅ Engine 无改动，跳过 Engine 预检${RESET}"
else
    echo -e "🔍 检测到 Engine 改动 ${BOLD}${ENGINE_CHANGED}${RESET} 个文件，开始 Engine 预检..."
    echo ""

    # Engine Check: version-sync
    echo -e "${BOLD}[E/1] engine-version-sync${RESET} — Engine 版本文件同步（package.json / VERSION / .hook-core-version / regression-contract.yaml）"
    ENGINE_VSYNC="packages/engine/ci/scripts/check-version-sync.sh"
    if [[ ! -f "$ENGINE_VSYNC" ]]; then
        echo -e "  ${YELLOW}⚠️  $ENGINE_VSYNC 不存在，跳过${RESET}"
    else
        CHECKS_RUN=$((CHECKS_RUN + 1))
        set +e
        (cd packages/engine && bash ci/scripts/check-version-sync.sh 2>&1)
        EV_EXIT=$?
        set -e
        if [[ $EV_EXIT -eq 0 ]]; then
            echo -e "  ${GREEN}✅ engine-version-sync 通过${RESET}"
        else
            echo -e "  ${RED}❌ engine-version-sync 失败${RESET}"
            echo -e "  ${RED}   请同步更新 VERSION / .hook-core-version / regression-contract.yaml${RESET}"
            ERRORS=$((ERRORS + 1))
        fi
    fi
    echo ""
fi

# ── 汇总 ──────────────────────────────────────────────────────────────────────
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
if [[ $ERRORS -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}✅ 本地预检全部通过（${CHECKS_RUN} 项）${RESET}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""
    exit 0
else
    echo -e "${RED}${BOLD}❌ 本地预检失败（${ERRORS} 项失败，共 ${CHECKS_RUN} 项）${RESET}"
    echo -e "${RED}   请修复以上问题后再 push${RESET}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""
    exit 1
fi
