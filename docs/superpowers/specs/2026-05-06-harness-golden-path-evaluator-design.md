# Harness Golden Path + Evaluator 设计

**日期**：2026-05-06
**状态**：APPROVED — 待实施
**根因**：Harness pipeline 是 feature-driven 的——合同按功能点写，任务按功能拆，没有一条 Golden Path E2E 贯穿始终，导致每个功能单独能跑但整体跑不通；且代码写完后无真实验证（只有 CI 单元测试）。
**解法**：三项改造——① Planner 只写 PRD 不拆任务；② Proposer 合同改为 Golden Path 格式含真实验证命令；③ 新增 Evaluator 做逐任务 DoD 验证 + 最终 E2E。

---

## 1. 问题

### 1.1 现状

```
Planner → PRD + 任务 DAG（一起出）
Proposer → 合同（按 Feature 写：Feature 1 / Feature 2）
Reviewer → GAN 审合同
Generator → 按任务写代码 → CI 单元测试
→ 完成
```

问题：
- 任务在合同之前拆，没有根基
- 合同是 Feature-driven（"功能需求 FR-001"），不是 E2E Golden Path
- 代码写完无真实验证，CI 只跑 mock 单元测试

### 1.2 目标

```
Planner → 只写 PRD（What，不拆任务）
Proposer + Reviewer → GAN 对抗 3-5 轮，写 Golden Path 合同 + 验证命令
合同确认后 → 从 Golden Path 倒推拆任务 DAG
Generator N → TDD 写代码
Evaluator N → 真实验证 DoD
最终 Evaluator → 跑 E2E Golden Path
```

---

## 2. 改动范围

| 类别 | 文件 | 变更 |
|---|---|---|
| Skill | `harness-planner/SKILL.md` | v7 → v8：去掉任务拆分，只输出 PRD |
| Skill | `harness-contract-proposer/SKILL.md` | v6 → v7：合同格式从 Feature → Golden Path Steps + 验证命令；合同确认后负责拆任务 |
| Skill | 新建 `harness-evaluator/SKILL.md` | v1.0：按 journey_type 验逐任务 DoD + 最终 E2E |
| Brain | `harness-initiative.graph.js` | Phase B 每个 Generator task 后插入 evaluate 节点 |

---

## 3. Planner v8 改动

**去掉**：`task-plan.json` 输出（不再在 Step 3 拆任务 DAG）

**保留**：PRD 输出 + journey_type 推断

**输出**：只有 `sprint-prd.md`，末尾注明 `journey_type`。

**PRD 格式改造**（从功能需求 → Golden Path）：

```markdown
# Sprint PRD — {目标}

## OKR 对齐
- 对应 KR：...

## 背景
{为什么做}

## Golden Path（核心场景）
用户/系统从 [入口] → 经过 [关键步骤] → 到达 [出口]

具体：
1. [触发条件]
2. [系统处理]
3. [可观测结果]

## 边界情况
- {异常/空/并发}

## 范围限定
**在范围内**：...
**不在范围内**：...

## journey_type: autonomous|user_facing|dev_pipeline|agent_remote
## journey_type_reason: {1 句推断依据}
```

---

## 4. Proposer v7 改动

### 4.1 合同格式：Feature → Golden Path Steps

**旧格式**：
```markdown
## Feature 1: 超时检测
行为描述...
## Feature 2: 去重逻辑
行为描述...
```

**新格式**：
```markdown
## Golden Path
[入口] → [步骤1] → [步骤2] → [出口]

### Step 1: {触发}
**可观测行为**：{外部可见的结果，不写实现}
**验证命令**：
```bash
# 具体可执行命令，Evaluator 直接跑
curl localhost:5221/api/brain/tasks/$TASK_ID | jq '.status'
# 期望：completed
```
**硬阈值**：status = completed，耗时 < 5s

### Step 2: {处理}
**可观测行为**：{...}
**验证命令**：
```bash
psql $DB -c "SELECT count(*) FROM brain_alerts WHERE task_id='$TASK_ID'"
# 期望：count = 1
```
**硬阈值**：count ≥ 1，2 小时内不重复

### Step 3: {出口}
...

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**：autonomous

**完整验证脚本**：
```bash
# 1. 注入超时任务
TASK_ID=$(psql $DB -t -c "INSERT INTO tasks ... RETURNING id")

# 2. 触发处理（或等待 tick）
curl -X POST localhost:5221/api/brain/scan-timeout

# 3. 验证终态
COUNT=$(psql $DB -t -c "SELECT count(*) FROM brain_alerts WHERE task_id='$TASK_ID'")
[ "$COUNT" -ge 1 ] || exit 1
echo "✅ Golden Path 验证通过"
```

**通过标准**：脚本 exit 0
```

### 4.2 GAN 对抗焦点（新增）

Reviewer 除了审"做没做对的事"，还要审**验证命令是否能造假通过**：

- "这个 SELECT count(*) 验证，手动 INSERT 一条就能绕过，需要加时间窗口校验"
- "Playwright 脚本缺少 assert 超时，可能假绿"
- "验证命令依赖环境变量未定义"

