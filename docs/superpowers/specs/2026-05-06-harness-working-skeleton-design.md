# Harness Working Skeleton 设计

**日期**：2026-05-06
**状态**：APPROVED — 待实施
**根因**：feature-driven 开发导致大量孤立功能点，没有一条链路端到端跑通
**解法**：Harness Planner 强制"Skeleton First"——每个 Initiative 第一个 Task 必须是能跑通全链路的薄片

---

## 1. 背景与问题

### 1.1 Feature-Driven 病根

过去的开发模式：
```
Task A（功能点 1）→ Task B（功能点 2）→ Task C（功能点 3）
```

每个 Task 独立测试，互不依赖，最终发现没有一条链路是端到端通的。

### 1.2 Working Skeleton 解法

```
Task 0（Skeleton：全链路薄片，中间层可 stub）
  → Task A（填充功能 1，替换 stub）
  → Task B（填充功能 2，替换 stub）
  → Task C（填充功能 3，替换 stub）
```

Skeleton 的目标不是完整实现，而是"从入口到出口，真实请求能走通"。

### 1.3 Cecelia 的四种 Journey

Cecelia 是三位一体系统，不同 journey 的"端"完全不同：

| Journey 类型 | 起点 | 终点 | E2E 链路 | 典型场景 |
|---|---|---|---|---|
| `user_facing` | Dashboard UI 点击/输入 | Dashboard 看到结果 | UI→API→Brain→DB→API→UI | 主理人创建 OKR / 看进度 |
| `autonomous` | tick loop / 外部事件 | action 执行 + 状态回写 | tick→thalamus→executor→DB | Brain 自动派任务、自动巡检 |
| `dev_pipeline` | 任务派发 | PR 合并 + 回写 task | task→/dev→worktree→PR→merge→Brain | Harness 拆任务、Codex 写代码 |
| `agent_remote` | Brain 派指令 | 远端机器执行 + 回报 | Brain→bridge→远端 Agent→bridge→DB | 派任务到西安/HK/Mac mini |

---

## 2. 改动范围

**三层改动**：

1. **Skill 层**（3 个 SKILL.md）— 提示词级别，指导 AI 行为
2. **Brain 层**（1 个 migration + 2 处 API）— journey_type 持久化，防中途遗忘
3. **CI 层**（1 个新脚本 + 1 个 CI job）— 机器校验 skeleton 形状，防假 skeleton

---

## 3. Skill 改动

### 3.1 harness-planner：v6.0 → v7.0

**新增 Step 0：推断 journey_type（在生成 PRD 之前）**

推断规则（优先级从高到低）：

```
if 涉及 apps/dashboard → user_facing
elif 仅涉及 packages/brain → autonomous
elif 涉及 packages/engine (hooks/skills) → dev_pipeline
elif 涉及远端 agent 协议 / bridge → agent_remote
elif 同时命中多个 → 取起点最靠前（UI > tick > task dispatch > bridge）
elif 无法判断 → 默认 autonomous，在 task-plan.json 注明推断原因
```

**Task DAG 强制规则（新增）：**

1. 第一个 Task 固定为 `skeleton`，`depends_on: []`
2. 所有其他 Task 必须在 `depends_on` 中包含 `"skeleton"`（直接或传递依赖）
3. skeleton Task 的描述使用以下模板：

| journey_type | skeleton Task 描述 |
|---|---|
| `user_facing` | "端到端薄片：主理人点击 [入口按钮] → 看到 [预期结果]，中间层可 stub" |
| `autonomous` | "端到端薄片：注入 [触发事件] → DB 终态出现 [预期字段]，中间层可 stub" |
| `dev_pipeline` | "端到端薄片：mock task 派发 → PR 创建（或 callback 回写），中间层可 stub" |
| `agent_remote` | "端到端薄片：Brain 发指令 → bridge log 有回报 + DB 回写，中间层可 stub" |

**task-plan.json 顶层新增字段：**

```json
{
  "journey_type": "user_facing",
  "journey_type_reason": "PRD 涉及 apps/dashboard 组件",
  "tasks": [
    { "id": "skeleton", "is_skeleton": true, "depends_on": [], ... },
    { "id": "task-1", "depends_on": ["skeleton"], ... }
  ]
}
```

### 3.2 harness-contract-proposer：v5.0 → v6.0

**识别 skeleton task**：从 task payload 读 `task.is_skeleton === true`（Planner 在 task-plan.json 中设置，Brain 入库时保留该字段；不用 `task.id === "skeleton"`，因为逻辑 ID 入库时会被替换为 UUID）。

**skeleton task 时走 E2E test 模板（替代现有 unit test 模板）：**

| journey_type | E2E test 形式 |
|---|---|
| `user_facing` | Playwright test：从 UI 入口触发，断言页面出现预期内容 |
| `autonomous` | 注入事件（DB insert 或 mock tick）→ `pollDB(...)` 断言终态字段 |
| `dev_pipeline` | mock task 入 DB → 等 callback → 断言 `result.pr_url` 非空 |
| `agent_remote` | POST 到 bridge → 断言 `tasks.result.executed === true` |

**contract-dod-ws0.md 新增 header（供 CI 读取）：**

```markdown
---
skeleton: true
journey_type: user_facing
---
```

**non-skeleton task**：保持现有 unit/behavior test 格式，不变。

