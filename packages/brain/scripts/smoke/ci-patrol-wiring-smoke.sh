#!/usr/bin/env bash
# Smoke: ci-patrol 接线 — 决策 db1b393b
# 验证（真加载 ESM 模块，不是 grep 文件）：
#   1. triggerCiPatrol 窗口/去重/INSERT 行为——注入 fake pool 真调用
#   2. task-router 4 张表全登记 + routeTaskCreate 解析
#   3. scheduler-jobs JOBS 已注册 ci-patrol
set -euo pipefail

echo "[ci-patrol-smoke] 1. triggerCiPatrol 真调用（fake pool）"
node --input-type=module -e "
import { isInCiPatrolWindow, hasTodayCiPatrol, triggerCiPatrol } from './packages/brain/src/daily-review-scheduler.js';

// 窗口判断
if (!isInCiPatrolWindow(new Date('2026-07-09T00:01:00Z'))) { console.error('FAIL: UTC00:01 应在窗口内'); process.exit(1); }
if (isInCiPatrolWindow(new Date('2026-07-09T12:00:00Z'))) { console.error('FAIL: UTC12:00 不应在窗口内'); process.exit(1); }

// 窗口外不查库
const noCall = { query: () => { throw new Error('不应查库'); } };
const r1 = await triggerCiPatrol(noCall, new Date('2026-07-09T12:00:00Z'));
if (!r1.skipped_window) { console.error('FAIL: 窗口外应 skipped_window'); process.exit(1); }

// 窗口内 + 无当日任务 → 统一 createTask 入口，且字段正确
const calls = [];
const pool = { query: (sql, params) => { calls.push([sql, params]); return Promise.resolve({ rows: [] }); } };
const created = [];
const taskCreator = async (input) => { created.push(input); return { task: { id: 'smoke-task-id' } }; };
const r2 = await triggerCiPatrol(pool, new Date('2026-07-09T00:01:00Z'), taskCreator);
if (!r2.triggered || r2.task_id !== 'smoke-task-id') { console.error('FAIL: 应创建任务', JSON.stringify(r2)); process.exit(1); }
const input = created[0];
if (input.task_type !== 'ci_patrol' || input.trigger_source !== 'brain_auto' || input.source !== 'scheduler') { console.error('FAIL: createTask 字段不对', JSON.stringify(input)); process.exit(1); }
const payload = input.payload;
if (!payload.prd_summary || payload.prd_summary.length < 20) { console.error('FAIL: prd_summary 不满足 pre-flight ≥20 字符'); process.exit(1); }

// 当日已有 → 去重
const dupPool = { query: () => Promise.resolve({ rows: [{ id: 'exists' }] }) };
const r3 = await triggerCiPatrol(dupPool, new Date('2026-07-09T00:01:00Z'));
if (!r3.skipped_recent) { console.error('FAIL: 当日已有应去重'); process.exit(1); }
console.log('triggerCiPatrol 窗口/去重/INSERT ✓');
"

echo "[ci-patrol-smoke] 2. task-router 4 张表登记"
node --input-type=module -e "
import { VALID_TASK_TYPES, SKILL_WHITELIST, LOCATION_MAP, TASK_REQUIREMENTS, routeTaskCreate } from './packages/brain/src/task-router.js';
if (!VALID_TASK_TYPES.includes('ci_patrol')) { console.error('FAIL: VALID_TASK_TYPES 缺 ci_patrol'); process.exit(1); }
if (SKILL_WHITELIST['ci_patrol'] !== '/ci-patrol') { console.error('FAIL: SKILL_WHITELIST'); process.exit(1); }
if (LOCATION_MAP['ci_patrol'] !== 'us') { console.error('FAIL: LOCATION_MAP'); process.exit(1); }
if (JSON.stringify(TASK_REQUIREMENTS['ci_patrol']) !== JSON.stringify(['has_git'])) { console.error('FAIL: TASK_REQUIREMENTS'); process.exit(1); }
const routed = routeTaskCreate({ title: 'CI 巡检 smoke', task_type: 'ci_patrol' });
if (routed.location !== 'us' || routed.skill !== '/ci-patrol') { console.error('FAIL: routeTaskCreate', JSON.stringify(routed)); process.exit(1); }
console.log('task-router 4 表 + 路由解析 ✓');
"

echo "[ci-patrol-smoke] 3. scheduler-jobs JOBS 已注册"
node --input-type=module -e "
import { JOBS } from './packages/brain/src/scheduler-jobs.js';
const job = JOBS.find((j) => j.name === 'ci-patrol');
if (!job || job.needsPool !== true || typeof job.handler !== 'function') { console.error('FAIL: JOBS 缺 ci-patrol 或配置不对'); process.exit(1); }
console.log('scheduler-jobs ci-patrol 注册 ✓');
"

echo "[ci-patrol-smoke] ✅ 全部通过"
