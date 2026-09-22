# 秋米任务路由 PR1 地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Brain 打地基——任务类型注册表成为唯一来源、`qiumi_task` 类型入库、`completed_no_pr` 有入边、`openclaw-agent` 执行体有合同——而对现有任务**零行为变化**。

**Architecture:** 新建 `packages/brain/src/lib/task-type-registry.js`：每个 task_type 一行声明 + 行为标签，导出与原常量**同名**的派生集合；22 处硬编码名单改为 import 派生集合；机械守卫（grep 字面量 + 派生集合==旧字面量 fixture + 派生集合==DB 白名单 + 变异）。迁移 459 扩 CHECK / 加 `tenant_id` / 去重索引谓词豁免 Notion 来源。转移表补 `completed_no_pr` 入边。执行体合同新增 `openclaw-agent`。

**Tech Stack:** Node ESM，vitest（`packages/brain`），PostgreSQL 迁移（幂等 DDL），bash smoke（psql）。

## Global Constraints

- 铁律 76cb816c：枚举语义常量只允许一份，落在被各消费方共同 import 的模块——本刀所有 task_type 名单只能来自 `lib/task-type-registry.js`。
- 铁律 761f242b：任何 SELECT 判态再 UPDATE 一律 `UPDATE … WHERE status = ANY(非终态)`（本刀不新增此类写路径，保持现状）。
- **零行为变化**：每个派生集合与替换前的字面量集合逐一相等（Task 1 fixture 断言）；现有 vitest 全绿。
- TDD 两段 commit：每个 Task 先 commit failing test，再 commit 实现（NO PRODUCTION CODE WITHOUT FAILING TEST FIRST）。
- 守卫必须变异测试：亲眼看它报红一次。
- 迁移编号 **459**；`tasks_task_type_check` 列表 = 457 全量 82 值 + `'qiumi_task'`，注释写明来源；全部 DDL 幂等。
- 状态写入今后只写 `cancelled`（本刀不改现有 `canceled` 写点，只是不再新增）。
- 工作目录：`/Users/administrator/worktrees/cecelia-scan-main/09221827-qiumi-task-router`（分支 `cp-0922182851-09221827-qiumi-task-router`）。所有 `git`/`npx` 命令在此目录执行；vitest 在 `packages/brain` 内运行。
- commit 信息中文，末尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 测试命令：`cd packages/brain && npx vitest run <path> 2>&1 | tail -20`（全量用 `npm test`，>5 分钟，只在 Task 6 跑一次）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/brain/src/lib/task-type-registry.js`（新） | 唯一来源：`TASK_TYPE_REGISTRY` 行 + `tagged()` 派生 + 同名导出集合 |
| `packages/brain/src/lib/__tests__/task-type-registry.test.js`（新） | 零行为变化 fixture 断言 + DB 白名单一致 |
| `packages/brain/src/__tests__/task-type-registry.guard.test.js`（新） | 机械守卫：grep 字面量名单、剩余站点清单、变异 |
| 22 个消费文件（改） | 删字面量，import 同名集合 |
| `packages/brain/migrations/459_qiumi_task_type_tenant_dedup.sql`（新） | CHECK + tenant_id + 去重索引谓词 |
| `packages/brain/scripts/smoke/qiumi-foundation-smoke.sh`（新） | 真库验 459 |
| `packages/quality/smoke-allowlist.txt`（改） | 登记 smoke |
| `packages/brain/src/lib/task-status-transitions.js`（改） | `completed_no_pr` 入边 |
| `packages/brain/src/routes/tasks.js`（改） | 终态清认领补 `completed_no_pr`；openclaw-agent 面 PATCH completed → 409 |
| `packages/brain/src/executor-contracts.js`（改） | `openclaw-agent` 合同；`EXECUTOR_KIND_FOR` 从注册表派生 |

---

### Task 1: 任务类型注册表 + 零行为变化 fixture 断言

**Files:**
- Create: `packages/brain/src/lib/task-type-registry.js`
- Test: `packages/brain/src/lib/__tests__/task-type-registry.test.js`

**Interfaces:**
- Produces（后续 Task 全部依赖）：
  - `TASK_TYPE_REGISTRY: Readonly<Record<string, {surface, coding, pr, executor, watchdog, push_to_notion, tick_dispatchable, cleanup_class, db, tags:string[]}>>`
  - `tagged(tag: string): readonly string[]`（按注册表声明顺序）
  - `getTaskType(type: string): entry | null`
  - 同名派生集合（全部 `Object.freeze`）：`TICK_DISPATCH_EXCLUDED`、`INITIATIVE_LOCK_TASK_TYPES`、`RETIRED_HARNESS_TYPES_DISPATCH`、`GUIDED_TASK_TYPES`、`BACKPRESSURE_BYPASS_TASK_TYPES`、`CODEX_SLOT_TASK_TYPES`、`HARNESS_INFLIGHT_TASK_TYPES`、`SYSTEM_TASK_TYPES`、`VALID_TASK_TYPES`、`CONTENT_TASK_TYPES`、`RESEARCH_TASK_TYPES`、`REVIEW_TASK_TYPES`、`CODING_TASK_TYPES`、`CODING_MUTATION_TASK_TYPES`、`PUSH_EXCLUDED_TASK_TYPES`、`KERNEL_RUN_ELIGIBLE_TASK_TYPES`、`ANCHOR_EXEMPT_TASK_TYPES`、`MONITOR_LONG_RUNNING_TASK_TYPES`、`PIPELINE_WATCHDOG_TASK_TYPES`、`RECOVERY_HARNESS_TASK_TYPES`、`RECURRING_TASK_TYPES`、`PROTECTED_TASK_TYPES`、`ESCALATION_EXEMPT_TASK_TYPES`、`CANCEL_EXEMPT_TYPES`、`AUTH_RECOVERY_SKIP_TASK_TYPES`、`NIGHTLY_EXCLUDED_TASK_TYPES`、`EXECUTOR_KIND_FOR_TASK_TYPE`、`DB_WHITELISTED_TASK_TYPES`

- [ ] **Step 1: 写 failing test（fixture = 替换前各文件字面量原文）**

```js
// packages/brain/src/lib/__tests__/task-type-registry.test.js
/**
 * 零行为变化断言：注册表派生集合必须与替换前 22 处字面量逐一相等。
 * fixture 是从原文件原样抄来的（PR1 之前的样子），改注册表时如果派生集合
 * 变了，这里先红——这就是"地基刀不许改行为"的机械保证。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../task-type-registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = join(HERE, '..', '..', '..', 'migrations', '459_qiumi_task_type_tenant_dedup.sql');

const same = (a, b) => expect(new Set(a)).toEqual(new Set(b));

const FIX = {
  TICK_DISPATCH_EXCLUDED: ['content-pipeline', 'content-export', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'harness_ci_watch', 'harness_deploy_watch', 'device_job'],
  INITIATIVE_LOCK_TASK_TYPES: ['harness_task', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_fix', 'harness_initiative', 'golden_path_proposal'],
  RETIRED_HARNESS_TYPES_DISPATCH: ['harness_task', 'harness_ci_watch', 'harness_fix', 'harness_final_e2e', 'harness_planner'],
  GUIDED_TASK_TYPES: ['dev', 'harness_initiative'],
  BACKPRESSURE_BYPASS_TASK_TYPES: ['harness_initiative', 'harness_task', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_fix', 'harness_ci_watch', 'harness_deploy_watch', 'dev', 'content_publish'],
  CODEX_SLOT_TASK_TYPES: ['codex_qa', 'codex_dev', 'codex_test_gen', 'crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register'],
  HARNESS_INFLIGHT_TASK_TYPES: ['harness_initiative', 'golden_path_proposal'],
  SYSTEM_TASK_TYPES: ['dept_heartbeat', 'codex_qa', 'initiative_verify', 'initiative_plan', 'code_review', 'prd_review', 'spec_review', 'code_review_gate', 'initiative_review', 'crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register', 'content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export', 'content_publish', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'harness_evaluate', 'harness_report', 'harness_initiative', 'harness_task', 'harness_final_e2e'],
  // task-router.js:15-62 原文（已用 awk 抽取核对，共 71 个；注意 harness_planner 不在其中——已退役）
  VALID_TASK_TYPES: ['dev', 'review', 'talk', 'data', 'qa', 'audit', 'research', 'explore', 'knowledge', 'codex_qa', 'codex_dev', 'codex_test_gen', 'code_review', 'decomp_review', 'crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register', 'pr_review', 'dept_heartbeat', 'initiative_plan', 'initiative_verify', 'initiative_execute', 'suggestion_plan', 'architecture_design', 'architecture_scan', 'arch_review', 'strategy_session', 'intent_expand', 'content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export', 'content_publish', 'prd_review', 'spec_review', 'code_review_gate', 'initiative_review', 'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review', 'sprint_generate', 'sprint_fix', 'sprint_report', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_ci_watch', 'harness_fix', 'harness_deploy_watch', 'harness_report', 'scope_plan', 'project_plan', 'okr_initiative_plan', 'okr_scope_plan', 'okr_project_plan', 'platform_scraper', 'harness_initiative', 'harness_task', 'harness_final_e2e', 'harness_evaluate', 'harness_intervention', 'staging_e2e', 'ci_patrol', 'golden_path_proposal', 'strategist_decision'],
  // alertness/escalation.js:73-83 export const CANCEL_EXEMPT_TYPES（与下面 pause 的内联名单不同：多 research/suggestion_plan/content_publish）
  CANCEL_EXEMPT_TYPES: ['research', 'suggestion_plan', 'content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export', 'content_publish', 'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review', 'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'arch_review', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_evaluate', 'harness_fix', 'harness_ci_watch', 'harness_deploy_watch', 'harness_report'],
  CONTENT_TASK_TYPES: ['content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export', 'content_publish'],
  RESEARCH_TASK_TYPES: ['research', 'explore', 'knowledge', 'talk', 'strategy_session', 'intent_expand', 'suggestion_plan', 'scope_plan', 'project_plan', 'okr_initiative_plan', 'okr_scope_plan', 'okr_project_plan', 'initiative_plan', 'dept_heartbeat', 'strategist_decision'],
  REVIEW_TASK_TYPES: ['review', 'qa', 'audit', 'codex_qa', 'codex_test_gen', 'pr_review', 'code_review', 'decomp_review', 'initiative_verify', 'architecture_design', 'architecture_scan', 'arch_review', 'prd_review', 'spec_review', 'code_review_gate', 'initiative_review', 'ci_patrol', 'staging_e2e', 'harness_evaluate', 'harness_final_e2e'],
  CODING_TASK_TYPES: ['dev', 'codex_dev', 'initiative_execute', 'sprint_generate', 'sprint_fix', 'harness_generate', 'harness_fix', 'harness_initiative', 'pipeline_rescue'],
  CODING_MUTATION_TASK_TYPES: ['dev', 'codex_dev', 'initiative_execute', 'sprint_generate', 'sprint_fix', 'harness_generate', 'harness_fix', 'pipeline_rescue', 'harness_initiative'],
  PUSH_EXCLUDED_TASK_TYPES: ['device_job'],
  KERNEL_RUN_ELIGIBLE_TASK_TYPES: ['harness_initiative', 'golden_path_proposal'],
  ANCHOR_EXEMPT_TASK_TYPES: ['dept_heartbeat', 'arch_review', 'ci_patrol', 'research', 'explore', 'talk', 'data', 'staging_e2e', 'deploy_drill', 'nightly', 'janitor', 'strategist_decision', 'harness_initiative', 'harness_task', 'harness_final_e2e', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'harness_evaluate', 'harness_report', 'harness_controller', 'codex_qa', 'codex_dev', 'codex_test_gen', 'initiative_verify', 'initiative_plan', 'code_review', 'prd_review', 'spec_review', 'code_review_gate', 'initiative_review', 'crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register'],
  MONITOR_LONG_RUNNING_TASK_TYPES: ['harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'arch_review'],
  PIPELINE_WATCHDOG_TASK_TYPES: ['harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'harness_ci_watch', 'harness_deploy_watch', 'harness_evaluate', 'harness_report'],
  RECOVERY_HARNESS_TASK_TYPES: ['harness_initiative', 'harness_task', 'harness_evaluate', 'harness_contract_propose', 'harness_contract_review', 'harness_planner', 'harness_generator', 'harness_generate', 'harness_fix'],
  RECURRING_TASK_TYPES: ['dept_heartbeat', 'codex_qa'],
  PROTECTED_TASK_TYPES: ['initiative_plan', 'initiative_verify', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'arch_review', 'harness_ci_watch', 'harness_deploy_watch', 'harness_report'],
  ESCALATION_EXEMPT_TASK_TYPES: ['sprint_planner', 'sprint_contract_propose', 'sprint_contract_review', 'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'arch_review', 'content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export', 'harness_initiative', 'harness_task', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_evaluate', 'harness_fix', 'harness_ci_watch', 'harness_deploy_watch', 'harness_report'],
  AUTH_RECOVERY_SKIP_TASK_TYPES: ['pipeline_rescue'],
  NIGHTLY_EXCLUDED_TASK_TYPES: ['harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_evaluate', 'harness_fix', 'harness_report', 'sprint_planner', 'sprint_generate', 'sprint_evaluate'],
};

// EXECUTOR_KIND_FOR 的 task_type → kind 部分（不含 __bridge_path/__local_spawn 两个路径 sentinel）
const FIX_EXECUTOR_KIND = {
  harness_initiative: 'relay-container',
  golden_path_proposal: 'relay-container',
  dev: 'brain-local',
  'content-pipeline': 'external-worker',
  'content-research': 'external-worker',
  'content-copywriting': 'external-worker',
  'content-copy-review': 'external-worker',
  'content-generate': 'external-worker',
  'content-image-review': 'external-worker',
  'content-export': 'external-worker',
};

// 本刀唯一允许"新增"的类型：它不在任何替换前名单里，比较时剔除，其余必须逐一相等
const NEW_TYPE = 'qiumi_task';

describe('task-type-registry：零行为变化', () => {
  for (const [name, expected] of Object.entries(FIX)) {
    it(`${name} 派生集合 == 替换前字面量`, () => same(R[name].filter((t) => t !== NEW_TYPE), expected));
  }

  it('EXECUTOR_KIND_FOR_TASK_TYPE == 替换前 EXECUTOR_KIND_FOR 的 task_type 部分 + qiumi_task', () => {
    expect(R.EXECUTOR_KIND_FOR_TASK_TYPE).toEqual({ ...FIX_EXECUTOR_KIND, qiumi_task: 'openclaw-agent' });
  });

  it('qiumi_task 声明符合 spec 1.1', () => {
    const e = R.getTaskType('qiumi_task');
    expect(e).toMatchObject({
      surface: 'openclaw-agent', coding: false, pr: false, executor: 'openclaw-agent',
      watchdog: 'openclaw-agent', push_to_notion: true, tick_dispatchable: true, db: true,
    });
    expect(R.VALID_TASK_TYPES).toContain('qiumi_task');
    expect(R.TICK_DISPATCH_EXCLUDED).not.toContain('qiumi_task');
  });

  it('DB 白名单派生集合 == 迁移 459 的 CHECK 列表', () => {
    const sql = readFileSync(MIG, 'utf8').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    const m = sql.match(/tasks_task_type_check CHECK \(\s*task_type IN \(([\s\S]*?)\)\s*\)/);
    expect(m, '459 里找不到 tasks_task_type_check 的 IN 列表').toBeTruthy();
    const dbList = [...m[1].matchAll(/'([a-z0-9_-]+)'/g)].map((x) => x[1]);
    same(R.DB_WHITELISTED_TASK_TYPES, dbList);
    expect(dbList).toContain('qiumi_task');
  });

  it('派生集合全部冻结', () => {
    for (const [name, v] of Object.entries(R)) {
      if (name.endsWith('_TASK_TYPES') || name === 'TICK_DISPATCH_EXCLUDED' || name === 'GUIDED_TASK_TYPES' || name === 'RETIRED_HARNESS_TYPES_DISPATCH') {
        expect(Object.isFrozen(v), `${name} 未冻结`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/task-type-registry.test.js 2>&1 | tail -15`
Expected: FAIL — `Failed to resolve import "../task-type-registry.js"`

- [ ] **Step 3: commit-1（failing test）**

```bash
git add packages/brain/src/lib/__tests__/task-type-registry.test.js
git commit -m "test(brain): 任务类型注册表零行为变化 fixture 断言（先红）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 写注册表（唯一来源）**

```js
// packages/brain/src/lib/task-type-registry.js
/**
 * task-type-registry.js — 任务类型的唯一真身（铁律 76cb816c）。
 *
 * PR1 之前，Brain 里有 22 处各自手抄的 task_type 名单（派发黑名单 / 推送排除 /
 * 看门狗 / 清理保护 / 路由白名单 / 执行体打标……）。加一种类型要改 22 处，漏一处
 * 就被 tick 抢跑或被推送刷屏（device_job 当时要加两道闸才拦住）。
 *
 * 这里每个 task_type 一行声明；各消费方只 import 下面的派生集合，禁止再手抄。
 * 守卫：__tests__/task-type-registry.guard.test.js（grep 字面量名单必红）。
 *
 * 字段：
 *   surface   执行面：kernel | openclaw-agent | device | brain-internal | external | none
 *   coding    是否编码变更（走 change_kind/map_scope 校验）
 *   pr        完成是否要求 PR（false → 完成态写 completed_no_pr）
 *   executor  派发时写进 tasks.executor_kind 的值（null = 由派发路径自决）
 *   watchdog  活性判定策略名（与 executor-contracts 合同对齐）
 *   push_to_notion  是否进 Notion 投影窗口
 *   tick_dispatchable  tick 主派发谓词是否允许（false → 进 TICK_DISPATCH_EXCLUDED）
 *   cleanup_class  none | recurring | protected
 *   db        是否在 tasks_task_type_check 白名单（false = 仅用于免锚等逻辑的虚拟类型）
 *   tags      行为标签，派生集合按标签过滤（名字与替换前常量语义一一对应）
 */

