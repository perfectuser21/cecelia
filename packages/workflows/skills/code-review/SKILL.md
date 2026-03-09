---
name: code-review
version: 1.3.0
created: 2026-02-24
updated: 2026-03-09
changelog:
  - 1.3.0: Phase 0 Step 0.3 集成测试执行步骤具体化（owner定位/分支checkout/命令优先级/结果捕获）
  - 1.2.0: 新增 --initiative-id 模式 + Phase 0（Initiative 前置：集成测试 + Golden Path + TEST_BLOCK 门禁）
  - 1.1.0: 修复 --full/--level 旗标被忽视的 bug，去掉 Cecelia 硬编码模块名，优化 description
  - 1.0.0: 初始版本
description: |
  Use this skill to proactively scan recent code changes for unknown problems — the "did anything
  break?" check. Triggers when users want to: inspect the last N hours of commits, run a daily
  代码巡检, check recent changes for race conditions/uncaught exceptions/edge cases/security issues,
  perform a security scan on a repo for injection or credential exposure, or invoke /code-review
  directly. Also auto-triggered by Brain task_type=code_review dispatch. Generates formal bug
  reports (L1/L2 severity) and prioritized fix plans. Supports --full (no time limit), --since=Nh,
  --level 1|2|3. Also supports --initiative-id for initiative-level integration review.
---

> **CRITICAL LANGUAGE RULE：所有输出必须使用简体中文。包括步骤说明、审查发现、报告内容、错误信息。**

# /code-review — 统一代码审查 Agent

这是 audit + qa + review + codex_qa 的统一入口：代码质量、安全性、AI 代码免疫、测试覆盖四个维度合一。

---

## 触发方式

```
/code-review                          # 日常增量审查（默认 24h 时间窗口）
/code-review /path/to/repo            # 审查指定 repo
/code-review --scope=src/             # 只审查指定目录
/code-review --since=48h              # 扩大时间窗口
/code-review --full                   # 全量扫描（无时间限制，等同于 --level 3）
/code-review --level 1|2|3            # 显式指定审查深度
/code-review --initiative-id <id>     # Initiative 级审查（含集成测试，Brain 断链#5 自动触发）
```

**深度说明**：

| 模式 | 触发条件 | 审查维度 |
|------|---------|---------|
| 快速（quick） | `--level 1` 或 RISK < 2 | 只查 L1 致命问题 |
| 标准（standard） | `--level 2` 或 RISK 2-4 | L1 + L2 + 安全基础检查 |
| 深度（deep） | `--level 3` / `--full` / RISK ≥ 5 | 全部维度：L1+L2+安全+AI免疫 |

### Brain 自动派发（task_type = code_review）

```json
{
  "task_type": "code_review",
  "repo_path": "/home/xx/perfect21/cecelia",
  "scope": "daily",
  "since_hours": 24
}
```

payload 含 `since_hours` → 时间窗口模式；不含 `since_hours`、不含 flags → 默认 24h。

---

## 执行流程

### ▶ Phase 0：Initiative 前置（仅 --initiative-id 模式）

**目的**：在进入常规代码审查前，先跑 Initiative 级别的集成测试和 Golden Path，作为质量门禁。

```
Step 0.1  从 Brain API 获取 Initiative 所有已完成 dev tasks
          GET /api/brain/tasks?project_id=<initiative_id>&task_type=dev&status=completed
          → 收集所有 task 的 pr_number / branch_name / payload

Step 0.2  收集所有 PR 的变更文件（合并去重）
          → 对每个 pr_number：gh pr diff <N> --name-only
          → 去重后形成 initiative 级别的变更文件清单
          → 此清单替代 Phase 1 的 git log 输出，直接进入 Phase 2

Step 0.3  定位并执行集成测试
          a. 查找 integration_test_owner task：
             OWNER_TASK=$(curl -s "http://localhost:5221/api/brain/tasks?project_id=$INITIATIVE_ID" | \
               jq -r '[.[] | select(.payload.integration_test_owner == true)] | first')
             [ "$OWNER_TASK" = "null" ] → 记录"无集成测试 owner，跳过"（不阻塞）

          b. 获取 owner 分支（优先 payload.branch_name，fallback payload.pr_number checkout）：
             BRANCH=$(echo $OWNER_TASK | jq -r '.payload.branch_name // empty')
             PR=$(echo $OWNER_TASK | jq -r '.payload.pr_number // empty')
             [ -n "$BRANCH" ] && git fetch origin "$BRANCH" && git checkout "origin/$BRANCH" -- 2>/dev/null
             [ -n "$PR" ] && gh pr checkout "$PR" 2>/dev/null
             [ -z "$BRANCH" -a -z "$PR" ] → 记录"无法定位分支，跳过集成测试"

          c. 确定测试命令（按优先级）：
             1. 检查 package.json 是否有 test:integration 脚本 → npm run test:integration
             2. 检查 vitest.config.* 是否有 integration project → npx vitest run --project integration
             3. 检查 initiative-dod.md 是否有 ## Integration Tests 章节并注明命令
             4. 以上均无 → 记录"无集成测试套件，跳过"（不阻塞）

          d. 执行测试，捕获 exit code 和失败用例：
             TEST_OUTPUT=$(eval "$TEST_CMD" 2>&1)
             TEST_EXIT=$?
             [ $TEST_EXIT -ne 0 ] → 提取失败用例（grep "FAIL\|Error\|✗" lines）
             → 记录：PASS（exit 0）/ FAIL（exit ≠ 0）+ 失败列表

Step 0.4  运行 Golden Path 测试
          → 检查 docs/golden-paths/ 是否有 Initiative 对应的 Golden Path 文件
          → 有 → 运行 Golden Path 测试脚本
          → 无 → 记录"无 Golden Path，跳过"（不阻塞）

Step 0.5  汇总 Phase 0 结论
          → 集成测试 FAIL / 未找到 integration_test_owner → 输出 TEST_BLOCK，终止执行
          → 集成测试 PASS → 继续 Phase 1-4（用 Step 0.2 的变更文件清单）
```

