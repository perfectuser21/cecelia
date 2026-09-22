#!/usr/bin/env node
/**
 * registry-vs-base.mjs — 「注册表 vs 基线源码」机械审计（Task 6 补充六）。
 *
 * 背景：Task 1 给 `lib/task-type-registry.js` 造 fixture 时是抄团队简报
 * （ANCHOR_EXEMPT 简报 38 项，真实源码 51 项），不是抄源码本身——简报本身有误，
 * fixture 照抄跟着错，测试当然照过（fixture==registry==简报，三者自洽地一起错），
 * 直到 Task 4 撞见真实反例才发现。这条审计脚本堵这个洞：**只信 git 里的历史源码
 * 原文，不信任何人写的简报/报告/记忆**，对 PR1 替换过的每一处站点，从基线 commit
 * （PR1 开工前，`5c232c9da`）取原始文件内容，用与守卫测试同款的字面量提取器
 * （`__tests__/helpers/task-type-registry.guard.lib.js`）取出原始集合/映射，与
 * 当前 `lib/task-type-registry.js` 的派生导出逐一 deep-equal，任何不等 exit 1。
 *
 * 用法：`npm run audit:registry-vs-base`（等价 `node scripts/audit/registry-vs-base.mjs`）。
 * 不需要数据库/网络，只读本地 git 历史 + 当前 src；随时可重跑，PR1 后续任何一刀
 * 改动注册表标签都应该先跑一遍这个脚本再提交。
 *
 * 已知局限（继承自 guard.lib.js 的提取器，见该文件头注释"已知盲区"）：
 * 这套提取器是正则 + 括号深度计数的启发式，不是真正的 JS 解析器，对模板字符串
 * 拼接名单/spread 展开/`Array.from`/多语句 `.add()` 构造集合等写法会看不到——本
 * 脚本涵盖的全部站点均已人工核实落在提取器能力范围内（见下方 SITES 表逐条 file:name
 * 定位），但"脚本跑绿"不等于"穷尽了所有可能藏字面量的写法"，这一点必须写清楚。
 *
 * 已知局限二（终审 I4）：本脚本只验"值"这一半，不验"引用"那一半。每条 `site()`
 * 的 `current()` 是**手写**指向 `lib/task-type-registry.js` 某个具名导出（如
 * `() => R.TICK_DISPATCH_EXCLUDED`），脚本只核对"基线字面量 deep-equal 这个导出
 * 当前的值"，不核对"消费方源文件（如 dispatch-helpers.js）现在是不是真的 import
 * 并使用了这个导出"——`current()` 里手写错一个导出名（比如笔误指到另一个同类型的
 * 集合），本脚本完全看不出来，因为它压根不读消费方文件当前的源码，只读 `import *
 * as R from '../../src/lib/task-type-registry.js'` 之后的运行时值。这半边"站点确
 * 实引用了正确的导出"由另一套独立机制兜底：① `task-type-registry.guard.test.js`
 * 的规则 A/B/C（手抄名单/SQL 字面量会被判红，逼着消费方必须 import 而不能抄值，
 * 但不保证 import 的是"对"的那个）；② 各消费方模块自己的 wiring/fixture 单测
 * （逐个断言"这个函数拿到的黑名单/白名单就是 XXX 派生集合"，见 task-3/4/5-report.md
 * 里每个站点替换后附带的单测改动）。三层合起来才是"值对 + 引用对"的完整证据链，
 * 本脚本单独跑绿只证明了前半。
 *
 * 覆盖完整性核查（终审 I5）：`nightly-orchestrator.js:122` 的 `NIGHTLY_KR_BONUS_TASK_TYPES`
 * 与 `notion-push-sync.js:240` 的 `PUSH_EXCLUDED_TASK_TYPES` 此前漏收（消费方文件早已改成
 * import 注册表派生值，不再含手抄字面量，导致人工编 SITES 表时被跳过——这正是"纯派生点"
 * 的通病：guard.test.js 的守卫只抓"手抄名单"，这类文件本身干净，不会被守卫标记出来，容易
 * 被遗忘）。核查方法：`grep -rn "from '.*lib/task-type-registry\.js'" src --include="*.js"`
 * 排除 `__tests__/`，列出全部消费方文件实际 import 的导出名，逐个与本文件 SITES 表里
 * `current: () => R.XXX` 引用到的导出名比对——全库当前只有这两处缺口，已补齐（见下方
 * Task 4 节新增的两条）。`routes/tasks.js` 只 import `getTaskType`（函数，不是名单/映射，
 * 不适用本审计的 deep-equal 比较）；其余全部消费方导出名都已有对应 SITES 条目。这条
 * grep 核查不是自动化的（没有测试断言"grep 结果与 SITES 表同步"），日后再新增消费方
 * import 时仍需人工重跑一遍这条 grep 核对，属于本脚本机制之外的人工纪律。
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  extractNamedLiteral,
  extractInlineArray,
} from '../../src/__tests__/helpers/task-type-registry.guard.lib.js';
import * as R from '../../src/lib/task-type-registry.js';
import { EXECUTOR_KIND_FOR } from '../../src/executor-contracts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAIN_DIR = join(HERE, '..', '..'); // packages/brain

// PR1 开工前的基线 commit（补充六原文点名，registry-vs-base 审计固定对齐这一点，
// 不随分支推进而漂移——漂移了就审计不出"注册表相对于开工前有没有走样"）。
const BASE_SHA = '5c232c9da';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: BRAIN_DIR, encoding: 'utf8' }).trim();

function baseline(relFile) {
  return execFileSync('git', ['show', `${BASE_SHA}:packages/brain/src/${relFile}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

// ── 值比较 ──────────────────────────────────────────────────────────────────
function setEq(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}
function arrEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
function valueEq(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && arrEq(a, b);
  return a === b;
}
function objEq(a, b) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (!arrEq(ka, kb)) return false;
  return ka.every((k) => valueEq(a[k], b[k]));
}

/**
 * 抓 de Morgan 形态的双重 `!==` 链（`X !== 'a' && X !== 'b'`，等价于
 * `![a,b].includes(X)`）——dispatcher.js 的 `shouldApplyHarnessCap`/`needsBridgeCheck`
 * 在基线里就是这个写法，没有数组/SQL 字面量可用 extractInlineArray 抓，
 * 单独写一个两字符串捕获组的提取器（Task 3 复核修复 Important#4 逐点核实过等价性
 * 才动手替换，这里对着基线原文机械核对，不是照抄那次核实的结论）。
 */