const T = (surface, coding, pr, executor, watchdog, push, tick, cleanup, db, tags = []) =>
  Object.freeze({ surface, coding, pr, executor, watchdog, push_to_notion: push, tick_dispatchable: tick, cleanup_class: cleanup, db, tags: Object.freeze([...tags]) });

// 常用标签缩写
const V = 'router_valid';            // task-router VALID_TASK_TYPES
const SYS = 'system_no_prd';         // pre-flight SYSTEM_TASK_TYPES
const ANC = 'anchor_exempt';         // anchor-check ANCHOR_EXEMPT_TASK_TYPES
const ESC = 'escalation_exempt';     // escalation pauseLowPriority 内联 NOT IN（:364-379）
const CX = 'cancel_exempt';          // escalation export CANCEL_EXEMPT_TYPES（:73-83，比 ESC 多 research/suggestion_plan/content_publish）
const NIT = 'nightly_excluded';      // nightly-orchestrator NOT IN
const PW = 'pipeline_watchdog';      // pipeline-watchdog HARNESS_TASK_TYPES
const MON = 'monitor_long_running';  // monitor-loop HARNESS_TASK_TYPES
const REC = 'recovery_harness';      // recovery-loop HARNESS_TASK_TYPES
const LOCK = 'initiative_lock';      // dispatcher INITIATIVE_LOCK_TASK_TYPES
const RET = 'retired_dispatch';      // dispatcher _RETIRED_HARNESS_TYPES_DISPATCH
const BP = 'backpressure_bypass';    // slot-allocator BACKPRESSURE_BYPASS_TASK_TYPES
const CODEX = 'codex_slot';          // slot-allocator countCodexInProgress
const INF = 'harness_inflight';      // slot-allocator inflight 计数
const GUIDE = 'allocation_guided';   // dispatch-allocation-guide GUIDED_TASK_TYPES
const KR = 'kernel_run_eligible';    // kernel-run-store ELIGIBLE_TASK_TYPES
const CM = 'coding_mutation';        // routes/task-tasks CODING_MUTATION_TASK_TYPES
const FC = 'family:content';         // actions.js CONTENT_TASK_TYPES
const FR = 'family:research';        // actions.js RESEARCH_TASK_TYPES
const FV = 'family:review';          // actions.js REVIEW_TASK_TYPES
const FK = 'family:coding';          // actions.js CODING_TASK_TYPES
const RECUR = 'recurring';           // task-cleanup RECURRING_TASK_TYPES
const PROT = 'protected';            // task-cleanup PROTECTED_TASK_TYPES
const AUTHSKIP = 'auth_recovery_skip'; // credential-expiry-checker SKIP_TASK_TYPES

