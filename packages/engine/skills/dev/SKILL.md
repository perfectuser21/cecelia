---
name: dev
version: 14.17.11
updated: 2026-04-19
description: Cecelia 开发工作流。调用 Superpowers 5.0.7 的 skill 接力链（brainstorming → writing-plans → subagent-driven-development → finishing-a-development-branch），Engine 只做 4 件事：worktree 管理 / PRD enrich / Brain 决策注入 / push+PR+Learning+自动合并。所有"问用户"交互点由 autonomous-research-proxy 替代为 Research Subagent。
trigger: /dev, --task-id <id>
changelog:
  - 14.17.11: Phase 4 — Engine 瘦身。删 prompts/ 21 文件本地复刻 + alignment.yaml + check-superpowers-alignment + sync-from-upstream + generate-alignment-table + 对照表 doc + CI Superpowers Alignment Gate + steps/01-spec.md + steps/02-code.md。/dev 从"协调器"改为"调 /superpowers:* 的 thin 入口"，Superpowers skill 按 Claude Code runtime 按需加载（主 agent 读完每个 skill prompt 末尾自动接力到下一个）。Engine 只保留真独有：autonomous-research-proxy（人换 subagent）+ Step 0/0.5/0.7 + Stage 3/4 + Stop Hook + orphan-pr-worker + worktree-manage + hygiene gate。
  - 14.17.10: Alignment Table Generator（Phase 4 已回滚此功能）
  - 14.17.9: Phase 3 回滚 L2 自创加固 + 补 upstream 同步脚本（Phase 4 已回滚 sync 脚本）
  - 14.17.8: Phase 1 Round 2 — 真正删除 Standard 代码
  - 14.17.7: Phase 1 Round 1 — Standard 弃用通告 + orphan-pr-worker
---

> **CRITICAL LANGUAGE RULE**: 所有输出必须使用简体中文。

## 架构哲学

**Engine = Superpowers 自动化适配层 + Cecelia 独有前后端点**。

- **Superpowers 14 个 skill** 是方法论库，主 agent 通过 `/superpowers:<skill-name>` 动态调用，runtime 按需加载。每个 skill 的 prompt 末尾指示下一个 skill，主 agent **自驱动接力**。
- **Engine 做 4 件事**：worktree 管理 / PRD enrich / Brain 决策注入 / push+PR+Learning+自动合并。
- **autonomous-research-proxy.md**：Superpowers 的"问用户"交互点全部替换为 Research Subagent（派 general-purpose agent 代用户答）。

## 启动

主 agent 按如下顺序执行。每个 step 是单独文件，**按需 `cat` 加载**（不要一次性全读）。

---

## Step 0: Worktree

```bash
cat ~/.claude-account1/skills/dev/steps/00-worktree-auto.md 2>/dev/null \
  || cat ~/.claude/skills/dev/steps/00-worktree-auto.md
```

执行 worktree 创建（Engine 自造 worktree-manage.sh，刻意不用 Superpowers using-git-worktrees）。

## Step 0.5: PRD Enrich

```bash
cat ~/.claude-account1/skills/dev/steps/00.5-enrich.md 2>/dev/null \
  || cat ~/.claude/skills/dev/steps/00.5-enrich.md
```

粗 PRD 通过 Enrich Subagent 自反思丰满（Engine 独有，非 Superpowers 范畴）。

## Step 0.7: Decision Query

```bash
cat ~/.claude-account1/skills/dev/steps/00.7-decision-query.md 2>/dev/null \
  || cat ~/.claude/skills/dev/steps/00.7-decision-query.md
```

查 Brain `decisions` 表作为约束（Engine 独有）。

## 加载交互点替换规则

```bash
cat ~/.claude-account1/skills/dev/steps/autonomous-research-proxy.md 2>/dev/null \
  || cat ~/.claude/skills/dev/steps/autonomous-research-proxy.md
```

**必读**。此文件定义 Superpowers 所有"问用户"交互点（17 个）→ Research Subagent 代答的规则（Tier 1/2/3）。

## Stage 1-2: Superpowers 接力链

**主 agent 直接调用 Superpowers skill，runtime 会动态加载对应 SKILL.md**：

