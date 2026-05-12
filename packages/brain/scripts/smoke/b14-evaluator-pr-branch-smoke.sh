#!/usr/bin/env bash
# B14 smoke — 验证 brain 镜像内 harness-task.graph.js 真含 PR_BRANCH 透传逻辑
#
# 不调用 evaluateContractNode（依赖 dbPool/resolveAccount 等运行时），
# 改用 docker exec 在已起 brain 容器内做源码读取 + 模块 import 验证：
#   1. 文件真存在
#   2. 含 'PR_BRANCH: prBranchEnv' 字面
#   3. 含 'gh pr view' fallback
#   4. 模块能 import（语法无误）
set -euo pipefail

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[B14 smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./src/workflows/harness-task.graph.js', 'utf8');

const checks = [
  { name: 'PR_BRANCH env 注入', regex: /PR_BRANCH\s*:\s*prBranchEnv/ },
  { name: 'state.pr_branch 主路径', regex: /state\.pr_branch/ },
  { name: 'gh pr view fallback', regex: /gh.*pr.*view.*headRefName/ },
  { name: '10s timeout 兜底', regex: /timeout:\s*10_000/ },
];

let fail = false;
for (const c of checks) {
  if (!c.regex.test(src)) {
    console.error('FAIL:', c.name, '未命中', c.regex);
    fail = true;
  }
}

// 真 import 测试模块能 load（语法无误）
try {
  const mod = await import('./src/workflows/harness-task.graph.js');
  if (typeof mod.evaluateContractNode !== 'function') {
    console.error('FAIL: evaluateContractNode 未 export');
    fail = true;
  }
} catch (err) {
  console.error('FAIL: graph.js import 错误:', err.message);
  fail = true;
}

if (fail) process.exit(1);
console.log('[B14 smoke] PASS — graph.js 4 项断言 + import 通过');
" || { echo "[B14 smoke] FAIL — assertions failed"; exit 1; }
