#!/usr/bin/env bash
# DoD Verification: longform-creator Step 5.5
# Tests that SKILL.md contains required Step 5.5 content

set -e
SKILL="packages/workflows/skills/longform-creator/SKILL.md"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local pattern="$2"
  if grep -q "$pattern" "$SKILL"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (pattern: $pattern)"
    FAIL=$((FAIL + 1))
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DoD Test: longform-creator Step 5.5"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

check "SKILL.md 包含 Step 5.5 章节" "Step 5\.5"
check "Step 5.5 包含 INSERT INTO zenithjoy.works" "INSERT INTO zenithjoy\.works"
check "Step 5.5 包含 psql 命令" "psql"
check "Step 5.5 包含 content_id 字段" "content_id"
check "Step 5.5 包含 ON CONFLICT 幂等处理" "ON CONFLICT"
check "Step 5.5 包含 POSTGRES_PASSWORD 环境变量" "POSTGRES_PASSWORD"

# 验证 Step 5.5 在 Step 5 和 Step 6 之间
node -e "
const s = require('fs').readFileSync('$SKILL', 'utf8');
const i5 = s.indexOf('### Step 5 —');
const i55 = s.indexOf('Step 5.5');
const i6 = s.indexOf('### Step 6 —');
if (i5 < 0 || i55 < 0 || i6 < 0) { console.log('  FAIL: 章节索引错误'); process.exit(1); }
if (i5 < i55 && i55 < i6) { console.log('  PASS: Step 5.5 在 Step 5 和 Step 6 之间'); }
else { console.log('  FAIL: Step 5.5 顺序不正确 (i5=' + i5 + ' i55=' + i55 + ' i6=' + i6 + ')'); process.exit(1); }
" && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  FAILED"
  exit 1
else
  echo "  ALL PASSED"
fi