### 3.3 harness-generator：v5.0 → v6.0

**skeleton task 阶段新增规则：**

目标：全链路能跑通，不要求完整实现。

允许 stub，但必须满足：
1. stub 有注释：`// SKELETON STUB — replaced in feature task <task-id>`
2. stub 的接口签名必须和最终实现兼容（不能图省事改接口）
3. commit 2（Green）的 PR description 必须列出"哪些层是 stub，对应哪个后续 feature task 替换"

**commit 结构（skeleton task）：**

```
commit 1: test(harness): skeleton e2e test (Red)
  — 只含 E2E 测试文件 + DoD.md

commit 2: feat(harness): skeleton implementation (Green)
  — stub 实现，让 E2E 通过
  — PR body 含 stub 清单
```

---

## 4. Brain migration

### 4.1 新增字段

```sql
-- migration 26X_initiative_journey_type.sql
ALTER TABLE initiative_runs
  ADD COLUMN journey_type VARCHAR(20)
    NOT NULL DEFAULT 'autonomous'
    CHECK (journey_type IN ('user_facing', 'autonomous', 'dev_pipeline', 'agent_remote'));
```

### 4.2 API 改动

**POST `/api/brain/initiatives`**：接受 `journey_type`（可选，默认 `autonomous`）

**GET `/api/brain/initiatives/:id`**：响应加 `journey_type` 字段

### 4.3 数据流

```
Planner 推断 journey_type
  → 写入 task-plan.json
  → Brain 读 task-plan.json，存入 initiative_runs.journey_type
  → Proposer 执行时：读 GET /api/brain/initiatives/:id → 获取 journey_type
  → Generator 执行时：同上
```

---

## 5. CI skeleton 形状校验

### 5.1 新脚本：`packages/engine/scripts/devgate/skeleton-shape-check.cjs`

**触发条件**：PR diff 中存在 `contract-dod-ws0.md` 且文件含 `skeleton: true`。

**校验逻辑**：

读 `contract-dod-ws0.md` 的 `journey_type` header，校验对应测试文件的 import/调用 pattern：

| journey_type | 测试文件必须包含 |
|---|---|
| `user_facing` | `playwright` 或 `chromium` 或 `chrome-mcp` |
| `autonomous` | `await.*query\|await.*db\|pollDB` |
| `dev_pipeline` | `pr_url\|execution-callback\|gh.*pr` |
| `agent_remote` | `bridge\|executed.*true\|agent.*result` |

**失败输出**：

```
ERROR: skeleton test shape mismatch
  expected pattern for journey_type=user_facing: playwright|chromium|chrome-mcp
  found in: sprints/.../tests/ws0/skeleton.test.ts
  actual content: <first 5 lines>
```

### 5.2 CI job（engine-ci.yml）

```yaml
- name: Skeleton shape check
  run: node packages/engine/scripts/devgate/skeleton-shape-check.cjs
```

上线第一周设 `continue-on-error: true` 观察，确认无误报后切硬门禁。

---

## 6. 完整改动清单

| 类别 | 文件 | 变更 |
|---|---|---|
| Skill | `packages/workflows/skills/harness-planner/SKILL.md` | v6→v7，journey_type 推断 + skeleton task 强制规则 |
| Skill | `packages/workflows/skills/harness-contract-proposer/SKILL.md` | v5→v6，4 种 E2E test 模板 + contract header |
| Skill | `packages/workflows/skills/harness-generator/SKILL.md` | v5→v6，skeleton stub 规则 + commit 结构 |
| Brain | `packages/brain/migrations/26X_initiative_journey_type.sql` | 新增 journey_type 字段 |
| Brain | `packages/brain/src/routes/initiatives.js` | POST/GET 加 journey_type |
| CI | `packages/engine/scripts/devgate/skeleton-shape-check.cjs` | 新增 skeleton 形状校验脚本 |
| CI | `.github/workflows/engine-ci.yml` | 加 skeleton-shape-check job |

---

## 7. 实施顺序

```
Sprint 1：Skill 改动（3 个 SKILL.md，单 PR）
  ↓ 合并后验证 Planner 正确推断 journey_type + 生成 skeleton task
Sprint 2：Brain migration + API 改动（单 PR）
  ↓ 合并后验证 Proposer/Generator 能从 DB 读 journey_type
Sprint 3：CI skeleton 形状校验（单 PR，continue-on-error: true 上线）
  ↓ 观察 1 周无误报 → 切硬门禁
```

---

## 8. 不做的事

- 不改 Brain 调度逻辑（`depends_on` 已能保证 skeleton 先跑）
- 不改 `harness-report`、`harness-planner` 以外的 v1 兼容层
- 不加 GAN 轮数上限（见 `harness-gan-design.md`）
- 不改 `/dev` 主接力链
- CI `continue-on-error` 第一周内不切硬门禁

---

## 9. 成功标准

- [ ] Planner 对每个新 Initiative 都产出 `skeleton` 作为第一个 Task
- [ ] skeleton Task 的测试文件形式与 journey_type 匹配（CI 可机械校验）
- [ ] Generator 的 skeleton PR 含明确 stub 清单
- [ ] `initiative_runs.journey_type` 字段非空，Dashboard 可读取
- [ ] CI skeleton-shape-check 在已有真实 skeleton PR 上不误报