function extractNotEqPair(rawSrc, anchorRegex) {
  const src = rawSrc; // 只找两个字符串字面量，不需要先剥注释
  const m = anchorRegex.exec(src);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return [m[1], m[2]];
}

/**
 * 抓单值 `!==`/`<>` 判据（`X <> 'device_job'` 这种只排除一个值的写法，不是数组）——
 * notion-push-sync.js 基线原文就是这个形状，没有数组字面量可用 extractInlineArray 抓
 * （终审 I5：这是"纯派生点"的一种——消费方从"单值排除"升级成"注册表派生的多值排除"，
 * 原文只有一个字符串字面量）。
 */
function extractNeqLiteral(rawSrc, anchorRegex) {
  const src = rawSrc; // 只找一个字符串字面量，不需要先剥注释
  const m = anchorRegex.exec(src);
  if (!m || m[1] === undefined) return null;
  return [m[1]];
}

// ── 站点表：每条 = 基线取值(extract) + 当前注册表派生值(current) + 比较方式 ──
// extract() 拿到的是「PR1 开工前，该文件里这个名字/上下文写的字面量原文」；
// current() 拿到的是「当前 lib/task-type-registry.js 派生导出的值」。
// compare='set'（默认，分类名单顺序不是行为）/ 'array'（顺序敏感，展示序）/ 'object'（映射表）。
const SITES = [];
function site(desc) { SITES.push(desc); }

// ── Task 3：派发类（task-3-report.md 第1节） ──
site({ label: 'dispatch-helpers.js:89 (SQL NOT IN)', file: 'dispatch-helpers.js',
  extract: (s) => extractInlineArray(s, /t\.task_type\s+NOT\s+IN\s*\(([^)]*)\)/),
  // 比较前剔除两个基线里不存在的新类型，其余 10 项必须逐一等于基线原文：
  //   qiumi_task —— PR2 入口刀打上第二道闸（tick_dispatchable=false，比照 device_job 双闸）
  //   project    —— main #5486 接力棒新增的项目容器行，永不 queued，本刀按黑名单制防呆一并拨 false
  current: () => R.TICK_DISPATCH_EXCLUDED.filter((t) => t !== 'qiumi_task' && t !== 'project'), compare: 'set',
  note: '「qiumi_task / project 确实在 TICK_DISPATCH_EXCLUDED 里」由 lib/__tests__/task-type-registry.test.js 的专属严格相等断言钉住，本审计只负责证明其余项相对基线零漂移' });
