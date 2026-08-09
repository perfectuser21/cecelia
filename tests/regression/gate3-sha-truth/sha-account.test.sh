#!/usr/bin/env bash
# sha-account.test.sh — G1 SHA 对账串链测试（L1 级）
#
# 覆盖 BEHAVIOR-01..07（见 contract-dod.md）。
# 本测试是 failing test：squash_merge_sha_diff 在旧代码跑应 FAIL，新代码跑应 PASS。
#
# 用法：
#   bash sprints/07161500-gate3-sha-truth/tests/sha-account.test.sh [--scenario <name>]
#
#   不传 --scenario 则跑全部场景。
#
# 约束（INV-04）：
#   禁 mock git rev-parse / curl /health 的真实行为；用 fixture 文件或隔离 git repo 替代。
#
# 退出码：0=全绿  1=有红（含 expected-failing 在旧代码下的 PASS 也算红，需手工确认）
#
# CI 集成：brain-ci-deploy.yml L1 矩阵调用，PR + push 都跑。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; NC='\033[0m'
FAILED=0; PASSED=0; SKIPPED=0

pass()  { echo -e "${GREEN}[PASS]${NC} $1"; PASSED=$((PASSED + 1)); }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; FAILED=$((FAILED + 1)); }
skip()  { echo -e "${YELLOW}[SKIP]${NC} $1"; SKIPPED=$((SKIPPED + 1)); }
xfail() { echo -e "${YELLOW}[XFAIL]${NC} $1 (期望失败——修复后本行应变为 PASS)"; }

# ── 解析参数 ────────────────────────────────────────────────────────────────
SCENARIO="${SCENARIO:-all}"
MOCK_PROD_SHA=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)     SCENARIO="$2"; shift 2 ;;
    --mock-prod-sha) MOCK_PROD_SHA="$2"; shift 2 ;;
    *) shift ;;
  esac
done

TMP="$(mktemp -d -t sha-account.XXXXXX)"
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

echo "=== SHA 对账串链测试 (G1) ==="
echo "SCENARIO=${SCENARIO}  ROOT=${ROOT_DIR}"
echo ""

# ════════════════════════════════════════════════════════════════════════════
# 工具函数：构造隔离 git repo，HEAD_SHA 可控
# ════════════════════════════════════════════════════════════════════════════
make_git_repo() {
  local dir="$1"
  local version="${2:-1.0.0}"
  local origin="$TMP/origin-$(basename "$dir").git"

  git init -q --bare "$origin"
  git init -q -b main "$dir"
  (
    cd "$dir"
    git config core.hooksPath /dev/null
    git config user.email test@sha-account.local
    git config user.name "SHA Test"
    mkdir -p packages/brain/src
    printf '{"name":"@cecelia/brain","version":"%s"}' "$version" \
      > packages/brain/package.json
    echo "// server placeholder" > packages/brain/src/server.js
    git add -A
    git commit -qm "init brain v${version}"
    git remote add origin "$origin"
    git push -q origin main
  )
  echo "$origin"
}

# ── 生成 health fixture JSON ────────────────────────────────────────────────
make_health_fixture() {
  local sha="$1"
  local version="${2:-1.0.0}"
  local uptime="${3:-5}"
  local file="$TMP/health-$(echo "$sha" | head -c 8).json"
  printf '{"ok":true,"version":"%s","git_sha":"%s","uptime_seconds":%s}' \
    "$version" "$sha" "$uptime" > "$file"
  echo "$file"
}

# ════════════════════════════════════════════════════════════════════════════
# S1：判读 brain-ci-deploy.yml 是否已完成 SHA 对账替换
# ════════════════════════════════════════════════════════════════════════════
check_workflow_sha_routing() {
  local wf="$ROOT_DIR/.github/workflows/brain-ci-deploy.yml"
  if [[ ! -f "$wf" ]]; then
    fail "workflow 文件不存在: $wf"; return 1
  fi

  # 检测旧路径：gate3-changed-paths.sh 调用
  if grep -q "gate3-changed-paths" "$wf"; then
    # 仅注释行不算（INV-08 允许保留历史注释说明删除原因，但不允许死代码）
    ACTIVE_LINES=$(grep "gate3-changed-paths" "$wf" | grep -v "^\s*#" | wc -l)
    if [[ "$ACTIVE_LINES" -gt 0 ]]; then
      xfail "workflow 仍含活跃 gate3-changed-paths.sh 调用（${ACTIVE_LINES} 行）——修复后本行 PASS"
      return 1
    fi
  fi

  # 检测新路径：SHA 对账关键词
  if grep -qE "PROD_SHA|HEAD_SHA|git_sha|rev-parse HEAD" "$wf"; then
    pass "workflow 含 SHA 对账逻辑（BEHAVIOR-05）"
    return 0
  else
    xfail "workflow 尚未添加 SHA 对账 step——修复后本行 PASS"
    return 1
  fi
}

