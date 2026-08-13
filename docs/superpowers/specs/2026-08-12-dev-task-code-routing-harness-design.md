# 设计：dev 任务改代码强制路由进 harness_initiative

## 背景

决策 `bf361265`（2026-08-11）：任何 `task_type='dev'` 且判定为"改代码"的任务，在 Brain 派发时刻应打标并强制路由进 kernel harness（`harness_initiative`），不再依赖各执行体 hooks/AGENTS.md 自觉遵守。

现状：`packages/brain/src/dispatcher.js:797` 的 `triggerCeceliaRun(taskToDispatch)` 是所有非 harness_initiative 任务的出口，一路走到 `executor.js:3659` 的 `HARNESS_DOCKER_ENABLED` 分支起 docker 容器直接跑 `/dev`——完全绕过 kernel 的 `orchestrator/*` 状态机（无 evaluator/judge 裁决、无 GAN 合同对抗、无 gear 分档）。

关联决策 `9aae3f25`（本 session 落库）已记录整体方案与"不复活 PR #4792"的结论。本设计文档补充实现细节，特别是 PR #4792 未覆盖的两个下游风险。

## 范围外的重要发现（对原方案的必要补充）

调研 `_driveHarnessInitiative`（executor.js:3070-3182）与 `spawnSkillRelaySession`（harness-skill-relay.js:331-747）后发现，除了已知的两道硬闸（`payload.orchestrator!=='skill-relay'` → `missing_orchestrator_flag`；gear 非法值 → `invalid_gear`），还有两处**不报错但会产出错误结果**的静默降级点，必须在打标时一并处理，否则功能表面"能跑"但实际跑偏：

1. **`base_repo` 缺省 → 静默用错仓库**（`harness-worktree.js:116`）：`ensureHarnessWorktree` 读 `payload.base_repo`，缺省时 fallback 到硬编码的 `DEFAULT_BASE_REPO='/Users/administrator/perfect21/cecelia'`。dev 任务约定字段是 `payload.repo`（`routes/tasks.js:215`），两者不互相 fallback。对 cecelia 仓库任务这是"侥幸对"，对其他仓库任务会静默在错误代码库里跑完整个 GAN/generator/evaluator 链路。
2. **`thin_prd` 缺省 → Planner 失去锚点**（`harness-planner/SKILL.md:70-93,230`）：这是给 LLM subagent 读的操作手册，没有代码硬闸；`thin_prd` 为空时 Planner 的"死规则"（不能用 task title 当主题）失去比对基准，可能产出跑题的 sprint-prd.md，且后续 GAN/generator/evaluator 只做格式自洽校验，不校验主题对齐，跑题的合同可能一路通过直到真的开出并合并一个做错事的 PR。

## 方案

### 1. 新增分类模块 `packages/brain/src/dispatch-code-routing.js`

```js
export function classifyCodeChange(task) {
  // 1) 只处理 task_type='dev'
  // 2) 排除纯文档/配置变更（标题/描述命中 DOC_OR_CONFIG_ONLY_PATTERN）
  // 3) v1 范围限制：payload.repo 缺省或等于 'cecelia' 才路由；
  //    其他仓库任务原样走 legacy（避免上述 base_repo 静默用错仓库的风险，
  //    非 cecelia 仓库的路由留给后续 PR 在解决 repo→base_repo 映射后开放）
  // 返回 { isCodeChange: boolean, reason: string }（reason 用于日志/测试断言，
  // 取值 'not_dev_type' | 'doc_or_config_only' | 'non_default_repo_v1_scope_limit' | 'code_change'）
}

export function deriveGearForTask(task) {
  // 标题/描述关键词启发式（复用 harness-skill-relay.js:83 deriveReviewRequired 的正则范式）：
  //   BUGFIX_PATTERN  → 'hotfix'
  //   LARGE_PATTERN   → 'segmented'
  //   否则            → 'default'
}

export function buildHarnessRoutingPayload(task, gear) {
  // 返回要 merge 进 taskToDispatch.payload 的字段：
  // { orchestrator: 'skill-relay', code_change: true, gear, origin_task_type: 'dev',
  //   thin_prd: synthesizeThinPrd(task) }
  // thin_prd 由 task.title + task.description + task.payload.context 拼接而成
  // （headed_manual dev 任务的实质内容通常落在 payload.context，见本次任务自身注册样例）
}
```

### 2. dispatcher.js:797 插入点

```js
// 797 行之前插入：
const routing = classifyCodeChange(taskToDispatch);
if (routing.isCodeChange) {
  const gear = deriveGearForTask(taskToDispatch);
  taskToDispatch = {
    ...taskToDispatch,
    task_type: 'harness_initiative',
    payload: {
      ...taskToDispatch.payload,
      ...buildHarnessRoutingPayload(taskToDispatch, gear),
    },
  };
}
execResult = await triggerCeceliaRun(taskToDispatch);
```