site({ label: 'dispatcher.js:89 INITIATIVE_LOCK_TASK_TYPES', file: 'dispatcher.js',
  extract: (s) => extractNamedLiteral(s, 'INITIATIVE_LOCK_TASK_TYPES'),
  current: () => R.INITIATIVE_LOCK_TASK_TYPES, compare: 'set' });
site({ label: 'dispatcher.js:105 _RETIRED_HARNESS_TYPES_DISPATCH', file: 'dispatcher.js',
  extract: (s) => extractNamedLiteral(s, '_RETIRED_HARNESS_TYPES_DISPATCH'),
  current: () => R.RETIRED_HARNESS_TYPES_DISPATCH, compare: 'set' });
site({ label: 'dispatch-allocation-guide.js:6 GUIDED_TASK_TYPES', file: 'dispatch-allocation-guide.js',
  extract: (s) => extractNamedLiteral(s, 'GUIDED_TASK_TYPES'),
  current: () => R.GUIDED_TASK_TYPES, compare: 'set' });
site({ label: 'slot-allocator.js:81 BACKPRESSURE_BYPASS_TASK_TYPES', file: 'slot-allocator.js',
  extract: (s) => extractNamedLiteral(s, 'BACKPRESSURE_BYPASS_TASK_TYPES'),
  current: () => R.BACKPRESSURE_BYPASS_TASK_TYPES, compare: 'set' });
site({ label: 'slot-allocator.js:353 countCodexInProgress SQL', file: 'slot-allocator.js',
  extract: (s) => extractInlineArray(s, /async function countCodexInProgress[\s\S]*?task_type IN \(([^)]*)\)/),
  current: () => R.CODEX_SLOT_TASK_TYPES, compare: 'set' });
site({ label: 'slot-allocator.js:662 inflight SQL', file: 'slot-allocator.js',
  extract: (s) => extractInlineArray(s, /SELECT count\(\*\)::int AS n FROM tasks\s*\n\s*WHERE task_type IN \(([^)]*)\)/),
  current: () => R.HARNESS_INFLIGHT_TASK_TYPES, compare: 'set' });
site({ label: 'dispatcher.js:592 shouldApplyHarnessCap 兜底计数 SQL（现 :593 = ANY($2::text[]) 绑 HARNESS_INFLIGHT_TASK_TYPES）', file: 'dispatcher.js',
  extract: (s) => extractInlineArray(s, /task_type IN \(([^)]*)\)/),
  current: () => R.HARNESS_INFLIGHT_TASK_TYPES, compare: 'set' });
site({ label: 'dispatcher.js:81 shouldApplyHarnessCap 双重 !== 链（de Morgan，复核修复 Important#4）', file: 'dispatcher.js',
  extract: (s) => extractNotEqPair(s, /candidate\.task_type !== '([^']+)'\s*\n\s*&& candidate\.task_type !== '([^']+)'/),
  current: () => R.HARNESS_INFLIGHT_TASK_TYPES, compare: 'set' });
site({ label: 'dispatcher.js:811 needsBridgeCheck 双重 !== 链（de Morgan，复核修复 Important#4）', file: 'dispatcher.js',
  extract: (s) => extractNotEqPair(s, /const needsBridgeCheck = nextTask\.task_type !== '([^']+)'\s*\n\s*&& nextTask\.task_type !== '([^']+)'/),
  current: () => R.HARNESS_INFLIGHT_TASK_TYPES, compare: 'set' });
site({ label: 'pre-flight-check.js:35 SYSTEM_TASK_TYPES', file: 'pre-flight-check.js',
  extract: (s) => extractNamedLiteral(s, 'SYSTEM_TASK_TYPES'),
  current: () => R.SYSTEM_TASK_TYPES, compare: 'set' });
site({ label: 'task-router.js:16 VALID_TASK_TYPES', file: 'task-router.js',
  extract: (s) => extractNamedLiteral(s, 'VALID_TASK_TYPES'),
  // PR2 入口刀开启了 qiumi_task 的 V（router_valid）标签——notion-gtd-sync 入账要过
  // task-router 的类型校验。它是基线里不存在的新类型，比较前剔除，其余 69 项必须等于基线。
  current: () => R.VALID_TASK_TYPES.filter((t) => t !== 'qiumi_task'), compare: 'set',
  note: 'PR1 决策（task-3-report.md 裁决后 Important#2）把 V 标签留给 PR2；PR2 已开启，「qiumi_task ∈ VALID_TASK_TYPES」由 lib/__tests__/task-type-registry.test.js 的专属严格相等断言钉住，本审计只负责证明其余项相对基线零漂移' });
