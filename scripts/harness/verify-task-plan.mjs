#!/usr/bin/env node
// Harness verify-task-plan: 检查 propose 分支上的 task-plan.json
// 通过 parseTaskPlan schema 校验 + 调用 inferTaskPlanNode 真实节点函数
// 用法: node scripts/harness/verify-task-plan.mjs --branch=<propose_branch> --sprint-dir=<sprint_dir> [--mode=schema|infer|both]
// 退出码: 0 通过；非 0 失败（stderr 含原因）

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const out = { mode: 'both' };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, '_')] = m[2];
  }
  return out;
}

function die(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

const { branch, sprint_dir, mode } = parseArgs(process.argv);
if (!branch) die('--branch=<propose_branch> required');
if (!sprint_dir) die('--sprint-dir=<sprint_dir> required');

const repoRoot = process.cwd();
const tmpPlan = join(tmpdir(), `task-plan-${Date.now()}.json`);

try {
  execSync(`git fetch origin ${branch} --quiet`, { cwd: repoRoot });
} catch {
  die(`git fetch origin ${branch} failed (分支可能不存在)`);
}

let raw;
try {
  raw = execSync(`git show origin/${branch}:${sprint_dir}/task-plan.json`, {
    cwd: repoRoot,
  }).toString();
  writeFileSync(tmpPlan, raw);
} catch {
  die(`origin/${branch} 上无 ${sprint_dir}/task-plan.json`);
}

if (mode === 'schema' || mode === 'both') {
  const dagUrl = pathToFileURL(join(repoRoot, 'packages/brain/src/harness-dag.js')).href;
  const { parseTaskPlan } = await import(dagUrl);
  let plan;
  try {
    plan = parseTaskPlan(raw);
  } catch (e) {
    die(`parseTaskPlan 抛错: ${e.message}`);
  }
  if (!plan || !Array.isArray(plan.tasks) || plan.tasks.length < 1) {
    die('parseTaskPlan: tasks 数组空或缺失');
  }
  console.log(`✅ schema OK，tasks=${plan.tasks.length}`);
}

if (mode === 'infer' || mode === 'both') {
  const graphUrl = pathToFileURL(
    join(repoRoot, 'packages/brain/src/workflows/harness-initiative.graph.js'),
  ).href;
  const { inferTaskPlanNode } = await import(graphUrl);
  const state = {
    ganResult: { propose_branch: branch },
    task: { payload: { sprint_dir } },
    worktreePath: repoRoot,
    initiativeId: process.env.TASK_ID || 'verify-task-plan',
  };
  const delta = await inferTaskPlanNode(state);
  if (delta.error) die(`inferTaskPlanNode error: ${delta.error}`);
  if (!delta.taskPlan || !Array.isArray(delta.taskPlan.tasks) || delta.taskPlan.tasks.length < 1) {
    die('inferTaskPlanNode: taskPlan.tasks 空或缺失');
  }
  console.log(`✅ inferTaskPlanNode OK，tasks=${delta.taskPlan.tasks.length}`);
}

console.log('✅ verify-task-plan 全部通过');
