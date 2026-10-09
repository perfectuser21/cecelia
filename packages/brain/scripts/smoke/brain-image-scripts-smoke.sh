#!/usr/bin/env bash
# brain-image-scripts-smoke.sh — Brain 镜像必须携带 packages/brain/scripts/sync-steps-from-workspace.mjs
#
# 触发条件：09-30 生产 sync（任务 8345a8dc）发现 #5705 新增的 sync-steps-from-workspace.mjs 不在镜像里
#（Dockerfile 只按白名单 COPY），上产靠手工 docker cp 进容器，下次部署即丢（任务 b2bba893）。
# 验证（源码层，不建镜像）：Dockerfile 有一条 COPY 把该脚本落到 /app/scripts/；两条既有 scripts/lib COPY 未丢；脚本源文件存在。
#
# 用法：bash packages/brain/scripts/smoke/brain-image-scripts-smoke.sh
# 退出码：0=通过  1=失败

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILED=0
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAILED=$((FAILED + 1)); }

echo "=== Brain Image Scripts Smoke (任务 b2bba893) ==="
echo ""

DOCKERFILE="$ROOT_DIR/packages/brain/Dockerfile"
SYNC_SRC="$ROOT_DIR/packages/brain/scripts/sync-steps-from-workspace.mjs"

if [[ ! -f "$DOCKERFILE" ]]; then
  fail "Dockerfile 不存在: $DOCKERFILE"
else
  # 只认未注释的 COPY 指令；目标必须落到 ./scripts/（容器内 /app/scripts/）
  if grep -Eq '^COPY[[:space:]]+packages/brain/scripts/sync-steps-from-workspace\.mjs[[:space:]]+\./scripts/' "$DOCKERFILE"; then
    pass "Dockerfile COPY sync-steps-from-workspace.mjs → ./scripts/（镜像内 /app/scripts/ 可直接 docker exec 跑）"
  else
    fail "Dockerfile 未 COPY packages/brain/scripts/sync-steps-from-workspace.mjs → ./scripts/（上产只能手工 docker cp，下次部署即丢）"
  fi
  if grep -Eq '^COPY[[:space:]]+scripts/lib/test-contract-paths\.cjs[[:space:]]+\./scripts/lib/' "$DOCKERFILE" \
     && grep -Eq '^COPY[[:space:]]+scripts/extract-contract-e2e\.cjs[[:space:]]+\./scripts/' "$DOCKERFILE"; then
    pass "既有 scripts/lib/test-contract-paths.cjs 与 scripts/extract-contract-e2e.cjs 两条 COPY 仍在"
  else
    fail "既有 scripts/lib COPY 被弄丢（封印闸依赖，Brain 启动即死）"
  fi
fi

if [[ -f "$SYNC_SRC" ]]; then
  pass "源文件存在: packages/brain/scripts/sync-steps-from-workspace.mjs"
else
  fail "源文件不存在: $SYNC_SRC（COPY 会让镜像构建失败）"
fi

echo ""
if [[ $FAILED -gt 0 ]]; then
  echo -e "${RED}✗ $FAILED 项失败${NC}"
  exit 1
fi
echo -e "${GREEN}✓ brain-image-scripts-smoke 全部通过${NC}"
exit 0