site({ label: 'actions.js:27 CONTENT_TASK_TYPES', file: 'actions.js',
  extract: (s) => extractNamedLiteral(s, 'CONTENT_TASK_TYPES'), current: () => R.CONTENT_TASK_TYPES, compare: 'set' });
site({ label: 'actions.js:31 RESEARCH_TASK_TYPES', file: 'actions.js',
  extract: (s) => extractNamedLiteral(s, 'RESEARCH_TASK_TYPES'), current: () => R.RESEARCH_TASK_TYPES, compare: 'set' });
site({ label: 'actions.js:37 REVIEW_TASK_TYPES', file: 'actions.js',
  extract: (s) => extractNamedLiteral(s, 'REVIEW_TASK_TYPES'), current: () => R.REVIEW_TASK_TYPES, compare: 'set' });
site({ label: 'actions.js:43 CODING_TASK_TYPES', file: 'actions.js',
  extract: (s) => extractNamedLiteral(s, 'CODING_TASK_TYPES'), current: () => R.CODING_TASK_TYPES, compare: 'set' });
site({ label: 'actions.js:19 systemTypes（裁决后→NO_GOAL_TASK_TYPES）', file: 'actions.js',
  extract: (s) => extractNamedLiteral(s, 'systemTypes'), current: () => R.NO_GOAL_TASK_TYPES, compare: 'set' });
site({ label: 'routes/task-tasks.js:27 CODING_MUTATION_TASK_TYPES', file: 'routes/task-tasks.js',
  extract: (s) => extractNamedLiteral(s, 'CODING_MUTATION_TASK_TYPES'), current: () => R.CODING_MUTATION_TASK_TYPES, compare: 'set' });
site({ label: 'orchestrator/kernel-run-store.js:23 ELIGIBLE_TASK_TYPES', file: 'orchestrator/kernel-run-store.js',
  extract: (s) => extractNamedLiteral(s, 'ELIGIBLE_TASK_TYPES'), current: () => R.KERNEL_RUN_ELIGIBLE_TASK_TYPES, compare: 'set' });
site({ label: 'task-queue-lanes.js:1 PIPELINE_TASK_TYPES', file: 'task-queue-lanes.js',
  extract: (s) => extractNamedLiteral(s, 'PIPELINE_TASK_TYPES'), current: () => R.PIPELINE_TASK_TYPES, compare: 'set' });
site({ label: 'executor.js:2018 isFixMode（内联）', file: 'executor.js',
  extract: (s) => extractInlineArray(s, /isFixMode\s*=\s*\[([^\]]*)\]/), current: () => R.FIX_MODE_TASK_TYPES, compare: 'set' });
site({ label: 'executor.js:2019 isHarnessV4（内联）', file: 'executor.js',
  extract: (s) => extractInlineArray(s, /isHarnessV4\s*=\s*\[([^\]]*)\]/), current: () => R.HARNESS_V4_TASK_TYPES, compare: 'set' });
site({ label: 'executor.js:2375 _HARNESS_GENERATE_TYPES（isHarnessV4 副本）', file: 'executor.js',
  extract: (s) => extractNamedLiteral(s, '_HARNESS_GENERATE_TYPES'), current: () => R.HARNESS_V4_TASK_TYPES, compare: 'set' });
site({ label: 'executor.js:2346 _isSprintOrHarnessDevMode（内联）', file: 'executor.js',
  extract: (s) => extractInlineArray(s, /function _isSprintOrHarnessDevMode\(taskType, payload\) \{\s*return \[([^\]]*)\]/),
  current: () => R.SPRINT_HARNESS_DEV_TASK_TYPES, compare: 'set' });
site({ label: 'executor.js:3453 _RETIRED_HARNESS_TYPES（副本）', file: 'executor.js',
  extract: (s) => extractNamedLiteral(s, '_RETIRED_HARNESS_TYPES'), current: () => R.RETIRED_HARNESS_TYPES_DISPATCH, compare: 'set' });
site({ label: 'executor.js:4198 CONTENT_PIPELINE_TYPES（内联）', file: 'executor.js',
  extract: (s) => extractNamedLiteral(s, 'CONTENT_PIPELINE_TYPES'), current: () => R.CONTENT_PIPELINE_TYPES, compare: 'set' });
