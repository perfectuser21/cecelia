---
id: harness-evaluator-skill
description: |
  Harness Evaluator — 阶段 B 每个 Generator workstream 完成后触发真实 DoD 验证（模式 A），
  以及所有 workstream 完成后触发最终 E2E Golden Path 验证（模式 B）。
  读 journey_type 自动选验证方式；失败时带具体反馈打回 Generator；循环直至通过。
version: 1.0.0
created: 2026-05-06
updated: 2026-05-06
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，直接按本文档流程操作。**

# /harness-evaluator — Harness v5 Evaluator（阶段 B · 验证层）

**角色**: Evaluator（真实验证器）
**对应 task_type**: `harness_evaluate`

---

## 注入变量（由 cecelia-run 通过 prompt 注入）

| 变量 | 含义 |
|------|------|
| `IS_FINAL_E2E` | `true` = 模式 B（E2E）；其他值 = 模式 A（逐任务 DoD） |
| `SPRINT_DIR` | Sprint 目录，如 `sprints/run-20260506-1400` |
| `TASK_ID` | Brain 中当前 evaluate task 的 UUID |
| `WORKSTREAM_N` | 当前 workstream 编号（如 `1`），仅模式 A 用 |
| `JOURNEY_TYPE` | `user_facing` / `autonomous` / `dev_pipeline` / `agent_remote` |
| `DB` | PostgreSQL 连接串，如 `postgresql://localhost/cecelia` |

---

## 核心原则

- **真实验证**：必须在真实环境（curl/psql/node/playwright）执行，不接受 mock
- **具体反馈**：FAIL 时的 `feedback` 必须指明具体失败原因 + 具体修复方向，严禁笼统输出"建议检查代码"
- **输出格式**：最后一条消息必须是 **纯 JSON 对象**，不加 markdown 代码块

---

## 执行流程

### Step 0: 确认模式

```bash
if [[ "$IS_FINAL_E2E" == "true" ]]; then
  echo "模式 B — 最终 E2E"
else
  echo "模式 A — 逐任务 DoD（ws${WORKSTREAM_N}）"
fi
```

---

### 模式 A：逐任务 DoD 验证

#### Step A-1: 读 DoD 文件

```bash
cat "${SPRINT_DIR}/contract-dod-ws${WORKSTREAM_N}.md"
```

提取所有 `[BEHAVIOR]` 条目的 `Test:` 字段命令。格式示例：

```
[BEHAVIOR] 任务完成后 status = completed
Test: curl -s localhost:5221/api/brain/tasks/$TARGET_TASK_ID | jq -r '.status'
期望: completed
```

#### Step A-2: 逐条执行验证命令

对每条 `[BEHAVIOR]` 条目：

1. 执行 `Test:` 字段中的命令（在真实环境，非 mock）
2. 记录 stdout / stderr / exit code
3. 将结果与 `期望:` 行对比

按 `journey_type` 选择验证方式：

| journey_type | 验证工具 |
|---|---|
| `autonomous` | `curl` / `psql` / `node` 脚本 |
| `user_facing` | Playwright（chrome MCP）模拟用户操作 |
| `dev_pipeline` | `curl callback` + `gh pr view` |
| `agent_remote` | 检查 bridge 回调 + DB 状态 |

#### Step A-3: 输出报告

**全部通过时**（所有 `[BEHAVIOR]` exit 0 且结果匹配期望）：

```
{"verdict": "PASS", "task_id": "<TASK_ID>", "workstream": "ws<WORKSTREAM_N>", "all_dod": "passed", "checked": <N>}
```

**有任何失败时**：

```
{"verdict": "FAIL", "task_id": "<TASK_ID>", "workstream": "ws<WORKSTREAM_N>", "failed_items": [{"dod": "<原条目>", "command": "<执行的命令>", "got": "<实际输出>", "expected": "<期望值>"}], "feedback": "<具体失败原因，指明文件/函数/行为，附修复方向>"}
```

**`feedback` 写作规则**：
- 必须包含具体失败的文件路径或函数名
- 必须包含实际得到的值 vs 期望值
- 必须给出具体修复方向（如："在 task-router.js 中为 harness_evaluate 添加路由条目，当前路由映射缺少此 task_type"）
- 禁止输出："建议检查代码" / "请排查问题" 等笼统描述

---

### 模式 B：最终 E2E 验证

#### Step B-1: 提取 E2E 验收脚本

```bash
# 从合同中提取 "E2E 验收" 区块的 bash 脚本
awk '/^## E2E 验收/,/^## /' "${SPRINT_DIR}/contract-draft.md" \
  | grep -A9999 '```bash' | grep -B9999 '```' | grep -v '```' \
  > /tmp/e2e-verify.sh
chmod +x /tmp/e2e-verify.sh
```

#### Step B-2: 执行 E2E 脚本

```bash
bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
EXIT_CODE=${PIPESTATUS[0]}
```

按 `journey_type` 补充验证逻辑：

| journey_type | E2E 验证方式 |
|---|---|
| `autonomous` | 直接跑合同 bash 脚本（curl/psql 链路） |
| `user_facing` | 合同 bash 脚本 + chrome MCP Playwright 界面点击验证 |
| `dev_pipeline` | 合同 bash 脚本 + `gh pr view` 验证 callback 到达 |
| `agent_remote` | 合同 bash 脚本 + 检查 bridge 回调 + DB 状态 |

#### Step B-3: 判断结果

**脚本 exit 0（通过）**：

```
{"verdict": "PASS", "task_id": "<TASK_ID>", "mode": "e2e", "journey_type": "<JOURNEY_TYPE>"}
```

**脚本 exit ≠ 0（失败）**：

分析 `/tmp/e2e-result.log`，定位哪个步骤失败（对照合同的 Step 1 / Step 2 / Step 3）：

```
{"verdict": "FAIL", "task_id": "<TASK_ID>", "mode": "e2e", "journey_type": "<JOURNEY_TYPE>", "failed_step": "<Step N>", "log_excerpt": "<失败行前后 5 行>", "feedback": "<具体失败原因 + 对应 workstream 修复方向>"}
```

---

## 输出规范

**最后一条消息必须是纯 JSON**，示例：

```
{"verdict": "PASS", "task_id": "abc123", "workstream": "ws2", "all_dod": "passed", "checked": 3}
```

```
{"verdict": "FAIL", "task_id": "abc123", "workstream": "ws2", "failed_items": [{"dod": "[BEHAVIOR] status = completed", "command": "curl -s localhost:5221/api/brain/tasks/abc123 | jq -r '.status'", "got": "in_progress", "expected": "completed"}], "feedback": "task-executor.js 未调用 updateTaskStatus，任务完成后状态未从 in_progress 变为 completed。修复：在 ws2 的任务完成回调中加 PATCH /api/brain/tasks/:id {status: 'completed'}"}
```

**禁止**：
- 输出 JSON 时加 markdown 代码块（```json）
- 输出摘要/说明文字后再附 JSON（最后一条消息只有 JSON）

---

## 常见错误

1. **验证命令用 mock 或 dry-run** → 必须连接真实服务（brain 端口 5221，真实 DB）
2. **feedback 笼统** → 必须指明具体文件/函数/值，附修复方向
3. **输出带 markdown 代码块** → Brain 解析 verdict 字段时会失败
4. **模式 A 漏提取 [BEHAVIOR] 条目** → `grep -n '\[BEHAVIOR\]'` 验证提取数量
5. **模式 B E2E 脚本提取不全** → 确认 `## E2E 验收` 区块边界正确
