#!/usr/bin/env bash
# 永久 CI 回归：真实发布/回档脚本 + 隔离产物与 Compose 配置渲染，不操作生产容器。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
node --test "$ROOT/scripts/__tests__/dashboard-release-bind.test.mjs"
