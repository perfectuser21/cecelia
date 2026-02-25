---
id: okr-iterative-decompose-v12.14.0
version: 1.0.0
created: 2026-02-08
updated: 2026-02-08
pr: "#546"
changelog:
  - 1.0.0: 初始版本 - 记录 OKR 迭代拆解能力开发经验
---

# OKR 迭代拆解能力开发经验 (v12.14.0)

## 功能概述

实现策略 C（混合规划）的 OKR 迭代拆解能力：
- **decompose-feature.sh**: 初始拆解（1 个详细 Task + 2-4 个草稿 Task）
- **continue-feature.sh**: 迭代拆解（基于反馈调整计划）

## 关键技术决策

### 1. 策略 C 架构设计

**三种策略对比**：

| 策略 | 优点 | 缺点 | 选择原因 |
|------|------|------|----------|
| A - 全量规划 | 全局视角清晰 | 不灵活，无法根据反馈调整 | ❌ |
| B - 完全迭代 | 最灵活 | 没有全局视角，容易迷失 | ❌ |
| **C - 混合规划** | 有全局视角 + 可调整 | 实现稍复杂 | ✅ 选择 |

**策略 C 实现**：
```bash
# 初始拆解：生成 3-5 个 Task 草稿
decompose-feature.sh → {
  "tasks": [
    {"id": "task-001", "prd_status": "detailed", ...},  # 第一个详细
    {"id": "task-002", "prd_status": "draft", ...},     # 后续草稿
    {"id": "task-003", "prd_status": "draft", ...}
  ]
}

# 迭代调整：Task N 完成后
continue-feature.sh → 读取反馈 → {
  "plan_adjusted": true,
  "tasks_inserted": 1,              # 可能插入新 Task
  "next_task": {"prd_status": "detailed", ...},  # 草稿→详细
  "feature_completed": false
}
```

### 2. 复杂度检测逻辑

**关键字匹配方法**：

```bash
is_simple_requirement() {
    local requirement="$1"

    # 简单需求特征：修复、优化类
    if echo "$requirement" | grep -qiE '修复|优化|fix|optimize'; then
        return 0  # 简单
    fi

    # 复杂需求特征：系统、功能集
    if echo "$requirement" | grep -qiE '实现.*系统|完整.*功能|feature.*set'; then
        return 1  # 复杂
    fi

    # 默认：复杂
    return 1
}
```

**优点**：
- 快速简单
- 覆盖大多数场景

**不足**：
- 边界 case 需要手动调整
- 未来可以用 LLM 判断

### 3. 反馈驱动迭代

**反馈报告格式**：
```json
{
  "summary": "功能基本完成，但错误提示不够友好",
  "issues_found": ["错误消息不明确", "缺少中文支持"],
  "next_steps_suggested": ["优化错误提示", "添加 i18n"],
  "technical_notes": "应该抽取错误消息到单独文件"
}
```

**迭代逻辑**：
```bash
continue-feature.sh:
1. 读取 .dev-runs/<task-id>-report.json
2. 分析 next_steps_suggested
3. 如果包含"需要|应该" → 插入新 Task
4. 将下一个草稿 Task 细化为详细 PRD
5. 判断是否完成（最后一个 Task + 反馈确认）
```

### 4. 状态管理设计

**Task PRD 状态**：
- `detailed`: 完整 PRD，可以立即执行
- `draft`: 简要描述，需要细化后执行

**Feature 计划存储**：
```json
{
  "feature_id": "feat-001",
  "title": "用户登录系统",
  "tasks": [
    {"id": "task-001", "status": "completed", "prd_status": "detailed"},
    {"id": "task-002", "status": "in_progress", "prd_status": "detailed"},
    {"id": "task-003", "status": "pending", "prd_status": "draft"}
  ],
  "plan_version": 2
}
```

**存储位置**：
- 当前：`/tmp/feature-<id>-plan.json`（测试用）
- 未来：PostgreSQL `features` 表

## 测试策略

### 完整覆盖

**decompose-feature.sh** (6 个测试):
1. 脚本存在性
2. 简单需求检测（"修复登录 bug" → single task）
3. 复杂需求检测（"实现用户系统" → multiple tasks）
4. Task 数量验证（复杂需求 2-5 个）
5. PRD 状态验证（第一个 detailed，后续 draft）
6. 描述长度验证（detailed > 100 字符，draft < 100）

**continue-feature.sh** (5 个测试):
1. 脚本存在性
2. 反馈读取（读取 mock 反馈文件）
3. 计划调整（插入/删除 Task）
4. 下一个 Task 生成（draft → detailed）
5. 完成判断（最后 Task + 反馈确认）

### Mock 数据策略

