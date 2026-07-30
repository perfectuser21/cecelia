# Golden Path 合同层设计（封版 PRD §②）

**状态**：待实施
**日期**：2026-07-30
**权威输入**：主理人签字的《Harness Golden Path 体系定版 PRD》
**前置基线**：Cecelia `origin/main@991ecbcb5`，§① decisions 已上线
**交付形态**：一个 §② 交付单元，两个强依赖 PR

## 1. 目标

把“每条 Golden Path 一页纸、7 项、签字绑具体版本”从文字纪律变成可执行合同：

1. proposer 必然起草 7 项合同，并对每条 NFR 建议 `lifeline` 或 `best_effort`；
2. reviewer 用既有红方角色攻击合同，并显式输出事故对照结果；
3. mapper 说明 GP 合同与现有格子账本的引用关系，不复制或改造账本；
4. Brain 追加保存每个合同版本，Owner 签字锁定具体版本；
5. 已签合同任一项变化后，旧签字自动失效，并自动产生重签待办；
6. Harness 实现任务只允许从最新已签合同启动，任务载荷固定携带合同 ID、版本和哈希。

本设计不改变 11 要素、四区、四家、`journey_step_links` 表结构、锚点闸或 GAN 组件拓扑。

## 2. 生产 as-built

### 2.1 Skill 仓库

- 唯一 SSOT：`perfectuser21/zenithjoy-skills`。
- Cecelia 的 `packages/workflows/skills/` 只是运行与 CI 快照。
- SSOT 已有：
  - `golden-path-proposer` 1.2.0；
  - `golden-path-reviewer` 1.2.0；
  - `golden-path-mapper` 1.1.0；
  - `golden-path-controller` 1.0.0。
- Cecelia 同步脚本已包含 controller/proposer/reviewer，但遗漏 mapper。

### 2.2 Brain

- `golden_paths` 只有 `proposal_doc`、`approved_at`、`judgment_refs` 等蓝图字段；
- `POST /golden-paths/:id/approve` 当前不检查 7 项合同，也不绑定合同版本；
- `initiative_contracts` 属于实现期 Harness Initiative，不得复用为 GP 级合同；
- `pending_actions` 已提供人工审批收件箱；
- `decisions` 已提供可审计决策记录。

## 3. 方案比较

### 方案 A：直接给 `golden_paths` 加 7 组列

优点是查询简单。缺点是覆盖式更新会丢历史，无法证明签字绑定哪一版，也难以实现自动失效。

### 方案 B：复用 `initiative_contracts`

优点是已有版本字段。缺点是它以 Harness initiative 为实体，生命周期从 GAN 合同批准开始；GP 合同则发生在 initiative 创建之前。复用会混淆两种合同及其产权。

### 方案 C：独立追加式 GP 合同版本表（采用）

每次语义变化追加版本；签字、失效和 Harness 任务都引用不可变版本。它保持现有实体边界，也能直接证明“旧签字已失效、新签字待处理”。

## 4. 跨仓交付顺序

### PR-S：`zenithjoy-skills`

只改 Skill SSOT：

- `golden-path-proposer/SKILL.md`
- `golden-path-reviewer/SKILL.md`
- `golden-path-mapper/SKILL.md`
- `golden-path-controller/SKILL.md`（仅增加结构化合同接力与 Brain 回写）
- 对应 Skill 合同行为测试/fixture

### PR-C：`cecelia`

依赖 PR-S 已合并：

- 新 migration；
- GP 合同 schema、版本服务、路由和审批处理；
- `/approve` 的最新签字 Gate；
- controller/proposer/reviewer/mapper 快照；
- `scripts/sync-skills-snapshot.sh` 补 mapper；
- Brain 单元测试、真实 PostgreSQL 集成测试；
- Brain 版本和 `DEFINITION.md`。

PR-S 合并后才允许生成 PR-C 的最终快照。两个 PR 都合并才算 §② 完成。

## 5. 7 项合同的机器形状

合同 JSON 顶层严格只有以下 7 个业务键；`schema_version`、版本、哈希和签字属于表级元数据，不是第 8 个合同项。

```json
{
  "fr_summary": {
    "statements": ["用户在 X 入口做 Y 操作，看到 Z 结果"]
  },
  "lifelines_and_nfr": {
    "items": [
      {
        "statement": "数据不重复扣款",
        "class": "lifeline",
        "verification": "可执行验证或证据锚点",
        "rationale": "为何属于命门或尽力"
      }
    ]
  },
  "yield_order": {
    "order": ["安全/资金正确性", "数据一致性", "功能完整", "性能", "体验顺滑"],
    "override_reason": null
  },
  "external_commitment_changes": {
    "changes": [],
    "none": true
  },
  "release_and_blast_radius": {
    "stages": [],
    "blast_radius": "",
    "rollback_triggers": []
  },
  "success_and_close": {
    "metrics": [],
    "observation_window": "",
    "close_conditions": [],
    "shutdown_conditions": []
  },
  "budget_guard": {
    "total_cost_cap_usd": 0,
    "atom_cost_cap_usd": 0,
    "atom_runtime_sec": 0,
    "atom_parallelism": 1
  }
}
```

