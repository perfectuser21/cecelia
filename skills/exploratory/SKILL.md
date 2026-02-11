---
name: exploratory
version: 1.0.0
created: 2026-02-11
description: |
  Exploratory Mode - 快速验证工作流
  
  证明能做 → 生成 PRD/DOD → Dev 重新实现
  
  核心理念：
  - Exploratory = 草稿本（hack 代码，能跑就行）
  - Dev = 正式稿（干净代码，走 CI/PR）
---

# /exploratory - 快速验证工作流

## 🎯 使用方式

```bash
/exploratory "任务描述"
```

示例：
```bash
/exploratory "添加 GET /api/hello endpoint"
```

## 核心流程

```
/exploratory "任务描述"
    ↓
Step 1: 创建临时 worktree (exp-<timestamp>)
    ↓
Step 2: Exploratory 模式实现
    - 写代码（hack、不干净、能跑就行）
    - 快速验证（手动测试、curl 测试）
    ↓
Step 3: 验证功能跑通
    - 确认功能能用
    - 记录踩的坑
    ↓
Step 4: 生成正式 PRD + DOD
    - 基于跑通的代码生成
    - 记录真实依赖和坑
    ↓
Step 5: 清理 worktree
    - 删除临时代码
    - 保留 PRD/DOD 到主仓库
    ↓
输出：.prd-<task>.md + .dod-<task>.md
```

## 与 /dev 的关系

| Skill | 目标 | 代码质量 | CI/PR | 产物 |
|-------|------|----------|-------|------|
| `/exploratory` | 证明能做 | hack、能跑就行 | ❌ 不需要 | PRD/DOD |
| `/dev` | 交付产品 | 干净、可维护 | ✅ 必须 | 功能代码 |

**典型工作流**：
```
1. /exploratory "新功能" → 生成 .prd.md + .dod.md
2. /dev                  → 使用 PRD/DOD 重新实现
```

## 使用模式

Exploratory Skill 支持两种使用模式，根据任务规模选择：

### 模式 1：小 Task（单个 Exploratory）

**适用场景**：功能简单，一次能做完

```
/exploratory "添加用户登录功能"
    ↓
生成：login.prd.md + login.dod.md
    ↓
/dev（直接使用这对 PRD/DOD）
    ↓
PR #123 合并 ✅
```

**特点**：
- 一次 Exploratory 产出一对 PRD/DOD
- 直接给 /dev 使用
- 适合独立功能、改动 < 5 个文件

### 模式 2：大 Initiative（多个 Exploratory + 合并）

**适用场景**：功能复杂，需要拆分成多个独立子任务

**Step 1: 拆分并逐个验证**
```
Initiative: "完整的用户认证系统"
    ↓
/exploratory "用户登录"    → login.prd.md + login.dod.md
/exploratory "用户注册"    → signup.prd.md + signup.dod.md
/exploratory "密码重置"    → reset-pwd.prd.md + reset-pwd.dod.md
/exploratory "第三方登录"  → oauth.prd.md + oauth.dod.md
```

**Step 2: 合并 PRD/DOD**
```bash
bash scripts/merge-exploratory-docs.sh \
  --output auth-system \
  exploratory-*.prd.md \
  exploratory-*.dod.md
```

**输出**：
```
auth-system.prd.md  # 合并后的完整 PRD
auth-system.dod.md  # 合并后的完整 DOD
```

**Step 3: 正式开发**
```
/dev（使用合并后的 auth-system.prd.md）
    ↓
实现完整的认证系统
    ↓
PR #200 合并 ✅（包含所有功能）
```

**特点**：
- 多个 Exploratory 独立验证
- 智能合并成系统级文档
- 适合大型功能、跨模块改动

### 合并工具使用

**基本用法**：
```bash
# 自动合并所有 exploratory-* 文件
bash scripts/merge-exploratory-docs.sh exploratory-*.{prd,dod}.md

# 指定输出前缀
bash scripts/merge-exploratory-docs.sh \
  --output my-feature \
  exploratory-*.{prd,dod}.md

# 详细模式
bash scripts/merge-exploratory-docs.sh \
  --verbose \
  --output auth-system \
  exploratory-login.{prd,dod}.md \
  exploratory-signup.{prd,dod}.md
```

**合并策略**：
- **PRD 合并**：提取需求、技术方案、依赖、踩坑经验
- **DOD 合并**：聚合验收标准、去重测试项、按模块组织
- **保留溯源**：每个部分标注来源文件

### 选择指南