site({ label: 'executor.js:4209 HARNESS_LIVENESS_EXEMPT_TYPES（RECOVERY 副本）', file: 'executor.js',
  extract: (s) => extractNamedLiteral(s, 'HARNESS_LIVENESS_EXEMPT_TYPES'), current: () => R.RECOVERY_HARNESS_TASK_TYPES, compare: 'set' });
site({ label: 'executor.js:1392 skillMap', file: 'executor.js',
  extract: (s) => extractNamedLiteral(s, 'skillMap'), current: () => R.EXECUTOR_SKILL_MAP, compare: 'object' });
site({ label: 'executor.js:1519 modeMap', file: 'executor.js',
  extract: (s) => extractNamedLiteral(s, 'modeMap'), current: () => R.EXECUTOR_MODE_MAP, compare: 'object' });
site({ label: 'lib/review-task-types.js:7 REVIEW_TASK_TYPES', file: 'lib/review-task-types.js',
  extract: (s) => extractNamedLiteral(s, 'REVIEW_TASK_TYPES'), current: () => R.REVIEW_ISOLATION_TASK_TYPES, compare: 'set' });
site({ label: 'recurring.js:221 codingMutation（内联）', file: 'recurring.js',
  extract: (s) => extractInlineArray(s, /codingMutation\s*=\s*skill\s*===\s*'\/dev'\s*\|\|\s*\[([^\]]*)\]/),
  current: () => R.RECURRING_CODING_MUTATION_TASK_TYPES, compare: 'set' });
site({ label: 'task-router.js:24 ASYNC_CALLBACK_TYPES', file: 'task-router.js',
  extract: (s) => extractNamedLiteral(s, 'ASYNC_CALLBACK_TYPES'), current: () => R.ASYNC_CALLBACK_TASK_TYPES, compare: 'set' });
site({ label: 'task-router.js:74 SKILL_WHITELIST', file: 'task-router.js',
  extract: (s) => extractNamedLiteral(s, 'SKILL_WHITELIST'), current: () => R.SKILL_WHITELIST, compare: 'object' });
site({ label: 'task-router.js:226 LOCATION_MAP', file: 'task-router.js',
  extract: (s) => extractNamedLiteral(s, 'LOCATION_MAP'), current: () => R.LOCATION_MAP, compare: 'object' });
site({ label: 'task-router.js:316 TASK_REQUIREMENTS', file: 'task-router.js',
  extract: (s) => extractNamedLiteral(s, 'TASK_REQUIREMENTS'), current: () => R.TASK_REQUIREMENTS, compare: 'object' });

// ── Task 4：推送/看门狗/清理类（task-4-report.md 逐站点表） ──
site({ label: 'anchor-check.js:14 ANCHOR_EXEMPT_TASK_TYPES', file: 'anchor-check.js',
  extract: (s) => extractNamedLiteral(s, 'ANCHOR_EXEMPT_TASK_TYPES'), current: () => R.ANCHOR_EXEMPT_TASK_TYPES, compare: 'set',
  note: '本站点是补充六的直接起因——Task 1 fixture 原是抄简报（38项）不是抄本文件（51项），Task 4 才发现改用本文件补全；此处必须用本审计脚本精确核对，不再信任何转述' });
site({ label: 'monitor-loop.js:37 HARNESS_TASK_TYPES', file: 'monitor-loop.js',
  extract: (s) => extractNamedLiteral(s, 'HARNESS_TASK_TYPES'), current: () => R.MONITOR_LONG_RUNNING_TASK_TYPES, compare: 'set' });
site({ label: 'monitor-loop.js:200 HARNESS_CHAIN_TYPES', file: 'monitor-loop.js',
  extract: (s) => extractNamedLiteral(s, 'HARNESS_CHAIN_TYPES'), current: () => R.HARNESS_CHAIN_TASK_TYPES, compare: 'set' });
site({ label: 'pipeline-watchdog.js:26 HARNESS_TASK_TYPES', file: 'pipeline-watchdog.js',
  extract: (s) => extractNamedLiteral(s, 'HARNESS_TASK_TYPES'), current: () => R.PIPELINE_WATCHDOG_TASK_TYPES, compare: 'set' });
