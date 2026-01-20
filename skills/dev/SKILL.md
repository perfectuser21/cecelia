---
name: dev
description: |
  统一开发工作流入口。一个对话完成整个开发流程。

  触发条件：
  - 用户说任何开发相关的需求
  - 用户说 /dev
  - Hook 输出 [SKILL_REQUIRED: dev]
---

# /dev - 统一开发工作流

## 11 步流程

| Step | 内容 | 详情 |
|------|------|------|
| 1 | PRD 确定 | → [01-prd.md](steps/01-prd.md) |
| 2 | 检测项目环境 | → [02-detect.md](steps/02-detect.md) |
| 3 | 创建分支 | → [03-branch.md](steps/03-branch.md) |
| 4 | 推演 DoD | → [04-dod.md](steps/04-dod.md) |
| 5 | 写代码 | → [05-code.md](steps/05-code.md) |
| 6 | 写测试 | → [06-test.md](steps/06-test.md) |
| 7 | 质检（三层）| → [07-quality.md](steps/07-quality.md) |
| 8 | 提交 PR | → [08-pr.md](steps/08-pr.md) |
| 9 | CI | → [09-ci.md](steps/09-ci.md) |
| 10 | Learning | → [10-learning.md](steps/10-learning.md) |
| 11 | Cleanup | → [11-cleanup.md](steps/11-cleanup.md) |

---

## 流程图（一个对话完成）

```
/dev 开始
    │
    ├── 有头：用户说需求 → Step 1 PRD 确定
    │                           │
    └── 无头：Hook 触发 ──────────┘
                                │
                                ▼
                        Step 2: 检测项目环境
                                │
                                ▼
                        Step 3: 创建分支
                                │
                                ▼
                        Step 4: 推演 DoD（不停顿，继续）
                                │
                                ▼
┌───────────────────────────────────────────────────┐
│  Loop: Step 5-7                                   │
│                                                   │
│  Step 5: 写代码                                   │
│      ↓                                            │
│  Step 6: 写测试                                   │
│      ↓                                            │
│  Step 7: 质检                                     │
│      │                                            │
│      ├── 失败 → 返回 Step 5 继续修复              │
│      │                                            │
│      └── 通过 ↓                                   │
└───────────────────────────────────────────────────┘
    │
    ▼
Step 8: 提交 PR（pr-gate 检查 L1）
    │
    ▼
┌───────────────────────────────────────────────────┐
│  Loop: Step 9                                     │
│                                                   │
│  Step 9: CI                                       │
│      │                                            │
│      ├── 失败 → 返回 Step 5（从 Step 5 重新开始）│
│      │                                            │
│      └── 通过 ↓                                   │
└───────────────────────────────────────────────────┘
    │
    ▼
Step 10: Learning（必须）
    │
    ▼
Step 11: Cleanup
    │
    ▼
完成 🎉
```

**关键**：
- 有头/无头两个入口一条线
- Step 1 PRD 确定后不停顿，直到 Step 4 DoD
- 失败返回逻辑：
  - Step 6 写测试失败 → 继续 Step 6
  - Step 7 质检失败 → 返回 Step 5 继续修复
  - Step 8 PR 被 Hook 拦截 → 返回 Step 5（只检查 L1，失败立即修复）
  - Step 9 CI 红 → 返回 Step 5（从 Step 5 重新开始）
- Step 10 Learning 是必须的
- 整个流程在一个对话中完成，失败时自动循环，不断开

---

## 核心规则