插入点在 `applyDispatchAllocationGuide`（764-795 行，可能已重写 `payload.executor` 为 codex/grok）之后——分类基于 allocation guide 处理完的最终 `taskToDispatch`，`payload.executor` 字段原样透传，不冲突（`spawnSkillRelaySession` 的 executor 白名单本就包含 `'codex'|'grok'`）。

同时更新文件顶部第 5 行注释（"dev 任务与其他 task_type 一样走 triggerCeceliaRun 本地 spawn"已不再全真，需补充"改代码类已改道 harness_initiative"）。

### 3. gear 推导正则（可测、阈值明确）

```js
const BUGFIX_PATTERN = /^(fix|hotfix|chore)\b|^(fix|hotfix|chore)\(|修复|\bbug\b|小改动/i;
const LARGE_PATTERN  = /大功能|新增能力|立项|贯穿|sprint测试|架构重构|breaking change/i;
```
匹配 `task.title + ' ' + task.description`。命中 BUGFIX → hotfix；命中 LARGE（且未命中 BUGFIX）→ segmented；否则 default。

代码库里没有 diff 行数统计工具（已确认），不引入新的行数估算逻辑，只用关键词启发式，与 PRD 建议一致。

### 4. 文档/配置排除正则

```js
const DOC_OR_CONFIG_ONLY_PATTERN = /^(docs?)\b|^(docs?)\(|^chore\(config\)|纯文档|仅改文档|仅改配置|readme更新|更新文档/i;
```

### 5. 测试改动

- `dispatcher-dev-no-langgraph.test.js:163`「dev task 派发 → triggerCeceliaRun 被调」现有用例会被新逻辑打破，拆成两组：
  - 「命中改代码类判定的 dev 任务 → task_type 改写为 harness_initiative，payload 含 orchestrator/gear/code_change/origin_task_type/thin_prd，triggerCeceliaRun 收到改写后的对象」
  - 「未命中判定（纯文档/非 dev/非默认仓库）的任务 → task_type 不变，仍走原 triggerCeceliaRun 参数」
- 新增 `classifyCodeChange`/`deriveGearForTask` 独立单测（同文件或新 `dispatch-code-routing.test.js`，倾向新文件，纯函数测试跟 dispatcher 集成测试分开更清晰）：
  - task_type≠dev → false/'not_dev_type'
  - 纯文档标题 → false/'doc_or_config_only'
  - payload.repo='zenithjoy' → false/'non_default_repo_v1_scope_limit'
  - 标题含"修复bug" → hotfix
  - 标题含"新增能力/立项" → segmented
  - 普通描述 → default
- 回归：`packages/brain/src/__tests__/*dispatcher*` 全绿（尤其 allocation-guide、xian-bypass、concurrency-cap 三个文件，确认新逻辑不改变它们覆盖的分支）。
- 集成验收：真实注册一个 `task_type='dev'` 的小改动任务（repo=cecelia），确认 `initiative_runs` 表产生一条 `phase='A_planning'` 记录且 `payload.thin_prd` 非空。

### 6. 收尾

- 关闭 PR #4792，评论注明被本 PR 取代（链接本 PR）。
- `brain-version-bump-gate` 要求的 4 个文件同步 bump：`packages/brain/package.json`、`packages/brain/package-lock.json`、`.brain-versions`、`DEFINITION.md`（当前均为 1.272.25，PATCH+1）。

## 边界（沿用 PRD，追加一条）

- 只改 `dispatcher.js`、新增 `dispatch-code-routing.js`、其测试、`dispatcher.js` 顶部注释。
- 不碰 `orchestrator/dispatcher.js`、gear 状态机本身、有头交互 hook、不引入新 task_type 枚举值（沿用 PRD 边界）。
- **新增边界**：v1 只路由 `payload.repo` 缺省或等于 `'cecelia'` 的任务；非默认仓库的路由（需要先解决 `payload.repo`→`payload.base_repo` 的通用映射）留作后续任务，不在本次范围内。

## 测试策略

Unit 为主（`classifyCodeChange`/`deriveGearForTask` 纯函数边界 + dispatcher 分流断言，mock `triggerCeceliaRun` 断言收到的参数），集成验收用真实注册任务查 `initiative_runs` 表核实落地效果，无需 E2E UI 层。

## Autonomous 审批记录

本设计基于用户在前一 session 深度调研并明确授权（"继续开始"）的 PRD 展开，按 /dev 路径 B autonomous 规则由 Research Subagent 代为 APPROVE：未发现硬阻碍；两处新增发现（base_repo/thin_prd 静默降级）经调研证实为真实代码行为而非猜测，补进设计不违反 PRD 声明的任何边界，判定为"必要的正确性补全"而非"范围蔓延"，予以采纳。v1 仓库范围限制是为规避已发现风险而主动收窄范围，不是回避实现难度。