site({ label: 'recovery-loop.js:44 HARNESS_TASK_TYPES', file: 'recovery-loop.js',
  extract: (s) => extractNamedLiteral(s, 'HARNESS_TASK_TYPES'), current: () => R.RECOVERY_HARNESS_TASK_TYPES, compare: 'set' });
site({ label: 'task-cleanup.js:23 RECURRING_TASK_TYPES', file: 'task-cleanup.js',
  extract: (s) => extractNamedLiteral(s, 'RECURRING_TASK_TYPES'), current: () => R.RECURRING_TASK_TYPES, compare: 'set' });
site({ label: 'task-cleanup.js:30 PROTECTED_TASK_TYPES', file: 'task-cleanup.js',
  extract: (s) => extractNamedLiteral(s, 'PROTECTED_TASK_TYPES'), current: () => R.PROTECTED_TASK_TYPES, compare: 'set' });
site({ label: 'alertness/escalation.js:73 CANCEL_EXEMPT_TYPES', file: 'alertness/escalation.js',
  extract: (s) => extractNamedLiteral(s, 'CANCEL_EXEMPT_TYPES'), current: () => R.CANCEL_EXEMPT_TYPES, compare: 'set' });
site({ label: 'alertness/escalation.js:364 buildPauseLowPriorityQuery（内联 SQL）', file: 'alertness/escalation.js',
  extract: (s) => extractInlineArray(s, /WHERE status IN \('queued', 'pending'\)[\s\S]*?task_type NOT IN \(([^)]*)\)/),
  current: () => R.ESCALATION_EXEMPT_TASK_TYPES, compare: 'set' });
site({ label: 'credential-expiry-checker.js:203 SKIP_TASK_TYPES', file: 'credential-expiry-checker.js',
  extract: (s) => extractNamedLiteral(s, 'SKIP_TASK_TYPES'), current: () => R.AUTH_RECOVERY_SKIP_TASK_TYPES, compare: 'set' });
site({ label: 'nightly-orchestrator.js:91（内联 SQL）', file: 'nightly-orchestrator.js',
  extract: (s) => extractInlineArray(s, /t\.task_type NOT IN \(([^)]*)\)/), current: () => R.NIGHTLY_EXCLUDED_TASK_TYPES, compare: 'set' });
site({ label: 'nightly-orchestrator.js:122 scoreTask typeScore（内联数组，终审 I5 补漏）', file: 'nightly-orchestrator.js',
  extract: (s) => extractInlineArray(s, /const typeScore = \[([^\]]*)\]\.includes\(task\.task_type\)/),
  current: () => R.NIGHTLY_KR_BONUS_TASK_TYPES, compare: 'set' });
site({ label: "notion-push-sync.js:240 PUSH_TASKS_QUERY task_type<>'device_job'（原单值排除，终审 I5 补漏）", file: 'notion-push-sync.js',
  extract: (s) => extractNeqLiteral(s, /task_type\s*<>\s*'([^']+)'/),
  current: () => R.PUSH_EXCLUDED_TASK_TYPES, compare: 'set',
  note: '基线只排除单值 device_job（不是数组），当前 PUSH_EXCLUDED_TASK_TYPES 由注册表 db && !push_to_notion 派生，实测两边集合当前都恰好等于 ["device_job"]——若未来注册表标记更多类型 db&&!push_to_notion，这条会精确报 FAIL，逼着显式过一遍是否该推送' });
site({ label: 'routes/execution.js:1659 VERDICT_HARNESS_TYPES', file: 'routes/execution.js',
  extract: (s) => extractNamedLiteral(s, 'VERDICT_HARNESS_TYPES'), current: () => R.VERDICT_HARNESS_TASK_TYPES, compare: 'set' });
site({ label: "routes/execution.js:3006 US server task_types（顺序敏感）", file: 'routes/execution.js',
  extract: (s) => extractInlineArray(s, /id:\s*'us'[\s\S]*?task_types:\s*\[([^\]]*)\]/),
  current: () => R.EXEC_STATUS_US_TASK_TYPES, compare: 'array' });
site({ label: "routes/execution.js:3025 HK server task_types（顺序敏感）", file: 'routes/execution.js',
  extract: (s) => extractInlineArray(s, /id:\s*'hk'[\s\S]*?task_types:\s*\[([^\]]*)\]/),
  current: () => R.EXEC_STATUS_HK_TASK_TYPES, compare: 'array' });
site({ label: 'routes/execution.js:3721 DEV_DASHBOARD（内联 SQL）', file: 'routes/execution.js',
  extract: (s) => extractInlineArray(s, /t\.task_type IN \(([^)]*)\)/), current: () => R.DEV_DASHBOARD_TASK_TYPES, compare: 'set' });
