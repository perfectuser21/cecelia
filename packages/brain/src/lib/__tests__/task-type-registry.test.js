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
const MIG = join(HERE, '..', '..', '..', 'migrations', '471_script_executor_kind_and_task_type.sql');

// 合并前 Minor：Set 相等只比对成员，不比对个数——数组里混进一个重复项（顶替掉
// 别的类型）不会被 new Set(a).toEqual(new Set(b)) 抓到，先钉长度相等再比集合。
const same = (a, b) => {
  expect(a.length, `长度不等：a.length=${a.length} b.length=${b.length}\na=${JSON.stringify(a)}\nb=${JSON.stringify(b)}`).toBe(b.length);
  expect(new Set(a)).toEqual(new Set(b));
};

const FIX = {
  // TICK_DISPATCH_EXCLUDED 不在这个通用 FIX 循环里比较（见下方专属测试，PR2 审查修复）——
  // 该循环对每个集合都做 `.filter((t) => t !== NEW_TYPE)`，会把 qiumi_task 从比较里剔除，
  // 掩盖住 qiumi_task 在不在 TICK_DISPATCH_EXCLUDED 这件事；PR2 曾打上 tick_dispatchable=false
  // 的第二道闸、PR3 又放开，两次都必须用不做剔除的严格相等断言钉住。
  INITIATIVE_LOCK_TASK_TYPES: ['harness_task', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_fix', 'harness_initiative', 'golden_path_proposal'],
  RETIRED_HARNESS_TYPES_DISPATCH: ['harness_task', 'harness_ci_watch', 'harness_fix', 'harness_final_e2e', 'harness_planner'],
  GUIDED_TASK_TYPES: ['dev', 'harness_initiative'],
  BACKPRESSURE_BYPASS_TASK_TYPES: ['harness_initiative', 'harness_task', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_fix', 'harness_ci_watch', 'harness_deploy_watch', 'dev', 'content_publish'],
  CODEX_SLOT_TASK_TYPES: ['codex_qa', 'codex_dev', 'codex_test_gen', 'crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register'],
  HARNESS_INFLIGHT_TASK_TYPES: ['harness_initiative', 'golden_path_proposal'],
  SYSTEM_TASK_TYPES: ['dept_heartbeat', 'codex_qa', 'initiative_verify', 'initiative_plan', 'code_review', 'prd_review', 'spec_review', 'code_review_gate', 'initiative_review', 'crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register', 'content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export', 'content_publish', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'harness_evaluate', 'harness_report', 'harness_initiative', 'harness_task', 'harness_final_e2e'],
  // VALID_TASK_TYPES 不在这个通用 FIX 循环里比较（见下方专属测试）——该循环对每个
  // 集合都做 `.filter((t) => t !== NEW_TYPE)`，会把 qiumi_task 从比较里剔除；但
  // qiumi_task 在 PR1 明确不得进 VALID_TASK_TYPES（V 标签留给 PR2 入口刀开启），必须
  // 用不做任何剔除的严格相等断言钉住这件事，见 VALID_TASK_TYPES_FIX + 下方专属 it()。
  // alertness/escalation.js:73-83 export const CANCEL_EXEMPT_TYPES（与下面 pause 的内联名单不同：多 research/suggestion_plan/content_publish）
  CANCEL_EXEMPT_TYPES: ['research', 'suggestion_plan', 'content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export', 'content_publish', 'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review', 'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'arch_review', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_evaluate', 'harness_fix', 'harness_ci_watch', 'harness_deploy_watch', 'harness_report'],
  CONTENT_TASK_TYPES: ['content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export', 'content_publish'],
  RESEARCH_TASK_TYPES: ['research', 'explore', 'knowledge', 'talk', 'strategy_session', 'intent_expand', 'suggestion_plan', 'scope_plan', 'project_plan', 'okr_initiative_plan', 'okr_scope_plan', 'okr_project_plan', 'initiative_plan', 'dept_heartbeat', 'strategist_decision'],
  REVIEW_TASK_TYPES: ['review', 'qa', 'audit', 'codex_qa', 'codex_test_gen', 'pr_review', 'code_review', 'decomp_review', 'initiative_verify', 'architecture_design', 'architecture_scan', 'arch_review', 'prd_review', 'spec_review', 'code_review_gate', 'initiative_review', 'ci_patrol', 'staging_e2e', 'harness_evaluate', 'harness_final_e2e'],
  CODING_TASK_TYPES: ['dev', 'codex_dev', 'initiative_execute', 'sprint_generate', 'sprint_fix', 'harness_generate', 'harness_fix', 'harness_initiative', 'pipeline_rescue'],
  CODING_MUTATION_TASK_TYPES: ['dev', 'codex_dev', 'initiative_execute', 'sprint_generate', 'sprint_fix', 'harness_generate', 'harness_fix', 'pipeline_rescue', 'harness_initiative'],
  PUSH_EXCLUDED_TASK_TYPES: ['device_job'],
  KERNEL_RUN_ELIGIBLE_TASK_TYPES: ['harness_initiative', 'golden_path_proposal'],
  // Task 4 实测更正：原 fixture（及 Task 1 registry 的 ANC 标签）漏抄了 anchor-check.js:34-39
  // 的 content-pipeline 8 项（缺 content-review）/ sprint 4 项（sprint_generate/evaluate/
  // fix/report，缺 sprint_planner/contract_propose/contract_review）/ golden_path_proposal
  // 共 13 项——原文件逐字核对后补全，registry 已同步补上这 13 个类型的 ANC 标签。
  ANCHOR_EXEMPT_TASK_TYPES: ['dept_heartbeat', 'arch_review', 'ci_patrol', 'research', 'explore', 'talk', 'data', 'staging_e2e', 'deploy_drill', 'nightly', 'janitor', 'strategist_decision', 'harness_initiative', 'harness_task', 'harness_final_e2e', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'harness_evaluate', 'harness_report', 'harness_controller', 'codex_qa', 'codex_dev', 'codex_test_gen', 'initiative_verify', 'initiative_plan', 'code_review', 'prd_review', 'spec_review', 'code_review_gate', 'initiative_review', 'crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register', 'content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export', 'content_publish', 'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'sprint_report', 'golden_path_proposal'],
  MONITOR_LONG_RUNNING_TASK_TYPES: ['harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'arch_review'],
  // monitor-loop.js:200 原内联 HARNESS_CHAIN_TYPES（Task 4 补充新增站点）
  HARNESS_CHAIN_TASK_TYPES: ['harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'harness_report', 'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review', 'sprint_generate', 'sprint_fix', 'sprint_report'],
  // nightly-orchestrator.js:122 原内联 scoreTask typeScore（Task 4 实测发现，守卫清单从「整文件豁免」
  // 收窄到「按行替换」后才现形，原不在 task-4-brief 明确列出的行号范围内）
  NIGHTLY_KR_BONUS_TASK_TYPES: ['dev', 'review', 'code_review', 'qa'],
  // triage-officer-15min.js:41 / triage-officer-rank.js:72,130 / work-routing-observability.js:44
  // 共4处原内联 ['dev','harness_initiative']（补充/补充二新增站点）
  GP_SCOPE_TASK_TYPES: ['dev', 'harness_initiative'],
  // routes/execution.js:3721 GET /api/brain/dev/tasks 原内联 ['dev','review']
  DEV_DASHBOARD_TASK_TYPES: ['dev', 'review'],
  // routes/execution.js:1659 原内联 VERDICT_HARNESS_TYPES
  VERDICT_HARNESS_TASK_TYPES: ['harness_contract_propose', 'harness_contract_review', 'harness_evaluate'],
  // routes/warroom.js:36 原内联 FEED_TYPES
  WARROOM_FEED_TASK_TYPES: ['harness_initiative', 'dev', 'content-pipeline', 'platform_scraper'],
  PIPELINE_WATCHDOG_TASK_TYPES: ['harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'harness_ci_watch', 'harness_deploy_watch', 'harness_evaluate', 'harness_report'],
  RECOVERY_HARNESS_TASK_TYPES: ['harness_initiative', 'harness_task', 'harness_evaluate', 'harness_contract_propose', 'harness_contract_review', 'harness_planner', 'harness_generator', 'harness_generate', 'harness_fix'],
  RECURRING_TASK_TYPES: ['dept_heartbeat', 'codex_qa'],
  PROTECTED_TASK_TYPES: ['initiative_plan', 'initiative_verify', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'arch_review', 'harness_ci_watch', 'harness_deploy_watch', 'harness_report'],
  ESCALATION_EXEMPT_TASK_TYPES: ['sprint_planner', 'sprint_contract_propose', 'sprint_contract_review', 'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'arch_review', 'content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export', 'harness_initiative', 'harness_task', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_evaluate', 'harness_fix', 'harness_ci_watch', 'harness_deploy_watch', 'harness_report'],
  AUTH_RECOVERY_SKIP_TASK_TYPES: ['pipeline_rescue'],
  NIGHTLY_EXCLUDED_TASK_TYPES: ['harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_evaluate', 'harness_fix', 'harness_report', 'sprint_planner', 'sprint_generate', 'sprint_evaluate'],
  // task-queue-lanes.js:1 PIPELINE_TASK_TYPES（Task 3 补充二新增站点）
  PIPELINE_TASK_TYPES: ['content-pipeline', 'content-export', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-review', 'content_publish', 'harness_ci_watch', 'harness_deploy_watch'],
  // executor.js:2018 isFixMode（Task 3 补充二新增站点）
  FIX_MODE_TASK_TYPES: ['sprint_fix', 'harness_fix'],
  // executor.js:2019 isHarnessV4 / :2375 _HARNESS_GENERATE_TYPES（同一字面量两处，Task 3 补充二新增站点）
  HARNESS_V4_TASK_TYPES: ['harness_generate', 'harness_fix'],
  // executor.js:2346 _isSprintOrHarnessDevMode 内联数组（Task 3 补充三新增站点）
  SPRINT_HARNESS_DEV_TASK_TYPES: ['sprint_generate', 'sprint_fix'],
  // executor.js:4198 CONTENT_PIPELINE_TYPES（Task 3 补充二新增站点；= executor==='external-worker' 的 task_type）
  CONTENT_PIPELINE_TYPES: ['content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export'],
  // actions.js:19 systemTypes（Task 3 裁决后新增站点）
  NO_GOAL_TASK_TYPES: ['research', 'intent_expand'],
  // task-router.js:24 ASYNC_CALLBACK_TYPES（Task 3 裁决后新增站点）
  ASYNC_CALLBACK_TASK_TYPES: ['explore', 'research'],
  // lib/review-task-types.js 原 REVIEW_TASK_TYPES 字面量（与 actions.js 的 family:review 派生
  // REVIEW_TASK_TYPES 语义不同，只搬家不合并，见注册表 REVIEWISO 定义处注释）
  REVIEW_ISOLATION_TASK_TYPES: ['spec_review', 'code_review_gate', 'prd_review', 'initiative_review', 'code_review', 'decomp_review', 'initiative_plan', 'initiative_verify', 'arch_review', 'architecture_design', 'architecture_scan'],
  // recurring.js:221 原内联数组（与 CODING_MUTATION_TASK_TYPES 语义不同，缺 harness_initiative，
  // 只搬家不合并，见注册表 RECMUT 定义处注释）
  RECURRING_CODING_MUTATION_TASK_TYPES: ['dev', 'codex_dev', 'initiative_execute', 'sprint_generate', 'sprint_fix', 'harness_generate', 'harness_fix', 'pipeline_rescue'],
};

// ── Map 型 fixture（对象 deep-equal，非 Set 比较）：SKILL_WHITELIST / LOCATION_MAP /
// TASK_REQUIREMENTS（task-router.js）、EXECUTOR_SKILL_MAP / EXECUTOR_MODE_MAP
// （executor.js 私有 skillMap/modeMap）。原样抄自替换前的源文件字面量。
const MAP_FIX = {
  SKILL_WHITELIST: {
  'dev': '/dev',
  'review': '/code-review',
  'talk': '/cecelia',
  'data': '/sync-hk',
  'qa': '/code-review',
  'audit': '/code-review',
  'research': '/research',
  'explore': '/explore',
  'knowledge': '/knowledge',
  'codex_qa': '/codex',
  'codex_dev': '/dev',  // Codex Provider 跑 /dev — 与 dev 相同 skill，通过 runner.sh 执行
  'crystallize': '/playwright',         // crystallize 编排入口 — 西安 M4 CDP 控制 PC
  'crystallize_scope': '/playwright',   // Scope 阶段：定义目标 + DoD
  'crystallize_forge': '/playwright',   // Forge 阶段：Codex 探索写脚本
  'crystallize_verify': '/playwright',  // Verify 阶段：无 LLM 验证3次
  'crystallize_register': '/playwright', // Register 阶段：注册到 SKILL.md
  'codex_test_gen': '/codex-test-gen',  // Codex 自动生成测试 — 西安 M4 扫描覆盖率低模块
  'pr_review': '/review',  // 异步 PR 审查 → 西安 Codex 独立 LLM 审查
  'code_review': '/code-review',
  'decomp_review': '/decomp-check',
  'dept_heartbeat': '/cecelia',
  'initiative_plan': '/decomp',
  'initiative_verify': '/arch-review verify',
  'suggestion_plan': '/plan',
  'architecture_design': '/architect design',
  'architecture_scan': '/architect scan',
  'arch_review': '/arch-review review',
  'strategy_session': '/strategy-session',
  // 前置审查（Intent Expansion）
  'intent_expand': '/intent-expand',  // 意图扩展 → US 本机，查 OKR/Vision 链路补全 PRD
  // Initiative 执行
  'initiative_execute': '/dev',       // Initiative 执行 → US 本机，/dev 全流程
  // 内容工厂 Pipeline（Content Factory）
  'content-pipeline': '/content-creator',
  'content-research': '/notebooklm',
  'content-copywriting': '/content-creator',
  'content-copy-review': '/content-creator',
  'content-generate': '/content-creator',
  'content-image-review': '/content-creator',
  'content-export': '/content-creator',
  'content_publish': '/content-creator',  // 发布阶段 → executor 按 payload.platform 路由到对应 publisher skill
  // Codex Gate 审查任务类型
  'prd_review': '/prd-review',              // PRD 审查
  'spec_review': '/spec-review',            // Spec 审查
  'code_review_gate': '/code-review-gate',  // 代码质量门禁
  'initiative_review': '/initiative-review', // Initiative 整体审查
  // Harness v3.x 旧类型（向后兼容）
  'sprint_planner': '/sprint-planner',
  'sprint_contract_propose': '/sprint-contract-proposer',
  'sprint_contract_review': '/sprint-contract-reviewer',
  'sprint_generate': '/dev',
  'sprint_fix': '/dev',
  'sprint_report': '/sprint-report',
  // Harness v4.0 新类型
  // 注：harness_planner 已退役（PR retire-harness-planner，2026-04-26）
  'harness_contract_propose': '/harness-contract-proposer',   // Layer 2a: 提合同草案
  'harness_contract_review': '/harness-contract-reviewer',    // Layer 2b: 挑战合同
  'harness_generate': '/harness-generator',                   // Layer 3a: Generator 写代码
  'ci_patrol': '/ci-patrol',
  'strategist_decision': '/line-strategist',
  'harness_ci_watch': '/_internal',                           // Brain tick 内联处理（不派 agent）
  'harness_fix': '/harness-generator',                        // Layer 3d: Generator 修复（同 generator skill）
  'harness_deploy_watch': '/_internal',                       // Brain tick 内联处理（不派 agent）
  'harness_evaluate': '/harness-evaluator',                   // FIX (P0) Layer 3e: Evaluator 对抗性功能验收（运行中应用 curl/Playwright）
  'harness_report': '/harness-report',                        // Layer 4: 最终报告
  'staging_e2e': '/_internal',                                // Slice9: native 执行（executor 短路），不派 agent
  'harness_intervention': '/_internal',                       // 人工干预任务类型（Brain 内部处理）
  // Scope 层飞轮（Project→Scope→Initiative）
  'scope_plan': '/decomp',        // Scope 内规划下一个 Initiative
  'project_plan': '/decomp',      // Project 内规划下一个 Scope
  // OKR 新表飞轮（okr_projects→okr_scopes→okr_initiatives）
  'okr_initiative_plan': '/decomp',  // OKR Scope 内规划下一个 Initiative
  'okr_scope_plan': '/decomp',       // OKR Project 内规划下一个 Scope
  'okr_project_plan': '/decomp',     // OKR Project 层完成后规划
  // 发布后数据回收（Brain 内部处理，声明 skill 避免路由校验失败）
  'platform_scraper': '/media-scraping',
  // Harness v2 新类型（M1 复用现有 skill，M2/M5 会重写）
  'harness_initiative': '/harness-planner',   // 阶段 A — M1 复用 planner skill
  'harness_task': '/_internal',               // 阶段 B — Brain tick 内部状态机，不派 agent
  'harness_final_e2e': '/harness-evaluator',  // 阶段 C — M1 复用 evaluator skill
  'golden_path_proposal': '/capability-controller', // GP 提案 — relay 实际 spawn skill 由 harness-skill-relay 映射
  },
  LOCATION_MAP: {
  'dev': 'us',        // 写代码 → US (Nobel + Opus + /dev)
  'review': 'us',     // 代码审查 → US (Sonnet + /review)
  'qa': 'us',         // QA → US (Sonnet)
  'audit': 'us',      // 审计 → US (Sonnet)
  'codex_qa': 'xian',  // Codex 免疫检查 → 西安 Mac mini (Codex CLI via codex-bridge)
  'codex_dev': 'xian', // Codex /dev → 西安 Mac mini (runner.sh + devloop-check.sh SSOT)
  // crystallize 能力蒸馏流水线 → 西安 M4 (playwright-runner.sh + CDP → PC)
  'crystallize': 'xian',
  'crystallize_scope': 'xian',
  'crystallize_forge': 'xian',
  'crystallize_verify': 'xian',
  'crystallize_register': 'xian',
  'codex_test_gen': 'xian',   // 自动生成测试 → 西安 M4 (Codex 扫描覆盖率低模块 + 生成测试)
  'pr_review': 'xian',  // 异步 PR 审查 → 西安 Mac mini (MiniMax via Codex CLI, 独立账号)
  'code_review': 'us',      // 代码审查 → US 本机 Codex (需读代码上下文，/code-review skill)
  'decomp_review': 'us',    // 拆解审查 → US 本机 Codex (需读代码结构，Vivian 角色)
  'dept_heartbeat': 'us',   // 部门心跳 → US (MiniMax-M2.5-highspeed via cecelia-run)
  'initiative_plan': 'us',        // Initiative 规划 → US 本机 Codex (需读现有代码，/decomp skill)
  'initiative_verify': 'us',      // Initiative 验收 → US 本机 Codex (需核查代码实现，/arch-review verify)
  'suggestion_plan': 'xian',      // Suggestion 层级识别 → 西安 Codex (B類纯策略，/plan skill)
  'architecture_design': 'us',    // Architecture 设计 → US 本机 Codex (需读代码，/architect design)
  'architecture_scan': 'us',      // 系统扫描 → US 本机 Codex (需读代码，/architect scan)
  'arch_review': 'us',             // 架构巡检 → US 本机（需读本地代码+DB，/arch-review review）
  'strategy_session': 'xian',     // 战略会议 → 西安 Codex (B類，/strategy-session)
  'intent_expand': 'us',          // 意图扩展 → US 本机（需读本地 Brain DB，补全 PRD）
  'initiative_execute': 'us',     // Initiative 执行 → US 本机（/dev 全流程，A類）
  'explore': 'xian',  // 快速调研 → 西安 Codex (general，任意可用机器)
  'knowledge': 'xian',  // 知识记录 → 西安 Codex (B類，/knowledge skill)
  'talk': 'xian',     // 对话 → 西安 Codex (general，任意可用机器)
  'research': 'xian', // 深度调研 → 西安 Codex (general，任意可用机器)
  'data': 'xian',     // 数据处理 → 西安 Codex (general)
  // 内容工厂 Pipeline（Content Factory）→ 西安 Codex 执行
  'content-pipeline': 'xian',  // Pipeline 编排入口 → 西安 Codex
  'content-research': 'xian',  // 调研阶段 → 西安 (/notebooklm)
  'content-copywriting': 'xian', // 文案生成 → 西安 (/content-creator)
  'content-copy-review': 'xian', // 文案审核 → 西安（纯规则检查）
  'content-generate': 'xian',  // 图片生成 → 西安 (/content-creator)
  'content-image-review': 'xian', // 图片审核 → 西安（规则+视觉检查）
  'content-export': 'xian',    // 导出阶段 → 西安 (card-renderer.mjs)
  'content_publish': 'us',     // 发布阶段 → US 本机（publisher skills 需要浏览器 CDP，在 US Mac mini 跑）
  // Harness v3.x 旧类型（向后兼容）→ US 本机
  'sprint_planner': 'us',
  'sprint_contract_propose': 'us',
  'sprint_contract_review': 'us',
  'sprint_generate': 'us',
  'sprint_fix': 'us',
  'sprint_report': 'us',
  // Harness v4.0 → US 本机
  'harness_contract_propose': 'us',   // Layer 2a: Generator 提合同草案 → US
  'harness_contract_review': 'us',    // Layer 2b: Evaluator 挑战合同 → US
  'harness_generate': 'us',           // Layer 3a: Generator 写代码 → US
  'ci_patrol': 'us',  // CI 巡检 → US 本机（需读本地 repo + gh + Brain DB）
  'strategist_decision': 'us',  // line-strategist 需读 git 历史 + decisions API → US
  'harness_ci_watch': 'us',           // Layer 3b: CI 监控（Brain tick 内联处理）→ US
  'harness_fix': 'us',                // Layer 3d: Generator 修复 → US
  'harness_deploy_watch': 'us',       // Layer 3e: Deploy 监控（Brain tick 内联处理）→ US
  'harness_report': 'us',             // Layer 4: 最终报告 → US
  // Codex Gate 审查任务类型 → US 本机（需读 worktree diff + Brain DB）
  'prd_review': 'us',            // PRD 审查 → US 本机 Codex
  'spec_review': 'us',           // Spec 审查 → US 本机 Codex
  'code_review_gate': 'us',      // 代码质量门禁 → US 本机 Codex
  'initiative_review': 'us',     // Initiative 整体审查 → US 本机 Codex
  // Scope 层飞轮
  'scope_plan': 'xian',            // Scope 规划 → 西安 Codex (B類，/decomp skill)
  'project_plan': 'xian',          // Project 规划 → 西安 Codex (B類，/decomp skill)
  // OKR 新表飞轮
  'okr_initiative_plan': 'xian',   // OKR Initiative 规划 → 西安 Codex (B類，/decomp skill)
  'okr_scope_plan': 'xian',        // OKR Scope 规划 → 西安 Codex (B類，/decomp skill)
  'okr_project_plan': 'xian',      // OKR Project 规划 → 西安 Codex (B類，/decomp skill)
  'pipeline_rescue': 'us',        // Pipeline 救援 → US 本机（需读 .dev-mode + worktree）
  'platform_scraper': 'us',       // 数据采集任务 → Brain 内部处理（不走外部 executor，见 post-publish-data-collector.js）
  // Harness v2 → US 本机
  'harness_initiative': 'us',     // 阶段 A 入口（复用 planner skill 运行 /dev）
  'golden_path_proposal': 'us',   // GP 提案 → US 本机 relay（同 harness_initiative 路径）
  'harness_task': 'us',           // 阶段 B 单 Task（tick 内部，US Brain 处理）
  'harness_final_e2e': 'us',      // 阶段 C 最终 E2E（复用 evaluator skill）
  'harness_evaluate': 'us',      // Layer 3e: Evaluator 对抗性功能验收 → US
  'harness_intervention': 'us', // 人工干预任务类型 → US 本机处理
  'staging_e2e': 'us',          // Slice9: staging E2E native 执行 → US 本机
  },
  TASK_REQUIREMENTS: {
  // A类 - 需要 git/代码访问（US M4 独有）
  'dev':                ['has_git'],
  'ci_patrol':          ['has_git'],
  'strategist_decision':['has_git'],
  'review':             ['has_git'],
  'qa':                 ['has_git'],
  'audit':              ['has_git'],
  'code_review':        ['has_git'],
  'decomp_review':      ['has_git'],
  'initiative_plan':    ['has_git'],
  'initiative_verify':  ['has_git'],
  'arch_review':        ['has_git'],
  'architecture_design':['has_git'],
  'architecture_scan':  ['has_git'],
  'prd_review':         ['has_git'],
  'spec_review':        ['has_git'],
  'code_review_gate':   ['has_git'],
  'initiative_review':  ['has_git'],
  'intent_expand':      ['has_git'],
  'initiative_execute': ['has_git'],
  'pipeline_rescue':    ['has_git'],
  'codex_dev':          ['has_git'],
  // 需要浏览器（crystallize 各阶段均通过 CDP 控制西安 PC 浏览器）
  'crystallize':          ['has_browser'],
  'crystallize_scope':    ['has_browser'],
  'crystallize_forge':    ['has_browser'],
  'crystallize_verify':   ['has_browser'],
  'crystallize_register': ['has_browser'],
  // B类通用 - 任意 general 机器
  'codex_qa':           ['general'],
  'codex_test_gen':     ['general'],
  'pr_review':          ['general'],
  'suggestion_plan':    ['general'],
  'strategy_session':   ['general'],
  'scope_plan':         ['general'],
  'project_plan':       ['general'],
  'okr_initiative_plan': ['general'],
  'okr_scope_plan':     ['general'],
  'okr_project_plan':   ['general'],
  'knowledge':          ['general'],
  'talk':               ['general'],
  'research':           ['general'],
  'explore':            ['general'],
  'data':               ['general'],
  'dept_heartbeat':     ['general'],
  'content-pipeline':   ['general'],
  'content-research':   ['general'],
  'content-copywriting': ['general'],
  'content-copy-review': ['general'],
  'content-generate':   ['general'],
  'content-image-review': ['general'],
  'content-export':     ['general'],
  'platform_scraper':   ['has_browser'],  // 需要 CDP 浏览器接入各平台
  'content_publish':    ['has_browser'],  // 发布 skill（douyin/kuaishou 等）需要 CDP 浏览器控制
  // Harness v4.0 — 需要 git 访问（US M4 独有）
  'harness_contract_propose': ['has_git'],
  'harness_contract_review':  ['has_git'],
  'harness_generate':         ['has_git'],
  'harness_ci_watch':         ['has_git'],
  'harness_fix':              ['has_git'],
  'harness_deploy_watch':     ['has_git'],
  'harness_report':           ['has_git'],
  // Harness v2 — 需要 git 访问（US M4）
  'harness_initiative':       ['has_git'],
  'golden_path_proposal':     ['has_git'],
  'harness_task':             ['has_git'],
  'harness_final_e2e':        ['has_git'],
  },
  EXECUTOR_SKILL_MAP: {
  'dev': '/dev',           // 写代码：Opus
  'review': '/code-review', // 审查：已迁移到 /code-review
  'qa_init': '/review init', // QA 初始化：设置 CI 和分支保护
  'talk': '/talk',         // 对话：写文档，不改代码
  'research': '',          // 研究：完全只读，不挂 skill，由 preparePrompt 直接构建 prompt
  'dept_heartbeat': '/repo-lead heartbeat', // 部门主管心跳：MiniMax
  'code_review': '/code-review', // 代码审查：Sonnet + /code-review skill
  'ci_patrol': '/ci-patrol', // CI/CD 巡检：每日按 line 报硬伤（ci-patrol skill）
  // Initiative 执行循环
  'initiative_plan': '/decomp',     // Phase 2 规划下一个 PR：/decomp
  'initiative_verify': '/architect', // Initiative 收尾验收 → /architect Mode 3
  'decomp_review': '/decomp-check', // 拆解质检：/decomp-check
  // Suggestion 驱动的自主规划
  'suggestion_plan': '/plan',       // Suggestion 层级识别 → /plan skill
  // Architecture 设计
  'architecture_design': '/architect', // Initiative 级架构设计 → /architect skill
  // 战略会议：C-Suite 模拟讨论，输出带 domain 的 KR
  'strategy_session': '/strategy-session',
  // 内容工厂 Pipeline（Content Factory）
  'content-pipeline': '/content-creator',      // 编排入口：触发完整内容生成流程
  'content-research': '/notebooklm',           // 调研阶段：NotebookLM 深度调研
  'content-copywriting': '/content-creator',   // 文案生成阶段
  'content-copy-review': '/content-creator',   // 文案审核阶段
  'content-generate': '/content-creator',      // 生成阶段：图片+文案生成
  'content-image-review': '/content-creator',  // 图片审核阶段
  'content-review': '/content-creator',        // 审核阶段：AI 质量评分
  'content-export': '/content-creator',        // 导出阶段：NAS 存储 + manifest
  // 旧类型向后兼容 → 统一走 /code-review
  'qa': '/code-review',
  'audit': '/code-review',
  // 前置审查
  'intent_expand': '/intent-expand',  // 意图扩展：查 OKR/Vision 链路补全 PRD
  // Initiative 执行
  'initiative_execute': '/dev',       // Initiative 执行：/dev 全流程
  // 多平台发布（payload.platform 动态路由，见上方特判逻辑）
  'content_publish': '/dev',          // fallback：正常由上方平台路由拦截
  // Codex Gate 审查任务类型（替代旧的多步审查流程）
  'prd_review': '/prd-review',              // PRD 审查
  'spec_review': '/spec-review',            // Spec 审查
  'code_review_gate': '/code-review-gate',  // 代码质量门禁
  'initiative_review': '/initiative-review', // Initiative 整体审查
  // Scope 层飞轮（Project→Scope→Initiative）
  'scope_plan': '/decomp',        // Phase 3: Scope 内规划下一个 Initiative
  'project_plan': '/decomp',      // Phase 4: Project 内规划下一个 Scope
  'pipeline_rescue': '/dev',       // 卡住的 pipeline 接管修复 → /dev 全流程
  'codex_test_gen': '/codex-test-gen',  // Codex 自动生成测试 → 西安 M4
  'platform_scraper': '/media-scraping', // 平台数据采集 → CN Mac mini (/media-scraping skill)
  'strategist_decision': '/line-strategist',  // Line 军师决策（PR3674 终态钩子派发，见 line-strategist-dispatch.js）
  },
  EXECUTOR_MODE_MAP: {
  'dev': 'bypassPermissions',        // 写代码
  'review': 'bypassPermissions',     // 已迁移到 /code-review，需写报告
  'talk': 'bypassPermissions',       // 要调 API 写数据库
  'research': 'bypassPermissions',   // 要调 API
  'code_review': 'bypassPermissions', // 需要写报告文件到 docs/reviews/
  // 旧类型向后兼容 → 统一走 /code-review
  'qa': 'bypassPermissions',
  'audit': 'bypassPermissions',
  },
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

// 本刀唯一允许"新增"的类型：它不在任何替换前名单里（VALID_TASK_TYPES 例外，见下方
// 专属断言——PR2 明确混入），比较时剔除，其余必须逐一相等
const NEW_TYPE = 'qiumi_task';
// 棒 3（executor=script）新增的类型，同样不在任何替换前名单里；比较通用 FIX 时一并剔除，
// 它自己的名单归属由下面的专属断言严格钉死。
const NEW_TYPE_SCRIPT = 'script_run';

// task-router.js:15-62 原文（已用 awk 抽取核对，共 70 个；harness_planner 不在其中——已退役）。
// PR2 入口刀开启 qiumi_task 的 V（router_valid）标签，VALID_TASK_TYPES 严格相等改为
// FIX + qiumi_task（决策见团队 Task 3 审查「Important #2」）。
// task-router.js:15-62 原 TICK_DISPATCH_EXCLUDED 字面量（PR1 之前抄自 dispatch-helpers.js 内联名单），
// 严格相等不剔除 qiumi_task——PR2 曾给它打第二道闸（tick_dispatchable=false，比照 device_job），
// PR3 路由接线后放开，qiumi_task 必须重新退出这个集合（plan「补充一」）。
const TICK_DISPATCH_EXCLUDED_FIX = ['content-pipeline', 'content-export', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'harness_ci_watch', 'harness_deploy_watch', 'device_job'];

const VALID_TASK_TYPES_FIX = ['dev', 'review', 'talk', 'data', 'qa', 'audit', 'research', 'explore', 'knowledge', 'codex_qa', 'codex_dev', 'codex_test_gen', 'code_review', 'decomp_review', 'crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register', 'pr_review', 'dept_heartbeat', 'initiative_plan', 'initiative_verify', 'initiative_execute', 'suggestion_plan', 'architecture_design', 'architecture_scan', 'arch_review', 'strategy_session', 'intent_expand', 'content-pipeline', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export', 'content_publish', 'prd_review', 'spec_review', 'code_review_gate', 'initiative_review', 'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review', 'sprint_generate', 'sprint_fix', 'sprint_report', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_ci_watch', 'harness_fix', 'harness_deploy_watch', 'harness_report', 'scope_plan', 'project_plan', 'okr_initiative_plan', 'okr_scope_plan', 'okr_project_plan', 'platform_scraper', 'harness_initiative', 'harness_task', 'harness_final_e2e', 'harness_evaluate', 'harness_intervention', 'staging_e2e', 'ci_patrol', 'golden_path_proposal', 'strategist_decision'];

describe('task-type-registry：零行为变化', () => {
  for (const [name, expected] of Object.entries(FIX)) {
    it(`${name} 派生集合 == 替换前字面量`, () => same(R[name].filter((t) => t !== NEW_TYPE && t !== NEW_TYPE_SCRIPT), expected));
  }

  for (const [name, expected] of Object.entries(MAP_FIX)) {
    it(`${name} 派生映射 == 替换前字面量（deep-equal）`, () => expect(R[name]).toEqual(expected));
  }

  it('VALID_TASK_TYPES 派生集合 == 替换前字面量 + qiumi_task（PR2 入口刀开启，其余零变化）', () => {
    same(R.VALID_TASK_TYPES, [...VALID_TASK_TYPES_FIX, 'qiumi_task', 'script_run']);
    expect(R.VALID_TASK_TYPES).toContain('qiumi_task');
    expect(R.VALID_TASK_TYPES).toContain('script_run');
  });

  it('TICK_DISPATCH_EXCLUDED 派生集合 == 替换前字面量 + project（PR3 放开第二道闸：qiumi_task 移出，project 留下）', () => {
    // script_run（棒 3）：PR A 期间在此名单里（执行体接线前不许被 tick 当普通任务派给 claude），
    // PR B 接线 script-executor 后移出——必须用不做剔除的严格相等钉住。
    same(R.TICK_DISPATCH_EXCLUDED, [...TICK_DISPATCH_EXCLUDED_FIX, 'project']);
    expect(R.TICK_DISPATCH_EXCLUDED).not.toContain('script_run');
    expect(
      R.TICK_DISPATCH_EXCLUDED,
      'qiumi_task 还在 tick 排除名单里——dispatchQiumiTask 接线了也永远选不中',
    ).not.toContain('qiumi_task');
    // project 是 main #5486 接力棒的项目容器行：它永不落 queued 所以现在够不着 tick，
    // 但那是建行方的巧合不是闸——黑名单制下必须显式进名单，见注册表该行注释。
    // 它与本刀无关，PR3 放开的只有 qiumi_task 这一条。
    expect(R.TICK_DISPATCH_EXCLUDED).toContain('project');
  });

  it('EXECUTOR_KIND_FOR_TASK_TYPE == 替换前 EXECUTOR_KIND_FOR 的 task_type 部分 + qiumi_task', () => {
    expect(R.EXECUTOR_KIND_FOR_TASK_TYPE).toEqual({ ...FIX_EXECUTOR_KIND, qiumi_task: 'openclaw-agent', script_run: 'script' });
  });

  it('qiumi_task 声明符合 spec 1.1（PR3：V 标签已开 + tick_dispatchable=true，第一道闸改由 QIUMI_DISPATCH_ENABLED 门控 headed_manual）', () => {
    const e = R.getTaskType('qiumi_task');
    expect(e).toMatchObject({
      surface: 'openclaw-agent', coding: false, pr: false, executor: 'openclaw-agent',
      watchdog: 'openclaw-agent', push_to_notion: true, tick_dispatchable: true, db: true,
    });
    expect(R.VALID_TASK_TYPES).toContain('qiumi_task');
    expect(R.TICK_DISPATCH_EXCLUDED).not.toContain('qiumi_task');
  });

  // 放开第二道闸的连带项：tick 能选中之后，qiumi_task 要过 dispatcher 的锚点执法闸，
  // 而入账链（ingestQiumiPage → createRoutedTask）从不写 payload.anchor →
  // 不免锚的话每条秋米任务都会在路由之前被终态 failed（failure_class=missing_anchor）。
  it('qiumi_task ∈ ANCHOR_EXEMPT_TASK_TYPES（运营活不走承诺地图锚点）', () => {
    expect(
      R.ANCHOR_EXEMPT_TASK_TYPES,
      'qiumi_task 不免锚——放开 tick 派发后每条秋米任务都会被锚点闸终态 failed',
    ).toContain('qiumi_task');
  });

  it('VALUABLE_LEARNING_TASK_TYPES 严格等于 auto-learning.js:20 原字面量（含非真实类型 feature）', () => {
    expect(R.VALUABLE_LEARNING_TASK_TYPES).toEqual(['dev', 'feature', 'research', 'harness_initiative']);
  });

  it('CRYSTALLIZE_ORCHESTRATOR_STAGES/STAGE_LABELS 严格等于 crystallize-orchestrator.js:54,278 原字面量', () => {
    expect(R.CRYSTALLIZE_ORCHESTRATOR_STAGES).toEqual([
      'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register',
    ]);
    expect(R.CRYSTALLIZE_ORCHESTRATOR_STAGE_LABELS).toEqual({
      crystallize_forge: 'Forge', crystallize_verify: 'Verify', crystallize_register: 'Register',
    });
  });

  it('DAILY_SMOKE_STAGE_ORDER 严格等于 cron/daily-real-business-smoke.js:42 原字面量', () => {
    expect(R.DAILY_SMOKE_STAGE_ORDER).toEqual([
      'content-research', 'content-copywriting', 'content-copy-review',
      'content-generate', 'content-image-review', 'content-export',
    ]);
  });

  it('HARNESS_BUILD_STAGE_ORDER/LABELS 严格等于 routes/harness.js:702,707 原字面量', () => {
    expect(R.HARNESS_BUILD_STAGE_ORDER).toEqual([
      'harness_contract_propose', 'harness_contract_review',
      'harness_generate', 'harness_evaluate', 'harness_report',
      'harness_auto_merge', 'harness_deploy', 'harness_smoke_test', 'harness_cleanup',
    ]);
    expect(R.HARNESS_BUILD_STAGE_LABELS).toEqual({
      harness_contract_propose: 'Propose',
      harness_contract_review: 'Review',
      harness_generate: 'Generate',
      harness_evaluate: 'Evaluate',
      harness_report: 'Report',
      harness_auto_merge: 'Auto-merge',
      harness_deploy: 'Deploy',
      harness_smoke_test: 'Smoke-test',
      harness_cleanup: 'Cleanup',
    });
  });

  it('HARNESS_PIPELINE_LIST_STAGE_ORDER/LABELS 严格等于 routes/status.js:334,342 原字面量', () => {
    expect(R.HARNESS_PIPELINE_LIST_STAGE_ORDER).toEqual([
      'harness_contract_propose',
      'harness_contract_review',
      'harness_generate',
      'harness_ci_watch',
      'harness_report',
    ]);
    expect(R.HARNESS_PIPELINE_LIST_STAGE_LABELS).toEqual({
      harness_contract_propose: 'Propose',
      harness_contract_review: 'Review',
      harness_generate: 'Generate',
      harness_ci_watch: 'CI Watch',
      harness_report: 'Report',
    });
  });

  it('EXEC_STATUS_US_TASK_TYPES 严格等于（含顺序）routes/execution.js:3006 + learning.js:571,590 原字面量', () => {
    expect(R.EXEC_STATUS_US_TASK_TYPES).toEqual(['dev', 'review', 'qa', 'audit']);
  });

  it('EXEC_STATUS_HK_TASK_TYPES 严格等于（含顺序）routes/execution.js:3025 原字面量', () => {
    expect(R.EXEC_STATUS_HK_TASK_TYPES).toEqual(['talk', 'research', 'data']);
  });

  it('DB 白名单派生集合 == 迁移 471 的 CHECK 列表（最近一次重建该约束的迁移）', () => {
    const sql = readFileSync(MIG, 'utf8').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    const m = sql.match(/tasks_task_type_check CHECK \(\s*task_type IN \(([\s\S]*?)\)\s*\)/);
    expect(m, '471 里找不到 tasks_task_type_check 的 IN 列表').toBeTruthy();
    const dbList = [...m[1].matchAll(/'([a-z0-9_-]+)'/g)].map((x) => x[1]);
    same(R.DB_WHITELISTED_TASK_TYPES, dbList);
    expect(dbList).toContain('qiumi_task');
    expect(dbList).toContain('script_run');
  });

  it('派生集合全部冻结', () => {
    for (const [name, v] of Object.entries(R)) {
      if (name.endsWith('_TASK_TYPES') || name === 'TICK_DISPATCH_EXCLUDED' || name === 'GUIDED_TASK_TYPES' || name === 'RETIRED_HARNESS_TYPES_DISPATCH'
        || Object.keys(MAP_FIX).includes(name)) {
        expect(Object.isFrozen(v), `${name} 未冻结`).toBe(true);
      }
    }
  });
});
