# Sprint PRD — Harness Pipeline Cockpit · Phase 2（read-only 全生命周期）

## OKR 对齐

- **对应 KR**：Harness Pipeline 可观测性（一页看全一个 pipeline）
- **当前进度**：Phase 1 已合（#3395，TaskPrdPage 显示完整 prep_prd_body + Markdown）
- **本次推进预期**：从"只看 PrepPRD 一项" → "全生命周期七项产物逐项可见"

## 背景

现有 pipeline 详情页的文档区把 Prep PRD / Sprint PRD / Contract / Harness Report 全显示"文件不存在"——根因是它读 sprint 目录的 `.md` 文件，线上路径找不到。Phase 1 已证明正解是改读 Brain DB（`payload.prep_prd_body`）。本 Phase 把"读 DB/API 不读文件"的修法落到整页全生命周期视图，且每一项缺失时给出语义化占位，绝不再出现裸"文件不存在"死字。

## Golden Path（核心场景）

用户从 [打开任意 harness run 的 pipeline 详情页] → 经过 [系统按生命周期逐项拉 Brain DB/API 数据] → 到达 [左侧/分区列出七项产物，有就 Markdown 渲染、没到该步标"未到该步"]

具体：
1. 用户打开任意 harness run / pipeline 的详情页（带 run/task id）。
2. 页面按生命周期顺序展示分区，每项独立从 Brain 取数（不读本地 `.md` 文件）：
   - **PrepPRD** — 来自 `payload.prep_prd_body`，完整全文 Markdown 渲染
   - **正式 PRD** — planner 产物（sprint-prd.md 内容，经 Brain 返回）
   - **Contract** — 合同 / DoD 断言
   - **DoD** — 验收清单
   - **决策清单** — 查 `decisions` WHERE target = 该 pipeline 的 ability/step
   - **流水线留痕** — `/harness/runs/:id/progress` + 节点事件
   - **Report** — harness 最终报告
3. 可观测结果：
   - PrepPRD 显示**完整全文**（来自 DB，非文件），Markdown 有格式。
   - 任一项有数据 → Markdown 渲染该项内容。
   - 任一项尚未产出（流水线没到该步） → 显示**"未到该步"**占位。
   - 全页**不出现**裸"文件不存在"字样。

## 边界情况

- run 已开始但仅完成前几步 → 已完成项渲染，未完成项一律"未到该步"，不报错。
- `decisions` 查无匹配 target → "未到该步"/"暂无决策"占位，而非空白或报错。
- 某项 Brain API 取数失败（网络/404） → 该分区降级为占位文案，不让整页崩。

## 范围限定

**在范围内**：read-only 全生命周期视图；七项产物逐项展示；缺失语义化占位；全部读 Brain DB/API。
**不在范围内**：Phase 3（Gate 1 决策面板、可改决策、"再来一轮"无头红队、点确定点火端点）；Phase 4（Gate 2 题库回灌）；任何写操作。

## 假设

- [ASSUMPTION: pipeline 详情页与 Phase 1 的 TaskPrdPage 同源/可复用，Phase 2 在其上扩展为左侧生命周期布局，设计参考 `out/dev-cockpit.html`。]
- [ASSUMPTION: 正式 PRD / Contract / DoD / Report 由 Brain 现有 task/run 端点返回（payload 或 run detail 字段）；具体字段名由 Proposer 读 api_registry 后锁定。]
- [ASSUMPTION: 决策清单经 `decisions` 表按 target=该 pipeline 的 ability/step 查询，端点已存在或复用现有 decisions 查询。]

## 预期受影响文件

- `apps/dashboard/src/pages/tasks/TaskPrdPage.tsx`：从单页 PRD 扩为左侧生命周期 cockpit（或拆出 pipeline 详情组件）。
- `apps/dashboard/src/pages/tasks/TaskPrdPage.prepprd.test.tsx`：扩/新增 failing test 覆盖七项分区 + "未到该步"占位 + 无"文件不存在"死字。
- （可能）新增 `apps/dashboard/src/pages/pipeline/` 下 cockpit 组件与对应测试。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment（mac_web → Playwright）填入 contract-draft.md。

```bash
# 占位：proposer 将填入 mac_web Playwright 脚本（localhost:5174）
# 期望验收点（自然语言）：
#   1. 打开任意 harness run 的 pipeline 详情页。
#   2. PrepPRD 分区显示完整全文（来自 DB payload.prep_prd_body，非文件），Markdown 有格式。
#   3. Contract / Report 分区：有数据则渲染、无数据则显示"未到该步"占位。
#   4. 全页 DOM 文本中不出现"文件不存在"字样（断言其缺失）。
```

## journey_type: user_facing
## journey_type_reason: 改动落在 apps/dashboard/ 前端页面（pipeline 详情 cockpit），if-elif 链首命中 user_facing。
## target_environment: mac_web
## target_environment_reason: Cecelia 内网 Dashboard Web UI，验收明确 Final E2E 走 mac_web（本机 Playwright，localhost:5174）。
## journey_id: Cecelia Line 唯一 = Harness Pipeline（来源 task.payload.journey_id，Brain 离线未取到，按 PrepPRD 锚定为 Harness Pipeline 线）
## step_id: cockpit-phase2-lifecycle（4-Phase cockpit 的 Phase 2 · read-only 全生命周期视图）
