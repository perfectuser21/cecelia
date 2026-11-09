#!/usr/bin/env bash
# sha-account.test.sh — G1 SHA 对账串链测试（L1 级）
#
# 保留现役 BEHAVIOR-03/04/07，旧工作流专属场景随入口清退。
#
# 用法：
#   BRAIN_URL=http://127.0.0.1:1 bash tests/regression/gate3-sha-truth/sha-account.test.sh [--scenario <name>]
#
#   不传 --scenario 则跑全部场景。
#
# 约束（INV-04）：
#   禁 mock git rev-parse / curl /health 的真实行为；用 fixture 文件或隔离 git repo 替代。
#
# 退出码：0=全绿  1=有红（含 expected-failing 在旧代码下的 PASS 也算红，需手工确认）
#
# CI 调用者： packages/brain/tests/gate3-sha-account.test.js

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
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)     SCENARIO="$2"; shift 2 ;;
    *) shift ;;
  esac
done

TMP="$(mktemp -d -t sha-account.XXXXXX)"
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

echo "=== SHA 对账串链测试 (G1) ==="
echo "SCENARIO=${SCENARIO}  ROOT=${ROOT_DIR}"
echo ""

make_health_fixture() {
  local sha="$1"
  local version="${2:-1.0.0}"
  local uptime="${3:-5}"
  local file="$TMP/health-$(echo "$sha" | head -c 8).json"
  printf '{"ok":true,"version":"%s","git_sha":"%s","uptime_seconds":%s}' \
    "$version" "$sha" "$uptime" > "$file"
  echo "$file"
}

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

  # 运行原部署脚本和原 helper；正常发布 fixture 不继承源码自举标记。
  local DEPLOY_ROOT="$TMP/sha-deploy"
  mkdir -p "$DEPLOY_ROOT/scripts/lib" "$DEPLOY_ROOT/packages/brain" \
    || { fail "创建部署 fixture 失败"; return 1; }
  cp "$DEPLOY" "$DEPLOY_ROOT/scripts/brain-deploy.sh" \
    || { fail "复制原部署脚本失败"; return 1; }
  local helper
  for helper in bluegreen.sh url-encode.sh internal-auth-token.sh brain-image-retention.sh brain-staging.sh; do
    cp "$ROOT_DIR/scripts/lib/$helper" "$DEPLOY_ROOT/scripts/lib/$helper" \
      || { fail "复制原 helper 失败：$helper"; return 1; }
  done
  printf '{"name":"@cecelia/brain","version":"9.9.9"}\n' > "$DEPLOY_ROOT/packages/brain/package.json" \
    || { fail "写入正常发布 fixture 失败"; return 1; }
  DEPLOY="$DEPLOY_ROOT/scripts/brain-deploy.sh"

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
    CECELIA_IMAGE_DEPLOYMENT_ID= HEALTH_JSON_OVERRIDE="$FIXTURE" \
    EXPECTED_SHA="$EXPECTED_SHA" \
    bash "$DEPLOY" --dry-run --sha-check-only >"$TMP/s6_out.txt" 2>&1; EXIT_CODE=$?

    if [[ $EXIT_CODE -eq 1 ]] && grep -Fq "SHA 不匹配：EXPECTED=${EXPECTED_SHA} ACTUAL=deadbeef00000000deadbeef00000000deadbeef" "$TMP/s6_out.txt"; then
      pass "[BEHAVIOR-04] 真实 SHA 不匹配 → exit 1（回读原因已核对）"
    else
      fail "[BEHAVIOR-04] 未抵达真实 SHA 不匹配断言（exit=${EXIT_CODE}）"
      cat "$TMP/s6_out.txt" | head -10 | sed 's/^/    /'
    fi
    # 正例必须真正读到相同 SHA，不能把任意提前退出当成错 SHA 验证成功。
    FIXTURE=$(make_health_fixture "$EXPECTED_SHA" "1.0.0" "5")
    EXIT_CODE=0
    CECELIA_IMAGE_DEPLOYMENT_ID= HEALTH_JSON_OVERRIDE="$FIXTURE" EXPECTED_SHA="$EXPECTED_SHA" \
      bash "$DEPLOY" --dry-run --sha-check-only >"$TMP/s6_match.txt" 2>&1 || EXIT_CODE=$?
    if [[ "$EXIT_CODE" -eq 0 ]] && grep -Fq "[SHA-CHECK] ✅ SHA 一致：${EXPECTED_SHA}" "$TMP/s6_match.txt"; then
      pass "[BEHAVIOR-04] 正常 fixture 同 SHA 真实读回通过"
    else
      fail "[BEHAVIOR-04] 正常 fixture 同 SHA 未通过真实读回"
    fi

    printf '{"version":"9.9.9","cecelia_source_only":false}\n' > "$DEPLOY_ROOT/packages/brain/package.json" \
      || { fail "写入 source-only fixture 失败"; return 1; }
    EXIT_CODE=0
    CECELIA_IMAGE_DEPLOYMENT_ID= HEALTH_JSON_OVERRIDE="$FIXTURE" EXPECTED_SHA="$EXPECTED_SHA" \
      bash "$DEPLOY" --dry-run --sha-check-only >"$TMP/s6_marked.txt" 2>&1 || EXIT_CODE=$?
    if [[ "$EXIT_CODE" -eq 1 ]] && [[ "$(cat "$TMP/s6_marked.txt")" == 'SOURCE_ONLY_PRODUCTION_FORBIDDEN' ]]; then
      pass "[BEHAVIOR-04] source-only fixture 即使同 SHA 也在回读前拒绝"
    else
      fail "[BEHAVIOR-04] source-only fixture 被同 SHA 绕过或拒绝原因错误"
    fi
  else
    xfail "[BEHAVIOR-04] brain-deploy.sh 尚未实现 SHA 回读断言——修复后本行 PASS"
    FAILED=$((FAILED + 1))
  fi
  echo ""
}

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

case "$SCENARIO" in
  health_returns_git_sha)  run_health_returns_git_sha ;;
  s6_sha_mismatch_rollback) run_s6_sha_mismatch_rollback ;;
  deploy_empty_body_not_skipped) run_deploy_empty_body_not_skipped ;;
  all)
    run_health_returns_git_sha
    run_s6_sha_mismatch_rollback
    run_deploy_empty_body_not_skipped
    ;;
  *)
    echo "未知 scenario: $SCENARIO"
    echo "可用: health_returns_git_sha | s6_sha_mismatch_rollback | deploy_empty_body_not_skipped | all"
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