| 场景 | 推荐模式 | 原因 |
|------|---------|------|
| 添加一个 API endpoint | 模式 1 | 功能独立，改动小 |
| 修复一个 bug | 模式 1 | 范围明确，快速完成 |
| 添加用户认证系统 | 模式 2 | 多个子功能，需要统一架构 |
| 重构整个模块 | 模式 2 | 影响面大，分步验证更安全 |

## 核心原则（CRITICAL）

### Exploratory 模式的自由度

**允许的行为**：
- ✅ hack 代码（复制粘贴、hardcode）
- ✅ 跳过错误处理
- ✅ 不写测试
- ✅ 不符合代码规范
- ✅ 直接修改核心文件（worktree 隔离）
- ✅ 快速试错，多次尝试

**禁止的行为**：
- ❌ 提交到主仓库
- ❌ 创建 PR
- ❌ 走 CI 流程
- ❌ 污染主代码

### Worktree 隔离

**所有 Exploratory 代码在临时 worktree 中**：
```
主仓库（develop）  → 保持干净
    ↓ 创建 worktree
../exploratory-<timestamp>/  → hack 代码、测试
    ↓ 清理
主仓库（develop）  → 只保留 PRD/DOD
```

## 加载策略

```
skills/exploratory/
├── SKILL.md          ← 你在这里（入口 + 总览）
├── steps/            ← 4 个步骤（按需加载）
│   ├── 01-init.md       ← 初始化 worktree
│   ├── 02-explore.md    ← 探索实现
│   ├── 03-validate.md   ← 验证跑通
│   └── 04-document.md   ← 生成 PRD/DOD
├── scripts/          ← 辅助脚本
│   ├── init-worktree.sh
│   ├── validate-impl.sh
│   ├── generate-prd-dod.sh
│   └── cleanup-worktree.sh
└── templates/        ← 文档模板
    ├── prd.template.md
    └── dod.template.md
```

## 状态追踪

创建 `.exploratory-mode` 文件：
```
exploratory
task: <任务描述>
worktree: <worktree 路径>
started: <timestamp>
step_1_init: pending
step_2_explore: pending
step_3_validate: pending
step_4_document: pending
```

## 执行规则

### 自动执行

每个步骤完成后，**立即执行下一步**，不要停顿。

### 快速验证

- 不需要完整测试
- 手动测试或 curl 测试即可
- 功能能用就行

### 记录踩坑

在实现过程中记录：
- 遇到的问题
- 解决方案
- 依赖关系
- 坑点提醒

这些信息会用于生成 PRD/DOD。

## 清理保证

**临时代码绝不进主线**：
- worktree 删除后，临时代码消失
- 只有 PRD/DOD 保留到主仓库
- 主仓库代码保持干净

## 典型场景

### 场景 1：验证新 API endpoint

```bash
# Exploratory：快速验证
/exploratory "添加 GET /api/users/:id endpoint"
# → 在 worktree 中 hack 实现
# → curl 测试能用
# → 生成 PRD/DOD

# Dev：正式实现
/dev
# → 使用 PRD/DOD
# → 干净代码
# → 完整测试
# → CI/PR/Merge
```

### 场景 2：探索第三方库

```bash
# Exploratory：尝试集成
/exploratory "集成 Redis 缓存"
# → 安装 Redis 库
# → hack 代码测试
# → 确认可行性
# → 生成 PRD（包含依赖、配置）

# Dev：正式集成
/dev
# → 按 PRD 正式实现
# → 错误处理
# → 配置管理
# → 测试覆盖
```

### 场景 3：架构探索

```bash
# Exploratory：验证架构
/exploratory "重构 auth 模块为 middleware"
# → 快速重构
# → 测试能用
# → 记录坑点
# → 生成 PRD

# Dev：正式重构
/dev
# → 按 PRD 重构
# → 迁移数据
# → 兼容性测试
```

## 依赖

- Git worktree 功能
- 当前仓库必须是 git 仓库
- 必须在 develop 或 main 分支启动

## 限制

### 不支持的场景

- ❌ 不能在 Exploratory 中提交代码
- ❌ 不能在 Exploratory 中创建 PR
- ❌ 不能在 Exploratory 中修改主仓库文件

### 适用范围

- ✅ 验证新功能可行性
- ✅ 探索第三方库集成
- ✅ 快速原型开发
- ✅ 架构方案验证

## 开始执行

当用户调用 `/exploratory "任务描述"` 时：

1. 读取 `steps/01-init.md` 并执行
2. 自动执行后续步骤
3. 最终输出 PRD/DOD 文件路径

**CRITICAL**: 执行过程中不要停顿，不要等待用户确认，直到生成 PRD/DOD 为止。