1. **只在 cp-* 或 feature/* 分支写代码** - Hook 引导
2. **步骤状态机** - Hook 检查 `git config branch.*.step`，step >= 4 才能写代码
3. **develop 是主开发线** - PR 合并回 develop
4. **main 始终稳定** - 只在里程碑时从 develop 合并
5. **CI 是唯一强制裁决** - Hook 是本地门禁，CI 是最终裁决
6. **v8+ 硬门禁规则**：
   - PR → develop：L1 + L2A 必须通过（自动化测试）
   - develop → main：L1 + L2A + L2B + L3 必须通过（本地产出，CI 裁决）

---

## 步骤状态机

用 `git config branch.cp-xxx.step` 追踪当前步骤：

| step | 状态 | 说明 |
|------|------|------|
| 1 | PRD 确定 | 需求明确 |
| 2 | 项目环境确认 | 确认项目类型 |
| 3 | 分支已创建 | cp-* 或 feature/* 分支 |
| 4 | DoD 完成 | DoD 推演完成，**可以写代码** |
| 5 | 代码完成 | 功能代码写完 |
| 6 | 测试完成 | 测试代码写完 |
| 7 | 质检通过 | L1 质检通过，**可以提交** |
| 8 | PR 已创建 | 等待 CI |
| 9 | CI 通过 | CI 检查完成 |
| 10 | Learning 完成 | 经验已记录 |
| 11 | 已清理 | 分支删除 |

### Hook 引导

**branch-protect.sh** (PreToolUse - Write/Edit):
- 引导 step >= 4 才能写代码
- 引导只在 cp-* 或 feature/* 分支写代码

**pr-gate-v2.sh** (PreToolUse - Bash):
- 拦截 `gh pr create`，根据目标分支自动检测模式
- **自动模式检测**：
  - 解析 `--base` 参数，`--base main` → release 模式
  - 否则 → pr 模式（默认）
  - 可用 `PR_GATE_MODE=release` 强制 release 模式
- **PR 模式** (→ develop)：
  - L1 + L2A 自动化测试必须通过
  - .dod.md 存在即可
- **Release 模式** (→ main)：
  - L1 + L2A 自动化测试必须通过
  - L2B 证据文件 (.layer2-evidence.md) 必须存在且有效
  - L3 验收项 (.dod.md) 全部打勾，Evidence 引用有效
  - 允许从 develop 分支提交
- 失败时回退到 step 4，引导修复后重试

**注意**：所有 Hook 都是引导性的，CI 是唯一强制检查。

---

## 快速修复模式

**适用条件**（全部满足）：
- `fix:` 类型修复
- 单文件或少量改动
- 需求明确

**可简化**：Step 1 PRD 确定可以快速完成

---

## 测试任务模式

**触发条件**：PRD 标题包含 `[TEST]` 前缀

```
用户: "我想测试一下 [TEST] 新的登录流程"
    ↓
Claude: 检测到 [TEST] 前缀
    ↓
设置: git config branch.$BRANCH_NAME.is-test true
```

**测试任务的特殊处理**：

| Step | 正常任务 | 测试任务 |
|------|----------|----------|
| 8 PR | 更新 CHANGELOG + 版本号 | 跳过，commit 用 `test:` 前缀 |
| 10 Learning | 必须记录 | 可选（只记录流程经验） |
| 11 Cleanup | 标准清理 | 额外检查残留 |

**为什么需要测试模式**：
- 测试任务的代码最终会删除
- 不应该产生真实的版本号和 CHANGELOG 记录
- 防止"版本号增加但功能被删除"的矛盾

---

## 版本号规则 (semver)

| commit 类型 | 版本变化 |
|-------------|----------|
| fix: | patch (+0.0.1) |
| feat: | minor (+0.1.0) |
| feat!: / BREAKING: | major (+1.0.0) |

---

## 加载策略

```
skills/dev/
├── SKILL.md        ← 你在这里（入口）
├── steps/          ← 每步一个文件
│   ├── 01-prd.md
│   ├── 02-detect.md
│   ├── 03-branch.md
│   ├── 04-dod.md
│   ├── 05-code.md
│   ├── 06-test.md
│   ├── 07-quality.md
│   ├── 08-pr.md
│   ├── 09-ci.md
│   ├── 10-learning.md
│   └── 11-cleanup.md
└── scripts/        ← 辅助脚本
    ├── cleanup.sh
    ├── check.sh
    ├── wait-for-merge.sh
    ├── scan-change-level.sh
    └── multi-feature.sh
```

**执行时按需加载对应步骤文件，减少上下文开销。**

---

## 完成度检查

**Cleanup 后运行**：

```bash
bash skills/dev/scripts/check.sh "$BRANCH_NAME" "$BASE_BRANCH"
```