**TEST_BLOCK 输出格式**：

```
[BLOCK] Initiative 集成测试失败
Initiative ID: <id>
失败原因: <reason>
失败用例:
  - <test_name>: <error>
建议: 修复以上集成测试后重新触发 code_review
```

> 输出含 `TEST_BLOCK` 或 `[BLOCK]` → Brain 断链#4 质量门禁触发，跳过 initiative_verify

---

### ▶ Phase 1：Triage（侦察）

**目的**：确定扫描范围和审查深度。

```
Step 1.0  解析参数，确定扫描范围
          检查 $ARGUMENTS 中的 flags：
          - 含 --initiative-id <id> → Phase 0 已完成，变更文件清单已由 Phase 0 Step 0.2 生成
                                       直接使用该清单，跳过 Step 1.1 的 git log
          - 含 --full 或 --level 3  → 全量模式：git log --all --name-only（无时间限制）
          - 含 --since=Nh           → 时间窗口：git log --since="N hours ago" --name-only
          - 含 --level 1 或 --level 2 → 时间窗口（24h）+ 对应深度
          - 无 flags（默认）         → git log --since="24 hours ago" --name-only
          ⚠️ --full 模式绝不使用时间限制

Step 1.1  执行 Step 1.0 选定的 git log 命令，收集变更文件列表
          （--initiative-id 模式跳过此步，已有 Phase 0 清单）

Step 1.2  按模块聚合
          → src/ 业务逻辑
          → __tests__/ 测试
          → migrations/ 数据库变更
          → scripts/ 工具脚本
          → 配置/文档

Step 1.3  风险评分（RISK SCORE）—— 仅当未通过 Step 1.0 指定深度时使用
          以下每项 +1 分：
          R1: 有 migration 文件变更
          R2: 有核心业务逻辑变更（src/ 下的主要模块）
          R3: 有超过 5 个文件变更
          R4: 有 package.json 依赖变更
          R5: 有安全敏感路径变更（auth/credential/token/secret）
          R6: 没有对应的测试文件变更（有 src/ 改但没有 test 改）
          R7: 有大段删除（超过 50 行删除）
          R8: 有跨模块边界改动（同时改了 src/ + migrations/）

          RISK < 2 → 快速，RISK 2-4 → 标准，RISK ≥ 5 → 深度

Step 1.4  如果没有任何变更 → 输出"今日无变更，跳过"并结束
```

---

### ▶ Phase 2：Deep Review（深度审查）

对 Phase 1 识别的变更区域，逐维度检查。

#### 维度 A：代码质量（L1/L2 分层）

| Layer | 名称 | 检查内容 | 处理方式 |
|-------|------|----------|----------|
| **L1** | 阻塞性 | 崩溃、功能不工作、数据丢失 | **必须列入修复计划** |
| **L2** | 功能性 | 边界条件缺失、错误处理不当 | **建议列入修复计划** |
| L3 | 最佳实践 | 命名、代码风格、可读性 | 记录但不阻塞 |
| L4 | 过度优化 | 理论性能微调 | **不记录** |

```
L1 检查项：
  □ 语法/类型错误
  □ 未捕获的异常（会让进程 crash）
  □ 数据库操作无事务保护（数据可能不一致）
  □ 无限循环或死锁风险
  □ 关键资源（连接/文件）未关闭

L2 检查项：
  □ 空值/undefined 未处理
  □ 网络请求无超时保护
  □ 错误码/错误信息不准确
  □ 重试逻辑缺失或有缺陷
  □ 并发竞争条件（race condition）
  □ 日志不足（关键操作无日志）
```

#### 维度 B：安全性（独立维度，高权重）

```
必查项（任何模式都要检查）：
  □ 硬编码的密钥/token/密码（password= key= secret= token=）
  □ SQL 拼接（非参数化查询）
  □ 命令注入风险（exec/spawn + 用户输入）
  □ 认证/权限检查缺失

深度模式额外检查：
  □ 依赖包版本是否有已知 CVE
  □ 对外暴露的 API 是否有输入校验
  □ 日志是否意外打印了敏感信息
```