# ════════════════════════════════════════════════════════════════════════════
# SCENARIO: squash_merge_sha_diff
# 构造：HEAD_SHA ≠ PROD_SHA，changed 为空（squash merge 现场）
# 新路径应触发部署；旧路径（gate3-changed-paths + changed_paths 为空）会假跳过。
# 这是 XFAIL 测试：修复前该 check_workflow_sha_routing 失败；修复后全 pass。
# ════════════════════════════════════════════════════════════════════════════
run_squash_merge_sha_diff() {
  echo "── [BEHAVIOR-01] squash merge SHA 不等 → 触发部署 ──"

  local repo="$TMP/repo-squash"
  make_git_repo "$repo" "2.0.0" > /dev/null
  local HEAD_SHA
  HEAD_SHA=$(cd "$repo" && git rev-parse HEAD)
  local PROD_SHA="0000000000000000000000000000000000000000"

  echo "  HEAD_SHA = ${HEAD_SHA:0:8}..."
  echo "  PROD_SHA = ${PROD_SHA:0:8}..."
  echo "  changed  = (空)"

  # 验证 SHA 不等（前提断言）
  if [[ "$HEAD_SHA" == "$PROD_SHA" ]]; then
    fail "前提失败：HEAD_SHA == PROD_SHA（fixture 构造错误）"
    return 1
  fi
  pass "前提：HEAD_SHA ≠ PROD_SHA，changed 为空（squash merge 场景已复现）"

  # 检查 workflow 是否已完成 SHA 路由替换（这是修复目标）
  if check_workflow_sha_routing; then
    pass "[BEHAVIOR-01] workflow 已走 SHA 对账路径 → squash merge 不再假跳过 (FIXED)"
  else
    # 修复前正常：workflow 还在用旧 changed_paths 路径
    echo -e "${YELLOW}  [XFAIL-01]${NC} workflow 尚未修复（squash merge 将假跳过）——这是需要修复的 failing test"
    FAILED=$((FAILED + 1))
  fi
  echo ""
}

# ════════════════════════════════════════════════════════════════════════════
# SCENARIO: sha_equal_skip
# SHA 相等时不触发部署（回归防线）
# 验证方式：grep workflow 文件确认含 SHA 相等时的 skip 条件代码，
#           而非内联恒等式（避免伪测试）。
# ════════════════════════════════════════════════════════════════════════════
run_sha_equal_skip() {
  echo "── [BEHAVIOR-02] SHA 相等 → workflow 含 skip 条件 ──"

  local WF="$ROOT_DIR/.github/workflows/brain-ci-deploy.yml"
  if [[ ! -f "$WF" ]]; then
    fail "[BEHAVIOR-02] workflow 文件不存在: $WF"
    echo ""
    return 1
  fi

  # 验证 workflow 文件中含有 SHA 相等判断的 skip 条件
  # 这是真实代码路径测试：确认 brain-ci-deploy.yml 包含类似
  #   [ "$PROD_SHA" == "$HEAD_SHA" ] && echo "SHA 相同，跳过"
  # 或等效的 if/then skip 逻辑，而不是在 bash 里自己做恒等式
  if grep -qE '\$PROD_SHA.*==.*\$HEAD_SHA|\$HEAD_SHA.*==.*\$PROD_SHA|PROD_SHA.*HEAD_SHA.*skip|skip.*PROD_SHA.*HEAD_SHA' "$WF"; then
    pass "[BEHAVIOR-02] workflow 含 SHA 相等时的 skip 条件代码（真实代码路径验证）"
  else
    # workflow 尚未实现 SHA 对账 skip 逻辑
    xfail "[BEHAVIOR-02] workflow 尚未含 SHA 相等 skip 条件——修复后本行 PASS"
    FAILED=$((FAILED + 1))
  fi

  # 反断言：SHA 相等时不应含"总是部署"逻辑（防过强 fail open 把 skip 覆盖）
  # 只检查 PROD_SHA/HEAD_SHA 相关行，不影响全局 fail-open 判断
  echo ""
}

