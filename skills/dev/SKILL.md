---
name: dev
version: 1.1.0
updated: 2026-01-23
description: |
  统一开发工作流入口。流程编排者，不做判断。

  触发条件：
  - 用户说任何开发相关的需求
  - 用户说 /dev
  - Hook 输出 [SKILL_REQUIRED: dev]
---

# /dev - 统一开发工作流

## 核心定位

**流程编排者**：只负责编排流程顺序，不做测试/审计判断。

判断由专门的规范负责：
- 测试决策 → 参考 `skills/qa/SKILL.md`
- 代码审计 → 参考 `skills/audit/SKILL.md`
- 放行判断 → 由 pr-gate Hook 执行

---

## 入口：四种模式自动检测

**进入 /dev 后，首先运行模式检测**：

```bash
# 获取当前状态
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
PR_NUMBER=$(gh pr list --head "$CURRENT_BRANCH" --state open --json number -q '.[0].number' 2>/dev/null)
CI_STATUS=""
if [[ -n "$PR_NUMBER" ]]; then
    CI_STATUS=$(gh pr checks "$PR_NUMBER" --json state -q '.[].state' 2>/dev/null | grep -q "FAILURE" && echo "red" || echo "green")
fi

# 判断模式
if [[ "$CURRENT_BRANCH" == "develop" || "$CURRENT_BRANCH" == "main" ]]; then
    MODE="new"  # 新任务模式
elif [[ -z "$PR_NUMBER" ]]; then
    MODE="continue"  # 继续开发模式
elif [[ "$CI_STATUS" == "red" ]]; then
    MODE="fix"  # 修复模式
else
    MODE="merge"  # 合并模式
fi

echo "检测到模式: $MODE"
```

### 模式处理

| 模式 | 条件 | 动作 |
|------|------|------|
| `new` | 在 develop/main | PRD → 分支 → DoD(含QA决策) → 代码 → 质检(含Audit) → PR → CI → Merge |
| `continue` | 在 cp-*/feature/* + 无 PR | 直接进入代码/测试阶段 |
| `fix` | 有 PR + CI 红 | 直接进入 CI 修复 |
| `merge` | 有 PR + CI 绿 | Learning → Cleanup → Merge |

---

## 流程节点

```
┌─────────────────────────────────────────────────────────┐
│                    /dev 流程编排                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  PRD 确定 (01-prd.md)                                   │
│      ↓                                                  │
│  环境检测 + 分支创建 (02-detect.md, 03-branch.md)        │
│      ↓                                                  │
│  DoD 定稿 (04-dod.md)                                   │
│      │   含 QA Decision Node                            │
│      │   规范来源: skills/qa/SKILL.md                   │
│      │   产物: docs/QA-DECISION.md                      │
│      ↓                                                  │
│  写代码 + 写测试 (05-code.md, 06-test.md)               │
│      ↓                                                  │
│  质检 (07-quality.md)                                   │
│      │   含 Audit Node                                  │
│      │   规范来源: skills/audit/SKILL.md                │
│      │   产物: docs/AUDIT-REPORT.md                     │
│      │   Gate: Decision 必须是 PASS                     │
│      │   然后: npm run qa                               │
│      ↓                                                  │
│  提交 PR (08-pr.md)                                     │
│      │   执行者: hooks/pr-gate-v2.sh                    │
│      │   检查: 产物存在 + 测试通过                       │
│      ↓                                                  │
│  CI + Merge (09-ci.md)                                  │
│      ↓                                                  │
│  Learning + Cleanup (10-learning.md, 11-cleanup.md)     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 核心规则

1. **只在 cp-* 或 feature/* 分支写代码** - Hook 强制
2. **develop 是主开发线** - PR 合并回 develop
3. **main 始终稳定** - 只在里程碑时从 develop 合并
4. **产物门控** - QA-DECISION.md 和 AUDIT-REPORT.md 必须存在
5. **Gate 放行** - pr-gate Hook 检查所有产物和测试

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
├── SKILL.md        ← 你在这里（入口 + 流程总览）
├── steps/          ← 每步详情（按需加载）
│   ├── 01-prd.md
│   ├── 02-detect.md
│   ├── 03-branch.md
│   ├── 04-dod.md       ← QA Decision Node
│   ├── 05-code.md
│   ├── 06-test.md
│   ├── 07-quality.md   ← Audit Node
│   ├── 08-pr.md
│   ├── 09-ci.md
│   ├── 10-learning.md
│   └── 11-cleanup.md
└── scripts/        ← 辅助脚本
    ├── cleanup.sh
    ├── check.sh
    └── ...
```

---

## 产物检查清单

| 产物 | 位置 | 规范来源 | Gate 检查 |
|------|------|----------|-----------|
| PRD | .prd.md | - | ✅ 存在 + 内容有效 |
| QA 决策 | docs/QA-DECISION.md | skills/qa/SKILL.md | ✅ 存在 |
| DoD | .dod.md | - | ✅ 存在 + 引用 QA 决策 |
| 审计报告 | docs/AUDIT-REPORT.md | skills/audit/SKILL.md | ✅ 存在 + PASS |

---

## 状态追踪（Core/Notion 同步）

有头和无头模式共用同一套追踪机制，在关键点调用 `track.sh`：

```bash
# 新任务开始时
bash skills/dev/scripts/track.sh start "$(basename "$(pwd)")" "$(git rev-parse --abbrev-ref HEAD)" ".prd.md"

# 每个步骤
bash skills/dev/scripts/track.sh step 1 "PRD"
bash skills/dev/scripts/track.sh step 2 "Detect"
bash skills/dev/scripts/track.sh step 3 "Branch"
bash skills/dev/scripts/track.sh step 4 "DoD"
bash skills/dev/scripts/track.sh step 5 "Code"
bash skills/dev/scripts/track.sh step 6 "Test"
bash skills/dev/scripts/track.sh step 7 "Quality"
bash skills/dev/scripts/track.sh step 8 "PR"
bash skills/dev/scripts/track.sh step 9 "CI"
bash skills/dev/scripts/track.sh step 10 "Learning"
bash skills/dev/scripts/track.sh step 11 "Cleanup"

# 完成时
bash skills/dev/scripts/track.sh done "$PR_URL"

# 失败时
bash skills/dev/scripts/track.sh fail "Error message"
```

追踪文件 `.cecelia-run-id` 自动管理，Core 是主数据源，Notion 是镜像。

---

## 完成度检查

**Cleanup 后运行**：

```bash
bash skills/dev/scripts/check.sh "$BRANCH_NAME" "$BASE_BRANCH"
```
