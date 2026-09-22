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

// PR1 替换期间的临时豁免：Task 3/4/5 每替换一处删一条；全部替换完此对象必须为空。
//
// 【终审 I2】原结构是纯文件名数组，测试①对清单内文件整个 `continue`——跳过扫描，
// 不是只放行已登记的那一处命中。以后任何人往这些 long-lived 文件里新加一段完全
// 不相关的手抄 task_type 名单，守卫永远看不见，是永久盲区（回归覆盖见测试⑩）。
// 改为 `{ 相对路径: [允许的命中串, ...] }` 的映射——命中串形如 `行:标识符`
// （见 scanFile），逐条核对：清单内文件的命中，只有不在该文件白名单数组里的才是
// offender；清单外文件任何命中都是 offender（不变）。测试②同步改为逐条检查白名单
// 里的每个命中串是否仍然成立（而不是"整个文件还有没有任意命中"）。
//
// 演进历史（实测见 task-2-report.md「修复」各节）：
// - 19 → 27（Task 2 首版）→ 27 → 34（第一轮，规则 A 语义识别）→ 34 → 40
//   （第二轮，补规则 C 对象字面量）：见 task-2-report.md 第一/二轮章节。
// - 40 → 44（第三轮，规则 A/C 去掉声明绑定限定，位置无关扫描）：新增
//   `recurring.js`（本轮审查给出的原始反例，kind: enum）/ `model-profile.js`
//   （kind: map）/ `role-registry.js`（kind: map，同一文件 4 处独立
//   task_types 映射）/ `routes/tasks.js`（kind: map）。`executor.js` /
//   `routes/execution.js` / `task-router.js` 里新增的内联命中（各自的
//   `.includes`/`task_types`/`skill` 等站点）落在已在清单里的文件，不新增
//   清单条目。
// - Task 3（派发类）实测：9 处原定站点 + task-queue-lanes.js/executor.js（6 处独立常量
//   + :2346 内联）已替换为 import 注册表派生集合，见 task-3-report.md。
// - Task 3 裁决后（同一份报告「裁决后」节）：actions.js（systemTypes）、dispatcher.js（SQL
//   `IN (...)`）、lib/review-task-types.js、recurring.js:221 全部清零退出清单；
//   task-router.js/executor.js 里能一对一映射到注册表字段的站点（SKILL_WHITELIST/
//   LOCATION_MAP/TASK_REQUIREMENTS/ASYNC_CALLBACK_TYPES、executor.js 的 skillMap/modeMap）
//   也已改注册表派生（对象型用 deep-equal fixture 校验零行为变化）。两个文件里各剩 1 处
//   真正的 long-lived: map（task-router.js:135 的 2 项业务降级链 FALLBACK_STRATEGIES.skill、
//   executor.js:2329 的 task_type→handler 函数路由表 _TASK_ROUTES，函数值无法进纯数据注册表）
//   ——kind: enum 在这两个文件里已清零，只剩 kind: map。
// - Task 6（补充五+补充六收尾）：`executor-contracts.js` 的 `EXECUTOR_KIND_FOR` 改从注册表
//   `EXECUTOR_KIND_FOR_TASK_TYPE` 派生（+ 两个路径 sentinel），退出清单——清单变量从
//   kind: map 12 条降到 11 条。补充五点名的 5 处未分配站点（agent-ops.js/content-pipeline.js/
//   task-weight.js/tick-helpers.js/token-budget-planner.js）逐条评估：全部无法一对一映射到
//   现有注册表字段（各自持有与"分类标签"正交的独立数据——展示文案/LLM prompt/数值权重/
//   降级判据/供应商亲和度配置），标 long-lived: map + 理由，未改动这 5 个文件本身的代码
//   （只改本清单注解）。至此清单里 **kind: enum 已在全部文件清零，只剩 kind: map**，
//   这 11 条即为 PR1 终态允许保留的清单（`packages/brain/scripts/audit/registry-vs-base.mjs`
//   另行对全部已替换站点做"注册表派生值 vs 基线源码原文"机械审计，见该脚本头注释）。
export const REMAINING_LEGACY_SITES = {
  // kind: map（long-lived）— 唯一残留 :2329 _TASK_ROUTES（task_type→handler 函数，无法表示为注册表纯数据字段）
  'executor.js': ['2329:_TASK_ROUTES'],
  // kind: map（long-lived）— Task 4 评估：:60 model_map 是 task_type→{provider,model,cascade}
  // 的模型路由调优配置（嵌套对象，非简单字符串），逐 type 独立调参（如 harness_planner 用 opus、
  // harness_generate 用 sonnet），无匹配注册表单一字段，且属运营调参数据非"哪类"分类标签
  'model-profile.js': ['60:model_map'],
  // kind: map（long-lived）— Task 4 评估：4 处 task_types 是 CTO/CPO/CMO/CFO/COO
  // 五个业务角色的任务归属划分（key===value 恒等映射，充当归属集合），是与现有 9 个字段
  // （surface/coding/pr/executor/watchdog/push_to_notion/tick_dispatchable/cleanup_class/db）
  // 正交的第 10 个业务归属轴，新增会是主理人裁决范畴（角色边界怎么划），非 PR1 零行为变化范围
  'role-registry.js': ['26:task_types', '49:task_types', '70:task_types', '95:task_types'],
  // kind: map（long-lived）— Task 6 评估：:17 SKILL_BY_TASK_TYPE 只覆盖 10 个
  // task_type（不是全量），且值与 SKILL_WHITELIST/EXECUTOR_SKILL_MAP 都不同（如
  // harness_initiative 这里写 'harness(skill-relay)'，两处已有映射表都是别的值）——是运行舱只读
  // 展示端点自己的第三份独立"推不出=null"降级展示文案，不是"哪类"的分类标签，无匹配注册表字段
  'routes/agent-ops.js': ['17:SKILL_BY_TASK_TYPE'],
  // kind: map（long-lived）— Task 6 评估：:101 STEP_SYSTEM_PROMPTS 是
  // 6 个 content-* task_type 各自专属的完整 LLM system prompt 长文本（调 LLM 用），不是分类标签，
  // 无法也不应该折进注册表的 T() 字段
  'routes/content-pipeline.js': ['101:STEP_SYSTEM_PROMPTS'],
  // kind: map（long-lived）— enum 部分（STAGE_ORDER/STAGE_LABELS）已搬进注册表 HARNESS_BUILD_STAGE_ORDER/LABELS；
  // 剩 TASK_TYPE_TO_SKILL（:933，task_type→skill目录名，与 SKILL_WHITELIST/EXECUTOR_SKILL_MAP
  // 语义相近但值不同——第3份独立维护，PR1 只搬家不合并）+ BASE_LABELS（:1021，task_type→短展示
  // 标签，第5份独立维护的 label 映射，无匹配注册表字段）
  'routes/harness.js': ['933:TASK_TYPE_TO_SKILL', '1021:BASE_LABELS'],
  // kind: map（long-lived）— Task 4 评估：:879 description 是 GET /api/brain/task-types
  // 的人类可读展示文案（仅5个类型有文案，不是"哪类"的分类标签），要对应注册表字段需给全部
  // ~80 个 task_type 逐个写产品文案，属独立的文档撰写工作，非 PR1 零行为变化范围
  'routes/tasks.js': ['879:description'],
  // kind: map（long-lived）— 唯一残留 :55 FALLBACK_STRATEGIES.skill（仅2项业务专用降级链 review→code_review→dev，非"哪类"的分类标签，无匹配注册表字段）
  'task-router.js': ['55:skill'],
  // kind: map（long-lived）— Task 6 评估：:25 TASK_TYPE_ADJUSTMENTS 是派发权重的数值
  // 调优表（+20/-10 这类优先级加减分），与现有 9 个字段（分类/流程标签）正交的第三个独立运营
  // 调参轴（另两个已知独立轴：model-profile.js 的模型路由、role-registry.js 的角色归属）
  'task-weight.js': ['25:TASK_TYPE_ADJUSTMENTS'],
  // kind: map（long-lived）— Task 6 评估：:27 TASK_TYPE_AGENT_MAP 只 6 项，且
  // research/content_publish 故意写 null 触发特殊降级路径（人工处理 / 按 payload.platform 动态路由），
  // 与 EXECUTOR_SKILL_MAP 同名 key 的值不完全相同（research: null vs ''；content_publish: null vs
  // '/dev'）——是 routeTask() 自己的降级判据表，不是纯粹的分类标签
  'tick-helpers.js': ['27:TASK_TYPE_AGENT_MAP'],
  // kind: map（long-lived）— Task 6 评估：:58 EXECUTOR_AFFINITY 是
  // task_type→{primary,fallback,no_downgrade} 的 LLM 供应商亲和度调优配置（Claude/Codex 选型 +
  // 降级策略），与 model-profile.js 的模型路由同属运营调参数据，非分类标签，无匹配注册表字段
  'token-budget-planner.js': ['58:EXECUTOR_AFFINITY'],
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
