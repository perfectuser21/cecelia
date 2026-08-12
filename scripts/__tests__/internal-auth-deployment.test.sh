#!/usr/bin/env bash
set -uo pipefail

ERRORS=0
PASS=0
pass() { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS + 1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
HELPER="$REPO_ROOT/scripts/lib/internal-auth-token.sh"
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/internal-auth-deploy.XXXXXX")
trap 'rm -rf "$TMPD"' EXIT

if [[ -f "$HELPER" ]]; then
  pass "内部鉴权 token helper 存在"
else
  fail "缺少内部鉴权 token helper"
fi

ENV_FILE="$TMPD/brain.env"
printf '%s\n' 'DB_NAME=cecelia' > "$ENV_FILE"
if [[ -f "$HELPER" ]] && bash -c 'source "$1"; ensure_cecelia_internal_token "$2"' _ "$HELPER" "$ENV_FILE"; then
  TOKEN=$(sed -n 's/^CECELIA_INTERNAL_TOKEN=//p' "$ENV_FILE")
  MODE=$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")
  if [[ "$TOKEN" =~ ^[0-9a-f]{64}$ && "$MODE" == 600 ]]; then
    pass "部署 helper 原子生成 64hex token 并收紧文件权限"
  else
    fail "生成 token 的格式或权限错误(mode=$MODE)"
  fi
else
  fail "部署 helper 无法生成 token"
fi

BEFORE=$(sed -n 's/^CECELIA_INTERNAL_TOKEN=//p' "$ENV_FILE")
if [[ -f "$HELPER" ]] && bash -c 'source "$1"; ensure_cecelia_internal_token "$2"' _ "$HELPER" "$ENV_FILE"; then
  AFTER=$(sed -n 's/^CECELIA_INTERNAL_TOKEN=//p' "$ENV_FILE")
  if [[ "$BEFORE" == "$AFTER" && $(grep -c '^CECELIA_INTERNAL_TOKEN=' "$ENV_FILE") -eq 1 ]]; then
    pass "重复部署复用同一 token 且不产生重复键"
  else
    fail "重复部署改写或重复追加 token"
  fi
else
  fail "重复部署 token helper 失败"
fi

if grep -q 'ensure_cecelia_internal_token.*CECELIA_INTERNAL_ENV_FILE' "$REPO_ROOT/scripts/brain-deploy.sh" \
  && grep -q -- '-e CECELIA_INTERNAL_TOKEN' "$REPO_ROOT/scripts/brain-deploy.sh"; then
  pass "生产部署在蓝绿启动前确保并显式传递 token"
else
  fail "生产蓝绿部署没有闭环内部 token"
fi

if grep -q 'assert-internal-auth-ready.sh' "$REPO_ROOT/.github/workflows/brain-ci-deploy.yml"; then
  pass "Gate 3 校验生产容器真实启用内部鉴权"
else
  fail "Gate 3 只验版本与重启，仍会放过未注入 token 的容器"
fi

if grep -q -- '-e "CECELIA_INTERNAL_ENV_FILE=' "$REPO_ROOT/scripts/lib/bluegreen.sh" \
  && grep -q -- ':${CECELIA_INTERNAL_ENV_FILE}:ro' "$REPO_ROOT/scripts/lib/bluegreen.sh"; then
  pass "蓝绿 sidecar 挂载并转发共享凭据 SSOT"
else
  fail "蓝绿 sidecar 无法读取宿主凭据 SSOT，Compose 会静默丢失 token"
fi

if grep -q 'ensure_cecelia_internal_token.*CECELIA_INTERNAL_ENV_FILE' "$REPO_ROOT/scripts/staging-deploy.sh"; then
  pass "staging 部署确保共享 SSOT token"
else
  fail "staging 部署没有闭环内部 token"
fi

if grep -q 'cecelia-internal.env' "$REPO_ROOT/docker-compose.yml" \
  && grep -q 'cecelia-internal.env' "$REPO_ROOT/scripts/scan/run-all-scans.sh"; then
  pass "生产 Compose 与跨 checkout cron 共享同一 credentials SSOT"
else
  fail "Compose 与 cron 的内部 token 来源仍可能按 checkout 分叉"
fi

if grep -q '^CECELIA_INTERNAL_TOKEN=' "$REPO_ROOT/.env.docker.example"; then
  pass "环境模板声明内部 token 合同"
else
  fail "环境模板缺少内部 token 合同"
fi

if grep -q 'brainInternalAuthHeaders' "$REPO_ROOT/packages/engine/skills/dev/scripts/init-journey.js" \
  && grep -q 'brainInternalAuthHeaders' "$REPO_ROOT/packages/engine/skills/dev/scripts/add-feature.js" \
  && grep -q 'brainInternalAuthHeaders' "$REPO_ROOT/packages/engine/skills/dev/scripts/thicken.js" \
  && grep -q 'brainAuthHeaders' "$REPO_ROOT/scripts/notion-create-issue.js" \
  && grep -q 'brainAuthHeaders' "$REPO_ROOT/packages/brain/scripts/apply-anchors.mjs"; then
  pass "受信任宿主写客户端统一附带内部凭据"
else
  fail "仍有宿主写客户端未附带内部凭据"
fi

if grep -q 'brainAuthHeaders' "$REPO_ROOT/scripts/map/product-map-adapter.mjs" \
  && grep -q -- "--submit" "$REPO_ROOT/scripts/map/product-map-adapter.mjs" \
  && grep -q -- "--submit" "$REPO_ROOT/packages/workflows/skills/capability-mapper/SKILL.md" \
  && ! sed -n '/### Step 5/,/拍板前绝不提交/p' \
    "$REPO_ROOT/packages/workflows/skills/capability-mapper/SKILL.md" \
    | grep -q 'curl .*api/brain/map/manifests'; then
  pass "Capability Mapper 只经受信宿主 adapter 提交，不向 Runner 下发通用 token"
else
  fail "Capability Mapper 仍存在匿名写入或缺少受信提交入口"
fi

if grep -q -- '- NODE_ENV=production' "$REPO_ROOT/docker-compose.yml" \
  && grep -q -- '- NODE_ENV=production' "$REPO_ROOT/docker-compose.staging.yml"; then
  pass "production/staging 明确启用漏配 token 的 fail-closed 模式"
else
  fail "生产 Compose 未声明 NODE_ENV=production，漏配 token 时代理可伪装 loopback"
fi

ACTIVATION_CALLS=$(grep -c '^[[:space:]]*activate_cecelia_map_manifest$' \
  "$REPO_ROOT/scripts/brain-deploy.sh" 2>/dev/null || true)
if grep -q '^activate_cecelia_map_manifest()' "$REPO_ROOT/scripts/brain-deploy.sh" \
  && grep -q 'packages/brain/config/map-manifests/cecelia.v1.json' "$REPO_ROOT/scripts/brain-deploy.sh" \
  && [[ "$ACTIVATION_CALLS" -ge 2 ]]; then
  pass "生产部署与同镜像幂等重跑都强制提交并激活 Cecelia Map manifest"
else
  fail "部署完成后路径归属 manifest 没有自动激活，Impact Gate 会继续使用旧投影"
fi

echo ""
echo "结果: $PASS passed, $ERRORS failed"
exit "$ERRORS"
