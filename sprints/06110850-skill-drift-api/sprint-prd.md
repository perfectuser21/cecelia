# Sprint PRD — Brain harness skill 快照漂移检测 API（GET /api/brain/harness/skill-drift）

## OKR 对齐

- **对应 KR**：Harness Pipeline 可观测性（Brain API 不可达，无法读取 KR 编号与进度，标注为 [ASSUMPTION]）
- **当前进度**：未知（运行时上下文不可达）
- **本次推进预期**：漂移可见性从 0 → 随时 curl 可查

## 背景

zenithjoy-skills 是所有 harness skill 的 SSOT；cecelia monorepo 的 `packages/workflows/skills/` 是 CI fallback 快照。2026-06-11 审计发现两者全员漂移且无人感知（#3334 手动同步过一次，但无持续检测手段）。需要一个 Brain 只读 API 端点让漂移随时可见。前次 run ed860936 因回调重入 bug 终止，#3335 修复后本次重跑。

## Golden Path（核心场景）

运维者从 [curl 端点] → 经过 [系统实读两侧 SKILL.md version 并逐项对比] → 到达 [一眼看到哪些 skill 漂移]

具体：
1. 用户执行 `curl localhost:5221/api/brain/harness/skill-drift` → 系统返回 HTTP 200 + JSON
2. 用户看到 `skills` 数组恰好 6 项（harness-planner / harness-contract-proposer / harness-contract-reviewer / harness-generator / harness-evaluator / harness-report），每项含 `name`、`ssot_version`、`snapshot_version`、`drifted` 四个字段
3. 用户看到顶层 `any_drift` 布尔值，其值与数组内任一 `drifted=true` 严格一致（内部一致性可由响应自身验证）
4. 每项的 `drifted` 必须等于 `ssot_version !== snapshot_version` 的真实对比结果（版本从 SSOT 与快照两份 SKILL.md frontmatter `version:` 行实读，禁止硬编码）

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 任一侧 SKILL.md 文件不存在 → 该项对应 version 字段为 null 且 `drifted=true`
- SKILL.md 存在但 frontmatter 无 `version:` 行 → 该项对应 version 字段为 null 且 `drifted=true`
- 两侧版本相同 → `drifted=false`；6 项全 false 时 `any_drift=false`

## 范围限定

**在范围内**：
- Brain 新增只读端点 `GET /api/brain/harness/skill-drift`，实读 SSOT 与快照各 6 个 harness SKILL.md 的 version，返回逐项对比与 `any_drift`

**不在范围内**：
- 自动同步/修复漂移（仅检测，不写文件）
- 任何 DB 写入
- 6 个 harness skill 之外的 skill（publisher / decomp 等不在本端点范围）
- Dashboard 展示与告警推送

## 假设

- [ASSUMPTION: Brain API 在本规划环境不可达，OKR 对齐信息无法实读；不影响本 PRD 范围锚定]
- [ASSUMPTION: SSOT 路径环境变量 `SKILLS_SSOT_DIR` 可覆盖，默认 `~/perfect21/zenithjoy-skills`，Brain 容器已 mount 此路径（来自 PrepPRD 实现约束）]
- [ASSUMPTION: 快照路径相对 repo 为 `packages/workflows/skills/`，已确认 6 个 harness skill 目录均存在]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`：harness 相关路由所在处，新增只读端点的自然落点
- `packages/brain/src/routes/__tests__/`：新端点的回归测试

## E2E 验收

> Planner 初稿此区块只框定"端到端要验到什么"，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl + jq）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + jq）
# 期望验收点（自然语言）：
# 1. curl localhost:5221/api/brain/harness/skill-drift 返回 HTTP 200 + JSON
# 2. jq -e 验证：.skills 长度=6；每项 name/ssot_version/snapshot_version/drifted 四字段齐全
# 3. jq -e 验证：.any_drift == (.skills | map(.drifted) | any)（内部一致性）
# 4. jq -e 验证：每项 .drifted == (.ssot_version != .snapshot_version)
# 5. 真实读盘证明：修改任一快照 SKILL.md 的 version 行后再 curl，对应项 drifted 翻转为 true（验完恢复原文件）
```

## journey_type: autonomous
## journey_type_reason: 实现仅涉及 packages/brain/（纯后端只读 API），无 dashboard / engine / 远端 agent 协议参与
## target_environment: local_api
## target_environment_reason: Brain 内部纯 API 端点，本地 evaluator 用 curl localhost:5221 即可端到端验证
## journey_id: 未注入（task.payload.journey_id 缺失，PrepPRD 亦无 Journey 锚定；Cecelia 侧唯一 Line = Harness Pipeline）
## step_id: 未注入（PrepPRD 无 Golden Path step 锚定结果）