发现安全问题 → 自动标记 CRITICAL，优先级 P0。

#### 维度 C：AI 代码免疫检查

```
识别 AI 生成代码的标志：
  → git blame 显示大段单次提交
  → 注释风格突然变化（英文/过于详细）
  → 函数签名与项目风格不一致

检查 AI 代码的特有陷阱：
  □ 幻觉 API：调用了不存在的方法或参数名错误
  □ 过度封装：为一次性操作创建了复杂的抽象
  □ 假设兜底：catch 块里默默 return null 掩盖了真实错误
  □ 上下文割裂：逻辑正确但与项目其他部分风格不一致
  □ 测试造假：测试通过但只是 mock 了所有逻辑
```

#### 维度 D：测试覆盖（QA 视角）

```
Step D.1  计算变更代码的测试覆盖缺口
          → 有业务逻辑变更但没有测试 → 标记 T1（缺测试）
          → 有测试但只测了 happy path → 标记 T2（覆盖不足）

Step D.2  RCI 决策
          → L1 修复 → MUST_ADD_RCI
          → L2 新增行为 → UPDATE_RCI
          → 仅重构/文档 → NO_RCI
```

---

### ▶ Phase 3：报告生成

输出两个文件到 `<repo_root>/docs/reviews/`（不存在则自动创建）：

**文件 1：`CODE-REVIEW-REPORT-<YYYYMMDD>.md`**

```markdown
---
repo: <repo_name>
review_date: <YYYY-MM-DD>
scope: daily-24h | full | custom
risk_score: <N>
mode: quick | standard | deep
decision: PASS | NEEDS_FIX | CRITICAL_BLOCK
---

## 审查摘要
- 变更文件数：N / 发现问题：L1: N, L2: N, L3: N / 安全: N / AI免疫: N / 测试缺口: N

## L1 问题（必须修）
### [L1-001] <简短标题>
- 文件：`path/to/file.js:行号`  问题：<描述>  风险：<后果>  建议修复：<具体改法>

## L2 问题（建议修）
### [L2-001] <简短标题>（同上格式）

## 安全问题
### [SEC-001] <简短标题>  严重性：CRITICAL | HIGH | MEDIUM

## AI 免疫发现 / 测试缺口 / L3 记录
（同上格式 / 表格 / 简单列表）
```

**文件 2：`REVIEW-PLAN-<YYYYMMDD>.md`**

包含优先级排序（P0/P1/P2）和 Brain 可直接派发的 Task JSON：

```json
[
  {
    "title": "fix[L1]: <标题>",
    "description": "<file.js:行号> — <问题描述>。修复：<具体改法>",
    "priority": "P0",
    "skill": "/dev",
    "repo_path": "<repo_path>"
  }
]
```

**Task 分组规则**：L1/SEC-CRITICAL → 每个独立一个 task；L2 同模块 → 合并一个 task；L3 全部 → 整个 repo 一个 task。

---

## Decision 值

| Decision | 含义 | Brain 行为 |
|---------|------|-----------|
| **PASS** | 无 L1，L2 ≤ 2个 | 记录报告，无需派发 |
| **NEEDS_FIX** | 有 L2 问题 | 创建修复 task（P1） |
| **CRITICAL_BLOCK** | 有 L1 或 CRITICAL 安全 | 立即创建 P0 task，通知用户 |

---

## 反模式警告

❌ `--full` 模式还用 `--since="24 hours ago"` → `--full` = 无时间限制，git log --all
❌ 把整个 repo 的所有文件都读进来 → 只读变更文件 + 直接依赖
❌ 对 L3/L4 问题标记 NEEDS_FIX → 只有 L1/L2/安全才触发 Decision
❌ 幻觉出不存在的文件路径 → 读文件前先确认路径存在
❌ Phase 2 结束不生成文件 → 报告文件是**必须产物**，不是可选的
❌ --initiative-id 模式跳过 Phase 0 → Phase 0 是 initiative 模式的核心，不可跳过
❌ 集成测试失败还继续 Phase 1-4 → TEST_BLOCK 出现即终止，不再生成常规报告

---

## ⚡ 完成后行为（CRITICAL）

1. 两个 `.md` 文件已写入磁盘
2. 输出一行摘要：`✅ code-review 完成 | Decision: <PASS/NEEDS_FIX/CRITICAL_BLOCK> | L1: N, L2: N | 报告: docs/reviews/CODE-REVIEW-REPORT-<YYYYMMDD>.md`
3. 如果 Decision = CRITICAL_BLOCK，额外输出：`🚨 发现 P0 问题，建议立即处理`
4. **不要**再输出其他总结
5. 如果是 Brain 调用，回调 `/api/brain/execution-callback` 时附带 `{ "decision": "PASS|NEEDS_FIX|CRITICAL_BLOCK", "l1_count": N, "l2_count": N }`