export const TASK_TYPE_REGISTRY = Object.freeze({
  // ── 通用 ──
  dev:                 T('kernel', true,  true,  'brain-local', 'kernel', true, true, 'none', true, [V, BP, GUIDE, CM, FK]),
  review:              T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV]),
  talk:                T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR]),
  data:                T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC]),
  research:            T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR]),
  exploratory:         T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V]),
  explore:             T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR]),
  knowledge:           T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  qa:                  T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV]),
  audit:               T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV]),
  decomp_review:       T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV]),
  codex_qa:            T('kernel', false, false, null, 'kernel', true, true, 'recurring', true, [V, SYS, ANC, CODEX, FV, RECUR]),
  codex_dev:           T('kernel', true,  true,  null, 'kernel', true, true, 'none', true, [V, ANC, CODEX, CM, FK]),
  codex_test_gen:      T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, ANC, CODEX, FV]),
  pr_review:           T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV]),
  code_review:         T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV]),
  initiative_plan:     T('brain-internal', false, false, null, 'none', true, true, 'protected', true, [V, SYS, ANC, FR, PROT]),
  initiative_verify:   T('brain-internal', false, false, null, 'none', true, true, 'protected', true, [V, SYS, ANC, FV, PROT]),
  initiative_execute:  T('kernel', true,  true,  null, 'kernel', true, true, 'none', true, [V, CM, FK]),
  dept_heartbeat:      T('brain-internal', false, false, null, 'none', true, true, 'recurring', true, [V, SYS, ANC, FR, RECUR]),
  suggestion_plan:     T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  notion_synced:       T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V]),
  architecture_design: T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV]),
  architecture_scan:   T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV]),
  arch_review:         T('kernel', false, false, null, 'kernel', true, true, 'protected', true, [V, ANC, ESC, MON, FV, PROT]),
  strategy_session:    T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  intent_expand:       T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  cto_review:          T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V]),
  spec_review:         T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV]),
  code_review_gate:    T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV]),
  prd_review:          T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV]),
  initiative_review:   T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV]),
  scope_plan:          T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  project_plan:        T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  okr_initiative_plan: T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  okr_scope_plan:      T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  okr_project_plan:    T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  // ── 内容工厂（外部 pipeline-worker 执行，不进 tick 派发）──
  'content-pipeline':     T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC]),
  'content-research':     T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC]),
  'content-generate':     T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC]),
  'content-review':       T('external', false, false, null, 'none', true, true, 'none', true, []),
  'content-export':       T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC]),
  content_publish:        T('external', false, false, null, 'none', true, true, 'none', true, [V, SYS, BP, FC]),
  'content-copywriting':  T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC]),
  'content-copy-review':  T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC]),
  'content-image-review': T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC]),
  pipeline_rescue:        T('kernel', true, true, null, 'kernel', true, true, 'none', true, [V, CM, FK, AUTHSKIP]),
  // ── crystallize ──
  crystallize:          T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  crystallize_scope:    T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  crystallize_forge:    T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  crystallize_verify:   T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  crystallize_register: T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  // ── sprint（v3.x 旧）──
  sprint_planner:          T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, ESC, NIT]),
  sprint_contract_propose: T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, ESC]),
  sprint_contract_review:  T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, ESC]),
  sprint_generate:         T('kernel', true,  true,  null, 'kernel', true, true, 'none', true, [V, ESC, NIT, CM, FK]),
  sprint_evaluate:         T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, ESC, NIT]),
  sprint_fix:              T('kernel', true,  true,  null, 'kernel', true, true, 'none', true, [V, ESC, CM, FK]),
  sprint_report:           T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V]),
  cecelia_event:           T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V]),
  // ── harness ──
  harness_planner:          T('kernel', false, false, null, 'kernel', true, true, 'protected', true, [V, SYS, ANC, ESC, NIT, PW, MON, REC, LOCK, RET, BP, PROT]),
  harness_contract_propose: T('kernel', false, false, null, 'kernel', true, true, 'protected', true, [V, SYS, ANC, ESC, NIT, PW, MON, REC, LOCK, BP, PROT]),
  harness_contract_review:  T('kernel', false, false, null, 'kernel', true, true, 'protected', true, [V, SYS, ANC, ESC, NIT, PW, MON, REC, LOCK, BP, PROT]),
  harness_generate:         T('kernel', true,  true,  null, 'kernel', true, true, 'protected', true, [V, SYS, ANC, ESC, NIT, PW, MON, REC, FK, PROT]),
  harness_generator:        T('kernel', true,  true,  null, 'kernel', true, true, 'none', true, [V, REC]),
  harness_ci_watch:         T('brain-internal', false, false, null, 'none', true, false, 'protected', true, [V, ESC, PW, RET, BP, PROT]),
  harness_evaluate:         T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, ESC, NIT, PW, REC, FV]),
  harness_fix:              T('kernel', true,  true,  null, 'kernel', true, true, 'protected', true, [V, SYS, ANC, ESC, NIT, PW, MON, REC, LOCK, RET, BP, FK, PROT]),
  harness_deploy_watch:     T('brain-internal', false, false, null, 'none', true, false, 'protected', true, [V, ESC, PW, BP, PROT]),
  harness_report:           T('kernel', false, false, null, 'kernel', true, true, 'protected', true, [V, SYS, ANC, ESC, NIT, PW, PROT]),
  platform_scraper:         T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V]),
  harness_initiative:       T('kernel', true,  true,  'relay-container', 'kernel', true, true, 'none', true, [V, SYS, ANC, ESC, REC, LOCK, INF, BP, GUIDE, KR, CM, FK]),
  harness_task:             T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, ESC, REC, LOCK, RET, BP]),
  harness_final_e2e:        T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, RET, FV]),
  trigger_backup:           T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V]),
  harness_intervention:     T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V]),
  staging_e2e:              T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FV]),
  skill_eval:               T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V]),
  ci_patrol:                T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FV]),
  golden_path_proposal:     T('kernel', false, false, 'relay-container', 'kernel', true, true, 'none', true, [V, LOCK, INF, KR]),
  strategist_decision:      T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR]),
  workflow_run:             T('external', false, false, null, 'none', true, true, 'none', true, [V]),
  device_job:               T('device', false, false, null, 'external-worker', false, false, 'none', true, [V]),
  // ── 本刀新增：秋米中文 GTD 表来的非编码任务，Brain 经 ssh 在 MMV 起 openclaw agent ──
  qiumi_task:               T('openclaw-agent', false, false, 'openclaw-agent', 'openclaw-agent', true, true, 'none', true, [V]),
  // ── 虚拟类型（不在 DB 白名单，只用于免锚判断）──
  deploy_drill:       T('none', false, false, null, 'none', false, false, 'none', false, [ANC]),
  nightly:            T('none', false, false, null, 'none', false, false, 'none', false, [ANC]),
  janitor:            T('none', false, false, null, 'none', false, false, 'none', false, [ANC]),
  harness_controller: T('none', false, false, null, 'none', false, false, 'none', false, [ANC]),
});

export function getTaskType(type) {
  return TASK_TYPE_REGISTRY[type] ?? null;
}

/** 按标签派生（保持注册表声明顺序，冻结）。 */
export function tagged(tag) {
  return Object.freeze(
    Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.tags.includes(tag)).map(([k]) => k),
  );
}

// ── 派生集合：名字与替换前各消费方的常量一一对应 ──
export const TICK_DISPATCH_EXCLUDED = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db && !e.tick_dispatchable).map(([k]) => k),
);
export const INITIATIVE_LOCK_TASK_TYPES = tagged(LOCK);
export const RETIRED_HARNESS_TYPES_DISPATCH = tagged(RET);
export const GUIDED_TASK_TYPES = tagged(GUIDE);
export const BACKPRESSURE_BYPASS_TASK_TYPES = tagged(BP);
export const CODEX_SLOT_TASK_TYPES = tagged(CODEX);
export const HARNESS_INFLIGHT_TASK_TYPES = tagged(INF);
export const SYSTEM_TASK_TYPES = tagged(SYS);
export const VALID_TASK_TYPES = tagged(V);
export const CONTENT_TASK_TYPES = tagged(FC);
export const RESEARCH_TASK_TYPES = tagged(FR);
export const REVIEW_TASK_TYPES = tagged(FV);
export const CODING_TASK_TYPES = tagged(FK);
export const CODING_MUTATION_TASK_TYPES = tagged(CM);
export const PUSH_EXCLUDED_TASK_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db && !e.push_to_notion).map(([k]) => k),
);
export const KERNEL_RUN_ELIGIBLE_TASK_TYPES = tagged(KR);
export const ANCHOR_EXEMPT_TASK_TYPES = tagged(ANC);
export const MONITOR_LONG_RUNNING_TASK_TYPES = tagged(MON);
export const PIPELINE_WATCHDOG_TASK_TYPES = tagged(PW);
export const RECOVERY_HARNESS_TASK_TYPES = tagged(REC);
export const RECURRING_TASK_TYPES = tagged(RECUR);
export const PROTECTED_TASK_TYPES = tagged(PROT);
export const ESCALATION_EXEMPT_TASK_TYPES = tagged(ESC);
export const CANCEL_EXEMPT_TYPES = tagged(CX);
export const AUTH_RECOVERY_SKIP_TASK_TYPES = tagged(AUTHSKIP);
export const NIGHTLY_EXCLUDED_TASK_TYPES = tagged(NIT);
export const DB_WHITELISTED_TASK_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db).map(([k]) => k),
);
/** task_type → executor_kind（只含声明了 executor 的类型；路径 sentinel 由 executor-contracts 自己补）。 */
export const EXECUTOR_KIND_FOR_TASK_TYPE = Object.freeze(
  Object.fromEntries(Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.executor).map(([k, e]) => [k, e.executor])),
);
```

> **tags 与 fixture 的对应必须逐条核对**（写计划时已用 `awk '/^const VALID_TASK_TYPES/,/\];/'` 抽过原文）。特别注意：
> - `V`（router_valid）**不给** `harness_planner / workflow_run / device_job / trigger_backup / skill_eval / cecelia_event / harness_generator / pipeline_rescue / notion_synced / cto_review / exploratory / sprint_evaluate`——它们在 DB 白名单里但不在 task-router 的 VALID 里（原文如此，零行为变化就要照抄）。上面注册表里这 12 行的 `[V, …]` 要把 `V` 去掉；`qiumi_task` 保留 `V`（新类型必须能过路由，fixture 比较时已剔除）。
> - `CX`（cancel_exempt）给：research、suggestion_plan、8 个 content 类型（含 content_publish）、sprint_planner/sprint_contract_propose/sprint_contract_review/sprint_generate/sprint_evaluate/sprint_fix、arch_review、harness_planner/harness_contract_propose/harness_contract_review/harness_generate/harness_evaluate/harness_fix/harness_ci_watch/harness_deploy_watch/harness_report。
> 实现时以 Task 1 Step 1 的 fixture 为准，fixture 红就改 tags，不改 fixture。

- [ ] **Step 5: 跑测试（459 还没写，DB 白名单那条仍红——预期）**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/task-type-registry.test.js 2>&1 | tail -15`
Expected: 除 `DB 白名单派生集合 == 迁移 459 的 CHECK 列表` 外全部 PASS（该条因 459 不存在 FAIL，Task 4 补齐）。若其它 fixture 断言红：说明注册表 tags 抄错，按原文修 tags，不改 fixture。

- [ ] **Step 6: commit-2（实现）**

