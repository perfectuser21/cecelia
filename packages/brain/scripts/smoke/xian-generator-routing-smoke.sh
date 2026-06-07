#!/usr/bin/env bash
# xian-generator-routing smoke — 验证 brain 镜像内西安 Codex Generator 路由代码真在
#
# 覆盖本 feature 4 个改动里的 2 个代码改动（DB executor 注册 + GITHUB_TOKEN 是运行时/数据，
# 此 smoke 验证 graph 代码层面的透传 + push + token 注入逻辑确实存在于镜像）：
#   1. runSubTaskNode 透传 machine/executor 到 sub-task payload
#   2. spawnNode codex 路径：push contract 到 GitHub + payload 注入 GITHUB_TOKEN
set -euo pipefail
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"
if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[xian-routing smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';

const initSrc = readFileSync('./src/workflows/harness-initiative.graph.js', 'utf8');
const taskSrc = readFileSync('./src/workflows/harness-task.graph.js', 'utf8');

const checks = [
  // 1. runSubTaskNode 透传 machine/executor
  { name: 'runSubTaskNode 透传 machine',
    src: initSrc, regex: /state\.task\?\.payload\?\.machine\s*\?\s*\{\s*machine:\s*state\.task\.payload\.machine/ },
  { name: 'runSubTaskNode 透传 executor',
    src: initSrc, regex: /state\.task\?\.payload\?\.executor\s*\?\s*\{\s*executor:\s*state\.task\.payload\.executor/ },
  // 2. spawnNode codex 路径 push contract（contractInWorktree 守卫 + git push HEAD:branch）
  //    门控用本次执行的本地变量 contractInWorktree（导入后即 true），不用 state.contractImported
  //    （后者首次运行同执行内仍 false → push 被跳过 → 西安 codex 无合同→无 PR，见 #3306）。
  { name: 'spawnNode codex push contract（contractInWorktree 守卫）',
    src: taskSrc, regex: /contractInWorktree\s*&&\s*worktreePath/ },
  { name: 'spawnNode codex push HEAD:precomputedBranch',
    src: taskSrc, regex: /'push'[\s\S]{0,40}HEAD:\\\$\{precomputedBranch\}/ },
  // 3. spawnNode codex payload 注入 GITHUB_TOKEN
  { name: 'spawnNode codex payload env.GITHUB_TOKEN',
    src: taskSrc, regex: /env:\s*\{\s*GITHUB_TOKEN:\s*token\s*\}/ },
];

let fail = false;
for (const c of checks) {
  if (!c.regex.test(c.src)) { console.error('FAIL:', c.name); fail = true; }
}

// 运行时验证：runSubTaskNode 真透传
const mod = await import('./src/workflows/harness-initiative.graph.js');
if (typeof mod.runSubTaskNode !== 'function') {
  console.error('FAIL: runSubTaskNode 未 export'); fail = true;
} else {
  const captured = [];
  const fakeCompiled = { invoke: async (input) => { captured.push(input); return { status: 'completed' }; } };
  await mod.runSubTaskNode({
    initiativeId: 'smoke-1',
    task: { id: 't1', payload: { machine: 'mac-mini-m4-xian', executor: 'codex' } },
    sub_task: { id: 'ws1', title: 'T', description: 'D', payload: { dod: [], files: [] } },
    task_loop_fix_count: 0, final_e2e_fix_count: 0,
  }, { compiledTaskGraph: fakeCompiled, waitMs: 0 });
  const p = captured[0]?.task?.payload || {};
  if (p.machine !== 'mac-mini-m4-xian' || p.executor !== 'codex') {
    console.error('FAIL: runSubTaskNode 运行时未透传 machine/executor，got', JSON.stringify({ machine: p.machine, executor: p.executor }));
    fail = true;
  }
}

if (fail) process.exit(1);
console.log('[xian-routing smoke] PASS');
" || { echo "[xian-routing smoke] FAIL"; exit 1; }
