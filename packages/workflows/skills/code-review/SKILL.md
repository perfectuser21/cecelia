---
name: code-review
version: 1.0.0
created: 2026-02-24
updated: 2026-02-24
description: |
  统一代码审查 Agent。合并 audit + qa + review + codex_qa 为单一入口。
  支持手动触发和 Brain 每日自动派发。按 repo 执行，两阶段分析，输出审查报告 + 修复计划。
---

> **CRITICAL LANGUAGE RULE：所有输出必须使用简体中文。包括步骤说明、审查发现、报告内容、错误信息。**

# /code-review — 统一代码审查 Agent

> 这是 audit + qa + review + codex_qa 的统一入口。以前四个角色，现在一个 Agent 搞定。

---

## 概念澄清（不要混淆）

| 旧工具 | 新位置 | 说明 |
|--------|--------|------|
| `/audit` | Phase 2 → 代码质量维度 | L1/L2/L3/L4 分层标准保留 |
| `/review` | Phase 2 → PR 变更维度 | 看最近 24h git diff |
| `/qa` | Phase 3 → 测试策略维度 | RCI 决策保留 |
| `codex_qa` | Phase 2 → AI 免疫维度 | 替换 Codex CLI，用 Claude 自身检查 |

**这个 Skill 不是 /dev 的一部分**——它是独立的每日巡检 Agent，也可以手动调用。

---

## 触发方式

### 手动触发
```
/code-review                          # 审查当前目录的 repo
/code-review /path/to/repo            # 审查指定 repo
/code-review --scope=src/             # 只审查指定目录
/code-review --since=48h              # 扩大时间窗口（默认 24h）
/code-review --full                   # 全量扫描（首次接入新 repo 用）
```

### Brain 自动派发（task_type = code_review）
Brain 每天 02:00 创建 task，payload 格式：
```json
{
  "task_type": "code_review",
  "repo_path": "/home/xx/perfect21/cecelia/core",
  "scope": "daily",
  "since_hours": 24
}
```

---

## 执行流程

### ▶ Phase 1：Triage（侦察，约 2 分钟）

**目的**：搞清楚今天有没有东西要看，要看哪里。

```
Step 1.1  git log --since="24 hours ago" --name-only
          → 收集变更文件列表

Step 1.2  按模块聚合
          → src/ 业务逻辑
          → __tests__/ 测试
          → migrations/ 数据库变更
          → scripts/ 工具脚本
          → 配置/文档

Step 1.3  风险评分（RISK SCORE）
          以下每项 +1 分：
          R1: 有 migration 文件变更
          R2: 有 src/ 核心逻辑变更（tick/executor/thalamus/cortex）
          R3: 有超过 5 个文件变更
          R4: 有 package.json 依赖变更
          R5: 有安全敏感路径变更（auth/credential/token/secret）
          R6: 没有对应的测试文件变更（有 src/ 改但没有 test 改）
          R7: 有大段删除（超过 50 行删除）
          R8: 有跨模块边界改动（同时改了 src/ + migrations/）

          RISK SCORE < 2 → 快速扫描模式（只看 L1）
          RISK SCORE 2-4 → 标准模式（L1 + L2）
          RISK SCORE >= 5 → 深度模式（L1 + L2 + 安全 + AI免疫）

Step 1.4  如果没有任何变更 → 输出"今日无变更，跳过"并结束
```

---

### ▶ Phase 2：Deep Review（深度审查，约 5-15 分钟）

**目的**：对 Phase 1 识别的变更区域，逐维度检查。

#### 维度 A：代码质量（L1/L2 分层）

沿用 `/audit` 的分层标准：

| Layer | 名称 | 检查内容 | 处理方式 |
|-------|------|----------|----------|
| **L1** | 阻塞性 | 会崩溃、功能完全不工作、数据丢失 | **必须列入修复计划** |
| **L2** | 功能性 | 边界条件缺失、错误处理不当、edge case | **建议列入修复计划** |
| L3 | 最佳实践 | 命名、代码风格、可读性 | 记录但不阻塞 |
| L4 | 过度优化 | 极端情况、理论性能微调 | **不记录** |

**具体检查清单**：
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

---

#### 维度 B：安全性（独立维度，高权重）