site({ label: 'work-routing-observability.js:44（内联 SQL）', file: 'work-routing-observability.js',
  extract: (s) => extractInlineArray(s, /task_type IN \(([^)]*)\)/), current: () => R.GP_SCOPE_TASK_TYPES, compare: 'set' });
site({ label: 'learning.js:571/590（内联 SQL，US 展示集合副本）', file: 'learning.js',
  extract: (s) => extractInlineArray(s, /task_type IN \(([^)]*)\)/), current: () => R.EXEC_STATUS_US_TASK_TYPES, compare: 'set' });
site({ label: 'triage-officer-15min.js:41（内联 SQL）', file: 'triage-officer-15min.js',
  extract: (s) => extractInlineArray(s, /task_type IN \(([^)]*)\)/), current: () => R.GP_SCOPE_TASK_TYPES, compare: 'set' });
site({ label: 'triage-officer-rank.js:72（内联 SQL）', file: 'triage-officer-rank.js',
  extract: (s) => extractInlineArray(s, /task_type IN \(([^)]*)\)/), current: () => R.GP_SCOPE_TASK_TYPES, compare: 'set' });
site({ label: 'topic-heat-scorer.js:114（内联 SQL，非注册表 legacy 名单）', file: 'topic-heat-scorer.js',
  extract: (s) => extractInlineArray(s, /cp\.task_type IN \(([^)]*)\)/),
  current: () => R.tagged ? undefined : undefined, compare: 'skip-not-in-registry',
  note: 'PIPELINE_LOOKUP_LEGACY_TASK_TYPES 就地导出在 topic-heat-scorer.js 本身（非注册表），且含非真实 task_type（copywriting），已在 Task 4 报告"补充"节说明为搬家不进注册表——不参与本审计（无注册表侧比较对象）' });
site({ label: 'topic-selector.js:135（内联 SQL，非注册表 legacy 名单）', file: 'topic-selector.js',
  extract: () => undefined, current: () => undefined, compare: 'skip-not-in-registry',
  note: '同上，CONTENT_GAP_LEGACY_TASK_TYPES 就地导出在 topic-selector.js 本身，不参与本审计' });
site({ label: 'routes/harness.js:702 buildStages STAGE_ORDER（顺序敏感）', file: 'routes/harness.js',
  extract: (s) => extractNamedLiteral(s, 'STAGE_ORDER'), current: () => R.HARNESS_BUILD_STAGE_ORDER, compare: 'array' });
site({ label: 'routes/harness.js:707 buildStages STAGE_LABELS', file: 'routes/harness.js',
  extract: (s) => extractNamedLiteral(s, 'STAGE_LABELS'), current: () => R.HARNESS_BUILD_STAGE_LABELS, compare: 'object' });
site({ label: 'routes/status.js:334 HARNESS_STAGE_ORDER（顺序敏感）', file: 'routes/status.js',
  extract: (s) => extractNamedLiteral(s, 'HARNESS_STAGE_ORDER'), current: () => R.HARNESS_PIPELINE_LIST_STAGE_ORDER, compare: 'array' });
site({ label: 'routes/status.js:342 HARNESS_STAGE_LABELS', file: 'routes/status.js',
  extract: (s) => extractNamedLiteral(s, 'HARNESS_STAGE_LABELS'), current: () => R.HARNESS_PIPELINE_LIST_STAGE_LABELS, compare: 'object' });
site({ label: 'auto-learning.js:20 VALUABLE_TASK_TYPES（顺序敏感，含非真实类型 feature）', file: 'auto-learning.js',
  extract: (s) => extractNamedLiteral(s, 'VALUABLE_TASK_TYPES'), current: () => R.VALUABLE_LEARNING_TASK_TYPES, compare: 'array' });
site({ label: 'crystallize-orchestrator.js:54 CRYSTALLIZE_STAGES（顺序敏感）', file: 'crystallize-orchestrator.js',
  extract: (s) => extractNamedLiteral(s, 'CRYSTALLIZE_STAGES'), current: () => R.CRYSTALLIZE_ORCHESTRATOR_STAGES, compare: 'array' });
site({ label: 'crystallize-orchestrator.js:278 stageLabels', file: 'crystallize-orchestrator.js',
  extract: (s) => extractNamedLiteral(s, 'stageLabels'), current: () => R.CRYSTALLIZE_ORCHESTRATOR_STAGE_LABELS, compare: 'object' });
