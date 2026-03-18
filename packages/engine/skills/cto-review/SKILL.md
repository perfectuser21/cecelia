---
name: cto-review
version: 1.0.0
updated: 2026-03-18
description: |
  CTO 代码审查 Skill。在 /dev Step 2（代码完成）之后、CI push 之前自动触发。
  由西安 Codex（Codex B）执行，读取 enriched PRD + DoD + 核心 diff，
  对整体实现质量作出 PASS/FAIL 判断。
  Brain task_type=cto_review 自动路由到此 skill（/cto-review）。
  是完成开发任务三个核心组件之一：dev + intent-expand + cto-review，均属 Engine。
---

> **CRITICAL LANGUAGE RULE：所有输出必须使用简体中文。包括步骤说明、审查结论、问题描述、错误信息。**

# /cto-review — CTO 代码审查

> 在代码写完、CI 之前，由独立 Codex Agent 对实现质量整体判断 PASS/FAIL。

---

## 定位

```
dev 流程中的位置：

Step 2: Code（写代码）
    ↓
  代码通过 Gate 2
    ↓
  触发 cto_review（本 Skill）← 你在这里
    ↓
  devloop-check.sh 条件 2.5：等待 PASS
    ↓
Step 3: PR+CI（push + CI）
```

**三组件关系**：

| Skill | 触发时机 | 执行者 | 目的 |
|-------|---------|--------|------|
| `/dev` | 用户发起任务 | 本机 Claude | 开发工作流编排（Step 0-5）|
| `/intent-expand` | Step 1 末尾（PRD 写完后）| 本机 Claude | 沿 OKR 链补全 PRD，生成 enriched PRD |
| `/cto-review` | Step 2 末尾（代码完成后）| 西安 Codex（Codex B）| 读 enriched PRD + DoD + diff，PASS/FAIL |

---

## 触发方式

### Brain 自动派发（task_type = cto_review）

Brain 路由到西安 Codex（xian），执行 `/cto-review`：

```json
{
  "task_type": "cto_review",
  "branch": "cp-MMDDHHNN-task-name",
  "diff_summary": "变更统计摘要（git diff --stat）",
  "brain_task_id": "原始开发任务 ID"
}
```

### 手动调用

```bash
/cto-review                             # 审查当前分支（读 .dev-mode 获取上下文）
/cto-review --branch cp-xxx-yyy         # 指定分支
/cto-review --task-id <brain_task_id>   # 指定关联的 Brain 任务 ID
```

---

## 执行流程

### Phase 1：上下文收集

```
Step 1.1  确定待审查的分支
          → 从参数获取 --branch，或从 .dev-mode 读取当前分支

Step 1.2  读取 enriched PRD
          → 从 Brain API 获取：GET /api/brain/tasks/:brain_task_id
          → payload.enriched_prd（由 intent_expand 写入）
          → 若无 enriched_prd → 使用原始 PRD（task.description）

Step 1.3  读取 DoD
          → 读取 .dod-cp-xxx-yyy.md 或 .task-cp-xxx-yyy.md 中的 DoD 部分
          → 提取成功标准、DoD 检查项

Step 1.4  读取核心 diff
          → 获取变更文件列表（排除无关文件）：
            git diff origin/main...HEAD --name-only | grep -vE '(package-lock\.json|^docs/learnings/|\.task-.*\.md|\.sql$)'
          → 获取概览（≤ 20 行）：
            git diff origin/main...HEAD --stat
          → 获取核心文件完整 diff（限制 500 行）：
            git diff origin/main...HEAD -- <核心文件列表> | head -500
          → 关键文件优先：业务逻辑 > 测试 > 配置
          → 排除：package-lock.json / docs/learnings/ / .task-*.md / *.sql
```

### Phase 2：质量审查

对以下五个维度逐一判断：

#### 维度 1：需求符合度

```
□ 实现是否覆盖了 enriched PRD 的全部成功标准？
□ 核心功能是否完整实现（不能只实现 happy path）？
□ 是否有遗漏的边界条件（enriched PRD 中提到但代码未处理）？
□ 实现范围是否有不必要的扩大（over-engineering）？
```

#### 维度 2：架构合理性

```
□ 新代码是否与现有架构模式一致（参考项目现有风格）？
□ 边界是否清晰（不应跨越 Brain/Engine/Workspace 三层职责）？
□ 是否引入了不必要的依赖或复杂抽象？
□ 关键路径（热点代码）是否有性能隐患？
```

#### 维度 3：代码质量（L1/L2）

| 层级 | 名称 | 检查内容 | 结论影响 |
|------|------|----------|---------|
| **L1** | 阻塞性 | 崩溃、数据丢失、功能不工作 | 必须 FAIL |
| **L2** | 功能性 | 边界条件缺失、错误处理不当、竞态 | 视严重程度 FAIL/WARN |
| L3 | 最佳实践 | 命名、可读性 | 记录但不影响结论 |