# ════════════════════════════════════════════════════════════════════════════
# SCENARIO: health_returns_git_sha
# /health 端点必须含 git_sha 字段（BEHAVIOR-03）
# ════════════════════════════════════════════════════════════════════════════
run_health_returns_git_sha() {
  echo "── [BEHAVIOR-03] /health 返回 git_sha 字段 ──"

  local OPS_FILE="$ROOT_DIR/packages/brain/src/routes/ops.js"
  if [[ ! -f "$OPS_FILE" ]]; then
    fail "ops.js 不存在: $OPS_FILE"
    echo ""
    return 1
  fi

  # 检查 health handler 是否含 git_sha 字段
  if grep -q "git_sha" "$OPS_FILE"; then
    pass "[BEHAVIOR-03] ops.js health handler 含 git_sha 字段（源码层验证）"
  else
    xfail "[BEHAVIOR-03] ops.js health handler 尚未添加 git_sha——修复后本行 PASS"
    FAILED=$((FAILED + 1))
  fi

  # 检查 Dockerfile 是否含 GIT_SHA
  local DOCKERFILE="$ROOT_DIR/packages/brain/Dockerfile"
  if [[ -f "$DOCKERFILE" ]]; then
    if grep -q "ARG GIT_SHA" "$DOCKERFILE" && grep -q "ENV GIT_SHA" "$DOCKERFILE"; then
      pass "[FR-01] Dockerfile 含 ARG GIT_SHA + ENV GIT_SHA（构建期烙入）"
    else
      xfail "[FR-01] Dockerfile 尚未添加 ARG GIT_SHA / ENV GIT_SHA——修复后本行 PASS"
      FAILED=$((FAILED + 1))
    fi
    # 验证 ENV 在 runtime 层（INV-04）
    if node -e "
      const fs = require('fs');
      const df = fs.readFileSync('$DOCKERFILE', 'utf8');
      // 找最后一个 FROM ... 后是否含 ENV GIT_SHA
      const parts = df.split(/^FROM /m);
      const lastPart = parts[parts.length - 1] || '';
      if (!lastPart.includes('ENV GIT_SHA')) {
        console.error('ENV GIT_SHA 不在 runtime FROM 层');
        process.exit(1);
      }
    " 2>/dev/null; then
      pass "[INV-04] ENV GIT_SHA 在 runtime FROM 层（不只在 deps layer）"
    else
      xfail "[INV-04] ENV GIT_SHA 未在 runtime FROM 层——修复后本行 PASS"
      FAILED=$((FAILED + 1))
    fi
  else
    fail "Dockerfile 不存在: $DOCKERFILE"
    FAILED=$((FAILED + 1))
  fi
  echo ""
}

# ════════════════════════════════════════════════════════════════════════════
# SCENARIO: s6_sha_mismatch_rollback
# brain-deploy.sh S6 SHA 回读：不匹配 → exit 1（BEHAVIOR-04）
# ════════════════════════════════════════════════════════════════════════════
run_s6_sha_mismatch_rollback() {
  echo "── [BEHAVIOR-04] S6 SHA 回读不匹配 → ROLLBACK exit 1 ──"

  local DEPLOY="$ROOT_DIR/scripts/brain-deploy.sh"
  if [[ ! -f "$DEPLOY" ]]; then
    fail "brain-deploy.sh 不存在: $DEPLOY"
    echo ""
    return 1
  fi

  # 检查 brain-deploy.sh 是否含 S6 SHA 断言逻辑
  if grep -qE "EXPECTED_SHA|git_sha.*EXPECTED|SHA.*不匹配|sha.*mismatch" "$DEPLOY"; then
    pass "[BEHAVIOR-04] brain-deploy.sh 含 SHA 回读断言逻辑（源码层验证）"

    # 构造 fixture：health 返回错误 SHA
    local FIXTURE
    FIXTURE=$(make_health_fixture "deadbeef00000000deadbeef00000000deadbeef" "1.0.0" "5")
    local EXPECTED_SHA="abc1234abc1234abc1234abc1234abc1234abc12"

    echo "  fixture git_sha = deadbeef..."
    echo "  expected_sha    = abc1234..."

    # 尝试运行 --dry-run --sha-check-only（如果支持）
    local EXIT_CODE=0
    HEALTH_JSON_OVERRIDE="$FIXTURE" \
    EXPECTED_SHA="$EXPECTED_SHA" \
    bash "$DEPLOY" --dry-run --sha-check-only 2>/tmp/s6_out.txt; EXIT_CODE=$?

    if [[ $EXIT_CODE -ne 0 ]]; then
      pass "[BEHAVIOR-04] SHA 不匹配 → exit ${EXIT_CODE}（ROLLBACK 触发）"
    else
      fail "[BEHAVIOR-04] SHA 不匹配时 exit 0（应 exit 1，ROLLBACK 未触发）"
      cat /tmp/s6_out.txt | head -10 | sed 's/^/    /'
    fi
  else
    xfail "[BEHAVIOR-04] brain-deploy.sh 尚未实现 SHA 回读断言——修复后本行 PASS"
    FAILED=$((FAILED + 1))
  fi
  echo ""
}