```bash
# 测试用 mock 数据
mkdir -p .dev-runs
cat > .dev-runs/task-001-report.json <<EOF
{
  "summary": "基本完成，但需要优化",
  "next_steps_suggested": ["需要添加错误提示"]
}
EOF

# 测试用 Feature 计划
mkdir -p /tmp
cat > /tmp/feature-test-plan.json <<EOF
{
  "feature_id": "test",
  "tasks": [
    {"id": "task-001", "status": "completed"},
    {"id": "task-002", "status": "pending", "prd_status": "draft"}
  ]
}
EOF
```

## 踩过的坑

### 1. sync-version.sh 不更新 .hook-core-version ⚠️

**问题**：
```bash
bash scripts/sync-version.sh  # ✅ 更新了 VERSION, hook-core/VERSION
# ❌ 但没有更新 .hook-core-version
```

**解决**：
```bash
# 必须手动更新
echo "12.14.0" > .hook-core-version
```

**为什么**：
- `sync-version.sh` 只负责同步标准版本文件
- `.hook-core-version` 是 hook 系统的独立文件
- CI 会检查这个文件，不同步会导致 CI 失败

**已记录到 MEMORY.md**：避免重复犯错

### 2. Feature Registry 变更需要重新生成路径视图

**问题**：
```bash
# 修改了 features/feature-registry.yml
# ❌ 忘记运行 generate-path-views.sh
# CI 检测到 Contract Drift → 失败
```

**解决**：
```bash
bash scripts/generate-path-views.sh
git add docs/paths/*.md
```

**CI 检查逻辑**：
```bash
# CI 会对比 registry 和 paths/ 的 git diff
if ! git diff --exit-code docs/paths/; then
    echo "❌ Contract Drift 检测到"
    exit 1
fi
```

### 3. RCI 覆盖率要求

**问题**：
新增功能必须添加 RCI（回归契约条目）

**解决**：
```yaml
# regression-contract.yaml
- id: S1-005
  category: skill
  name: "OKR Iterative Decomposition"
  description: "OKR 迭代拆解能力（策略 C）"
  test_path: "tests/okr/test-decompose-feature.sh && tests/okr/test-continue-feature.sh"
  tags: [okr, iterative, decompose, continue-feature]
  priority: P1
  auto: true
  version_added: "12.14.0"
```

**CI 检查**：
```bash
npm run coverage:rci
# 检查 S1-005 是否存在
# 检查测试路径是否有效
```

## 性能优化

### Bash 脚本性能

**复杂度检测**：
- 使用 `grep -qiE` 快速匹配
- 避免多次正则（合并为一个 pattern）

**JSON 处理**：
- 使用 `jq` 而不是纯 Bash 字符串拼接
- 性能：jq 处理 1KB JSON < 10ms

**文件操作**：
- 使用 `mktemp` 而不是固定路径（避免冲突）
- 及时清理临时文件

### 未来优化方向

1. **LLM 驱动的复杂度判断**（替代关键字匹配）
2. **数据库存储 Feature 计划**（替代 /tmp 文件）
3. **增强反馈字段**（technical_notes, code_changes 等）

## 未来工作

### Phase 3: /dev 集成

```bash
# /dev 支持从数据库读取 Task PRD
/dev --task-id task-001

# 自动：
1. 从数据库读取 Task PRD
2. 生成 .prd-task-001.md
3. 执行开发流程
4. 完成后生成 feedback report
```

### Phase 4: Brain 自动化

```bash
# Brain 自动迭代
1. Task N 完成 → POST /api/brain/execution-callback
2. Brain 调用 continue-feature.sh
3. 生成下一个 Task PRD
4. 自动派发 Task N+1
```

### 反馈字段增强

```json
{
  "summary": "...",
  "issues_found": [...],
  "next_steps_suggested": [...],
  "technical_notes": "...",      // 新增
  "code_changes": {              // 新增
    "files_modified": [...],
    "lines_changed": 123
  },
  "test_coverage": "85%"         // 新增
}
```

## 结论

策略 C 成功实现了"有全局视角 + 灵活调整"的平衡：
- ✅ 初始规划提供方向感
- ✅ 反馈驱动确保适应性
- ✅ 完整测试覆盖保证质量
- ✅ CI 自动化检查防止退化

关键教训：
1. **SSOT 严格执行**：版本同步、路径视图、RCI 覆盖率，一个都不能少
2. **测试先行**：11 个测试全部通过才提交
3. **CI 是唯一防线**：本地 Hook 是辅助，CI 才是真正的门卫
4. **增量实现**：Phase 2 完成核心功能，Phase 3/4 逐步集成

下一步：将 Phase 3 (/dev --task-id) 和 Phase 4 (Brain auto-callback) 加入 Roadmap。
