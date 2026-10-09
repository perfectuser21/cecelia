#!/usr/bin/env bash
# no-dockerhub-pull.test.sh — CI 不直接从 Docker Hub 拉镜像
#
# 2026-10-10 05:00 起 GitHub 共享 runner 未登录拉 Docker Hub（pgvector/pgvector:pg15、node:20-alpine）
# 连续 toomanyrequests，real-env-smoke / Smoke Glob Runner 等 job 全红、所有 PR 卡死（Brain 任务 7294cf3a）。
# 仓库没有 Docker Hub 凭据；改为从 mirror.gcr.io（Docker Hub 的 Google 拉取缓存，同一份镜像）拉。
# 守卫：workflow 的 image: 与 CI 构建用的 Dockerfile FROM 必须带允许的镜像源前缀，裸名（隐含 docker.io）或 docker.io 一律拒。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ALLOWED='^(mirror\.gcr\.io|ghcr\.io|public\.ecr\.aws|gcr\.io)/'
FAIL=0

check() {
  local where="$1" ref="$2"
  ref="${ref%\"}"; ref="${ref#\"}"; ref="${ref%\'}"; ref="${ref#\'}"
  case "$ref" in
    \$\{\{*|scratch|'') return 0 ;;  # 表达式 / scratch / 空不查
  esac
  if ! printf '%s' "$ref" | grep -qE "$ALLOWED"; then
    echo "FAIL: ${where} 直接从 Docker Hub 拉：${ref}（改成 mirror.gcr.io/<原路径>，官方镜像用 mirror.gcr.io/library/<名>）"
    FAIL=$((FAIL + 1))
  fi
}

while IFS= read -r line; do
  file="${line%%:*}"; rest="${line#*:}"; lineno="${rest%%:*}"; content="${rest#*:}"
  ref=$(printf '%s' "$content" | sed -E 's/^[[:space:]]*-?[[:space:]]*image:[[:space:]]*//' | awk '{print $1}')
  check "${file#"$ROOT"/}:$lineno" "$ref"
done < <(grep -nE '^[[:space:]]*-?[[:space:]]*image:[[:space:]]*[^[:space:]]' "$ROOT"/.github/workflows/*.yml || true)

for df in "$ROOT"/packages/brain/Dockerfile; do
  while IFS= read -r line; do
    lineno="${line%%:*}"; content="${line#*:}"
    ref=$(printf '%s' "$content" | awk '{print $2}')
    check "${df#"$ROOT"/}:$lineno" "$ref"
  done < <(grep -nE '^FROM[[:space:]]' "$df" || true)
done

if [ "$FAIL" -gt 0 ]; then
  echo "Results: FAIL=$FAIL"
  exit 1
fi
echo "PASS: CI 镜像全部来自允许的镜像源（不直连 Docker Hub）"