```
L1 必查：
  □ 未捕获异常（会让进程 crash）
  □ 数据库操作无事务（数据不一致）
  □ 关键资源未释放（连接/文件/锁）
  □ 无限循环或死锁

L2 必查：
  □ null/undefined 未处理
  □ 网络请求无超时
  □ 错误码不准确
  □ 重试逻辑缺失
```

#### 维度 4：DoD符合度

```
□ DoD 中每个检查项，diff 中是否有对应实现？
□ 测试覆盖：有业务逻辑变更就必须有测试变更
□ 若 DoD 中有 RCI 要求，是否已更新 RCI？
□ 版本/配置文件是否按 DoD 要求更新？
```

#### 维度 5：安全性

```
必查（任何模式）：
  □ 硬编码密钥/token/密码
  □ SQL 拼接（非参数化查询）
  □ 命令注入（exec/spawn + 用户输入）
  □ 认证/权限检查缺失

发现安全问题 → 自动 FAIL，优先级 P0
```

### Phase 3：输出结论

#### 结论格式

```
CTO REVIEW — <branch>
决定：PASS | FAIL | WARN

## 需求符合度
[PASS/FAIL] 说明

## 架构合理性
[PASS/WARN] 说明

## 代码质量
L1 问题：N 个
  - [L1-001] file:行号 — 问题描述
L2 问题：N 个
  - [L2-001] file:行号 — 问题描述

## DoD符合度
[PASS/FAIL] 说明：缺失的检查项列表

## 安全性
[PASS/FAIL] 说明

## 总结
整体决定：PASS / FAIL / WARN
原因（1-3 句）：
需要修复（FAIL 时）：
  1. 具体修复项
  2. ...
```

#### 决定规则

| 决定 | 条件 | dev 流程行为 |
|------|------|------------|
| **PASS** | 无 L1，L2 ≤ 2 个轻微，安全无问题，需求/DoD 基本符合 | devloop-check.sh 放行，继续 Step 3 (PR+CI) |
| **WARN** | 有 L2 问题但不阻塞，需求 90% 以上覆盖 | 放行但记录 WARN，建议后续修复 |
| **FAIL** | 有 L1 问题，或安全问题，或需求严重缺失，或 DoD 关键项未实现 | devloop-check.sh 阻塞，开发者必须修复后重新触发 |

---

## 回调 Brain

审查完成后，必须回调 Brain：

```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "{
        \"status\": \"completed\",
        \"result\": \"PASS\",
        \"decision\": \"PASS\",
        \"l1_count\": 0,
        \"l2_count\": 0,
        \"summary\": \"需求覆盖完整，代码质量符合标准，DoD 全通过\"
    }" \
    "${BRAIN_URL}/api/brain/execution-callback" \
    2>/dev/null
```

FAIL 时：

```bash
curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "{
        \"status\": \"completed\",
        \"result\": \"FAIL\",
        \"decision\": \"FAIL\",
        \"l1_count\": 1,
        \"l2_count\": 0,
        \"summary\": \"发现 L1 问题：xxx（file.js:行号）\"
    }" \
    "${BRAIN_URL}/api/brain/execution-callback"
```

Brain 收到回调后：
- `result=PASS` → 更新任务 `cto_review_status=PASS`，devloop-check.sh 条件 2.5 解除阻塞
- `result=FAIL` → 更新任务 `cto_review_status=FAIL`，devloop-check.sh 条件 2.5 保持阻塞，通知开发者

---

## 与 devloop-check.sh 的联动

`devloop-check.sh` 条件 2.5（push 前）：

```bash
# 条件 2.5：等待 cto_review PASS
CTO_TASK_ID=$(grep "^cto_review_task_id:" "$DEV_MODE_FILE" | awk '{print $2}')
if [[ -n "$CTO_TASK_ID" ]]; then
    CTO_STATUS=$(curl -s "${BRAIN_URL}/api/brain/tasks/${CTO_TASK_ID}" | \
        python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('payload',{}).get('decision','pending'))")
    if [[ "$CTO_STATUS" != "PASS" && "$CTO_STATUS" != "WARN" ]]; then
        echo "等待 cto_review 完成（当前状态: ${CTO_STATUS}）"
        exit 2  # 继续等待
    fi
fi
```

---

## 约束

1. **只读代码，不修改文件**：审查员不是执行者，不改任何代码
2. **结论必须明确**：PASS / WARN / FAIL，三选一，不能模糊
3. **FAIL 必须给出具体修复项**：不能只说"有问题"，必须指出 file:行号 + 修复方向
4. **不能因为 L3/L4 问题 FAIL**：L3 记录，L4 忽略，都不影响决定
5. **回调必须执行**：无论 PASS/FAIL，都必须回调 Brain（否则 devloop-check.sh 永远等待）