```
/superpowers:brainstorming
  ↓ (skill prompt 指示接力)
/superpowers:writing-plans
  ↓ (skill prompt 问 "Subagent-Driven vs Inline?" — autonomous-research-proxy Tier 1 默认 subagent-driven)
/superpowers:subagent-driven-development
  ↓ (派 Implementer + Spec Reviewer + Code Quality Reviewer subagent)
/superpowers:finishing-a-development-branch
  ↓ (skill prompt 问 "merge/PR/keep/discard" — autonomous-research-proxy Tier 1 默认 Option 2 push+PR)
```

**每一步只加载当前 skill 的 prompt**。Context 精简、聚焦、不污染。

**遇到 skill prompt 里的"用户交互点"**：主 agent 按 autonomous-research-proxy.md 的 Tier 1/2/3 规则派 Research Subagent 代答，**不停下等用户**。

## Stage 3: Integrate (Engine 独有)

```bash
cat ~/.claude-account1/skills/dev/steps/03-integrate.md 2>/dev/null \
  || cat ~/.claude/skills/dev/steps/03-integrate.md
```

Superpowers finishing-a-development-branch 结束后，Engine 接管 push + PR 自动化。

## Stage 4: Ship (Engine 独有)

```bash
cat ~/.claude-account1/skills/dev/steps/04-ship.md 2>/dev/null \
  || cat ~/.claude/skills/dev/steps/04-ship.md
```

Learning 文件写入 + 标记 step_4_ship=done。

## Stop Hook 兜底（devloop-check.sh）

标准模式：`CI 绿 + Stage 4 done → 自动合并 PR → cleanup → exit 0`
Harness 模式（`harness_mode: true`）：`step_2_code done + PR 已创建 → exit 0（Brain 派 Evaluator）`

## Harness 模式

当 task payload `harness_mode: true` 时：
- Stage 1 跳过自写（读 `sprint-contract.md` 作为 spec）
- Stage 2 严格按合同实现
- Stage 3 push + PR 后 exit 0，由 harness-evaluator 接手

其他与标准模式一致（仍调用 Superpowers skill 接力链）。

## 核心规则

1. **只在 cp-* 分支写代码**（branch-protect hook 强制）
2. **遇到问题自动修复**（禁止"建议手动"）
3. **Stop Hook 保证循环**：PR 未合并 → exit 2 → 继续
4. **每步完成后立即执行下一步**，不停顿
5. **Superpowers skill 接力由主 agent 自驱动**（读每个 skill prompt 末尾指令 → invoke 下一个）
6. **"问用户"交互点全部派 Research Subagent 代答**（autonomous-research-proxy Tier 1/2/3）

## Engine 目录结构（瘦身后）

```
packages/engine/
├── skills/dev/
│   ├── SKILL.md                       ← 入口（本文件）
│   ├── steps/
│   │   ├── 00-worktree-auto.md        ← Engine 独有
│   │   ├── 00.5-enrich.md             ← Engine 独有
│   │   ├── 00.7-decision-query.md     ← Engine 独有
│   │   ├── 03-integrate.md            ← Engine 独有
│   │   ├── 04-ship.md                 ← Engine 独有
│   │   └── autonomous-research-proxy.md ← Engine 核心价值（人换 subagent）
│   └── scripts/                        ← worktree/fetch/parse/enrich-decide/check/cleanup
├── scripts/
│   ├── bump-version.sh                 ← Engine 版本同步
│   └── devgate/
│       └── check-engine-hygiene.cjs    ← Engine 卫生检查（版本同步 + 无 TODO）
├── hooks/                              ← branch-protect / credential-guard / bash-guard / stop-dev
├── lib/
│   └── devloop-check.sh                ← Stop Hook 核心
├── feature-registry.yml
├── regression-contract.yaml
├── .hook-core-version
└── VERSION
```

**已删除（Phase 4 瘦身）**：
- `prompts/` 21 个 Superpowers 本地复刻（runtime 按需加载官方 /superpowers:*）
- `contracts/superpowers-alignment.yaml`
- `scripts/devgate/check-superpowers-alignment.cjs`
- `scripts/sync-from-upstream.sh`
- `scripts/generate-alignment-table.sh`
- `docs/superpowers-alignment-table.md`
- `steps/01-spec.md` + `steps/02-code.md`（重复 Superpowers 流程）
- CI `Superpowers Alignment Gate` step

## 版本同步

Engine 6 处版本号：`VERSION` / `package.json` / `.hook-core-version` / `hooks/VERSION` / `skills/dev/SKILL.md` / `regression-contract.yaml`。

`bash packages/engine/scripts/bump-version.sh <new-version>` 一键同步。