校验规则：

- 缺项、额外业务项、空 FR、无验证方式的 `lifeline`、无回滚触发条件或非正预算均拒绝；
- `external_commitment_changes.none=true` 时 `changes` 必须为空；
- 非默认让路顺序必须带 `override_reason`；
- NFR 分类只能是 `lifeline` 或 `best_effort`；
- 合同内容先稳定排序再做 SHA-256，JSON 键顺序不影响哈希。

## 6. 数据模型

新增 `golden_path_contract_versions`：

| 字段 | 语义 |
|---|---|
| `id` | 不可变合同版本 ID |
| `golden_path_id` | FK → `golden_paths.id` |
| `schema_version` | 当前为 1 |
| `version` | 同一 GP 从 1 单调递增 |
| `contract_json` | 严格 7 项 JSONB |
| `content_hash` | 规范化合同的 SHA-256 |
| `status` | `pending_signature / signed / invalidated / superseded` |
| `signature_decision_id` | FK → `decisions.id` |
| `signing_action_id` | FK → `pending_actions.id` |
| `signed_by / signed_at / invalidated_at` | 签字审计 |
| `created_at` | 版本创建时间 |

约束：

- `UNIQUE(golden_path_id, version)`；
- 仅与**最新版本**哈希相同时幂等返回；允许未来回退到某个旧内容并生成新的递增版本；
- 同一 GP 至多一个 `signed` 版本；
- 合同正文不提供 PATCH，版本创建后不可修改。

`golden_paths`、`journey_step_links` 均不增加合同正文列。合同通过
`golden_path_id → golden_paths.journey_id → journey_step_links` 引用现有格子账本。

## 7. 生命周期与事务

### 7.1 提交合同版本

`POST /api/brain/golden-paths/:id/contracts`

1. 锁定 `golden_paths` 行；
2. 验证 GP 必须已有 `journey_id`；
3. 校验严格 7 项并计算规范哈希；
4. 哈希与现有版本相同：返回原版本，不升版、不重复建待办；
5. 查询绑定当前合同的非终态 Harness task：
   - `dispatched/in_progress` 存在 → `409 GP_CONTRACT_IN_FLIGHT`，必须先通过既有任务
     drain/cancel 流程停稳，禁止执行中偷换合同；
   - 只有尚未执行的 `queued/blocked` 任务 → 在同一事务中取消旧任务；
6. 内容变化：
   - 原 `signed` → `invalidated`；
   - 原 `pending_signature` → `superseded`；
   - 追加 `version + 1, status=pending_signature`；
   - 创建 `pending_actions(action_type=sign_golden_path_contract)`；
7. 同一事务提交。

这就是“修改任一项 → 旧签字作废 → 触发重签”的机械实现。

### 7.2 Owner 签字

Owner 在现有 pending-actions 收件箱批准 `sign_golden_path_contract`。处理器在同一事务内：

1. 锁定待签合同版本；
2. 确认它仍是该 GP 最新版本；
3. 写 `decisions`，记录 GP、合同 ID、版本、哈希、签字人；
4. 合同置为 `signed`；
5. 调用共享的 GP approve 服务，创建 Harness implementation task；
6. Harness task payload 写入：
   - `gp_contract_id`
   - `gp_contract_version`
   - `gp_contract_hash`
7. pending action 置为 approved。

因此“签合同”和“启动批准”是一次人工动作，不增加第二次点击。

### 7.3 `/golden-paths/:id/approve`

保留现有端点用于兼容和内部重试，但新增硬 Gate：

- 找不到最新 `signed` 合同 → `409 GP_CONTRACT_SIGNATURE_REQUIRED`；
- 请求版本不是最新版本 → `409 GP_CONTRACT_STALE`；
- 已对相同合同创建 Harness task → 幂等返回原任务；
- 不得再用裸 `proposal_doc` 启动 Harness。

## 8. Skill 行为

### 8.1 proposer

- 在提案中增加固定的“GP 级合同（7 项）”一页；
- 同步产出 `.harness/gp-contract-v<N>.json`；
- 每条 NFR 必须给出 `lifeline/best_effort` 建议及理由；
- 不增加第 12 个要素，不把 11 要素搬进 GP 合同。

### 8.2 reviewer

