#!/usr/bin/env bash
# Smoke test: skill-eval Form B 渲染器/schema/worker 模块可加载 + 核心函数用真实 fixture 跑通
# 不连真实 DB、不 spawn 真实 claude 进程（CI 没有这些依赖），只验证纯函数逻辑完整。
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

node "$SCRIPT_DIR/skill-eval-formb-smoke.mjs"
