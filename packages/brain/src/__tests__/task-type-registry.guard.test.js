/**
 * 任务类型注册表机械守卫（铁律 76cb816c：枚举常量只允许一份）。
 *
 * 纯函数实现（stripComments/scanFile/walk 及扫描细节：规则 A/B/C 判定逻辑、
 * 阈值理由、位置无关扫描的启发式、已知盲区）全部在
 * `helpers/task-type-registry.guard.lib.js` 的文件头注释里，本文件只留
 * describe/it 和豁免清单——改规则请先读那份注释。
 *
 * ── 三轮修复摘要 ──────────────────────────────────────────────────────
 * 第一轮：守卫从"硬编码 19/27 个已知消费方常量名"改成语义识别（规则 A 数组/Set
 * + 规则 B SQL），抓到 monitor-loop.js:200 HARNESS_CHAIN_TYPES 这个真实反例。
 * 第二轮：补规则 C（对象字面量，以 task_type 为键的映射），抓到
 * executor-contracts.js:36 EXECUTOR_KIND_FOR。
 * 第三轮（本次）：规则 A/C 不再要求 `NAME = [...]`/`{...}` 的**声明绑定**，
 * 改成扫描源码里任意位置的数组/对象字面量起始点，抓到 recurring.js:221 这类
 * "内联字面量+.includes()判断"、以及对象属性值里的内联数组
 * （`task_types: ['dev', ...]`）——这些之前因为没有绑定到一个具名常量，规则
 * A/C 完全看不到。
 *
 * ── 清单 ───────────────────────────────────────────────────────────────
 * REMAINING_LEGACY_SITES：PR1 逐 Task 替换期间的临时豁免，替换一处删一行；
 * 清单里的文件若已经不再命中 → 也判红（防止豁免长期残留，见测试②）。
 * 本 PR（PR1-A）只落地注册表与守卫本体、消费方一处未替换，故清单是 A 树的真实
 * 空跑快照（44 文件 / 82 条命中串），由 PR1-B 逐条清空到 11 条 long-lived: map。
 * kind 标注（只是注释，不参与判定）：enum = 规则 A/B（数组/Set/SQL 字面量
 * 枚举），map = 规则 C（对象映射）。同一文件可能同时命中多条规则。
 *
 * ── 变异 ───────────────────────────────────────────────────────────────
 * ③/③b：合成样本验证规则各自会红、干净文件不会误报。
 * ④：真实变异——注释掉 monitor-loop.js 里 HARNESS_CHAIN_TYPES 声明行，命中
 * 精确消失。
 * ⑤/⑥：规则 C 正例（executor-contracts.js）/反例（tick-scheduler.js）。
 * ⑦：规则 A 第三轮正例——recurring.js:221 的内联数组必须被抓到（这就是本轮
 * 要修的原始反例），标识符应该是调用上下文 `.includes`。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scanFile, walk, relPath } from './helpers/task-type-registry.guard.lib.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const REGISTRY = join(SRC, 'lib', 'task-type-registry.js');

// 本 PR（PR1-A）只落地 `lib/task-type-registry.js` 与本守卫本体，**消费方一处都还没替换**，
// 所以这份豁免清单是"A 树上扫描器能看到的全部手抄站点"的**真实空跑快照**（44 个文件、
// 82 条命中串），不是从 PR #5492 终态清单抄来的。生成方法：把 REMAINING_LEGACY_SITES 置空跑
// 测试①，把报出的 offenders 逐条按「文件 → 命中串白名单」填回来（命中串形如 `行:标识符`，见
// scanFile）。
//
// 【PR1-B 逐条清空】叠放在本 PR 之上的 PR1-B（原 #5492）做 44 处消费方替换，每替换一处删一条，
// 收敛到 11 条 `long-lived: map` 终态（下面带 `*` 的那些），kind: enum 全部清零。
//
// 【终审 I2】结构是 `{ 相对路径: [允许的命中串, ...] }` 的映射，逐条核对——不是整文件跳过扫描。
// 早期版本按文件名整体豁免，导致任何人往已登记文件里新加一段无关的手抄名单都不会被抓到（永久
// 盲区，回归覆盖见测试⑩）。清单内文件的命中，只有不在该文件白名单数组里的才是 offender；清单外
// 文件任何命中都是 offender。测试②同步逐条检查白名单里每个命中串是否仍然成立。
//
// kind 标注（只是注释，不参与判定）：enum = 规则 A/B（数组/Set/SQL 字面量枚举），
// map = 规则 C（对象映射）；`*` = PR1-B 评估后判定 long-lived、终态保留的站点。
export const REMAINING_LEGACY_SITES = {
  // kind: enum
  'actions.js': ['19:systemTypes', '27:CONTENT_TASK_TYPES', '31:RESEARCH_TASK_TYPES', '37:REVIEW_TASK_TYPES', '43:CODING_TASK_TYPES'],
  // kind: enum
  'alertness/escalation.js': ['73:CANCEL_EXEMPT_TYPES', '368:SQL'],
  // kind: enum
  'anchor-check.js': ['14:ANCHOR_EXEMPT_TASK_TYPES'],
  // kind: enum
  'auto-learning.js': ['20:VALUABLE_TASK_TYPES'],
  // kind: enum
  'credential-expiry-checker.js': ['203:SKIP_TASK_TYPES'],
  // kind: enum
  'cron/daily-real-business-smoke.js': ['42:STAGE_ORDER'],
  // kind: enum/map
  'crystallize-orchestrator.js': ['54:CRYSTALLIZE_STAGES', '278:stageLabels'],
  // kind: enum
  'dispatch-allocation-guide.js': ['6:GUIDED_TASK_TYPES'],
  // kind: enum
  'dispatch-helpers.js': ['89:SQL'],
  // kind: enum
  'dispatcher.js': ['89:INITIATIVE_LOCK_TASK_TYPES', '105:_RETIRED_HARNESS_TYPES_DISPATCH', '602:SQL'],
  // kind: map
  'executor-contracts.js': ['36:EXECUTOR_KIND_FOR'],
  // kind: enum/map/map*
  // * :2378 _TASK_ROUTES 是 task_type→handler 函数路由表，函数值进不了纯数据注册表，PR1-B 终态保留
  'executor.js': ['1392:skillMap', '1519:modeMap', '2018:isFixMode', '2019:isHarnessV4', '2346:.includes', '2375:_HARNESS_GENERATE_TYPES', '2378:_TASK_ROUTES', '3453:_RETIRED_HARNESS_TYPES', '4198:CONTENT_PIPELINE_TYPES', '4209:HARNESS_LIVENESS_EXEMPT_TYPES'],
  // kind: enum
  'learning.js': ['571:SQL', '590:SQL'],
  // kind: enum
  'lib/review-task-types.js': ['7:REVIEW_TASK_TYPES'],
  // kind: map*
  // * 模型路由调优配置（task_type→{provider,model,cascade}），非分类标签，PR1-B 终态保留
  'model-profile.js': ['60:model_map'],
  // kind: enum
  'monitor-loop.js': ['37:HARNESS_TASK_TYPES', '200:HARNESS_CHAIN_TYPES'],
  // kind: enum
  'nightly-orchestrator.js': ['91:SQL', '125:typeScore'],
  // kind: enum
  'orchestrator/kernel-run-store.js': ['23:ELIGIBLE_TASK_TYPES'],
  // kind: enum
  'pipeline-watchdog.js': ['26:HARNESS_TASK_TYPES'],
  // kind: enum
  'pre-flight-check.js': ['35:SYSTEM_TASK_TYPES'],
  // kind: enum
  'recovery-loop.js': ['44:HARNESS_TASK_TYPES'],
  // kind: enum
  'recurring.js': ['221:.includes'],
  // kind: map*
  // * CTO/CPO/CMO/CFO/COO 五个业务角色的任务归属划分，与注册表现有 9 个字段正交，PR1-B 终态保留
  'role-registry.js': ['26:task_types', '49:task_types', '70:task_types', '95:task_types'],
  // kind: map*
  // * 运行舱只读展示端点自己的第三份独立降级展示文案，PR1-B 终态保留
  'routes/agent-ops.js': ['17:SKILL_BY_TASK_TYPE'],
  // kind: map*
  // * 6 个 content-* 类型各自的 LLM system prompt 长文本，PR1-B 终态保留
  'routes/content-pipeline.js': ['101:STEP_SYSTEM_PROMPTS'],
  // kind: enum
  'routes/execution.js': ['1658:VERDICT_HARNESS_TYPES', '3006:task_types', '3025:task_types', '3720:SQL'],
  // kind: enum/map*
  // * :946/:1034 是第 3 份 task_type→skill 目录名 + 第 5 份 label 映射（值与已有映射都不同，只搬家不合并），PR1-B 终态保留
  'routes/harness.js': ['702:STAGE_ORDER', '946:TASK_TYPE_TO_SKILL', '1034:BASE_LABELS'],
  // kind: enum/map
  'routes/status.js': ['334:HARNESS_STAGE_ORDER', '342:HARNESS_STAGE_LABELS'],
  // kind: enum
  'routes/task-tasks.js': ['27:CODING_MUTATION_TASK_TYPES'],
  // kind: map*
  // * GET /api/brain/task-types 的人类可读展示文案（仅 5 个类型有文案），PR1-B 终态保留
  'routes/tasks.js': ['873:description'],
  // kind: enum
  'routes/warroom.js': ['36:FEED_TYPES'],
  // kind: enum
  'slot-allocator.js': ['81:BACKPRESSURE_BYPASS_TASK_TYPES', '353:SQL', '662:SQL'],
  // kind: enum
  'task-cleanup.js': ['23:RECURRING_TASK_TYPES', '30:PROTECTED_TASK_TYPES'],
  // kind: enum
  'task-queue-lanes.js': ['1:PIPELINE_TASK_TYPES'],
  // kind: enum/map/map*
  // * :179 FALLBACK_STRATEGIES.skill 仅 2 项业务专用降级链，PR1-B 终态保留
  'task-router.js': ['16:VALID_TASK_TYPES', '68:ASYNC_CALLBACK_TYPES', '74:SKILL_WHITELIST', '179:skill', '226:LOCATION_MAP', '316:TASK_REQUIREMENTS'],
  // kind: map*
  // * 派发权重数值调优表（+20/-10），与分类标签正交，PR1-B 终态保留
  'task-weight.js': ['25:TASK_TYPE_ADJUSTMENTS'],
  // kind: map*
  // * routeTask() 自己的降级判据表（research/content_publish 故意写 null），PR1-B 终态保留
  'tick-helpers.js': ['27:TASK_TYPE_AGENT_MAP'],
  // kind: map*
  // * LLM 供应商亲和度调优配置，非分类标签，PR1-B 终态保留
  'token-budget-planner.js': ['58:EXECUTOR_AFFINITY'],
  // kind: enum
  'topic-heat-scorer.js': ['114:SQL'],
  // kind: enum
  'topic-selector.js': ['135:SQL'],
  // kind: enum
  'triage-officer-15min.js': ['41:SQL'],
  // kind: enum
  'triage-officer-rank.js': ['72:SQL', '130:SQL'],
  // kind: enum
  'weekly-report-generator.js': ['142:SQL'],
  // kind: enum
  'work-routing-observability.js': ['44:SQL'],
};
describe('task-type-registry 守卫', () => {
  const files = walk(SRC, REGISTRY);

  it('① 注册表之外不得手抄 task_type 名单（豁免清单按命中串核对，白名单外的新命中仍判红）', () => {
    const offenders = [];
    for (const f of files) {
      const rel = relPath(SRC, f);
      const hits = scanFile(f);
      if (!hits.length) continue;
      const allowed = REMAINING_LEGACY_SITES[rel];
      const extra = allowed ? hits.filter((h) => !allowed.includes(h)) : hits;
      if (extra.length) offenders.push(`${rel}:${extra.join(',')}`);
    }
    expect(offenders, `手抄名单，改为 import lib/task-type-registry.js（或若确属 long-lived，把新命中串补进 REMAINING_LEGACY_SITES 并写明理由）：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('② 豁免清单里的文件必须仍在命中，且每条白名单命中串本身必须仍然成立（不许腐烂）', () => {
    const entries = Object.entries(REMAINING_LEGACY_SITES);
    const missing = entries.filter(([rel]) => !existsSync(join(SRC, rel))).map(([rel]) => rel);
    expect(
      missing,
      `这些站点已不存在于 src 下（多半已迁移/改名/删除），请从 REMAINING_LEGACY_SITES 删除：${missing.join(', ')}`,
    ).toEqual([]);

    const staleFiles = [];
    const staleHits = [];
    for (const [rel, allowed] of entries) {
      if (missing.includes(rel)) continue;
      const hits = scanFile(join(SRC, rel));
      if (hits.length === 0) { staleFiles.push(rel); continue; }
      for (const h of allowed) {
        if (!hits.includes(h)) staleHits.push(`${rel}:${h}`);
      }
    }
    expect(staleFiles, `这些文件已完全替换完成（无任何命中），请从 REMAINING_LEGACY_SITES 删除：${staleFiles.join(', ')}`).toEqual([]);
    expect(
      staleHits,
      `这些白名单命中串已不再成立（行号/标识符变了，或该处已被替换掉），请更新或删除对应条目：${staleHits.join(', ')}`,
    ).toEqual([]);
  });

  it('③ 变异：合成手抄名单（数组 + SQL）必须被抓到', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ttr-guard-'));
    const mutated = join(dir, 'mutant.js');
    writeFileSync(mutated, [
      "import pool from './db.js';",
      "const HARNESS_TASK_TYPES = ['harness_planner', 'harness_fix'];",
      "export const Q = `SELECT 1 FROM tasks WHERE task_type NOT IN ('device_job', 'content-export')`;",
    ].join('\n'));
    const hits = scanFile(mutated);
    expect(hits.length, '变异体没被抓到，守卫失效').toBeGreaterThanOrEqual(2);
    expect(hits.some((h) => h.endsWith(':HARNESS_TASK_TYPES'))).toBe(true);
    expect(hits.some((h) => h.endsWith(':SQL'))).toBe(true);
  });

  it('③b 干净文件不误报（只 import 派生集合 + 非字面量 SQL + 数组下标）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ttr-guard-'));
    const clean = join(dir, 'clean.js');
    writeFileSync(clean, [
      "import { PIPELINE_WATCHDOG_TASK_TYPES } from './lib/task-type-registry.js';",
      "export const Q = `SELECT 1 FROM tasks WHERE task_type = ANY($1)`;",
      "// 巧合命中排除：非 task_type 的业务优先级顺序，只有 2/10 命中占比 20% < 50%，不判手抄",
      "const PRIORITY_ORDER = ['knowledge', 'operations', 'research', 'finance', 'growth', 'product', 'coding', 'security', 'quality', 'agent_ops'];",
      "// 数组下标访问不是字面量起点，不该被规则 A 当成手抄名单扫描",
      "function pick(arr) { return arr[PRIORITY_ORDER.length]; }",
    ].join('\n'));
    expect(scanFile(clean)).toEqual([]);
  });

  it('④ 真实变异（Task 4 改用合成样本）：注释掉 HARNESS_CHAIN_TYPES 声明行，该命中必须消失', () => {
    // monitor-loop.js:200 的 HARNESS_CHAIN_TYPES 与 :37 的 HARNESS_TASK_TYPES 在 Task 4
    // 已改为 import 注册表派生集合（HARNESS_CHAIN_TASK_TYPES / MONITOR_LONG_RUNNING_TASK_TYPES），
    // 真实文件不再含手抄字面量。原样保留这两个真实站点被抓到过的原文，验证规则 A 对
    // "同一文件两处独立数组声明，各自精确定位到声明行" 的能力不因替换而失去覆盖
    // （同 ⑦ 的改法：真实反例已消失，回归价值改由合成样本保留）。
    const original = [
      "const HARNESS_TASK_TYPES = [",
      "  'harness_planner', 'harness_contract_propose', 'harness_contract_review',",
      "  'harness_generate', 'harness_fix', 'arch_review'",
      "];",
      "",
      "function checkStuck(taskType) {",
      "  const HARNESS_CHAIN_TYPES = new Set([",
      "    'harness_planner', 'harness_contract_propose', 'harness_contract_review',",
      "    'harness_generate', 'harness_fix', 'harness_report',",
      "    'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review',",
      "    'sprint_generate', 'sprint_fix', 'sprint_report'",
      "  ]);",
      "  return HARNESS_CHAIN_TYPES.has(taskType);",
      "}",
    ].join('\n');

    const dir = mkdtempSync(join(tmpdir(), 'ttr-guard-real-'));
    const beforePath = join(dir, 'monitor-loop.before.js');
    writeFileSync(beforePath, original);
    const beforeHits = scanFile(beforePath);
    expect(beforeHits.some((h) => h.endsWith(':HARNESS_CHAIN_TYPES'))).toBe(true);
    expect(beforeHits.some((h) => h.endsWith(':HARNESS_TASK_TYPES'))).toBe(true);

    const mutated = original.replace(
      '  const HARNESS_CHAIN_TYPES = new Set([',
      '  // const HARNESS_CHAIN_TYPES = new Set([',
    );
    expect(mutated).not.toEqual(original);

    const mutatedPath = join(dir, 'monitor-loop.mutated.js');
    writeFileSync(mutatedPath, mutated);
    const afterHits = scanFile(mutatedPath);

    expect(
      afterHits.some((h) => h.endsWith(':HARNESS_CHAIN_TYPES')),
      'HARNESS_CHAIN_TYPES 声明行被注释后，规则 A 仍然命中它——说明正则没有精确到该行',
    ).toBe(false);
    expect(afterHits.some((h) => h.endsWith(':HARNESS_TASK_TYPES'))).toBe(true);
  });

  it('⑤ 规则 C 正例：EXECUTOR_KIND_FOR 手抄对象字面量（Task 6 改用合成样本）必须被抓到', () => {
    // executor-contracts.js:36 的 EXECUTOR_KIND_FOR 在 Task 6 已改为
    // `{...EXECUTOR_KIND_FOR_TASK_TYPE, __bridge_path, __local_spawn}`（注册表派生，
    // 只 spread 一个 import 的对象 + 两个 sentinel，顶层不再有任何 task_type 字符串字面量
    // key），真实文件不再含手抄字面量，同 ④ 的改法：原样保留这个真实站点被抓到过的原文，
    // 用合成样本验证规则 C 对"顶层 key 落在白名单、命中数≥2 且占比≥0.7"这个对象字面量
    // 形态的识别能力不因替换而失去覆盖。
    const dir = mkdtempSync(join(tmpdir(), 'ttr-guard-'));
    const mutated = join(dir, 'executor-contracts-kind-for.js');
    writeFileSync(mutated, [
      "export const EXECUTOR_KIND_FOR = {",
      "  harness_initiative: 'relay-container',",
      "  golden_path_proposal: 'relay-container',",
      "  dev: 'brain-local',",
      "  'content-pipeline': 'external-worker',",
      "  'content-research': 'external-worker',",
      "  'content-copywriting': 'external-worker',",
      "  'content-copy-review': 'external-worker',",
      "  'content-generate': 'external-worker',",
      "  'content-image-review': 'external-worker',",
      "  'content-export': 'external-worker',",
      "  __bridge_path: 'bridge',",
      "  __local_spawn: 'brain-local',",
      "};",
    ].join('\n'));
    const hits = scanFile(mutated);
    expect(
      hits.some((h) => h.endsWith(':EXECUTOR_KIND_FOR')),
      `未抓到 EXECUTOR_KIND_FOR，规则 C 失效。实际命中：${hits.join(',')}`,
    ).toBe(true);
  });

  it('⑥ 规则 C 反例：tick-scheduler.js 的 EXECUTOR_ROUTING 键含非法 task_type，不该被抓', () => {
    const hits = scanFile(join(SRC, 'tick-scheduler.js'));
    expect(
      hits.some((h) => h.endsWith(':EXECUTOR_ROUTING')),
      `规则 C 误报了 EXECUTOR_ROUTING（不该抓，键含非法 task_type）。实际命中：${hits.join(',')}`,
    ).toBe(false);
  });

  it('⑦ 规则 A 第三轮正例：内联数组（无声明绑定）必须被抓到——合成样本', () => {
    // recurring.js:221 曾是本轮审查给出的原始反例（`const codingMutation = skill === '/dev' ||
    // [...].includes(taskType)`，数组从没被赋给任何具名常量），已在 Task 3 裁决后改用
    // RECURRING_CODING_MUTATION_TASK_TYPES.includes(taskType)（见 lib/task-type-registry.js），
    // 真实站点不再是这个形状。改用合成样本保留这条回归覆盖：位置无关扫描必须抓到"无声明绑定
    // 的内联数组 + 紧跟方法调用"这个模式。
    const dir = mkdtempSync(join(tmpdir(), 'ttr-guard-'));
    const mutated = join(dir, 'inline-array.js');
    writeFileSync(mutated, [
      "function pick(skill, taskType) {",
      "  return skill === '/dev' || [",
      "    'dev', 'codex_dev', 'initiative_execute', 'sprint_generate', 'sprint_fix',",
      "    'harness_generate', 'harness_fix', 'pipeline_rescue',",
      "  ].includes(taskType);",
      "}",
    ].join('\n'));

    const hits = scanFile(mutated);
    expect(
      hits.some((h) => /^2:/.test(h)),
      `未抓到内联数组，规则 A 的位置无关扫描失效。实际命中：${hits.join(',')}`,
    ).toBe(true);
    // 标识符应取到字面量结束后紧跟的方法调用 `.includes`（没有声明名/属性名可用）。
    expect(hits.some((h) => h === '2:.includes')).toBe(true);
  });

  it('⑧ 规则 A 变体正例（Task 4 审查修复）：单元素绑定参数名单必须被抓到——合成样本还原 credential-expiry-checker.js 替换前原形', () => {
    // credential-expiry-checker.js 替换前的真实写法：SKIP_TASK_TYPES 只有 1 个真实
    // task_type（'pipeline_rescue'），命中数 1 < 主阈值要求的 2，规则 A 主判据从未
    // 抓到过它——直到它被拼进 `task_type NOT IN (${占位符})` 当绑定参数，才是真正的
    // "手抄名单"风险（漏加新类型会直接改变查询语义）。真实站点已替换为 import
    // AUTH_RECOVERY_SKIP_TASK_TYPES，改用合成样本保留这条回归覆盖。
    const dir = mkdtempSync(join(tmpdir(), 'ttr-guard-'));
    const mutated = join(dir, 'bind-param-array.js');
    writeFileSync(mutated, [
      "const SKIP_TASK_TYPES = ['pipeline_rescue'];",
      "",
      "async function recoverAuthQuarantinedTasks(pool) {",
      "  const skipTypesPlaceholders = SKIP_TASK_TYPES.map((_, i) => `$${i + 1}`).join(', ');",
      "  return pool.query(",
      "    `SELECT id FROM tasks WHERE status = 'quarantined' AND task_type NOT IN (${skipTypesPlaceholders})`,",
      "    SKIP_TASK_TYPES,",
      "  );",
      "}",
    ].join('\n'));

    const hits = scanFile(mutated);
    expect(
      hits.some((h) => h.endsWith(':SKIP_TASK_TYPES')),
      `未抓到单元素绑定参数名单，规则 A 变体失效。实际命中：${hits.join(',')}`,
    ).toBe(true);
  });

  it('⑨ 规则 A 变体反例：单元素数组若不在"绑定参数"文件语境里，不该被抓（避免偶然撞库误报）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ttr-guard-'));
    const clean = join(dir, 'single-element-no-bind.js');
    writeFileSync(clean, [
      // 'review' 恰好是真实 task_type，但本文件不含 task_type 绑定参数的 SQL 形态，
      // 不该被规则 A 变体误伤（例如某处纯粹拿它当字符串常量用，与 task_type 无关）。
      "const ONLY_LABEL = ['review'];",
      "console.log(ONLY_LABEL[0]);",
    ].join('\n'));
    expect(scanFile(clean)).toEqual([]);
  });

  it('⑩（终审 I2 回归）豁免清单必须逐命中串核对：executor.js 白名单外新增的手抄不得被整文件豁免掩盖', () => {
    // I2：原豁免清单是纯文件名数组，测试①对清单内文件整个 `continue`——跳过扫描，
    // 不只是放行已知的 _TASK_ROUTES 那一处。这意味着以后任何人往 executor.js（或
    // 其余 10 个 long-lived 文件）里新加一段完全不相关的手抄 task_type 名单，守卫
    // 永远看不见。修复后 REMAINING_LEGACY_SITES 必须是「文件 → 允许的命中串白名单」
    // 的映射，逐命中串比对，白名单之外的新命中仍判红。
    const dir = mkdtempSync(join(tmpdir(), 'ttr-guard-i2-'));
    const mutated = join(dir, 'executor-mutant.js');
    // 复刻 executor.js 已登记的 long-lived 站点 `_TASK_ROUTES`，并在同一份文件里
    // 注入一段假想的"新手抄名单"，模拟以后有人往这个 long-lived 文件随手加一段。
    writeFileSync(mutated, [
      'export const _TASK_ROUTES = {',
      '  dev: () => {}, review: () => {}, qa: () => {}, audit: () => {},',
      '  talk: () => {}, research: () => {}, data: () => {}, exploratory: () => {},',
      '};',
      '',
      "const NEWLY_LEAKED_TYPES = ['dev', 'review', 'qa', 'audit'];",
      'export function pick(t) { return NEWLY_LEAKED_TYPES.includes(t); }',
    ].join('\n'));

    const hits = scanFile(mutated);
    // executor.js 必须仍在豁免清单里，且映射到「命中串数组」（不是整文件豁免的
    // 数组下标存在性）——按 key 取值必须是白名单命中串本身，不是 true/文件名。
    const allowed = REMAINING_LEGACY_SITES['executor.js'];
    expect(
      allowed,
      'REMAINING_LEGACY_SITES.executor.js 不是命中串白名单（仍是整文件豁免的旧结构）',
    ).toBeTruthy();
    expect(Array.isArray(allowed)).toBe(true);

    const offenders = hits.filter((h) => !allowed.includes(h));
    expect(
      offenders.length,
      `executor.js 白名单外新增的手抄没被抓到，整文件豁免仍在掩盖新问题。全部命中：${hits.join(',')}，白名单：${allowed.join(',')}`,
    ).toBeGreaterThan(0);
    // 复刻的 long-lived 站点（_TASK_ROUTES）标识符必须命中（行号是合成文件自己的，
    // 不必等于真实 executor.js 的行号——这里只验证"已登记站点的标识符仍被识别"）。
    expect(hits.some((h) => h.endsWith(':_TASK_ROUTES'))).toBe(true);
  });
});