- 沿用现有 reviewer，不新建红方组件；
- 输入新增 `GP_CONTRACT` 与 `INCIDENT_CONTEXT`；
- 红方逐项攻击 7 项合同，特别检查模糊 FR、漏命门、错误让路、无回滚、伪成功指标和预算逃逸；
- 输出必须包含 `contract_attack` 与 `incident_comparison`；
- §④ 事故库上线前，`INCIDENT_CONTEXT=unavailable` 必须输出“证据暂不可用”，禁止伪造“无事故”；该状态在 §② 记账但不假装完成事故库机制。

### 8.3 mapper

- 在地图拍板后确保 GP 已绑定 `journey_id`；
- 明确合同是 GP 级签字面，格子/11 要素/断言继续以 `journey_step_links` 为 SSOT；
- 合同引用账本，不复制账本正文，不修改 `journey_step_links` 表结构。

### 8.4 controller

- 将 proposer 的结构化合同交给每轮 reviewer；
- 只有 reviewer 的合同攻击和事故对照均合格才允许 converged；
- Step 6 先提交结构化合同，再回写 `proposal_doc` 和 `converged`；
- Brain 返回待签 action 后停止在人工签字边界，不自行冒充 Owner。

## 9. Red→Green 测试

### 9.1 PR-S Red

先写失败的 Skill 合同测试，证明当前版本：

- proposer 不含严格 7 项与 NFR 分类；
- reviewer 不接收事故输入、不输出事故对照；
- mapper 没有合同→账本引用纪律；
- controller 不提交结构化合同。

Green 后对每个 Skill 单独验证，再进入下一个 Skill，禁止批量写完后补测试。

### 9.2 PR-C Red

最小行为序列：

1. 缺任一合同项返回 400；
2. 相同 JSON 不升版；
3. 已签 v1 修改任一项后，v1=`invalidated`、v2=`pending_signature`、新待办存在；
4. 批准旧版本待办返回 stale，不产生任务；
5. 批准最新待办同时签字并只创建一个 Harness task；
6. task payload 精确绑定合同 ID/版本/哈希；
7. 无已签合同调用 `/approve` 返回 409；
8. 并发提交只产生一个确定的下一版本；
9. mapper 快照被同步脚本纳入；
10. 真实 PostgreSQL 演示完整的 v1 签字→改单→v1 失效→v2 重签。

## 10. 失败语义

- 合同 schema 不合法：400，绝不保存半成版本；
- GP 未绑定 Journey：409 `GP_LEDGER_ANCHOR_REQUIRED`；
- 旧合同已有运行中任务：409 `GP_CONTRACT_IN_FLIGHT`，不得热替换；
- 待签版本过时：409 `GP_CONTRACT_STALE`；
- 签字事务任一步失败：整体回滚，不产生孤儿 decision、task 或假签字；
- Skill SSOT 不可达：PR-C 不允许用旧快照代替；
- 事故输入不可用：明确记录 unavailable，不伪造比对结论。

## 11. 文件边界

### `zenithjoy-skills`

- 四个 Golden Path Skill；
- 每个 Skill 自己的测试/fixture；
- §② 设计镜像（如该仓库 PR 流程要求）。

### `cecelia`

- `packages/brain/migrations/<next>_golden_path_contract_versions.sql`
- `packages/brain/src/golden-path-contracts.js`
- `packages/brain/src/routes/golden-paths.js`
- `packages/brain/src/decision-executor.js`
- 对应 route/service/integration tests
- `scripts/sync-skills-snapshot.sh`
- 四个 Golden Path Skill 快照
- `packages/brain/package.json`
- `packages/brain/DEFINITION.md`

## 12. 非目标

- 不做 §③ 的 118 格锚点回填、NFR 归位或双实现收敛；
- 不做 §④ 的断言盖章、裁决记账、退役触发或事故对照库本体；
- 不做打回率采集；
- 不做四条执行线的完整自动分类器；
- 不改 11 要素、四区、四家、账本表结构或 GAN 组件数量；
- 不宣称 Harness Golden Path PRD 全部完成。

## 13. 合并 Gate

1. PR-S 全部 Skill 测试通过并合并；
2. PR-C 从 PR-S 合并提交同步快照，`any_drift=false`；
3. Brain 定向单测与真实 PostgreSQL 集成测试通过；
4. Brain 版本和 `DEFINITION.md` 同步；
5. 所有 required GitHub checks 为最新 SHA 的绿色；
6. 两个 PR 均 squash merge 后，才更新 §② 完成度并 handoff §③。

## 14. 基线风险记录

在 `991ecbcb5` 的隔离 worktree、零代码改动下：

- GP 定向基线：4 个文件、52 个测试通过；
- 仓库全量 Vitest 在 Node 25 长尾阶段出现 worker OOM，且真实 PostgreSQL
  `critical-routes.integration` 组失败，随后人工停止。

实施验收以定向 Red→Green、CI required checks 和隔离的真实 PostgreSQL 合同集成为准；
不得把上述改动前环境问题算作 §② 引入的回归，也不得用它豁免本次新增测试。