```bash
git add packages/brain/src/lib/task-type-registry.js
git commit -m "feat(brain): 任务类型注册表——唯一来源 + 与原字面量同名的派生集合（铁律 76cb816c）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 机械守卫（grep 字面量 + 剩余站点清单 + 变异）

**Files:**
- Test: `packages/brain/src/__tests__/task-type-registry.guard.test.js`

**Interfaces:**
- Consumes: `task-type-registry.js`
- Produces: `REMAINING_LEGACY_SITES` 清单（Task 3/4/5 每替换一处就从清单删一行；清单空时守卫全量生效）

- [ ] **Step 1: 写守卫（此刻 22 处都在清单里，守卫应 PASS；清单为空时对未替换文件 FAIL）**

```js
// packages/brain/src/__tests__/task-type-registry.guard.test.js
/**
 * 任务类型注册表机械守卫（铁律 76cb816c：枚举常量只允许一份）。
 *
 * ① 扫 packages/brain/src 下所有 .js（排除 __tests__ 与注册表本身）：
 *    出现 `task_type (NOT )?IN (` 的 SQL 字面量名单，或出现下列常量名的字面量数组/Set
 *    初始化，即视为手抄名单 → 红，打印 文件:行。
 * ② REMAINING_LEGACY_SITES：PR1 逐 Task 替换期间的临时豁免，替换一处删一行；
 *    清单里的文件若已经不再命中 → 也红（防止豁免长期残留）。
 * ③ 变异：把某消费文件复制到临时目录、把 import 行删掉、把派生集合名替换回字面量，
 *    调 scanFile 必须命中。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const REGISTRY = join(SRC, 'lib', 'task-type-registry.js');

// PR1 替换期间的临时豁免：Task 3/4/5 每替换一处删一行；全部替换完此数组必须为空。
export const REMAINING_LEGACY_SITES = [
  'dispatch-helpers.js',
  'dispatcher.js',
  'dispatch-allocation-guide.js',
  'slot-allocator.js',
  'pre-flight-check.js',
  'task-router.js',
  'actions.js',
  'routes/task-tasks.js',
  'notion-push-sync.js',
  'orchestrator/kernel-run-store.js',
  'anchor-check.js',
  'monitor-loop.js',
  'pipeline-watchdog.js',
  'recovery-loop.js',
  'executor-contracts.js',
  'task-cleanup.js',
  'alertness/escalation.js',
  'credential-expiry-checker.js',
  'nightly-orchestrator.js',
];

// 替换前各消费方的常量名——出现"= [ '...' ]"或"= new Set([ '...'"形态即手抄
const LEGACY_CONST_NAMES = [
  'INITIATIVE_LOCK_TASK_TYPES', '_RETIRED_HARNESS_TYPES_DISPATCH', 'GUIDED_TASK_TYPES',
  'BACKPRESSURE_BYPASS_TASK_TYPES', 'SYSTEM_TASK_TYPES', 'VALID_TASK_TYPES',
  'CONTENT_TASK_TYPES', 'RESEARCH_TASK_TYPES', 'REVIEW_TASK_TYPES', 'CODING_TASK_TYPES',
  'CODING_MUTATION_TASK_TYPES', 'ELIGIBLE_TASK_TYPES', 'ANCHOR_EXEMPT_TASK_TYPES',
  'HARNESS_TASK_TYPES', 'RECURRING_TASK_TYPES', 'PROTECTED_TASK_TYPES', 'SKIP_TASK_TYPES',
  'EXECUTOR_KIND_FOR', 'CANCEL_EXEMPT_TYPES',
];

const SQL_LIST_RE = /task_type\s+(NOT\s+)?IN\s*\(\s*'[a-z0-9_-]+'/i;
const CONST_LITERAL_RE = new RegExp(
  `(?:const|export const)\\s+(?:${LEGACY_CONST_NAMES.join('|')})\\s*=\\s*(?:new Set\\(\\s*)?\\[\\s*'`,
);
const ESCALATION_RE = /task_type\s+NOT\s+IN\s*\(\s*\n\s*'/; // escalation.js 的多行写法

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');
}

export function scanFile(absPath) {
  const src = stripComments(readFileSync(absPath, 'utf8'));
  const hits = [];
  src.split('\n').forEach((line, i) => {
    if (SQL_LIST_RE.test(line) || CONST_LITERAL_RE.test(line)) hits.push(i + 1);
  });
  if (ESCALATION_RE.test(src)) hits.push('multiline-sql');
  return hits;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '__tests__') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js') && p !== REGISTRY) out.push(p);
  }
  return out;
}

describe('task-type-registry 守卫', () => {
  const files = walk(SRC);

  it('① 注册表之外不得手抄 task_type 名单（豁免清单内除外）', () => {
    const offenders = [];
    for (const f of files) {
      const rel = relative(SRC, f);
      if (REMAINING_LEGACY_SITES.includes(rel)) continue;
      const hits = scanFile(f);
      if (hits.length) offenders.push(`${rel}:${hits.join(',')}`);
    }
    expect(offenders, `手抄名单，改为 import lib/task-type-registry.js：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('② 豁免清单里的文件必须仍在命中（否则豁免该删了）', () => {
    const stale = REMAINING_LEGACY_SITES.filter((rel) => scanFile(join(SRC, rel)).length === 0);
    expect(stale, `这些文件已替换完成，请从 REMAINING_LEGACY_SITES 删除：${stale.join(', ')}`).toEqual([]);
  });

  it('③ 变异：把 import 换回字面量必须被抓到', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ttr-guard-'));
    const mutated = join(dir, 'mutant.js');
    writeFileSync(mutated, [
      "import pool from './db.js';",
      "const HARNESS_TASK_TYPES = ['harness_planner', 'harness_fix'];",
      "export const Q = `SELECT 1 FROM tasks WHERE task_type NOT IN ('device_job', 'content-export')`;",
    ].join('\n'));
    const hits = scanFile(mutated);
    expect(hits.length, '变异体没被抓到，守卫失效').toBeGreaterThanOrEqual(2);
  });

  it('③b 干净文件不误报', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ttr-guard-'));
    const clean = join(dir, 'clean.js');
    writeFileSync(clean, [
      "import { PIPELINE_WATCHDOG_TASK_TYPES } from './lib/task-type-registry.js';",
      "export const Q = `SELECT 1 FROM tasks WHERE task_type = ANY($1)`;",
    ].join('\n'));
    expect(scanFile(clean)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑守卫（此刻应 PASS：22 处都在豁免清单）**

Run: `cd packages/brain && npx vitest run src/__tests__/task-type-registry.guard.test.js 2>&1 | tail -12`
Expected: 4 passed。若 ① 报出豁免清单之外的文件（如 `promise-map-nightly.js`、`triage-officer-*.js`）：先确认它们只是 **消费** 现成常量而非手抄；若真是手抄，把该文件加进本 PR 的替换范围。

- [ ] **Step 3: 变异验证守卫会红（手工，一次性）**

Run:
```bash
cd packages/brain && sed -i.bak "s/^  'dispatch-helpers.js',$//" src/__tests__/task-type-registry.guard.test.js && npx vitest run src/__tests__/task-type-registry.guard.test.js 2>&1 | grep -E "FAIL|手抄名单|dispatch-helpers" | head -5; mv src/__tests__/task-type-registry.guard.test.js.bak src/__tests__/task-type-registry.guard.test.js
```
Expected: 输出含 `FAIL` 且列出 `dispatch-helpers.js:89`（守卫真会红）。还原后再跑一次全绿。

- [ ] **Step 4: commit**

```bash
git add packages/brain/src/__tests__/task-type-registry.guard.test.js
git commit -m "test(brain): 任务类型注册表机械守卫——grep 手抄名单 + 豁免清单 + 变异验证

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 替换派发类 9 处（dispatch-helpers / dispatcher / allocation-guide / slot-allocator / pre-flight / task-router / actions / task-tasks / kernel-run-store）

**Files:**
- Modify: `packages/brain/src/dispatch-helpers.js:89-90`、`dispatcher.js:89-108`、`dispatch-allocation-guide.js:6`、`slot-allocator.js:81-92,353-355,662`、`pre-flight-check.js:35-44`、`task-router.js:15-62`、`actions.js:27-43`、`routes/task-tasks.js:27-30`、`orchestrator/kernel-run-store.js:23-26`
- Test: `packages/brain/src/__tests__/task-type-registry.guard.test.js`（删豁免）+ 各文件现有测试

**Interfaces:**
- Consumes: Task 1 派生集合

- [ ] **Step 1: failing test——从豁免清单删掉这 9 个文件**

在 `REMAINING_LEGACY_SITES` 里删除：`'dispatch-helpers.js'`、`'dispatcher.js'`、`'dispatch-allocation-guide.js'`、`'slot-allocator.js'`、`'pre-flight-check.js'`、`'task-router.js'`、`'actions.js'`、`'routes/task-tasks.js'`、`'orchestrator/kernel-run-store.js'`。

Run: `cd packages/brain && npx vitest run src/__tests__/task-type-registry.guard.test.js 2>&1 | tail -12`
Expected: FAIL，① 列出这 9 个文件的行号。

```bash
git add packages/brain/src/__tests__/task-type-registry.guard.test.js
git commit -m "test(brain): 守卫豁免清单去掉派发类 9 处（先红）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 2: 逐文件替换**

`dispatch-helpers.js`：顶部加 import，SQL 名单改为参数。
```js
import { TICK_DISPATCH_EXCLUDED } from './lib/task-type-registry.js';
```
把
```js
      AND t.task_type NOT IN ('content-pipeline', 'content-export', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review',
                               'harness_ci_watch', 'harness_deploy_watch', 'device_job')
```
改为（在 SQL 之前先 `queryParams.push([...TICK_DISPATCH_EXCLUDED])` 并记下下标）：
```js
  queryParams.push([...TICK_DISPATCH_EXCLUDED]);
  const excludedTypesIdx = queryParams.length;
```
SQL 行：
```js
      AND NOT (t.task_type = ANY($${excludedTypesIdx}::text[]))
```
> 注意：`goalCondition`/`excludeClause` 在前面已经 push 过参数，这一句必须放在它们之后、拼 SQL 之前；`__tests__/device-job-foundation.test.js` 闸2 断言原来 grep 字面量 `'device_job'`，改为断言 `TICK_DISPATCH_EXCLUDED` 含 `device_job` 且 SQL 含 `= ANY($` —— 修改该测试时保持"先剥注释再匹配"的写法。

`dispatcher.js`：删除第 89-96 行 `INITIATIVE_LOCK_TASK_TYPES = [...]` 与 105-108 行 `_RETIRED_HARNESS_TYPES_DISPATCH = new Set([...])`，改为：
```js
import { INITIATIVE_LOCK_TASK_TYPES, RETIRED_HARNESS_TYPES_DISPATCH } from './lib/task-type-registry.js';
const _RETIRED_HARNESS_TYPES_DISPATCH = new Set(RETIRED_HARNESS_TYPES_DISPATCH);
```
（保留注释块；`:422/:573/:627/:635` 用法不变。）

`dispatch-allocation-guide.js:6`：
```js
import { GUIDED_TASK_TYPES as GUIDED } from './lib/task-type-registry.js';
const GUIDED_TASK_TYPES = new Set(GUIDED);
```

`slot-allocator.js`：
```js
import { BACKPRESSURE_BYPASS_TASK_TYPES, CODEX_SLOT_TASK_TYPES, HARNESS_INFLIGHT_TASK_TYPES } from './lib/task-type-registry.js';
```
删 81-92 行字面量数组；`countCodexInProgress` 改为
```js
    const result = await pool.query(
      `SELECT COUNT(*) FROM tasks WHERE status = 'in_progress' AND task_type = ANY($1::text[])`,
      [[...CODEX_SLOT_TASK_TYPES]],
    );
```
inflight 查询把 `WHERE task_type IN ('harness_initiative', 'golden_path_proposal')` 改为 `WHERE task_type = ANY($3::text[])` 并在参数数组末尾追加 `[...HARNESS_INFLIGHT_TASK_TYPES]`（原来是 `$1,$2`，新参数是 `$3`）。

`pre-flight-check.js:35-44`：删 `SYSTEM_TASK_TYPES = [...]`，改
```js
import { SYSTEM_TASK_TYPES } from './lib/task-type-registry.js';
```
（函数体内 `const isSystemTask = SYSTEM_TASK_TYPES.includes(task.task_type);` 不变。）

`task-router.js:15-62`：删整个 `VALID_TASK_TYPES = [...]`（含行内注释），改
```js
import { VALID_TASK_TYPES } from './lib/task-type-registry.js';
```

`actions.js:27-43`：删四个 `new Set([...])`，改
```js
import {
  CONTENT_TASK_TYPES as _C, RESEARCH_TASK_TYPES as _R, REVIEW_TASK_TYPES as _V, CODING_TASK_TYPES as _K,
} from './lib/task-type-registry.js';
const CONTENT_TASK_TYPES = new Set(_C);
const RESEARCH_TASK_TYPES = new Set(_R);
const REVIEW_TASK_TYPES = new Set(_V);
const CODING_TASK_TYPES = new Set(_K);
```

`routes/task-tasks.js:27-30`：
```js
import { CODING_MUTATION_TASK_TYPES as _CM } from '../lib/task-type-registry.js';
const CODING_MUTATION_TASK_TYPES = new Set(_CM);
```

`orchestrator/kernel-run-store.js:23-26`：
```js
import { KERNEL_RUN_ELIGIBLE_TASK_TYPES } from '../lib/task-type-registry.js';
const ELIGIBLE_TASK_TYPES = new Set(KERNEL_RUN_ELIGIBLE_TASK_TYPES);
```

- [ ] **Step 3: 跑守卫 + 相关现有测试**

Run:
```bash
cd packages/brain && npx vitest run src/__tests__/task-type-registry.guard.test.js src/lib/__tests__/task-type-registry.test.js src/__tests__/device-job-foundation.test.js src/__tests__/dispatch-helpers.test.js src/__tests__/slot-allocator*.test.js src/__tests__/pre-flight*.test.js src/__tests__/task-router*.test.js 2>&1 | tail -20
```
Expected: 守卫 ①② PASS；其余现有测试全绿（个别 glob 不存在时 vitest 提示 no test files，忽略）。

- [ ] **Step 4: commit-2**

```bash
git add packages/brain/src/dispatch-helpers.js packages/brain/src/dispatcher.js packages/brain/src/dispatch-allocation-guide.js packages/brain/src/slot-allocator.js packages/brain/src/pre-flight-check.js packages/brain/src/task-router.js packages/brain/src/actions.js packages/brain/src/routes/task-tasks.js packages/brain/src/orchestrator/kernel-run-store.js packages/brain/src/__tests__/device-job-foundation.test.js
git commit -m "refactor(brain): 派发类 9 处 task_type 名单改读注册表（零行为变化，fixture 断言护航）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 替换推送/看门狗/清理类 10 处 + 迁移 459 + smoke

**Files:**
- Modify: `notion-push-sync.js:246`、`anchor-check.js:14-32`、`monitor-loop.js:37-40`、`pipeline-watchdog.js:26-36`、`recovery-loop.js:44-48`、`task-cleanup.js:23-38`、`alertness/escalation.js:364-379`、`credential-expiry-checker.js:203`、`nightly-orchestrator.js:91-95`
- Create: `packages/brain/migrations/459_qiumi_task_type_tenant_dedup.sql`、`packages/brain/scripts/smoke/qiumi-foundation-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`
- Test: 守卫豁免清单；`src/lib/__tests__/task-type-registry.test.js` 的 459 断言

**Interfaces:**
- Consumes: Task 1 派生集合
- Produces: 迁移 459（Task 5/6 依赖 `tasks.tenant_id`、`qiumi_task` 可 INSERT）

- [ ] **Step 1: failing tests**

从 `REMAINING_LEGACY_SITES` 删除：`'notion-push-sync.js'`、`'anchor-check.js'`、`'monitor-loop.js'`、`'pipeline-watchdog.js'`、`'recovery-loop.js'`、`'task-cleanup.js'`、`'alertness/escalation.js'`、`'credential-expiry-checker.js'`、`'nightly-orchestrator.js'`（清单只剩 `'executor-contracts.js'`）。

Run: `cd packages/brain && npx vitest run src/__tests__/task-type-registry.guard.test.js src/lib/__tests__/task-type-registry.test.js 2>&1 | tail -12`
Expected: 守卫 ① FAIL 列出 9 文件；`DB 白名单 == 459` FAIL（文件不存在）。

```bash
git add packages/brain/src/__tests__/task-type-registry.guard.test.js
git commit -m "test(brain): 守卫豁免清单去掉推送/看门狗/清理类 9 处（先红）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 2: 逐文件替换**

`notion-push-sync.js`：顶部 `import { PUSH_EXCLUDED_TASK_TYPES } from './lib/task-type-registry.js';`；`PUSH_TASKS_QUERY` 里 `AND task_type <> 'device_job'` 改为
```js
       AND NOT (task_type = ANY(ARRAY[${PUSH_EXCLUDED_TASK_TYPES.map((t) => `'${t}'`).join(',')}]::text[]))
```
（模板字符串内联——`PUSH_TASKS_QUERY` 是导出的常量字符串、被 `device-job-foundation.test.js` 闸3 直接断言；改该测试为断言 `PUSH_EXCLUDED_TASK_TYPES` 含 `device_job` 且 query 含 `'device_job'`。）

`anchor-check.js:14-32`：
```js
import { ANCHOR_EXEMPT_TASK_TYPES as _A } from './lib/task-type-registry.js';
export const ANCHOR_EXEMPT_TASK_TYPES = new Set(_A);
```
（`promise-map-nightly.js:83` 已 import 此常量，不用动。）

`monitor-loop.js:37-40`：
```js
import { MONITOR_LONG_RUNNING_TASK_TYPES as HARNESS_TASK_TYPES } from './lib/task-type-registry.js';
```
删字面量数组。

`pipeline-watchdog.js:26-36`：
```js
import { PIPELINE_WATCHDOG_TASK_TYPES as HARNESS_TASK_TYPES } from './lib/task-type-registry.js';
```

`recovery-loop.js:44-48`：
```js
import { RECOVERY_HARNESS_TASK_TYPES as _H } from './lib/task-type-registry.js';
const HARNESS_TASK_TYPES = new Set(_H);
```

`task-cleanup.js:23-38`：
```js
import { RECURRING_TASK_TYPES, PROTECTED_TASK_TYPES } from './lib/task-type-registry.js';
```
删两个字面量数组（`isProtectedTask` 里的 `.includes` 不变）。

`alertness/escalation.js` 有**两处**：
1. `:73-83` `export const CANCEL_EXEMPT_TYPES = [...]`（被 `:448` `buildCancelPendingQuery` 的 `$1` 消费）→ 改为
```js
import { CANCEL_EXEMPT_TYPES as _CX, ESCALATION_EXEMPT_TASK_TYPES } from '../lib/task-type-registry.js';
export const CANCEL_EXEMPT_TYPES = [..._CX];
```
（保持导出名与数组形态，`:448` 调用不动。）
2. `:356` `buildPauseLowPriorityQuery()` 里 `:364-379` 的内联 `AND task_type NOT IN (...)` 改为 `AND NOT (task_type = ANY($4::text[]))`；`:393` 调用改为 `client.query(buildPauseLowPriorityQuery(), [priorities, SYSTEM_AUTO_TRIGGER_SOURCES, 'escalation_graceful_degrade', [...ESCALATION_EXEMPT_TASK_TYPES]])`。真库 PREPARE 守卫测试（`grep -rn buildPauseLowPriorityQuery packages/brain/src/__tests__`）里该语句的参数个数由 3 改 4。

`credential-expiry-checker.js:203`：
```js
import { AUTH_RECOVERY_SKIP_TASK_TYPES as SKIP_TASK_TYPES } from './lib/task-type-registry.js';
```

`nightly-orchestrator.js:91-95`：`AND t.task_type NOT IN (...)` 改 `AND NOT (t.task_type = ANY($2::text[]))`；`:106` 的参数 `[today]` 改 `[today, [...NIGHTLY_EXCLUDED_TASK_TYPES]]`；顶部 `import { NIGHTLY_EXCLUDED_TASK_TYPES } from './lib/task-type-registry.js';`。

- [ ] **Step 3: 写迁移 459**

```sql
-- packages/brain/migrations/459_qiumi_task_type_tenant_dedup.sql
-- Migration 459: qiumi_task 任务类型 + tasks.tenant_id + 去重索引豁免 Notion 来源
--
-- 秋米中文 GTD 表接入 Brain 统一调度·PR1 地基（task 15f42776，决策 b8abd28c）。
--
-- 一、tasks_task_type_check 纳入 qiumi_task
--     qiumi_task = 中文 GTD 表来的非编码任务，Brain 经 ssh 在 MMV 起 openclaw agent 执行。
--     同 457 修法：DROP + 重建。列表 = 457 的全量 82 值（457 注释：取自生产
--     pg_get_constraintdef）+ 'qiumi_task'。lib/task-type-registry.js 的
--     DB_WHITELISTED_TASK_TYPES 与此列表由测试机械对账。
--
-- 二、tasks.tenant_id
--     tasks 表此前没有租户列，租户只躺在 payload.tenant_id（routes/task-tasks.js 读
--     x-tenant-id 头写入）。中文表三人现为悦升云端，金诺盛源与后续客户各自一个值。
--     回填 payload->>'tenant_id'；建 (tenant_id, status) 索引供按租户过滤。
--
-- 三、idx_tasks_dedup_active 豁免 Notion 来源
--     077 的唯一索引 (title, goal_id, project_id) WHERE 活跃 会把同名的 Notion 行
--     （"朋友圈点赞测试" ×4 这种）吞掉。豁免键用专用的 payload.dedup_by_notion_page='true'。
--     【终审 C1 更正】不能用 payload.notion_page_id：notion-push-sync.js 现有的
--     pullNotionTasks（source='notion_tasks_db'）建单时已把 metadata:{notion_page_id}
--     传给 createRoutedTask，work-routing-store.js 的 payload spread 会让它在 INSERT
--     时即带该键——生产里现在就有活跃任务的 payload 带 notion_page_id，拿它当豁免键
--     会让全部既有 Notion 排单任务立刻退出 title 去重，PR1"零行为变化"不成立。
--     不能用 notion_id 列：它是建单后才 UPDATE 的，且 pushTasks 给所有投影任务都写它。
--     dedup_by_notion_page 只有 PR2 的 qiumi_task 建单路径会显式写，PR1 期间无任务
--     带该键，索引行为不变。
--
-- 全部 DDL 幂等：CI 会重放全部 migration。

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN (
    'dev', 'review', 'talk', 'data', 'research', 'exploratory', 'explore', 'knowledge',
    'qa', 'audit', 'decomp_review', 'codex_qa', 'codex_dev', 'codex_test_gen', 'pr_review',
    'code_review', 'initiative_plan', 'initiative_verify', 'initiative_execute',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced', 'architecture_design',
    'architecture_scan', 'arch_review', 'strategy_session', 'intent_expand', 'cto_review',
    'spec_review', 'code_review_gate', 'prd_review', 'initiative_review', 'scope_plan',
    'project_plan', 'okr_initiative_plan', 'okr_scope_plan', 'okr_project_plan',
    'content-pipeline', 'content-research', 'content-generate', 'content-review',
    'content-export', 'content_publish', 'content-copywriting', 'content-copy-review',
    'content-image-review', 'pipeline_rescue', 'crystallize', 'crystallize_scope',
    'crystallize_forge', 'crystallize_verify', 'crystallize_register', 'sprint_planner',
    'sprint_contract_propose', 'sprint_contract_review', 'sprint_generate',
    'sprint_evaluate', 'sprint_fix', 'sprint_report', 'cecelia_event', 'harness_planner',
    'harness_contract_propose', 'harness_contract_review', 'harness_generate',
    'harness_generator', 'harness_ci_watch', 'harness_evaluate', 'harness_fix',
    'harness_deploy_watch', 'harness_report', 'platform_scraper', 'harness_initiative',
    'harness_task', 'harness_final_e2e', 'trigger_backup', 'harness_intervention',
    'staging_e2e', 'skill_eval', 'ci_patrol', 'golden_path_proposal',
    'strategist_decision', 'workflow_run', 'device_job',
    'qiumi_task'
  )
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tenant_id TEXT;
UPDATE tasks SET tenant_id = payload->>'tenant_id'
 WHERE tenant_id IS NULL AND payload ? 'tenant_id' AND payload->>'tenant_id' <> '';
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON tasks (tenant_id, status);
COMMENT ON COLUMN tasks.tenant_id IS
  '租户标识（如 yueshengyun / jinoshengyuan）。Notion 来源由 NOTION_TENANT_MAP 映射；API 来源由 x-tenant-id 头。NULL = 未标租户的历史任务。';

DROP INDEX IF EXISTS idx_tasks_dedup_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedup_active
ON tasks (
  title,
  COALESCE(goal_id, '00000000-0000-0000-0000-000000000000'),
  COALESCE(project_id, '00000000-0000-0000-0000-000000000000')
)
WHERE status IN ('queued', 'in_progress')
  AND COALESCE(payload->>'dedup_by_notion_page', 'false') <> 'true';
```

> 实现者动手前先核对 457 原文列表与上面完全一致（`diff <(sed -n '19,44p' packages/brain/migrations/457_*.sql) <(sed -n 'NN,MMp' 459)`），只允许多出 `'qiumi_task'` 一行。

- [ ] **Step 4: 写 smoke**

```bash
#!/usr/bin/env bash
# packages/brain/scripts/smoke/qiumi-foundation-smoke.sh
# Smoke: 秋米任务路由 PR1 地基的真库验证（task 15f42776，决策 b8abd28c）
#   闸1 qiumi_task 能 INSERT（CHECK 白名单已扩）
#   闸2 tasks.tenant_id 列存在
#   闸3 去重索引谓词豁免 payload.dedup_by_notion_page='true'：同名两行都带此键都能 queued
#   闸4 对照组：同名两行不带该键仍撞索引（豁免没把去重整个打掉）
#   闸4b（C1 回归）：只带 notion_page_id、不带专用键 → 仍必须撞（不复用 notion_page_id 当豁免键）
# 只删自己插的行（固定 title 前缀），绝不动别人的行。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

T="[smoke] qiumi-foundation $$"
cleanup() { "$PSQL" "$DATABASE_URL" -q -c "DELETE FROM tasks WHERE title LIKE '${T}%'" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# 闸1
q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} g1', 'qiumi_task', 'queued', 'P2', '{\"headed_manual\":true}'::jsonb)" >/dev/null \
  || fail "闸1 qiumi_task INSERT 被 CHECK 拒（459 未应用）"
pass "闸1 qiumi_task 可入库"

# 闸2
[[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='tasks' AND column_name='tenant_id'")" == "1" ]] || fail "闸2 tasks.tenant_id 不存在"
pass "闸2 tenant_id 列存在"

# 闸3：同名 + 都带 dedup_by_notion_page='true' → 两条都能 queued
q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} dup', 'qiumi_task', 'queued', 'P2', '{\"headed_manual\":true,\"dedup_by_notion_page\":\"true\",\"notion_page_id\":\"page-a\"}'::jsonb)" >/dev/null
q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} dup', 'qiumi_task', 'queued', 'P2', '{\"headed_manual\":true,\"dedup_by_notion_page\":\"true\",\"notion_page_id\":\"page-b\"}'::jsonb)" >/dev/null \
  || fail "闸3 同名 Notion 行仍撞去重索引（谓词未豁免 dedup_by_notion_page）"
[[ "$(q "SELECT count(*) FROM tasks WHERE title='${T} dup' AND status='queued'")" == "2" ]] || fail "闸3 计数不对"
pass "闸3 Notion 来源同名不撞"

# 闸4 对照组：同名 + 无豁免键 → 第二条必须撞
q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} ctl', 'data', 'queued', 'P2', '{}'::jsonb)" >/dev/null
if q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} ctl', 'data', 'queued', 'P2', '{}'::jsonb)" >/dev/null 2>&1; then
  fail "闸4 对照组没撞索引——去重被整个打掉了"
fi
pass "闸4 非 Notion 同名仍去重"

# 闸4b（C1 回归）：只带 payload.notion_page_id、不带专用键 → 仍必须撞
q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} legacy', 'data', 'queued', 'P2', '{\"notion_page_id\":\"page-c\"}'::jsonb)" >/dev/null
if q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} legacy', 'data', 'queued', 'P2', '{\"notion_page_id\":\"page-d\"}'::jsonb)" >/dev/null 2>&1; then
  fail "闸4b 只带 notion_page_id 未撞索引——谓词错用 notion_page_id 当豁免键(C1 复发)"
fi
pass "闸4b 仅 notion_page_id 不豁免（专用键未复发 C1）"

# 闸5：注册表派生的 tick 黑名单与 device-job 地基一致（qiumi_task 不在黑名单，device_job 在）
[[ "$(cd "$(dirname "$0")/../.." && node -e "import('./src/lib/task-type-registry.js').then(m=>process.stdout.write(String(m.TICK_DISPATCH_EXCLUDED.includes('device_job') && !m.TICK_DISPATCH_EXCLUDED.includes('qiumi_task'))))")" == "true" ]] || fail "闸5 注册表 tick 黑名单不符预期"
pass "闸5 注册表 tick 黑名单正确"
echo "ALL PASS"
```

登记：在 `packages/quality/smoke-allowlist.txt` 按字母序插入一行 `qiumi-foundation-smoke.sh`（`chmod +x` 脚本）。

- [ ] **Step 5: 跑测试 + 真库 smoke**

```bash
cd packages/brain && npx vitest run src/__tests__/task-type-registry.guard.test.js src/lib/__tests__/task-type-registry.test.js src/__tests__/device-job-foundation.test.js src/__tests__/escalation*.test.js src/__tests__/task-cleanup*.test.js src/__tests__/anchor*.test.js 2>&1 | tail -20
```
Expected: 全绿（守卫 ① 只剩 executor-contracts.js 在豁免清单）。
```bash
# 在 mmv 本机测试库应用迁移后跑 smoke（迁移应用方式照 device-job-foundation-smoke 所在 CI job：psql -f）
DATABASE_URL=postgresql://cecelia@localhost:5432/cecelia_test psql "$DATABASE_URL" -f packages/brain/migrations/459_qiumi_task_type_tenant_dedup.sql && DATABASE_URL=postgresql://cecelia@localhost:5432/cecelia_test bash packages/brain/scripts/smoke/qiumi-foundation-smoke.sh
```
Expected: `PASS: 闸1..闸5`（含闸4b）+ `ALL PASS`。变异验证（一次性）：把 459 里 `AND COALESCE(payload->>'dedup_by_notion_page','false') <> 'true'` 临时删掉重放 → 闸3 必须 FAIL；还原。

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/notion-push-sync.js packages/brain/src/anchor-check.js packages/brain/src/monitor-loop.js packages/brain/src/pipeline-watchdog.js packages/brain/src/recovery-loop.js packages/brain/src/task-cleanup.js packages/brain/src/alertness/escalation.js packages/brain/src/credential-expiry-checker.js packages/brain/src/nightly-orchestrator.js packages/brain/migrations/459_qiumi_task_type_tenant_dedup.sql packages/brain/scripts/smoke/qiumi-foundation-smoke.sh packages/quality/smoke-allowlist.txt packages/brain/src/__tests__/device-job-foundation.test.js
git commit -m "feat(brain): 迁移 459（qiumi_task 白名单 + tenant_id + 去重豁免 Notion 页 id）；推送/看门狗/清理类 9 处改读注册表；地基 smoke

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 转移表 `completed_no_pr` 入边 + 终态清认领 + openclaw-agent 面 PATCH completed → 409

**Files:**
- Modify: `packages/brain/src/lib/task-status-transitions.js:55-77`、`packages/brain/src/routes/tasks.js:455,520-526`
- Test: `packages/brain/src/lib/__tests__/task-status-transitions.test.js`（追加）、`packages/brain/src/routes/__tests__/tasks-completed-no-pr.test.js`（新）

**Interfaces:**
- Consumes: `getTaskType` from registry
- Produces: `TRANSITIONS.in_progress` 含 `completed_no_pr`；PATCH 语义：openclaw-agent 面写 `completed` → 409 `USE_COMPLETED_NO_PR`

- [ ] **Step 1: failing tests**

在 `lib/__tests__/task-status-transitions.test.js` 末尾追加：
```js
describe('completed_no_pr 入边（PR1）', () => {
  it('in_progress 可以直接到 completed_no_pr（非编码任务不产 PR 的销账路径）', () => {
    expect(TRANSITIONS.in_progress).toContain('completed_no_pr');
  });
  it('等待态也能到 completed_no_pr', () => {
    for (const s of ['blocked', 'paused', 'quota_exhausted']) {
      expect(TRANSITIONS[s], `${s} 缺 completed_no_pr 出边`).toContain('completed_no_pr');
    }
  });
});
```

新建 `packages/brain/src/routes/__tests__/tasks-completed-no-pr.test.js`（照 `routes/__tests__` 里现有 PATCH 测试的 mock 方式——先 `ls packages/brain/src/routes/__tests__ | grep -i tasks` 找一个 mock `pool.query` 的样例，复用其 app/supertest 装配；下面只给断言主体）：
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
// …照现有 tasks 路由测试的方式 mock '../db.js' 的 pool.query 与装配 express app…

describe('PATCH /tasks/:id 完成态按执行面分流（PR1）', () => {
  it('qiumi_task 写 completed → 409 USE_COMPLETED_NO_PR', async () => {
    mockTaskRow({ status: 'in_progress', task_type: 'qiumi_task', claimed_by: 'x' });
    const res = await request(app).patch('/api/brain/tasks/t1').send({ status: 'completed' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('USE_COMPLETED_NO_PR');
    expect(res.body.hint).toContain('completed_no_pr');
  });
  it('qiumi_task 写 completed_no_pr → 200，且清 claimed_by/claimed_at', async () => {
    mockTaskRow({ status: 'in_progress', task_type: 'qiumi_task', claimed_by: 'x' });
    const res = await request(app).patch('/api/brain/tasks/t1').send({ status: 'completed_no_pr' });
    expect(res.status).toBe(200);
    const update = lastUpdateSql();
    expect(update).toMatch(/claimed_by = NULL/);
    expect(update).toMatch(/claimed_at = NULL/);
  });
  it('research 写 completed 行为不变（不进 409）', async () => {
    mockTaskRow({ status: 'in_progress', task_type: 'research', review_required_raw: null, pr_url: null });
    const res = await request(app).patch('/api/brain/tasks/t1').send({ status: 'completed' });
    expect(res.status).toBe(200);
  });
});
```

Run: `cd packages/brain && npx vitest run src/lib/__tests__/task-status-transitions.test.js src/routes/__tests__/tasks-completed-no-pr.test.js 2>&1 | tail -15`
Expected: 新增 5 条 FAIL。

```bash
git add packages/brain/src/lib/__tests__/task-status-transitions.test.js packages/brain/src/routes/__tests__/tasks-completed-no-pr.test.js
git commit -m "test(brain): completed_no_pr 入边 + openclaw-agent 面完成态分流（先红）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 2: 实现**

`lib/task-status-transitions.js`：
```js
const WAITING_EXITS = Object.freeze(['queued', 'in_progress', 'completed', 'completed_no_pr', 'failed', 'cancelled']);
// …
  in_progress: ['completed', 'completed_no_pr', 'failed'],
```
（`quarantined`/`canceled`/`cancelled`/`dep_failed`/`pending_postdeploy` 各自数组也加 `'completed_no_pr'`，与"等待态必须能销账"一致。）

`routes/tasks.js`：顶部 `import { getTaskType } from '../lib/task-type-registry.js';`。在转移校验块结束、`const isSkillRelayHarness = …` 之前插入：
```js
    // 非产 PR 的执行面（openclaw-agent）不许写 completed：完成闸按 PR 语义设计，
    // 这类任务的销账态是 completed_no_pr。只限该执行面——talk/research 等存量类型
    // 今天 PATCH completed 合法，不动。
    if (status === 'completed' && !isStatusNoop && getTaskType(task.task_type)?.surface === 'openclaw-agent') {
      return res.status(409).json({
        success: false,
        error: `task_type '${task.task_type}' 不产 PR，完成态必须写 completed_no_pr`,
        code: 'USE_COMPLETED_NO_PR',
        current_status: currentStatus,
        requested_status: status,
        hint: "PATCH {\"status\":\"completed_no_pr\"}",
      });
    }
```
终态清认领：
```js
      if (status === 'failed' || status === 'completed' || status === 'completed_no_pr') {
```

- [ ] **Step 3: 跑测试**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/task-status-transitions.test.js src/routes/__tests__/tasks-completed-no-pr.test.js src/__tests__/integration/task-status-transitions.integration.test.js 2>&1 | tail -15`
Expected: 全绿。

- [ ] **Step 4: commit-2**

```bash
git add packages/brain/src/lib/task-status-transitions.js packages/brain/src/routes/tasks.js
git commit -m "feat(brain): completed_no_pr 有入边、终态清认领；openclaw-agent 面写 completed 改 409 引导（其它类型不变）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `openclaw-agent` 执行体合同 + EXECUTOR_KIND_FOR 从注册表派生 + 全量回归

**Files:**
- Modify: `packages/brain/src/executor-contracts.js:24-55,104-260`
- Test: `packages/brain/src/__tests__/executor-contracts-openclaw-agent.test.js`（新）、守卫豁免清单清空

**Interfaces:**
- Consumes: `EXECUTOR_KIND_FOR_TASK_TYPE`、`sshTargetFor` from `machine-registry.js`
- Produces: `EXECUTOR_CONTRACTS['openclaw-agent']`（PR3 执行器与守护刀依赖）；`VALID_EXECUTOR_KINDS` 含 `'openclaw-agent'`

- [ ] **Step 1: failing tests**

从 `REMAINING_LEGACY_SITES` 删掉 `'executor-contracts.js'`（数组变空）。新建：
```js
// packages/brain/src/__tests__/executor-contracts-openclaw-agent.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), execSync: vi.fn() }));
import { execFileSync } from 'node:child_process';
import { EXECUTOR_CONTRACTS, EXECUTOR_KIND_FOR, VALID_EXECUTOR_KINDS, assessTaskLiveness } from '../executor-contracts.js';

const task = (over = {}) => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000009', status: 'in_progress', executor_kind: 'openclaw-agent',
  updated_at: new Date(Date.now() - 50 * 60000).toISOString(),
  last_attempt_at: new Date(Date.now() - 50 * 60000).toISOString(),
  payload: { run_id: 'notion-abc-1' }, ...over,
});

describe('openclaw-agent 合同', () => {
  beforeEach(() => vi.clearAllMocks());

  it('登记为合法 executor_kind，且 qiumi_task 打标为它', () => {
    expect(VALID_EXECUTOR_KINDS).toContain('openclaw-agent');
    expect(EXECUTOR_KIND_FOR.qiumi_task).toBe('openclaw-agent');
    expect(EXECUTOR_KIND_FOR.__bridge_path).toBe('bridge'); // sentinel 保留
    expect(EXECUTOR_CONTRACTS['openclaw-agent']).toMatchObject({ staleMinutes: 45, onStale: 'fail' });
  });

  it('远端 .exit 已落 → dead（进程结束，等收割）', async () => {
    execFileSync.mockReturnValue('0\n');
    const r = await EXECUTOR_CONTRACTS['openclaw-agent'].probe(task(), {});
    expect(r).toBe('dead');
    const [cmd, args] = execFileSync.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args.at(-2)).toBe('administrator@100.71.151.105');
    expect(args.at(-1)).toContain('brain-runs/notion-abc-1.exit');
  });

  it('远端无 .exit 但 pid 存活 → alive', async () => {
    execFileSync.mockReturnValue('RUNNING\n');
    expect(await EXECUTOR_CONTRACTS['openclaw-agent'].probe(task(), {})).toBe('alive');
  });

  it('ssh 报错 → unknown（fail-open）', async () => {
    execFileSync.mockImplementation(() => { throw new Error('ssh: connect timeout'); });
    expect(await EXECUTOR_CONTRACTS['openclaw-agent'].probe(task(), {})).toBe('unknown');
  });

  it('缺 run_id → unknown，不发 ssh', async () => {
    expect(await EXECUTOR_CONTRACTS['openclaw-agent'].probe(task({ payload: {} }), {})).toBe('unknown');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('assessTaskLiveness 对 dead 返回 onStale=fail', async () => {
    execFileSync.mockReturnValue('1\n');
    const v = await assessTaskLiveness(task(), {});
    expect(v.verdict).toBe('dead');
    expect(v.onStale).toBe('fail');
  });
});
```

Run: `cd packages/brain && npx vitest run src/__tests__/executor-contracts-openclaw-agent.test.js src/__tests__/task-type-registry.guard.test.js 2>&1 | tail -15`
Expected: 新测试 FAIL；守卫 ① FAIL 列 `executor-contracts.js:36`。

```bash
git add packages/brain/src/__tests__/executor-contracts-openclaw-agent.test.js packages/brain/src/__tests__/task-type-registry.guard.test.js
git commit -m "test(brain): openclaw-agent 执行体合同 + 守卫豁免清单清空（先红）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 2: 实现**

`executor-contracts.js`：
```js
import { execSync, execFileSync } from 'node:child_process';
import { assessKernelLiveness } from './lib/kernel-liveness.js';
import { probeCodexReviewLock } from './lib/codex-review-liveness.js';
import { EXECUTOR_KIND_FOR_TASK_TYPE } from './lib/task-type-registry.js';
import { sshTargetFor } from './machine-registry.js';

export const KERNEL_EXECUTOR_KIND = 'kernel-process';
export const OPENCLAW_AGENT_EXECUTOR_KIND = 'openclaw-agent';

export const VALID_EXECUTOR_KINDS = [
  'brain-local',
  'relay-container',
  KERNEL_EXECUTOR_KIND,
  'headed-session',
  'bridge',
  'external-worker',
  'codex-review-local',
  OPENCLAW_AGENT_EXECUTOR_KIND,
];

// task_type → kind 来自注册表（铁律 76cb816c）；两个路径 sentinel 不是 task_type，留在这里。
// EXECUTOR_KIND_FOR 被 executor.js 与多个测试直接 import，形态不能改。
export const EXECUTOR_KIND_FOR = Object.freeze({
  ...EXECUTOR_KIND_FOR_TASK_TYPE,
  __bridge_path: 'bridge',
  __local_spawn: 'brain-local',
});
```
（删除原 36-55 行字面量对象。）在 `EXECUTOR_CONTRACTS` 末尾追加：
```js
  /**
   * openclaw-agent: Brain 经 ssh 在 MMV(us-mac-m4) 起的 `openclaw agent` 进程。
   * 活性：远端 ~/brain-runs/<run_id>.exit 存在 → 进程已结束（dead，等收割）；
   * 不存在但 .pid 存活 → alive；ssh 拿不到答案 → unknown（fail-open）。
   * staleMinutes 45 = AGENT_TIMEOUT 1800s + 余量；onStale 'fail'（守护刀只认 fail/requeue/release-claim-and-alert）。
   */
  'openclaw-agent': {
    probe: async (task, _ctx) => {
      const runId = task?.payload?.run_id;
      if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) return 'unknown';
      let target;
      try { target = sshTargetFor('us-mac-m4'); } catch { return 'unknown'; }
      const remote = `if [ -f ~/brain-runs/${runId}.exit ]; then cat ~/brain-runs/${runId}.exit; elif [ -f ~/brain-runs/${runId}.pid ] && kill -0 "$(cat ~/brain-runs/${runId}.pid)" 2>/dev/null; then echo RUNNING; else echo NO_EXIT; fi`;
      try {
        const out = String(execFileSync('ssh', [
          '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=no',
          target, remote,
        ], { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' })).trim();
        if (out === 'RUNNING') return 'alive';
        if (out === 'NO_EXIT') return 'unknown';
        return 'dead';
      } catch {
        return 'unknown';
      }
    },
    staleMinutes: 45,
    onStale: 'fail',
  },
```

- [ ] **Step 3: 跑相关测试**

Run: `cd packages/brain && npx vitest run src/__tests__/executor-contracts*.test.js src/__tests__/task-type-registry.guard.test.js src/lib/__tests__/task-type-registry.test.js 2>&1 | tail -15`
Expected: 全绿；守卫 ①② 在豁免清单为空时全绿（= 22 处全部归一）。

- [ ] **Step 4: 全量回归 + lint**

Run: `cd packages/brain && npm run lint 2>&1 | tail -5 && npm test 2>&1 | tail -25`
Expected: lint 0 error；vitest 全绿（>560s，含真调 API 的测试若因余额红，按 memory 记录以 CI 为准，但本刀改动相关的测试文件必须本地绿）。

- [ ] **Step 5: commit-2**

```bash
git add packages/brain/src/executor-contracts.js
git commit -m "feat(brain): openclaw-agent 执行体合同（ssh 探 .exit/.pid，stale 45min，onStale fail）；EXECUTOR_KIND_FOR 从注册表派生

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 自审记录

- Spec 覆盖：1.1 注册表（Task 1–4、6）、1.2 迁移 459（Task 4）、1.3 状态机与清认领与 409 断言（Task 5）、1.4 合同（Task 6）、第 4 节测试四档（unit=Task 1/2/5/6，integration=transitions.integration + 现有 pg 测试，E2E=smoke Task 4，trivial=常量）。
- 不在本计划：PR2 同步、PR3 路由/执行/切换（spec 1.5/1.6）。
- 名称一致性：派生集合名在 Task 1 定义、Task 3/4/6 消费同名；`EXECUTOR_KIND_FOR` 形态不变；`TICK_DISPATCH_EXCLUDED` 与 `PUSH_EXCLUDED_TASK_TYPES` 由字段派生而非标签。
- 已知风险：`VALID_TASK_TYPES` 与 `SYSTEM_TASK_TYPES` 原文很长，fixture 若与原文有出入以原文为准（Task 1 Step 4 注）；`escalation.js`/`nightly-orchestrator.js` 改 SQL 参数位次时须同步真库 PREPARE 守卫测试的参数数。

---

## 补充（Task 2 实测）：守卫抓出 9 处简报未列的手抄站点，纳入替换范围

`REMAINING_LEGACY_SITES` 实测 27 处（`notion-push-sync.js:246` 经查无命中已剔除）。新增 9 处按下表并入 Task 3/4；**每处替换前必须先在 `src/lib/__tests__/task-type-registry.test.js` 补该站点旧字面量集合的 fixture 断言（先红），再替换（后绿）**，零行为变化规则同原 23 处。

| 站点 | 并入 | 说明 |
|---|---|---|
| `lib/review-task-types.js` | Task 3 | 第二份自称 SSOT 的 `REVIEW_TASK_TYPES`（3 处引用）：改为 `export { REVIEW_TASK_TYPES } from './task-type-registry.js'` 保留模块路径，消费方不动 |
| `routes/execution.js` | Task 4 | 查询名单 |
| `work-routing-observability.js` | Task 4 | 观测口径名单 |
| `learning.js` | Task 4 | 统计名单 |
| `triage-officer-15min.js`、`triage-officer-rank.js` | Task 4 | 排序官名单 |
| `topic-heat-scorer.js`、`topic-selector.js` | Task 4 | 内容类型名单（若与 `CONTENT_TASK_TYPES` 相等则直接复用，否则注册表加对应 tag） |
| `weekly-report-generator.js` | Task 4 | 周报名单 |
| `monitor-loop.js:200` `HARNESS_CHAIN_TYPES`（Task 2 审查发现，与同文件 `HARNESS_TASK_TYPES` 同类） | Task 4 | 注册表加 tag 派生 `HARNESS_CHAIN_TASK_TYPES`，先补 fixture 再替换；守卫改为语义识别后此类常量都会被抓 |

## 补充二（Task 2 审查修复后）：守卫改语义识别，清单扩到 34+ 处，分配与裁决

守卫不再靠常量名，改为：规则 A 字符串数组/Set 中 ≥2 元素 ∈ `DB_WHITELISTED_TASK_TYPES`；规则 B `task_type (NOT )?IN (`；规则 C 对象字面量 ≥2 键 ∈ 白名单（`kind: map`）。新抓到的站点分配：

| 站点 | 并入 | 说明 |
|---|---|---|
| `executor.js`（6 处独立常量） | Task 3 | 派发/执行面；每处先补 fixture 再替换 |
| `task-queue-lanes.js` | Task 3 | 队列车道名单 |
| `routes/harness.js`、`routes/status.js`、`routes/warroom.js` | Task 4 | 只读查询名单 |
| `auto-learning.js`、`crystallize-orchestrator.js`、`cron/daily-real-business-smoke.js` | Task 4 | 统计/巡检名单 |
| `executor-contracts.js` `EXECUTOR_KIND_FOR`（map） | Task 6 | 已在计划：改为从注册表派生 |
| 其它 `kind: map` 站点 | Task 4 评估 | 能对应注册表单一字段（如 change_kind）的折入并派生；不能的保留在清单、条目标 `long-lived: map` 并在 PR 说明里逐条列理由 |

**裁决**：PR1 结束时 `REMAINING_LEGACY_SITES` 中 `kind: enum` 必须为空；`kind: map` 允许非空但每条必须标 `long-lived` 与理由，整分支审查逐条核。守卫类 Task 的两段 commit = 先红（新规则/空豁免抓到真实站点）后绿（补清单）。

## 补充三（守卫第三轮：位置无关扫描）：清单 44 处，新增站点分配

| 站点 | kind | 并入 | 说明 |
|---|---|---|---|
| `recurring.js:221` `[...].includes(taskType)` | enum | Task 3 | CODING_MUTATION_TASK_TYPES 第三份手抄，改为 `CODING_MUTATION_TASK_TYPES.includes(taskType)` |
| `executor.js:2346` `['sprint_generate','sprint_fix']` | enum | Task 3 | 随 executor.js 一并（注册表加 tag） |
| `routes/execution.js:3006,3025` `task_types: [...]` | enum | Task 4 | 对象属性值数组，改引用派生集合 |
| `model-profile.js:60` `model_map` | map | Task 4 评估 | 模型偏好映射，多半 long-lived |
| `role-registry.js:26,49,70,95` `task_types` | map | Task 4 评估 | 角色→类型映射，多半 long-lived |
| `routes/tasks.js:861` `description` | map | Task 4 评估 | 文案映射，long-lived |
| `task-router.js:179` `skill` | map | Task 3 | 随 task-router.js |

守卫已知盲区（写在 guard.lib.js 头注释）：模板字符串拼接、`Array.from`、spread 拼接、多次 push/add、对象展开——全库当前无实例，整分支审查时人工 grep 一次。

## 补充四（Task 3 审查裁决）
- `qiumi_task` 在 PR1 **不进** `VALID_TASK_TYPES`（task-router 白名单）：进了会被 `:405 || '/dev'` 默认按 /dev 路由，属真实行为变化。PR2（入口刀）随 pullNotionTasks 改造一并开启 V tag。
- 不变式/一致性测试不得用白名单压红；459 未落地前 `integration/task-type-registry-consistency` 允许红，Task 4 转绿。
- 闸类断言（device_job 闸 2、golden-path-proposal-wiring）必须钉住 `AND NOT (… = ANY($` 与绑定集合，并做去 `NOT` 变异。

## 补充五（Task 4 后）：未分配的 5 处 map 站点并入 Task 6 收尾
`routes/agent-ops.js SKILL_BY_TASK_TYPE`、`routes/content-pipeline.js STEP_SYSTEM_PROMPTS`、`task-weight.js TASK_TYPE_ADJUSTMENTS`、`tick-helpers.js TASK_TYPE_AGENT_MAP`、`token-budget-planner.js EXECUTOR_AFFINITY`——Task 6 逐条评估：能一对一映射注册表字段的派生（deep-equal fixture），否则清单条目标 `long-lived: map` + 理由。PR1 结束时清单只允许 `long-lived: map`，整分支审查逐条核。
待主理人裁决（不在 PR1 合并）：routes/harness.js `TASK_TYPE_TO_SKILL`（第 3 份 skill 映射）/`BASE_LABELS`（第 5 份 label 映射）要不要合并；role-registry.js 角色归属是否建模进注册表字段。

## 补充七（整分支终审 C1/I1 修复）
- **C1**：459 去重豁免键从 `payload.notion_page_id`（生产存量任务已带，会造成真实行为变化）
  改为专用键 `payload.dedup_by_notion_page='true'`（PR2 才会显式写）。459 头注释、
  spec 1.2、本文件 Task 4 步骤 3/4/5 原文同步更正；smoke 新增闸4b 钉住回归。
- **I1**：459 原把 CHECK 重建、tenant_id 回填、去重索引重建三类重活挤在一个事务，
  拆成：459 内 `ADD CONSTRAINT ... NOT VALID`（毫秒级）+ tenant_id 回填改分批循环
  （`LIMIT 5000` DO 块）；新增独立文件 `460_validate_task_type_check.sql` 单独跑
  `VALIDATE CONSTRAINT`（SHARE UPDATE EXCLUSIVE，不阻塞并发 DML，且是独立事务）；
  去重索引重建仍是 DROP+CREATE（未用 CONCURRENTLY，同 077/457），头注释标注建议
  维护窗口执行。smoke 补闸6：CHECK 存在且 `convalidated=true`（460 应用后）。
  在 cecelia_test 实测：459→460 顺序应用 + 各自重放均幂等，`ALL PASS`（含闸6）。

## 补充六（Task 4 审查）：Task 6 增加"注册表 vs 基线源码"机械审计
Task 1 的 fixture 抄自简报而非源码（ANCHOR_EXEMPT 简报 38 项 / 源码 51 项，fixture==registry==简报三者同错，Task 4 撞见才修）。Task 6 必须：写 `packages/brain/scripts/audit/registry-vs-base.mjs`，对 PR1 替换过的**每一处**站点，用 `git show 5c232c9da:<file>` 取基线源码、用与守卫相同的扫描器提取原字面量集合/映射，与当前注册表派生值逐一 deep-equal，输出对照表；任何不等即 exit 1。审计输出全文贴进 Task 6 报告与 PR 说明。审计脚本保留在仓库（后续刀复用）。
