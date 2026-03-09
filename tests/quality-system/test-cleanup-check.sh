#!/bin/bash
# 元测试：验证 cleanup-check 逻辑的正确行为
# 该检查在 devgate.yml 中以内联 bash 脚本形式运行
# 场景1：DoD 无清理条目 → 应 exit 0（跳过检查）
# 场景2：DoD 有清理条目 + PR 有代码删除 → 应 exit 0
# 场景3：DoD 有清理条目 + PR 无代码删除 → 应 exit 1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PASS_COUNT=0
FAIL_COUNT=0

# 提取 devgate.yml 中 cleanup-check 的逻辑到独立脚本进行测试
# cleanup-check 逻辑：检查 DoD 是否有清理条目，若有则检查 PR 是否有代码删除
run_cleanup_check() {
  local dod_file="$1"
  local deleted_lines="$2"  # 模拟 PR diff 中删除的代码行数

  if [[ ! -f "$dod_file" ]]; then
    echo "No DoD file found — skipping cleanup check"
    return 0
  fi

  # 检查 DoD 中是否有重构/清理/替换相关条目（与 devgate.yml 保持一致）
  CLEANUP_KEYWORDS="重构|refactor|替换|replace|cleanup|clean.up|删除.*旧|移除.*旧|remove.*old|simplify|简化"
  CLEANUP_ITEMS=$(grep -iE "$CLEANUP_KEYWORDS" "$dod_file" | grep -E "^\s*-\s*\[" || true)

  if [[ -z "$CLEANUP_ITEMS" ]]; then
    echo "No cleanup/refactor items found in DoD — check not required"
    return 0
  fi

  echo "Cleanup items found in DoD:"
  echo "$CLEANUP_ITEMS"
  echo "Deleted lines in PR diff: $deleted_lines"

  # DoD 有重构/清理条目，但 PR 无任何代码删除 → 硬失败
  if [[ "$deleted_lines" -eq 0 ]]; then
    echo "❌ HARD GATE FAILED: Cleanup required but no code deleted"
    return 1
  fi

  echo "✅ Cleanup Check passed ($deleted_lines lines deleted)"
  return 0
}

TMPDIR_PATH=$(mktemp -d)
trap "rm -rf $TMPDIR_PATH" EXIT

# ─────────────────────────────────────────────
# 场景1：DoD 无清理条目 → 应 exit 0
# ─────────────────────────────────────────────
cat > "$TMPDIR_PATH/dod-no-cleanup.md" << 'EOF'
# DoD

- [x] 实现新功能
  Test: manual:curl -s http://localhost:5221/health
- [x] 单元测试通过
  Test: tests/unit/feature.test.ts
EOF

if ! run_cleanup_check "$TMPDIR_PATH/dod-no-cleanup.md" 0 > /dev/null 2>&1; then
  echo "❌ 场景1失败：期望 exit 0（无清理条目），实际 exit 1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景1通过：DoD 无清理条目 → exit 0（跳过清理检查）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景2：DoD 有清理条目 + PR 有代码删除 → 应 exit 0
# ─────────────────────────────────────────────
cat > "$TMPDIR_PATH/dod-with-cleanup-has-deletion.md" << 'EOF'
# DoD

- [x] 重构旧模块，删除冗余代码
  Test: manual:bash scripts/verify.sh
- [x] 替换旧 API 调用为新接口
  Test: tests/api/new-interface.test.ts
EOF

if ! run_cleanup_check "$TMPDIR_PATH/dod-with-cleanup-has-deletion.md" 50 > /dev/null 2>&1; then
  echo "❌ 场景2失败：期望 exit 0（有清理条目 + 有代码删除），实际 exit 1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景2通过：DoD 有清理条目 + 有代码删除 → exit 0（清理已执行）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景3：DoD 有清理条目 + PR 无代码删除 → 应 exit 1
# ─────────────────────────────────────────────
cat > "$TMPDIR_PATH/dod-with-cleanup-no-deletion.md" << 'EOF'
# DoD

- [x] 重构旧模块，删除冗余代码
  Test: manual:bash scripts/verify.sh
- [x] 简化函数逻辑
  Test: tests/unit/simplified.test.ts
EOF

if run_cleanup_check "$TMPDIR_PATH/dod-with-cleanup-no-deletion.md" 0 > /dev/null 2>&1; then
  echo "❌ 场景3失败：期望 exit 1（有清理条目但无代码删除），实际 exit 0"
  echo "   cleanup-check 没有正确拦截未执行清理的情况"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景3通过：DoD 有清理条目 + 无代码删除 → exit 1（门禁正常拦截）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景4：DoD 文件不存在 → 应 exit 0（跳过）
# ─────────────────────────────────────────────
if ! run_cleanup_check "$TMPDIR_PATH/nonexistent-dod.md" 0 > /dev/null 2>&1; then
  echo "❌ 场景4失败：期望 exit 0（DoD 不存在应跳过），实际 exit 1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景4通过：DoD 文件不存在 → exit 0（正确跳过）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

echo ""
echo "cleanup-check 场景验证: $PASS_COUNT 通过 / $FAIL_COUNT 失败"

[ "$FAIL_COUNT" -eq 0 ] && exit 0 || exit 1
