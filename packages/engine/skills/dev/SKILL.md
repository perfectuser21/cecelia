---
name: dev
version: 15.0.0
updated: 2026-04-19
description: Cecelia 开发工作流入口。纯点火链 — 启动时调第一个 engine-* skill，后续由每个 skill 的 TERMINAL IMPERATIVE 自动接力到下一个。Engine 前置 3 skill（worktree/enrich/decision）+ Superpowers 4 skill（brainstorming/writing-plans/subagent-driven-development/finishing-a-development-branch）+ Engine 终棒 skill（ship）。
trigger: /dev, --task-id <id>
changelog:
  - 15.0.0: Phase 5 — Engine Skillification。Step 0/0.5/0.7/4 全部升级为真 skill（engine-worktree/enrich/decision/ship），每个 SKILL.md 带 TERMINAL IMPERATIVE 实现自驱动接力链。/dev 本身退化为纯点火入口。Stage 3（03-integrate.md）彻底删除（和 Superpowers finishing-a-development-branch 功能重叠，由 autonomous-research-proxy Tier 1 默认 Option 2 = push+PR 覆盖）。autonomous-research-proxy 加硬规则："finishing 完成后 MUST invoke /engine-ship via Skill tool"。
  - 14.17.11: Phase 4 — Engine 瘦身。删 prompts/ 21 文件本地复刻 + alignment.yaml + steps/01-spec.md + steps/02-code.md。问题：skill chain 不自驱动（每个文档结尾缺 TERMINAL IMPERATIVE）— Phase 5 已修复。
  - 14.17.10: Alignment Table Generator（Phase 4 已回滚此功能）
  - 14.17.9: Phase 3 回滚 L2 自创加固 + 补 upstream 同步脚本（Phase 4 已回滚 sync 脚本）
  - 14.17.8: Phase 1 Round 2 — 真正删除 Standard 代码
  - 14.17.7: Phase 1 Round 1 — Standard 弃用通告 + orphan-pr-worker
---

> **CRITICAL LANGUAGE RULE**: 所有输出必须使用简体中文。

## 架构哲学

**Engine = Superpowers 自动化适配层 + Cecelia 独有前后端点**，通过 skill chain 自驱动接力。

- **Engine 4 个独有真 skill**（本 repo）：`engine-worktree` / `engine-enrich` / `engine-decision` / `engine-ship`
- **Superpowers 4 个核心真 skill**（plugin）：`superpowers:brainstorming` / `superpowers:writing-plans` / `superpowers:subagent-driven-development` / `superpowers:finishing-a-development-branch`
- **autonomous-research-proxy.md**：Superpowers 所有"问用户"交互点（17 个）→ Research Subagent 代答规则 Tier 1/2/3

每个 skill SKILL.md 结尾都有 **TERMINAL IMPERATIVE** 指令（"Your next tool call MUST be Skill(...)"），主 agent 按指令自驱动接力到下一棒。

## 完整接力链

```
/dev (本 skill — 点火入口)
  ↓ TERMINAL IMPERATIVE
/engine-worktree        ← Engine Step 1/4：worktree 创建 + cp-* 分支自检
  ↓ TERMINAL IMPERATIVE
/engine-enrich          ← Engine Step 2/4：thin PRD 丰满（Enrich Subagent）
  ↓ TERMINAL IMPERATIVE
/engine-decision        ← Engine Step 3/4：查 Brain decisions 表为推理输入
  ↓ TERMINAL IMPERATIVE
/superpowers:brainstorming  ← Superpowers 原生接力链开始
  ↓ (原生 chain)
/superpowers:writing-plans
  ↓ (原生 chain，autonomous-research-proxy Tier 1 默认 subagent-driven)
/superpowers:subagent-driven-development
  ↓ (Implementer + Spec Reviewer + Code Quality Reviewer subagent 派发)
/superpowers:finishing-a-development-branch
  ↓ (autonomous-research-proxy Tier 1 默认 Option 2 = push+PR；该文件硬规则指向下一步)
/engine-ship            ← Engine Step 4/4（终棒）：Learning + fire-learnings-event + step_4_ship=done
  ↓ 退出 assistant turn
Stop Hook 接管（devloop-check.sh）→ CI 绿 + step_4_ship=done → 自动合并 PR → cleanup → exit 0
```

## Harness 模式

当 task payload `harness_mode: true`：
- engine-enrich 仍运行
- engine-decision 仍运行
- Superpowers 接力链照走
- **engine-ship 极简路径**：跳过 Learning + fire-learnings-event，只 `step_4_ship=done` → 由 harness-evaluator 接管

## 核心规则

1. **只在 cp-* / feature/* 分支写代码**（branch-protect hook 强制）
2. **遇到问题自动修复**（禁止"建议手动"）
3. **Stop Hook 保证循环**：PR 未合并 → exit 2 → 继续修
4. **接力链不得中断**：读完每个 SKILL.md 必按 TERMINAL IMPERATIVE 调下一个 Skill，不 Read 不 Bash 绕开
5. **"问用户"交互点全部派 Research Subagent 代答**（autonomous-research-proxy Tier 1/2/3）

## Engine 目录结构（Phase 5）

```
packages/engine/
├── skills/
│   ├── dev/                           ← 入口（本文件）
│   │   ├── SKILL.md                    ← 点火链 entry
│   │   ├── steps/
│   │   │   └── autonomous-research-proxy.md  ← 唯一剩下的 step 文档（规则文件，非 skill）
│   │   ├── scripts/
│   │   └── feature.yaml
│   ├── engine-worktree/SKILL.md        ← Engine 真 skill 1/4
│   ├── engine-enrich/SKILL.md          ← Engine 真 skill 2/4
│   ├── engine-decision/SKILL.md        ← Engine 真 skill 3/4
│   └── engine-ship/SKILL.md            ← Engine 真 skill 4/4（终棒）
├── scripts/
├── hooks/
├── lib/devloop-check.sh
├── feature-registry.yml
├── regression-contract.yaml
├── .hook-core-version
└── VERSION
```

**Phase 5 已删除**：
- `steps/00-worktree-auto.md` → migrate 到 `engine-worktree/SKILL.md`
- `steps/00.5-enrich.md` → migrate 到 `engine-enrich/SKILL.md`
- `steps/00.7-decision-query.md` → migrate 到 `engine-decision/SKILL.md`
- `steps/03-integrate.md` → 彻底删除（冗余）
- `steps/04-ship.md` → migrate 到 `engine-ship/SKILL.md`

## 版本同步

Engine 6 处版本号：`VERSION` / `package.json` / `.hook-core-version` / `hooks/VERSION` / `skills/dev/SKILL.md` / `regression-contract.yaml`。
`bash packages/engine/scripts/bump-version.sh <new-version>` 一键同步。

---

## TERMINAL IMPERATIVE

/dev 点火。**你的下一个 tool call 必须是**：

```
Skill({"skill":"engine-worktree"})
```

不要 `Read` 任何文件。不要 `Bash` 任何命令。不要 inline 执行 worktree 创建逻辑。

这不是文档引用，这是你下一步的 tool call 指令。engine-worktree 会接力处理 worktree 创建，之后自动链到 engine-enrich → engine-decision → superpowers:brainstorming → ... → engine-ship。
