---
id: harness-evaluator-skill
description: |
  Harness Evaluator — 阶段 B **pre-merge gate**（不是 merge 后）：
  Generator 写完代码 push PR 后，CI 跑过基础卫生（lint/type/vitest mock/build），
  evaluator 在 CI 绿之后、PR merge 之前真启服务 + 跑 contract 的 manual:bash 命令验真行为。
  PASS → 允许 merge；FAIL → 不 merge，带反馈打回 Generator 在 PR 分支 fix loop（main 不变动）。
  模式 A 跑 contract-dod-ws*.md BEHAVIOR；模式 B（所有 ws merge 后）跑 final E2E Golden Path。
version: 1.3.0
created: 2026-05-06
updated: 2026-05-10
changelog:
  - 1.3.0: 明确 pre-merge gate 位置（反 2026-04-09 决策）— description 重写 + 加 "## 调用时机" 段，说明 evaluator 跑在 CI 绿后、PR merge 前。配套 brain 编排改动（harness-initiative.graph.js 把 evaluate 从 merge 后挪到 merge 前）由独立 PR 跟进
  - 1.2.0: 修协议盲 — 加 Test: 字段 manual:bash/manual: 前缀处理段（proposer SKILL v7.4+ 写此格式，evaluator 必须 strip 后执行）
  - 1.1.0: 加反作弊 reflexive check — 禁止把 vitest "passed" 当 PASS 替代物（W19/W20 实证 sub-evaluator 漏判 schema drift 的根因）。强制每条 [BEHAVIOR] Test: 命令必须真执行；命令缺 jq -e 或自然语言期望直接 FAIL；vitest 输出存在但合同 [BEHAVIOR] 未真跑 → FAIL。对齐 Anthropic harness-design "evaluator 默认会过度通过，必须 prompt 工程严格化"
  - 1.0.0: 初版 — Step A 模式 (DoD 验证) + Step B 模式 (E2E)，按 journey_type 选验证工具
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，直接按本文档流程操作。**

# /harness-evaluator — Harness v5 Evaluator（阶段 B · 验证层）

## 调用时机（v1.3 — pre-merge gate）

```
generator 写代码 + push PR
       ↓
   CI 跑（cheap layer）— lint/type/vitest mock/build/secrets
       ↓ CI 绿
   ★ evaluator 跑（expensive layer）— 真启 server + curl + jq -e   ← 这就是我
       ↓ evaluator PASS
   PR auto-merge（branch protection 卡 evaluator status check）
       ↓
   final_evaluate 跑 Golden Path 端到端
```

**关键 invariant**：evaluator 不 PASS，main 不变动。

**为什么 pre-merge 而非 post-merge**：
- post-merge 跑 → FAIL 时 main 已污染，fix loop 在污染的 main 上跑（违反"评判从执行分离"）
- pre-merge 跑 → FAIL 不 merge，fix loop 在 PR 分支，main 永远干净

**为什么 CI + evaluator 双层不可省**：
- CI（vitest mock）验"代码层正确"，秒级零成本
- evaluator（manual:bash）验"启动 server 真发请求看响应"，1-2min + ~$0.5
- 两层验不同事，不可替代
- memory 实证：CI 全绿但真启动 SyntaxError / host.docker.internal 不解析 / migration 漏跑 → 这些只 evaluator 抓

**注意（撤销 2026-04-09 决策）**：
2026-04-09 决策曾说"CI 是机械执行器，砍 evaluator"。该决策已撤销，见 memory `harness-pipeline-evaluator-as-pre-merge-gate.md`。

---

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

**注**：DoD 文件中的 `Test:` 命令若引用 `$TARGET_TASK_ID`，该 ID 来自 DoD 文件内部（合同写入时硬编码或由 Generator 写入），Evaluator 直接执行 DoD 中的命令原文，不需单独注入。

---

## 核心原则

- **真实验证**：必须在真实环境（curl/psql/node/playwright）执行，不接受 mock
- **具体反馈**：FAIL 时的 `feedback` 必须指明具体失败原因 + 具体修复方向，严禁笼统输出"建议检查代码"
- **输出格式**：最后一条消息必须是 **纯 JSON 对象**，不加 markdown 代码块
- **角色边界**：FAIL 报告由 Brain 编排层接收，Brain 负责决定是否重新 dispatch Generator（最多 3 次）；Evaluator 本身无需计数轮次

### 反作弊红线（v1.1 强制 — 不要让 evaluator 过度通过）

对齐 Anthropic harness-design 2026-03 原话："Out of the box, Claude is a poor QA agent...even evaluator needs prompt engineering"。下面 4 条**违反任一直接 FAIL，禁止 PASS**：

1. **禁止把 vitest 输出 grep "passed" 当 PASS 证据**。vitest 是 generator 自写的测试，不是 contract oracle。即便看到 "Tests 8 passed" 也不能给 PASS——必须真跑合同里 [BEHAVIOR] 的 `Test:` 命令逐条校验
2. **禁止以"代码看起来对"给 PASS**。不能读 server.js 源码看到 `app.get('/sum')` 就 PASS——必须真起 server + 真 curl + jq 校验响应
3. **缺 [BEHAVIOR] Test: 命令直接 FAIL**。如果合同 contract-dod-ws{N}.md 没有 [BEHAVIOR] 条目（数 < 1），输出 `{"verdict": "FAIL", "feedback": "DoD 缺 [BEHAVIOR] 条目"}`；这是 contract 阶段没 codify oracle 的问题，evaluator 不能猜
4. **缺 jq -e 严匹配视为弱测试**。如果 [BEHAVIOR] Test: 命令只 `curl -f /xxx` 不带 jq 校验 body shape，记入 `feedback` 但本轮仍按命令 exit code 判（容忍但报告，让 reviewer 下轮严化）

