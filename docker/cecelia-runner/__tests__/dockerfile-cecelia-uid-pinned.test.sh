#!/usr/bin/env bash
# Regression: 08-11 实证——playwright install --with-deps webkit（Dockerfile 早于
# useradd 执行）会在系统 UID 段新增账户，useradd -r（动态分配）把 cecelia 的
# UID 从历史值 999 挤到 997。attempt-runner.cjs 的 --tmpfs 挂载对 .codex /
# .config/gh 硬编码固定 uid/gid；非 evaluator 角色容器无 --user root 可自愈，
# 直接以镜像默认（漂移后的）UID 启动，凭据目录属主对不上，GitHub 凭据 FIFO
# 写入失败（attempt_github_credential_fifo_write_failed），本机 harness 派发瘫痪。
#
# 本测试断言 Dockerfile 显式钉死 cecelia 的 UID/GID=5999，不再交给 useradd -r
# 系统账户段动态分配。未选 999：本地实测该镜像基座的 systemd-journal 组已占用
# GID 999（`groupadd -g 999` 构建期直接报错），999 本就落在 useradd -r 的系统
# 账户动态段内，天然会被未来的 apt 依赖再次抢占。5999 在系统账户段（通常
# ≤999）与 node 用户（1000）之上，任何系统依赖都不会分配到这个区间；
# 若真撞车，useradd 会在镜像构建期报错（响亮失败），不会静默漂移到生产。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKERFILE="$SCRIPT_DIR/../Dockerfile"

fail() { echo "FAIL: $*" >&2; exit 1; }

[[ -f "$DOCKERFILE" ]] || fail "missing Dockerfile at $DOCKERFILE"

user_line="$(grep -E '^RUN groupadd .* && useradd .* cecelia$' "$DOCKERFILE" || true)"
[[ -n "$user_line" ]] || fail "missing cecelia groupadd+useradd RUN line"

echo "$user_line" | grep -Eq -- '-g[[:space:]]+5999\b' \
  || fail "groupadd must pin -g 5999 (got: $user_line)"
echo "$user_line" | grep -Eq -- '-u[[:space:]]+5999\b' \
  || fail "useradd must pin -u 5999 (got: $user_line)"
echo "$user_line" | grep -Eq -- '-g[[:space:]]+5999\b.*useradd' \
  || fail "useradd must join the pinned group by numeric gid 5999, not by name (got: $user_line)"

echo "PASS: dockerfile-cecelia-uid-pinned.test.sh"