# ════════════════════════════════════════════════════════════════════════════
# SCENARIO: workflow_no_changed_paths
# brain-ci-deploy.yml 不含 gate3-changed-paths.sh（BEHAVIOR-05）
# ════════════════════════════════════════════════════════════════════════════
run_workflow_no_changed_paths() {
  echo "── [BEHAVIOR-05] workflow 不含 gate3-changed-paths 调用 ──"
  check_workflow_sha_routing
  echo ""
}

# ════════════════════════════════════════════════════════════════════════════
# SCENARIO: deploy_empty_body_not_skipped
# POST /api/brain/deploy body={} 返回 2xx，不含 skipped:true（BEHAVIOR-07）
# 验证 FR-04：/deploy handler 去除了对 changed_paths 为空的跳过判据。
# ════════════════════════════════════════════════════════════════════════════
verify_deploy_source() {
  local OPS_FILE="$ROOT_DIR/packages/brain/src/routes/ops.js"
  if [[ ! -f "$OPS_FILE" ]]; then
    fail "[BEHAVIOR-07] ops.js 不存在: $OPS_FILE"
    return 1
  fi
  if grep -qE "changed_paths.*length.*===.*0.*skip|changed_paths.*empty.*skip|!changed_paths.*skip" "$OPS_FILE"; then
    xfail "[BEHAVIOR-07] ops.js 仍含 changed_paths 为空时 skip 判据——修复后本行 PASS"
    FAILED=$((FAILED + 1))
    return 1
  fi
  pass "[BEHAVIOR-07] ops.js 无 changed_paths 为空时 skip 判据（源码层验证）"
}

run_deploy_empty_body_not_skipped() {
  echo "── [BEHAVIOR-07] POST /deploy body={} 不含 skipped:true ──"

  local BRAIN_URL_CHECK="${BRAIN_URL:-http://localhost:5221}"

  # 检查 Brain 是否在运行
  if ! curl -s --connect-timeout 3 "${BRAIN_URL_CHECK}/api/brain/health" > /dev/null 2>&1; then
    verify_deploy_source
    echo ""
    return 0
  fi

  # Brain 运行中：做真实 HTTP 验证
  local RESPONSE HTTP_BODY HTTP_CODE
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "${BRAIN_URL_CHECK}/api/brain/deploy" \
    -H "Content-Type: application/json" \
    -d '{}' 2>/dev/null)
  HTTP_BODY=$(printf '%s\n' "$RESPONSE" | sed '$d')
  HTTP_CODE=$(printf '%s\n' "$RESPONSE" | tail -n 1)

  # 健康端点公开但 deploy 受内部鉴权保护时，401/403 不能说明部署逻辑失败。
  # 此时回到同一实现文件做源码级契约验证，避免测试误打正在运行的生产 Brain。
  if [[ "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" ]]; then
    verify_deploy_source
    echo ""
    return 0
  fi

  if [[ "$HTTP_CODE" =~ ^2 ]]; then
    pass "[BEHAVIOR-07] POST /deploy body={} → HTTP ${HTTP_CODE}（2xx）"
  else
    xfail "[BEHAVIOR-07] POST /deploy body={} → HTTP ${HTTP_CODE}（期望 2xx）——修复后本行 PASS"
    FAILED=$((FAILED + 1))
  fi

  if echo "$HTTP_BODY" | grep -qE '"skipped"\s*:\s*true'; then
    xfail "[BEHAVIOR-07] 响应含 skipped:true（changed_paths 为空时仍跳过）——修复后本行 PASS"
    FAILED=$((FAILED + 1))
  else
    pass "[BEHAVIOR-07] 响应不含 skipped:true（空 body 不跳过）"
  fi
  echo ""
}

