#!/bin/bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# 1. 语法与静态检查：修复后的 quickcheck.sh 必须仍是合法 bash，且不触碰 brain/src
bash -n scripts/quickcheck.sh || { echo "FAIL: quickcheck.sh 语法错误"; exit 1; }
if git diff --name-only origin/main...HEAD 2>/dev/null | grep -q '^packages/brain/src/'; then
  echo "FAIL: 本次改动触碰了 packages/brain/src，超出范围"; exit 1
fi
echo "OK: 语法合法且未触碰 packages/brain/src"

# 2. 安装依赖（若尚未安装）
if [[ ! -d node_modules/.bin ]]; then
  npm install --prefer-offline --no-audit --no-fund
fi

# 3. 运行永久回归测试（TDD 红→绿的绿证据；四类场景全部覆盖）
# 用 packages/engine 自身 node_modules/.bin/vitest（与 package.json "test" 脚本一致），
# 不强用根目录 hoisted 版本 —— 根目录与 packages/engine 可能存在独立锁定的不同 vitest 版本
cd packages/engine
NODE_OPTIONS='--max-old-space-size=2048' \
  node_modules/.bin/vitest run tests/scripts/quickcheck-oom-priority.test.ts --reporter=verbose \
  | tee /tmp/quickcheck-oom-priority-e2e.log
RESULT_EXIT=${PIPESTATUS[0]}
[ "$RESULT_EXIT" -eq 0 ] || { echo "FAIL: quickcheck-oom-priority.test.ts 未全绿"; exit 1; }
grep -qE '4 passed|passed \(4\)' /tmp/quickcheck-oom-priority-e2e.log || { echo "FAIL: 未确认 4 个场景全部通过"; exit 1; }

echo "✅ Golden Path 验证通过"
