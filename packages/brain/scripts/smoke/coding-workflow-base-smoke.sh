#!/usr/bin/env bash
# 真实离线 Git：main 前进后仍固定任务提交，非法/缺失/非 commit 基线拒绝，旧任务兼容。
set -euo pipefail
cd "$(dirname "$0")/../.."
npx vitest run scripts/coding-workflow/__tests__/worktree-base.test.mjs --maxWorkers=1 --minWorkers=1