### 4.3 合同确认后拆任务 DAG

GAN 收敛（Reviewer APPROVED）后，Proposer 从 Golden Path 倒推拆任务：

```
每个 Step → 对应 1-N 个 Task
约束：每个 Task < 200 行（hard limit < 400 行）
依赖：线性链，task2 depends_on task1
```

输出 `task-plan.json`（格式同现有，但此时已有合同作为根基）。

---

## 5. Evaluator v1.0（新建）

### 5.1 两种模式

**模式 A：逐任务 DoD 验证**（每个 Generator task 跑完后触发）

```
输入：
  - 当前 task 的 contract-dod-ws{N}.md
  - journey_type
  
执行：
  读 DoD 中每个 [BEHAVIOR] 条目的验证命令
  逐条执行，记录 pass/fail
  
输出：
  PASS → 通知 Brain 继续下一个 task
  FAIL → 打详细报告给 Generator 重做（最多 3 次）
```

**模式 B：最终 E2E**（所有 task 完成后触发）

```
输入：
  - 合同中的 "E2E 验收" 脚本
  - journey_type

执行：
  按 journey_type 选验证方式：
  
  user_facing  → 用 chrome MCP 点界面
  autonomous   → 跑 psql/curl 脚本
  dev_pipeline → curl callback + gh pr view
  agent_remote → 检查 bridge 回调 + DB 状态

输出：
  PASS → initiative_runs.phase = 'done'
  FAIL → 分析哪个 Step 失败 → 打回对应 Generator
         超过 3 轮 → phase = 'failed'，人工介入
```

### 5.2 执行流程

```
Step 0: 确认模式（读 task payload）
  is_final_e2e === true → 模式 B
  否则 → 模式 A

Step 1（模式 A）: 读 DoD 文件
  cat ${SPRINT_DIR}/contract-dod-ws${N}.md
  提取所有 [BEHAVIOR] 条目的验证命令

Step 2（模式 A）: 逐条执行验证
  每条命令在真实环境执行（curl/psql/node）
  记录 stdout/stderr + exit code

Step 3（模式 A）: 输出报告
  PASS: {"verdict": "PASS", "task_id": "...", "all_dod": "passed"}
  FAIL: {"verdict": "FAIL", "failed_items": [...], "feedback": "..."}

Step 1（模式 B）: 读合同 E2E 验收脚本
  cat ${SPRINT_DIR}/contract-draft.md | 提取 "E2E 验收" 区块

Step 2（模式 B）: 执行 E2E 脚本
  bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log

Step 3（模式 B）: 判断结果
  exit 0 → PASS
  exit ≠ 0 → 分析 log，定位失败 Step → 打回
```

---

## 6. Brain 编排改动（harness-initiative.graph.js）

### 6.1 Phase B 新增 evaluate 节点

```
现在：
  taskLoopNode → [dispatch generator task] → taskLoopNode（循环）

改后：
  taskLoopNode → [dispatch generator task] → evaluateNode → taskLoopNode
                                                ↓ FAIL（< 3次）
                                              taskLoopNode（重新 dispatch 同 task）
                                                ↓ FAIL（≥ 3次）
                                              phase = 'failed'
```

### 6.2 Phase C 改为调用 Evaluator 模式 B

```
现在：Phase C 逻辑内嵌在 graph.js
改后：dispatch harness_evaluate task（is_final_e2e: true）
      Evaluator 跑合同 E2E 脚本
      回写结果到 initiative_runs
```

### 6.3 新增任务类型

`harness_evaluate` 已在 task-router.js 中注册（`/harness-evaluator`），无需改动路由。

---

## 7. 实施顺序

```
Sprint 1：Skill 改动（单 PR）
  - harness-planner v8（去掉任务拆分）
  - harness-contract-proposer v7（Golden Path 格式 + 合同后拆任务）
  - 新建 harness-evaluator v1.0 SKILL.md

Sprint 2：Brain 编排（单 PR）
  - harness-initiative.graph.js：Phase B 加 evaluate 节点
  - Phase C 改为 dispatch harness_evaluate
```

---

## 8. 不做的事

- 不改 Reviewer SKILL.md（方向已对，只是审的内容会随合同格式自动变）
- 不改 Generator SKILL.md（TDD 逻辑已有）
- 不改 CI（CI 继续做硬门禁，Evaluator 是额外验证层）
- 不加 Evaluator 轮数上限（外层 graph.js 已有 MAX_FIX_ROUNDS=3 兜底）

---

## 9. 成功标准

- [ ] Planner 输出只有 PRD，无 task-plan.json
- [ ] Proposer 合同格式是 Golden Path Steps，每步含验证命令
- [ ] 合同 GAN 对抗后 Proposer 输出 task-plan.json
- [ ] Generator 跑完后自动触发 Evaluator 验 DoD
- [ ] 最终 Evaluator 跑合同 E2E 脚本，exit 0 才 Done
- [ ] Evaluator 失败能打回 Generator 带具体反馈
