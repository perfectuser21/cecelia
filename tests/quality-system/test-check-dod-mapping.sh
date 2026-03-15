#!/bin/bash
# 元测试：验证 check-dod-mapping.cjs 的正确行为
# 场景1：DoD 条目缺少 Test 字段 → 应 exit 1
# 场景2：DoD 条目有 Test 字段但测试文件不存在 → 应 exit 1
# 场景3：DoD 条目有有效 Test 字段（manual: 内联命令）→ 应 exit 0
# 场景4：DoD 条目有 echo 假测试 → 应 exit 1（假测试检测）
# 场景5：DoD 中含未勾选条目 [  ] → 应 exit 1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECK_DOD="$REPO_ROOT/packages/engine/scripts/devgate/check-dod-mapping.cjs"

if [[ ! -f "$CHECK_DOD" ]]; then
  echo "❌ check-dod-mapping.cjs 不存在: $CHECK_DOD"
  exit 1
fi

# 检查 js-yaml 是否安装
if ! (cd "$REPO_ROOT/packages/engine" && node -e "require('js-yaml')" 2>/dev/null); then
  echo "❌ js-yaml 未安装，请先运行 cd packages/engine && npm ci"
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0

# 在临时 git 仓库中运行（check-dod-mapping.cjs 需要 git 仓库）
TMPDIR_PATH=$(mktemp -d)
trap "rm -rf $TMPDIR_PATH" EXIT

# 初始化临时 git 仓库
git -C "$TMPDIR_PATH" init -q
git -C "$TMPDIR_PATH" config user.email "test@test.com"
git -C "$TMPDIR_PATH" config user.name "Test"
# 创建初始提交（避免 git rev-parse HEAD 失败）
touch "$TMPDIR_PATH/.gitkeep"
git -C "$TMPDIR_PATH" add .gitkeep
git -C "$TMPDIR_PATH" commit -q -m "init"

run_dod_check() {
  local dod_file="$1"
  local workdir="$2"
  # 将 DoD 文件放到临时 git 仓库的根目录
  cp "$dod_file" "$workdir/.dod.md"
  (cd "$workdir" && node "$CHECK_DOD" ".dod.md" 2>/dev/null)
  return $?
}

# ─────────────────────────────────────────────
# 场景1：DoD 条目缺少 Test 字段 → 应 exit 1
# ─────────────────────────────────────────────
cat > "$TMPDIR_PATH/dod-no-test.md" << 'EOF'
# DoD

- [x] 功能正常实现
- [x] 测试通过
EOF

if run_dod_check "$TMPDIR_PATH/dod-no-test.md" "$TMPDIR_PATH" > /dev/null 2>&1; then
  echo "❌ 场景1失败：期望 exit 1（缺少 Test 字段），实际 exit 0"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景1通过：DoD 条目缺少 Test 字段 → exit 1（门禁正常拦截）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景2：DoD 条目 Test 指向不存在的测试文件 → 应 exit 1
# ─────────────────────────────────────────────
cat > "$TMPDIR_PATH/dod-missing-test-file.md" << 'EOF'
# DoD

- [x] 功能正常实现
  Test: tests/nonexistent/feature.test.ts
EOF

if run_dod_check "$TMPDIR_PATH/dod-missing-test-file.md" "$TMPDIR_PATH" > /dev/null 2>&1; then
  echo "❌ 场景2失败：期望 exit 1（测试文件不存在），实际 exit 0"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景2通过：Test 指向不存在文件 → exit 1（门禁正常拦截）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景3：DoD 有 manual: 内联命令 → 应 exit 0
# 使用不依赖外部服务的 node 命令（CI 安全）
# ─────────────────────────────────────────────
cat > "$TMPDIR_PATH/dod-manual-inline.md" << 'EOF'
# DoD

- [x] [ARTIFACT] Node.js 可用
  Test: manual:node -e "process.exit(0)"
- [x] [BEHAVIOR] 文件系统可访问（运行时验证）
  Test: manual:node -e "require('fs').readdirSync('.')"
- [x] [GATE] 所有检查通过
  Test: manual:node -e "process.exit(0)"
EOF

if ! run_dod_check "$TMPDIR_PATH/dod-manual-inline.md" "$TMPDIR_PATH" > /dev/null 2>&1; then
  echo "❌ 场景3失败：期望 exit 0（有效 manual: 内联命令），实际 exit 1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景3通过：manual: 内联命令 → exit 0（有效 Test 字段通过）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景4：DoD 使用 echo 假测试 → 应 exit 1
# ─────────────────────────────────────────────
cat > "$TMPDIR_PATH/dod-fake-echo-test.md" << 'EOF'
# DoD

- [x] 功能正常实现
  Test: manual:echo "测试通过"
EOF

if run_dod_check "$TMPDIR_PATH/dod-fake-echo-test.md" "$TMPDIR_PATH" > /dev/null 2>&1; then
  echo "❌ 场景4失败：期望 exit 1（echo 假测试被禁止），实际 exit 0"
  echo "   check-dod-mapping.cjs 没有正确拦截 echo 假测试"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景4通过：echo 假测试 → exit 1（假测试检测正常）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────
# 场景5：DoD 含未勾选条目 → 应 exit 1
# ─────────────────────────────────────────────
cat > "$TMPDIR_PATH/dod-unchecked.md" << 'EOF'
# DoD

- [x] 已验证的功能
  Test: manual:curl -s http://localhost:5221/api/brain/health | grep -q ok
- [ ] 未验证的功能（应该触发门禁）
  Test: manual:curl -s http://localhost:5221/api/brain/status
EOF

if run_dod_check "$TMPDIR_PATH/dod-unchecked.md" "$TMPDIR_PATH" > /dev/null 2>&1; then
  echo "❌ 场景5失败：期望 exit 1（含未勾选条目），实际 exit 0"
  echo "   check-dod-mapping.cjs 没有正确拦截未验证的 DoD 条目"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "✅ 场景5通过：DoD 含未勾选条目 → exit 1（门禁正常拦截）"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

echo ""
echo "check-dod-mapping.cjs 场景验证: $PASS_COUNT 通过 / $FAIL_COUNT 失败"

[ "$FAIL_COUNT" -eq 0 ] && exit 0 || exit 1