```
必查项（任何 RISK SCORE 都要检查）：
  □ 硬编码的密钥/token/密码（搜索关键词：password= key= secret= token=）
  □ SQL 拼接（非参数化查询）
  □ 命令注入风险（exec/spawn + 用户输入）
  □ 认证/权限检查缺失

深度模式额外检查（RISK SCORE >= 5）：
  □ 依赖包版本是否有已知 CVE
  □ 对外暴露的 API 是否有输入校验
  □ 日志是否意外打印了敏感信息
```

发现安全问题 → 自动标记 CRITICAL，优先级 P0。

---

#### 维度 C：AI 代码免疫检查（替代 codex_qa）

**目的**：检查 AI 生成的代码是否有"看起来对但实际有问题"的模式。

```
识别 AI 生成代码的标志：
  → git blame 显示大段单次提交
  → 注释风格突然变化（英文/过于详细）
  → 函数签名与项目风格不一致

检查 AI 代码的特有陷阱：
  □ 幻觉 API：调用了不存在的方法或参数名错误
  □ 过度封装：为一次性操作创建了复杂的抽象
  □ 假设兜底：catch 块里默默 return null 掩盖了真实错误
  □ 上下文割裂：函数逻辑正确但与项目其他部分不一致（比如错误处理风格）
  □ 测试造假：测试通过但只是 mock 了所有逻辑，没有真正测试
```

---

#### 维度 D：测试覆盖（QA 视角）

```
Step D.1  计算变更代码的测试覆盖缺口
          → 有业务逻辑变更但没有测试 → 标记 T1（缺测试）
          → 有测试但只测了 happy path → 标记 T2（覆盖不足）

Step D.2  RCI 决策（继承 /qa 的机制）
          → L1 修复 → MUST_ADD_RCI
          → L2 新增行为 → UPDATE_RCI
          → 仅重构/文档 → NO_RCI
```

---

### ▶ Phase 3：报告生成（约 1 分钟）

**目的**：把所有发现整理成可执行的报告。

输出两个文件：

#### 文件 1：CODE-REVIEW-REPORT.md

```markdown
---
repo: <repo_name>
review_date: <YYYY-MM-DD>
scope: daily-24h | full | pr
risk_score: <N>
mode: quick | standard | deep
decision: PASS | NEEDS_FIX | CRITICAL_BLOCK
---

## 审查摘要

- 变更文件数：N
- 发现问题数：L1: N, L2: N, L3: N
- 安全问题：N
- AI 免疫问题：N
- 测试缺口：N

## L1 问题（必须修）

### [L1-001] <简短标题>
- 文件：`path/to/file.js:行号`
- 问题：<具体描述>
- 风险：<如果不修会怎样>
- 建议修复：<具体改法>

## L2 问题（建议修）

### [L2-001] <简短标题>
（同上格式）

## 安全问题

### [SEC-001] <简短标题>
- 严重性：CRITICAL | HIGH | MEDIUM
（同上格式）

## AI 免疫发现

### [AI-001] <简短标题>
（同上格式）

## 测试缺口

| 变更文件 | 缺失测试类型 | RCI 决策 |
|---------|-------------|---------|

## L3 记录（不阻塞）

（简单列表，无需详细描述）
```

#### 文件 2：REVIEW-PLAN.md（修复计划）

