#!/usr/bin/env bash
# gate3-changed-paths.sh — Gate3「计算变更路径」抽出可测脚本
# 用法: gate3-changed-paths.sh <BEFORE_SHA> <AFTER_SHA>
# stdout: 空格分隔的 brain 相关变更路径；检测不出时 fallback "packages/brain/"
#
# 背景（2026-07-15 假跳过 P1）：原 workflow 内联
#   git diff | grep | tr '\n' ' ' || echo "packages/brain/"
# 的 fallback 是死代码——管道退出码取最后命令 tr（恒 0），shallow diff 失败
# （fetch-depth:2 下 BEFORE 不可达）或 grep 无命中时静默送出空列表，下游
# deploy-local.sh 判"无 Brain 改动"跳过真部署。
# 本 workflow job 有 paths 过滤器（packages/brain/** + scripts/brain-deploy.sh），
# 跑到这里必然有 brain 改动 → 空结果 fallback 全量 brain 部署是安全的。
set -uo pipefail

BEFORE="${1:-}"
AFTER="${2:-}"
CHANGED=""

if [[ -n "$BEFORE" && "$BEFORE" != "0000000000000000000000000000000000000000" ]]; then
  CHANGED=$(git diff --name-only "$BEFORE" "$AFTER" 2>/dev/null \
    | grep -E "^packages/brain/|^scripts/brain-deploy\.sh" | tr '\n' ' ') || true
fi

if [[ -z "${CHANGED//[[:space:]]/}" ]]; then
  echo "WARN: 变更检测为空（首次 push / shallow diff 失败 / grep 无命中）→ fallback 全量 brain 部署" >&2
  CHANGED="packages/brain/"
fi

echo "$CHANGED"
