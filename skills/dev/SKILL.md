---
name: dev
description: |
  统一开发工作流入口。集成 Ralph Loop 插件。

  触发条件：
  - 用户说任何开发相关的需求
  - 用户说 /dev
  - Hook 输出 [SKILL_REQUIRED: dev]
---

# /dev - 统一开发工作流

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
| `new` | 在 develop/main | PRD → 创建分支 → DoD → **Loop 1** → PR → **Loop 2** → Merge |
| `continue` | 在 cp-*/feature/* + 无 PR | 直接进入 **Loop 1** |
| `fix` | 有 PR + CI 红 | 直接进入 **Loop 2** |
| `merge` | 有 PR + CI 绿 | Learning → Cleanup → Merge |

---

## Loop 1: 本地 QA（使用 Ralph Loop）

**目标**：`npm run qa` 通过

**调用方式**：
```
/ralph-loop "
## 任务
完成 DoD 中的验收标准，确保本地 QA 通过。

## DoD 内容
$(cat .dod.md)

## 执行步骤
1. 写代码实现 DoD 中的功能
2. 运行 npm run qa
3. 如果失败，读取错误信息并修复
4. 重复 2-3 直到通过
5. 通过后输出：LOCAL_QA_PASSED

## 告警
如果已经修复了 20 次还没通过，停下来输出：NEED_HUMAN_HELP
" --max-iterations 25 --completion-keyword "LOCAL_QA_PASSED"
```

**Loop 1 完成后**：
- 输出 `LOCAL_QA_PASSED` → 继续创建 PR
- 输出 `NEED_HUMAN_HELP` → 停止，等待用户介入

---

## Loop 2: CI 修复（使用 Ralph Loop）

**目标**：CI 全绿

**调用方式**：
```
/ralph-loop "
## 任务
PR #$PR_NUMBER 的 CI 失败，需要修复。

## 执行步骤
1. 运行 gh pr checks $PR_NUMBER 获取失败的检查
2. 运行 gh run view --log-failed 读取错误日志
3. 分析错误原因，修复代码
4. git add -A && git commit -m 'fix: CI 修复' && git push
5. 运行 gh pr checks $PR_NUMBER --watch 等待 CI
6. 如果还是红，重复 1-5
7. CI 全绿后输出：CI_ALL_GREEN

## 告警
如果已经修复了 20 次还没通过，停下来输出：NEED_HUMAN_HELP
" --max-iterations 25 --completion-keyword "CI_ALL_GREEN"
```

**Loop 2 完成后**：
- 输出 `CI_ALL_GREEN` → 继续 Learning + Cleanup + Merge
- 输出 `NEED_HUMAN_HELP` → 停止，等待用户介入

---

## 完整流程图

```
/dev 入口
    │
    ▼
┌─────────────────────────────────────┐
│  模式检测（bash 脚本）              │
│  → new / continue / fix / merge     │
└─────────────────────────────────────┘
    │
    ├── new ────────────────────────────┐
    │                                   ▼
    │                           ┌──────────────┐
    │                           │  PRD + DoD   │
    │                           │  (新任务)    │
    │                           └──────┬───────┘
    │                                  │
    │                                  ▼
    │                           ┌──────────────┐
    │                           │  创建 cp-*   │
    │                           │  分支        │
    │                           └──────┬───────┘
    │                                  │
    ├── continue ──────────────────────┤
    │   (已在 cp-* 分支，直接进入)     │
    │   ┌──────────────────────────────┘
    │   │
    │   ▼
    │  ┌─────────────────────────────────────┐
    │  │  /ralph-loop (Loop 1: 本地 QA)      │
    │  │  → npm run qa 直到通过              │
    │  │  → 20 轮告警                        │
    │  └─────────────────────────────────────┘
    │       │
    │       ├── NEED_HUMAN_HELP → 停止
    │       │
    │       ▼ LOCAL_QA_PASSED
    │  ┌─────────────────────────────────────┐
    │  │  gh pr create                       │
    │  └─────────────────────────────────────┘
    │       │
    │       ▼
    ├── fix ────────────────────────────┐
    │                                   │
    │   ┌───────────────────────────────┘
    │   │
    │   ▼
    │  ┌─────────────────────────────────────┐
    │  │  /ralph-loop (Loop 2: CI 修复)      │
    │  │  → 修复 + push 直到 CI 绿           │
    │  │  → 20 轮告警                        │
    │  └─────────────────────────────────────┘
    │       │
    │       ├── NEED_HUMAN_HELP → 停止
    │       │
    │       ▼ CI_ALL_GREEN
    └── merge ──────────────────────────┐
                                        │
        ┌───────────────────────────────┘
        │
        ▼
   ┌─────────────────────────────────────┐
   │  Learning + Cleanup + Merge         │
   └─────────────────────────────────────┘
        │
        ▼
      完成
```

---

## 有头 vs 无头

| | 有头 | 无头 (Cecilia) |
|---|---|---|
| PRD 来源 | 用户说 | prompt 传入 |
| 告警处理 | Claude 问用户 | 输出 NEED_HUMAN_HELP，N8N 发通知 |
| 超时 | 无 | N8N 设 1 小时告警 |
| 流程 | **完全一样** | **完全一样** |

---

## 核心规则

1. **只在 cp-* 或 feature/* 分支写代码** - Hook 引导
2. **develop 是主开发线** - PR 合并回 develop
3. **main 始终稳定** - 只在里程碑时从 develop 合并
4. **CI 是唯一强制检查** - 其他都是引导
5. **Loop 自动处理失败** - Ralph Loop 自动重试

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
├── VALIDATION.md   ← 质检规则
├── steps/          ← 每步详情（按需加载）
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
    └── ...
```

---

## 快速修复模式

**适用条件**（全部满足）：
- `fix:` 类型修复
- 单文件或少量改动
- 需求明确

**简化流程**：PRD 快速确认 → Loop 1 → PR → Loop 2 → Merge

---

## 完成度检查

**Cleanup 后运行**：

```bash
bash skills/dev/scripts/check.sh "$BRANCH_NAME" "$BASE_BRANCH"
```