```markdown
---
repo: <repo_name>
plan_date: <YYYY-MM-DD>
total_items: N
estimated_effort: <N> tasks
---

## 优先级排序

### P0 — 立即修复（今天）
- [ ] [L1-001] <标题> → 建议新建 task 派发给 /dev

### P1 — 本周修复
- [ ] [L2-001] <标题>
- [ ] [SEC-001] <标题>

### P2 — 下个迭代
- [ ] <其他>

## Brain 可派发的 Task 列表

### Task 分组规则（CRITICAL）

| 发现类型 | 分组方式 | 一个 task = 一个 PR | 标题格式 |
|---------|---------|-------------------|---------|
| **L1 / SEC-CRITICAL** | 每个 finding 独立一个 task | ✅ 高风险修复不混用 | `fix[L1]: <标题>` |
| **L2 同文件/同模块** | 合并为一个 task | ✅ 一次 PR 改完 | `fix[L2]: <模块> 多项修复` |
| **L3 全部** | 整个 repo 一个 task | ✅ 批量处理 | `chore[L3]: <repo> 代码质量清理` |

**实际 JSON 示例**（假设发现了 2 个 L1 + 3 个 L2 分属两个模块 + 若干 L3）：

```json
[
  {
    "title": "fix[L1]: 修复 execution-callback 并发幂等性漏洞",
    "description": "routes.js:1993 — 双回调到达时后处理逻辑重复触发。修复：COMMIT 后检查 rowCount，若为 0 提前返回。",
    "priority": "P0",
    "skill": "/dev",
    "repo_path": "<repo_path>"
  },
  {
    "title": "fix[L1]: 修复 isRunIdProcessAlive 命令注入风险",
    "description": "executor.js:1593 — execSync shell 模式拼接 runId。修复：改用 spawnSync + UUID 白名单校验。",
    "priority": "P0",
    "skill": "/dev",
    "repo_path": "<repo_path>"
  },
  {
    "title": "fix[L2]: executor 模块多项修复（死代码 + 接口误导）",
    "description": "1. tick.js TASK_TYPE_AGENT_MAP 死代码删除\n2. generateRunId 无用参数清理\n3. GET /tasks 无 limit 上限",
    "priority": "P1",
    "skill": "/dev",
    "repo_path": "<repo_path>"
  },
  {
    "title": "fix[L2]: routes 模块多项修复（状态机 + 幂等性）",
    "description": "1. PATCH /tasks 缺状态转换校验\n2. 内存 Map 幂等性重启失效",
    "priority": "P1",
    "skill": "/dev",
    "repo_path": "<repo_path>"
  },
  {
    "title": "chore[L3]: cecelia-core 代码质量清理",
    "description": "L3 最佳实践清理：命名规范、注释、未使用导出等。",
    "priority": "P2",
    "skill": "/dev",
    "repo_path": "<repo_path>"
  }
]
\`\`\`
```

---

## Decision 值定义

| Decision | 含义 | Brain 行为 |
|---------|------|-----------|
| **PASS** | 无 L1 问题，L2 ≤ 2个 | 记录报告，无需派发 |
| **NEEDS_FIX** | 有 L2 问题 | 创建修复 task（P1，非紧急） |
| **CRITICAL_BLOCK** | 有 L1 或 CRITICAL 安全问题 | 立即创建 P0 task，通知用户 |

---

## 输出位置

| 文件 | 路径 |
|------|------|
| 审查报告 | `<repo_root>/docs/reviews/CODE-REVIEW-REPORT-<YYYYMMDD>.md` |
| 修复计划 | `<repo_root>/docs/reviews/REVIEW-PLAN-<YYYYMMDD>.md` |

如果 `docs/reviews/` 不存在，自动创建。

---

## 完成条件

以下任一情况即为完成：

1. ✅ Phase 1 → 无变更 → 输出"无变更，跳过"
2. ✅ Phase 1 → 有变更 → Phase 2 → Phase 3 → 两个文件已生成
3. ❌ 中途报错 → 输出已发现的内容 + 错误说明，不要静默失败

---

## 反模式警告

❌ 把整个 repo 的所有文件都读进来 → 只读变更文件 + 直接依赖
❌ "这里还可以改进一下" → L3 记录，不放入修复计划
❌ 对 L3/L4 问题标记 NEEDS_FIX → 只有 L1/L2/安全问题才触发 Decision
❌ 幻觉出不存在的文件路径 → 读文件前先确认路径存在
❌ Phase 2 结束不生成文件 → 报告文件是**必须产物**，不是可选的

---

## ⚡ 完成后行为（CRITICAL）

1. 两个 `.md` 文件已写入磁盘
2. 输出一行摘要：`✅ code-review 完成 | Decision: <PASS/NEEDS_FIX/CRITICAL_BLOCK> | L1: N, L2: N | 报告: docs/reviews/CODE-REVIEW-REPORT-<YYYYMMDD>.md`
3. 如果 Decision = CRITICAL_BLOCK，额外输出：`🚨 发现 P0 问题，建议立即处理`
4. **不要**再输出其他总结
5. 如果是 Brain 调用，回调 `/api/brain/execution-callback` 时附带 `{ "decision": "PASS|NEEDS_FIX|CRITICAL_BLOCK", "l1_count": N, "l2_count": N }`