site({ label: 'cron/daily-real-business-smoke.js:42 STAGE_ORDER（顺序敏感）', file: 'cron/daily-real-business-smoke.js',
  extract: (s) => extractNamedLiteral(s, 'STAGE_ORDER'), current: () => R.DAILY_SMOKE_STAGE_ORDER, compare: 'array' });
site({ label: 'routes/warroom.js:36 FEED_TYPES', file: 'routes/warroom.js',
  extract: (s) => extractNamedLiteral(s, 'FEED_TYPES'), current: () => R.WARROOM_FEED_TASK_TYPES, compare: 'set' });

// ── Task 6（本刀）：executor-contracts.js EXECUTOR_KIND_FOR ──
site({
  label: 'executor-contracts.js:36 EXECUTOR_KIND_FOR',
  file: 'executor-contracts.js',
  extract: (s) => extractNamedLiteral(s, 'EXECUTOR_KIND_FOR'),
  current: () => {
    // qiumi_task 是本刀新增（注册表新声明 executor:'openclaw-agent'），基线里不存在——
    // 唯一允许的已知新增项，其余 key/value 必须与基线原文精确相等。
    const rest = { ...EXECUTOR_KIND_FOR };
    delete rest.qiumi_task;
    return rest;
  },
  compare: 'object',
  note: 'EXECUTOR_KIND_FOR 现由 {...EXECUTOR_KIND_FOR_TASK_TYPE, __bridge_path, __local_spawn} 组装；qiumi_task 是本刀新增合法项，比较前剔除，其余 9 类型 + 2 sentinel 必须逐字等于基线',
});

// ── 执行 ──────────────────────────────────────────────────────────────────
let failures = 0;
const rows = [];
for (const s of SITES) {
  if (s.compare === 'skip-not-in-registry') {
    rows.push({ label: s.label, status: 'SKIP', detail: s.note });
    continue;
  }
  let base;
  try {
    base = s.extract(baseline(s.file));
  } catch (err) {
    base = null;
    rows.push({ label: s.label, status: 'ERROR', detail: `基线提取失败: ${err.message}` });
    failures += 1;
    continue;
  }
  if (base == null) {
    rows.push({ label: s.label, status: 'ERROR', detail: '基线提取器未命中（正则锚点失效，需人工检查 baseline 文件原文）' });
    failures += 1;
    continue;
  }
  let cur;
  try {
    cur = s.current();
  } catch (err) {
    rows.push({ label: s.label, status: 'ERROR', detail: `当前值获取失败: ${err.message}` });
    failures += 1;
    continue;
  }
  let ok;
  if (s.compare === 'set') ok = setEq(base, cur);
  else if (s.compare === 'array') ok = arrEq(base, cur);
  else if (s.compare === 'object') ok = objEq(base, cur);
  else ok = false;

  if (ok) {
    rows.push({ label: s.label, status: 'PASS', detail: Array.isArray(base) ? `${base.length} 项` : `${Object.keys(base).length} 键` });
  } else {
    failures += 1;
    const baseStr = JSON.stringify(base);
    const curStr = JSON.stringify(cur);
    rows.push({
      label: s.label, status: 'FAIL',
      detail: `基线(${s.file}@${BASE_SHA})=${baseStr}\n    当前(注册表派生)=${curStr}`,
    });
  }
}

// ── 输出对照表 ───────────────────────────────────────────────────────────────
console.log(`registry-vs-base 审计（基线 ${BASE_SHA}）— ${SITES.length} 处站点\n`);
for (const r of rows) {
  const mark = r.status === 'PASS' ? '✓' : r.status === 'SKIP' ? '·' : '✗';
  console.log(`${mark} [${r.status}] ${r.label}`);
  if (r.detail) console.log(`    ${r.detail}`);
}
const passCount = rows.filter((r) => r.status === 'PASS').length;
const skipCount = rows.filter((r) => r.status === 'SKIP').length;
console.log(`\n合计：${rows.length} 站点，PASS ${passCount}，SKIP ${skipCount}（非注册表 legacy 名单，见各自 note），FAIL/ERROR ${failures}`);

if (failures > 0) {
  console.error(`\n审计不通过：${failures} 处与基线不等或提取失败，见上方 FAIL/ERROR 详情。`);
  process.exit(1);
}
console.log('\n审计通过：全部站点与基线源码逐一 deep-equal。');
