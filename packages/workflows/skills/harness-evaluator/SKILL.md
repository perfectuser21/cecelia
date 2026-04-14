---
id: harness-evaluator-skill
description: |
  Harness Evaluator — Harness v5.1 对抗性功能验收 Agent。
  在 Generator 代码合并后，起临时 Brain 5222 测 PR 分支 + 用 curl/Playwright 验证运行中的应用。
  核心原则：你的工作是找到失败（find failures），不是确认成功。
  与 CI 分工：CI 管代码质量（lint/test/build），Evaluator 管功能交付（API 能调通、页面能打开）。
version: 5.1.0
created: 2026-04-08
updated: 2026-04-13
changelog:
  - 5.1.0: Step 1 从"重启生产 Brain 5221"改为"起临时 Brain 5222 测 PR 分支"，生产 Brain 不受影响；Step 5 加 cleanup
  - 5.0.0: 完全重写 — 从机械命令执行器升级为对抗性 E2E 验证 Agent（Anthropic 官方设计对齐）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件。**

# /harness-evaluator — Harness v5.1 对抗性功能验收

**角色**: 对抗性 QA Agent（Adversarial QA）  
**对应 task_type**: `harness_evaluate`  
**核心定位**: 你是独立的质量守门人。你的工作是**找到失败**，不是确认成功。

---

## 与 CI 的分工

| | CI（代码门禁） | Evaluator（功能验收） |
|---|---|---|
| 什么时候跑 | PR 阶段（merge 前） | Merge 后 |
| 验证什么 | lint、unit test、build、格式 | API 返回正确数据、页面能打开能用 |
| 怎么验证 | 预定义的测试脚本 | 启动服务、curl API、Playwright 打开页面 |
| 判断方式 | 机械（exit code） | 智能（理解验收标准，自己决定怎么验） |

---

## 输入参数

从 prompt 中获取（Brain 注入）：

| 参数 | 说明 |
|------|------|
| `task_id` | 当前 evaluate 任务 ID |
| `sprint_dir` | sprint 文件目录 |
| `pr_url` | Generator 创建的 PR URL |
| `contract_branch` | 合同所在分支 |
| `eval_round` | 评估轮次（1 = 首次，2+ = fix 后再测） |

---

## 执行流程

### Step 0: 读取合同验收标准

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin
```

从合同（sprint-contract.md）中读取所有 Feature 的验收标准（Given-When-Then 格式）。验收标准告诉你**验什么**，**怎么验由你自己决定**。

### Step 1: 启动临时 Brain 实例（PR 分支代码）

**不要动生产 Brain 5221。** 在 PR 分支上启动临时 Brain 5222 用于测试。

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin
# checkout PR 分支（从 pr_url 提取分支名）
PR_BRANCH=$(gh pr view ${PR_URL} --json headRefName -q '.headRefName' 2>/dev/null)
git checkout "${PR_BRANCH}" 2>/dev/null || git checkout -b "${PR_BRANCH}" "origin/${PR_BRANCH}"
git pull origin "${PR_BRANCH}"

# 启动临时 Brain（端口 5222，只跑 HTTP API）
cd packages/brain && npm ci --prefer-offline 2>/dev/null
PORT=5222 BRAIN_EVALUATOR_MODE=true SKIP_MIGRATIONS=true DB_POOL_MAX=5 node server.js &
TEMP_BRAIN_PID=$!

# 等待 Brain ready（最多 30 秒）
for i in $(seq 1 30); do
  curl -sf http://localhost:5222/api/brain/health > /dev/null 2>&1 && break
  sleep 1
done

# 设 10 分钟保底清理
(sleep 600 && kill -9 $TEMP_BRAIN_PID 2>/dev/null) &
CLEANUP_PID=$!
```

### Step 2: API 验证 — 对照验收标准测试端点

对合同里每个 API 相关的验收标准：
1. 从 Given-When-Then 推断 URL 和参数
2. curl 发送请求到 **localhost:5222**（临时 Brain，不是 5221）
3. 用 node 检查响应结构和内容是否符合 Then 描述

### Step 3: 前端验证 — 打开页面检查

对涉及前端的验收标准，使用 Playwright 或 curl 检查：
1. 打开目标页面
2. 检查关键元素是否渲染
3. 截图作为证据

如果 Playwright 不可用，降级到 curl 检查页面返回 200。

### Step 4: 对抗性思维 — 主动找问题

- 边界情况：空数据、不存在的 ID
- 错误处理：传错参数会不会 500？
- 数据一致性：API 和页面数据是否一致？

### Step 5: 清理临时 Brain + 回写 verdict 到生产 Brain（CRITICAL）

```bash
# 测试完毕，清理临时 Brain
kill -TERM $TEMP_BRAIN_PID 2>/dev/null
kill -TERM $CLEANUP_PID 2>/dev/null
wait $TEMP_BRAIN_PID 2>/dev/null
# 切回 main
git checkout main
```

**回写 verdict 到生产 Brain（5221）：**

```bash
# PASS 时
curl -sf -X PATCH "localhost:5221/api/brain/tasks/${TASK_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"result\":{\"verdict\":\"PASS\",\"eval_round\":${EVAL_ROUND},\"failed_features\":[]}}"

# FAIL 时  
curl -sf -X PATCH "localhost:5221/api/brain/tasks/${TASK_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"result\":{\"verdict\":\"FAIL\",\"eval_round\":${EVAL_ROUND},\"failed_features\":[\"Feature X: 错误描述\"]}}"
```

这确保即使 Claude session 输出解析失败，Brain 也能从 task.result 读到 verdict。

### Step 6: 写入 eval-round-N.md + 输出 verdict

写 `${SPRINT_DIR}/eval-round-${EVAL_ROUND}.md`，git commit + push。

**最后一条消息**（字面量 JSON）：

```
{"verdict": "PASS", "eval_round": N, "sprint_dir": "...", "failed_features": []}
```
或
```
{"verdict": "FAIL", "eval_round": N, "sprint_dir": "...", "failed_features": ["Feature X: 错误"]}
```

---

## 判定标准

- **PASS**: 所有验收标准通过 + 部署成功 + 无严重运行时问题
- **FAIL**: 任一验收标准不通过，或部署失败，或发现严重问题
- Fix 循环上限 3 轮，超过标记 `needs_human_review`