**特别针对 schema drift（W19/W20 根因）**：如果 PRD 写 response 必须 `{result, operation}` 但 generator 实际返 `{product}`：
- 合同里若有 `jq -e '.result == 35'` → evaluator 真跑 → exit 1 → FAIL ✓ 抓住
- 合同里若只有 `curl -f /multiply` 没 jq -e → evaluator 跑 → exit 0 → 假 PASS ❌ 漏判
- → 这是 **contract reviewer 第 6 维 verification_oracle_completeness** 该卡的事，但 evaluator 看到 [BEHAVIOR] 命令缺 jq -e 时必须**在 feedback 里写明 "弱 oracle，schema drift 漏判风险"** 让上游知道

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
DOD_FILE="${SPRINT_DIR}/contract-dod-ws${WORKSTREAM_N}.md"
if [[ ! -f "$DOD_FILE" ]]; then
  echo '{"verdict": "FAIL", "task_id": "'"$TASK_ID"'", "workstream": "ws'"$WORKSTREAM_N"'", "failed_items": [], "feedback": "DoD 文件不存在：'"$DOD_FILE"'，Generator 未产出合同 DoD，请检查 Proposer 是否已输出对应 workstream 的 DoD 文件"}'
  exit 0
fi
cat "$DOD_FILE"
```

若提取结果中 `[BEHAVIOR]` 条目数量为 0，输出 FAIL：
```
{"verdict": "FAIL", "task_id": "...", "workstream": "ws<N>", "failed_items": [], "feedback": "DoD 文件中无 [BEHAVIOR] 条目，无法验证，请检查合同格式"}
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
**Test: 字段前缀处理（v1.2 — 修协议盲，proposer SKILL 写 manual:bash 前缀）**：
- Test 命令若以 `manual:bash -c '<cmd>'` 开头 → strip `manual:bash -c '` 前缀和末尾 `'`，把里面的 `<cmd>` 整体用 `bash -c "<cmd>"` 执行
- Test 命令若以 `manual:` 开头（无 bash -c）→ strip `manual:` 前缀，剩下原样 bash 执行
- 不以 `manual:` 开头的（如 `node -e "..."` / `curl ...`） → 直接 bash 执行原文
- 这是跟 proposer SKILL v7.4+ 协议约定的格式，evaluator 不能因看到 `manual:` 前缀就跳过命令

2. 记录 stdout / stderr / exit code
3. 将结果与 `期望:` 行对比（规则：`stdout` trim 后**包含**期望字符串即通过，大小写敏感）

按 `$JOURNEY_TYPE` 选择验证工具（表中 `journey_type` 列对应注入变量 `$JOURNEY_TYPE` 的值）：

| journey_type | 验证工具 |
|---|---|
| `autonomous` | `curl` / `psql` / `node` 脚本 |
| `user_facing` | Playwright（chrome MCP）模拟用户操作 |
| `dev_pipeline` | `curl callback` + `gh pr view` |
| `agent_remote` | 检查 bridge 回调 + DB 状态 |
| 其他/未知值 | 回退到 `autonomous` 方式（curl/psql/node） |

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
CONTRACT="${SPRINT_DIR}/contract-draft.md"
if [[ ! -f "$CONTRACT" ]]; then
  echo "{\"verdict\": \"FAIL\", \"task_id\": \"$TASK_ID\", \"mode\": \"e2e\", \"journey_type\": \"$JOURNEY_TYPE\", \"failed_step\": \"setup\", \"log_excerpt\": \"\", \"feedback\": \"合同文件不存在：$CONTRACT\"}"
  exit 0
fi

# 提取 "## E2E 验收" 区块内第一个 bash 代码块
awk '/^## E2E 验收/{found=1} found && /^```bash/{in_block=1; next} in_block && /^```/{in_block=0; exit} in_block{print}' \
  "$CONTRACT" > /tmp/e2e-verify.sh

if [[ ! -s /tmp/e2e-verify.sh ]]; then
  echo "{\"verdict\": \"FAIL\", \"task_id\": \"$TASK_ID\", \"mode\": \"e2e\", \"journey_type\": \"$JOURNEY_TYPE\", \"failed_step\": \"setup\", \"log_excerpt\": \"\", \"feedback\": \"合同中未找到 ## E2E 验收 区块或区块内无 bash 脚本\"}"
  exit 0
fi
chmod +x /tmp/e2e-verify.sh
```

#### Step B-2: 执行 E2E 脚本

```bash
timeout 120 bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
EXIT_CODE=${PIPESTATUS[0]}
# timeout 退出码 124 表示超时
if [[ $EXIT_CODE -eq 124 ]]; then
  echo '{"verdict": "FAIL", "task_id": "'"$TASK_ID"'", "mode": "e2e", "journey_type": "'"$JOURNEY_TYPE"'", "failed_step": "timeout", "log_excerpt": "", "feedback": "E2E 脚本执行超时（120 秒），请检查被测服务是否正常启动或脚本是否有无限等待"}'
  exit 0
fi
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
