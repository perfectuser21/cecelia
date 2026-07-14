#!/bin/bash
# Regression: pre-swap smoke（bluegreen T2 闸）在 brain 容器内执行，
# smoke-core 脚本依赖 jq——镜像缺 jq 时 4/5 条假红拦部署（2026-07-14 实证）。
# brain Dockerfile 运行时层必须装 jq。
set -e
DF="$(dirname "$0")/../../packages/brain/Dockerfile"
RUNTIME=$(awk '/^FROM node:20-alpine$/,0' "$DF")
echo "$RUNTIME" | grep -q "jq" || { echo "❌ brain Dockerfile 运行时层未安装 jq（pre-swap smoke 会假红）"; exit 1; }
echo "✅ brain-image-smoke-deps regression 过"