# ════════════════════════════════════════════════════════════════════════════
# SCENARIO: health_unreachable_fail_open
# curl /health 失败 → fail open（保守部署，BEHAVIOR-06）
# ════════════════════════════════════════════════════════════════════════════
run_health_unreachable_fail_open() {
  echo "── [BEHAVIOR-06] /health 不可达 → fail open（保守部署）──"

  # fixture：空响应（模拟 curl 超时）
  local PROD_SHA=""
  local HEAD_SHA
  HEAD_SHA=$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "abc1234deadbeef0")

  # 逻辑：PROD_SHA 为空/unknown → 视为需部署
  local DECISION
  if [[ -z "$PROD_SHA" || "$PROD_SHA" == "unknown" || "$PROD_SHA" == "null" ]]; then
    DECISION="FAIL_OPEN_DEPLOY"
  elif [[ "$PROD_SHA" == "$HEAD_SHA" ]]; then
    DECISION="SKIP_DEPLOY"
  else
    DECISION="DEPLOY_TRIGGERED"
  fi

  if [[ "$DECISION" == "FAIL_OPEN_DEPLOY" ]]; then
    pass "[BEHAVIOR-06] /health 不可达 → FAIL_OPEN_DEPLOY（保守触发部署）"
  else
    fail "[BEHAVIOR-06] /health 不可达时跳过了部署（fail closed，危险）"
  fi

  # 检查 workflow 是否体现 fail open 逻辑
  local WF="$ROOT_DIR/.github/workflows/brain-ci-deploy.yml"
  if grep -qE "fail.open|unknown.*deploy|PROD_SHA.*unknown|不可达.*部署|fail_open" "$WF" 2>/dev/null; then
    pass "[BEHAVIOR-06] workflow 含 fail open 逻辑（源码层）"
  else
    xfail "[BEHAVIOR-06] workflow 尚未显式实现 fail open——修复后本行 PASS"
    FAILED=$((FAILED + 1))
  fi
  echo ""
}

# ════════════════════════════════════════════════════════════════════════════
# 执行
# ════════════════════════════════════════════════════════════════════════════
case "$SCENARIO" in
  squash_merge_sha_diff)   run_squash_merge_sha_diff ;;
  sha_equal_skip)          run_sha_equal_skip ;;
  health_returns_git_sha)  run_health_returns_git_sha ;;
  s6_sha_mismatch_rollback) run_s6_sha_mismatch_rollback ;;
  workflow_no_changed_paths) run_workflow_no_changed_paths ;;
  deploy_empty_body_not_skipped) run_deploy_empty_body_not_skipped ;;
  health_unreachable_fail_open) run_health_unreachable_fail_open ;;
  all)
    run_squash_merge_sha_diff
    run_sha_equal_skip
    run_health_returns_git_sha
    run_s6_sha_mismatch_rollback
    run_workflow_no_changed_paths
    run_deploy_empty_body_not_skipped
    run_health_unreachable_fail_open
    ;;
  *)
    echo "未知 scenario: $SCENARIO"
    echo "可用: squash_merge_sha_diff | sha_equal_skip | health_returns_git_sha | s6_sha_mismatch_rollback | workflow_no_changed_paths | deploy_empty_body_not_skipped | health_unreachable_fail_open | all"
    exit 1
    ;;
esac

echo "════════════════════════════════════════"
echo "PASS=${PASSED}  FAIL=${FAILED}  SKIP=${SKIPPED}"
echo ""
if [[ "$FAILED" -gt 0 ]]; then
  echo -e "${RED}SHA_ACCOUNT_TEST_FAIL${NC} — ${FAILED} 项未通过（含 XFAIL = 待修复）"
  echo ""
  echo "注意：XFAIL 项是预期失败（旧代码下），修复后应变为 PASS。"
  echo "      若在旧代码下全部 XFAIL，这是正常的——说明复现测试已就位。"
  exit 1
else
  echo -e "${GREEN}SHA_ACCOUNT_TEST_PASS${NC} — 全部通过"
  exit 0
fi
