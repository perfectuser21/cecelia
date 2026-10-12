#!/usr/bin/env bash
# 原生provider进程/文件读取边界/证据拒假/费用未知值的离线回归；不使用真实模型账号。
set -euo pipefail
cd "$(dirname "$0")/../.."
npx vitest run scripts/coding-workflow/__tests__/codex-session.test.mjs \
  scripts/coding-workflow/__tests__/codex-files.test.mjs \
  scripts/coding-workflow/__tests__/transcript.test.mjs --maxWorkers=1 --minWorkers=1
