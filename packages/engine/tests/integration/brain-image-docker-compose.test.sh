#!/usr/bin/env bash
# brain-image-docker-compose.test.sh — 验证 Brain image 含 docker compose plugin
#
# 修复 webhook deploy 一直 fail 的根因（PR #2789 log 落盘后才看清）：
#   container 内 docker CLI 缺 compose subcommand → brain-deploy.sh 调
#   `docker compose -f docker-compose.yml up -d` 报 "unknown shorthand flag: 'f' in -f"
#
# 验证：
#   1. Dockerfile apk add 含 docker-cli-compose
#   2. （可选 BUILD_IMAGE=1）真 build image + docker run 验证 docker compose 子命令可用

set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DOCKERFILE="$REPO_ROOT/packages/brain/Dockerfile"

# Test 1: Dockerfile apk install 含 docker-cli-compose
if grep -qE 'apk add.*docker-cli-compose' "$DOCKERFILE"; then
    pass "Dockerfile apk add 含 docker-cli-compose"
else
    fail "Dockerfile apk add 缺 docker-cli-compose"
fi

# Test 2: 跟原有 docker-cli 在同一 RUN 里（不分两次 apk add 造成 layer 浪费）
if grep -qE 'apk add.*docker-cli .*docker-cli-compose|apk add.*docker-cli-compose.*docker-cli' "$DOCKERFILE" 2>/dev/null \
   || grep -qE 'docker-cli docker-cli-compose|docker-cli-compose docker-cli' "$DOCKERFILE"; then
    pass "docker-cli + docker-cli-compose 同一 apk add"
else
    fail "docker-cli-compose 应跟 docker-cli 同一 apk add（共享 layer）"
fi

# Test 3: 不动 stage 1 (deps) — 只动 runtime stage
DEPS_LINE=$(grep -n "FROM node:20-alpine AS deps" "$DOCKERFILE" | head -1 | cut -d: -f1)
RUNTIME_LINE=$(grep -n "^FROM node:20-alpine$" "$DOCKERFILE" | head -1 | cut -d: -f1)
COMPOSE_LINE=$(grep -n "docker-cli-compose" "$DOCKERFILE" | head -1 | cut -d: -f1)

if [[ -n "$RUNTIME_LINE" ]] && [[ "$COMPOSE_LINE" -gt "$RUNTIME_LINE" ]]; then
    pass "docker-cli-compose 在 runtime stage（不污染 deps stage）"
else
    fail "docker-cli-compose 位置错（应在 runtime stage 之后）"
fi

# Test 4 (可选): 真 build image + 验证 docker compose version 可执行
if [[ "${BUILD_IMAGE:-0}" == "1" ]]; then
    echo ""
    echo "=== BUILD_IMAGE=1 真 build image 验证 docker compose 子命令 ==="
    TEST_TAG="cecelia-brain:test-compose-plugin"
    if docker build -q -t "$TEST_TAG" -f "$DOCKERFILE" "$REPO_ROOT" >/dev/null 2>&1; then
        if docker run --rm "$TEST_TAG" docker compose version 2>&1 | grep -qiE 'compose|v[0-9]'; then
            pass "真 image 内 docker compose version 可执行"
        else
            fail "真 image 内 docker compose 仍失败"
        fi
        docker rmi "$TEST_TAG" >/dev/null 2>&1 || true
    else
        fail "image build 失败"
    fi
else
    echo "ℹ️  跳过 Test 4（BUILD_IMAGE=1 启用真 build 验证，本地 ~1min CI 跳过）"
fi

echo ""
echo "=== brain-image-docker-compose: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
