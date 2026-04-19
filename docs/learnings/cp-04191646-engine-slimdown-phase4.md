# Learning: Phase 4 — Engine 瘦身到真正的自动化适配层

**Branch**: cp-0419164625-engine-slimdown-phase4
**Date**: 2026-04-19
**Task ID**: d27a6079-c9a3-4a86-951c-1a775e21056e

## 做了什么

**删除**（总 ~3500 行）：
- `packages/engine/skills/dev/prompts/` 整个目录（11 skill / 21 md / 2866 行本地复刻）
- `packages/engine/contracts/` 整个目录（alignment.yaml + manifest.yaml）
- `packages/engine/scripts/devgate/check-superpowers-alignment.cjs` (484 行)
- `packages/engine/scripts/sync-from-upstream.sh`
- `packages/engine/scripts/generate-alignment-table.sh`
- `docs/superpowers-alignment-table.md`
- `packages/engine/skills/dev/steps/01-spec.md` + `02-code.md`（重复 Superpowers 流程）
- `.github/workflows/ci.yml` 的 Superpowers Alignment Gate step

**修改**：
- `SKILL.md` 极简重写：主 agent 按 Step 0/0.5/0.7 准备后调 `/superpowers:brainstorming` 启动接力链
- `scripts/devgate/check-engine-hygiene.cjs` Check 2 反转：`no-external-superpowers-ref` → `no-dangling-prompt-ref`
- `scripts/devgate/README.md` 重写反映 Phase 4 状态
- `feature-registry.yml` 新增 14.17.11 条目
- bump 14.17.10 → 14.17.11

## 根本原因

**深度调研**（Explore subagent）揭示：

1. **Superpowers 没有协调器**。每个 skill 的 SKILL.md prompt 末尾明确指示下一步调什么 skill：
   - `brainstorming:66` "The ONLY skill you invoke after brainstorming is writing-plans"
   - `executing-plans:36` "REQUIRED SUB-SKILL: finishing-a-development-branch"
   - ...

2. **Claude Code 主 agent 就是协调者**。它读 SKILL.md 按 prompt 接力调下一个 skill，runtime **按需动态加载**对应 prompt。Context 一直保持精简聚焦。

3. **之前 PR #2406 的本地复刻架构是错的**。我把 Superpowers 21 个 prompt 复刻到本地，然后 /dev 的 steps/01-spec.md / 02-code.md 内嵌引用 —— 等于让主 agent **一次性加载所有 step 内容**，违背 Superpowers "skill 接力按需加载" 设计。

4. **今天建的 alignment.yaml + DevGate + sync-from-upstream + 对照表，都在解决一个本不该存在的问题**：维护"本地复刻一致性"。如果不复刻，就没有这个问题。

## 架构前后对比

### 之前（错误架构）
```
/dev 启动
  ↓ 主 agent Read SKILL.md
  ↓ Read autonomous-research-proxy.md
  ↓ Read 00/00.5/00.7/01/02/03/04 全部 step
  ↓ 引用的本地 prompts/ 21 文件（逻辑上 context 里都是可引用的）
  ↓ Context 一上来就爆炸
  ↓ 做 Stage 1 时 04-ship 内容也在 context 里污染
```

### 现在（正确架构）
```
/dev 启动
  ↓ 主 agent Read SKILL.md（极简版）
  ↓ Read autonomous-research-proxy.md
  ↓ Step 0: cat 00-worktree-auto.md → 做 worktree
  ↓ Step 0.5: cat 00.5-enrich.md → 做 enrich
  ↓ Step 0.7: cat 00.7-decision-query.md → 查 decisions
  ↓ /superpowers:brainstorming ← runtime 动态注入
  ↓   遇到 HARD-GATE → autonomous-research-proxy Tier 1 派 Research Subagent
  ↓   brainstorming prompt 结尾指令"调 writing-plans"
  ↓ /superpowers:writing-plans ← runtime 注入（brainstorming 可退出 context）
  ↓ /superpowers:subagent-driven-development
  ↓ /superpowers:finishing-a-development-branch
  ↓ Stage 3: cat 03-integrate.md → push + PR
  ↓ Stage 4: cat 04-ship.md → Learning + 合并
  ↓ Stop Hook 兜底
```

每一步 context 只有当前需要的，**不污染**。

## Engine 真正的三类价值（全部保留）

1. **人机交互替代** — `autonomous-research-proxy.md`
   - Superpowers 10+ 交互点 → Research Subagent 代答
   - 这是 Alex 从第一天就说的"唯一应该做的事"

2. **Engine 独有步骤**（Superpowers 不管）
   - Step 0: worktree 管理（`worktree-manage.sh` 自造）
   - Step 0.5: PRD Enrich（粗 PRD 丰满）
   - Step 0.7: Decision Query（Brain 决策注入）
   - Stage 3: push + PR 自动化
   - Stage 4: Learning 写入 + 自动合并

3. **兜底机制**
   - Stop Hook (`devloop-check.sh`) — PR 未合并循环 exit 2
   - `orphan-pr-worker.js` — Brain tick 30min 扫孤儿 PR
   - `branch-protect` / `credential-guard` / `bash-guard` hooks

## 下次预防

- [ ] **禁止再建"Superpowers 本地复刻"**：任何"为防 upstream 挂了本地有备份"的冲动要三思 — Claude Code 插件机制本身就可靠，我们不是 SaaS 需要 100% uptime
- [ ] **禁止再建 "/dev 协调器"**：Superpowers 自带 skill 接力机制，我们不重新发明协调器
- [ ] **Engine 改动必须问："这是 Engine 独有吗？还是 Superpowers 已经做了？"**：如果是后者，不做
- [ ] **"升级同步"基础设施没必要**：Claude Code runtime 自动拉 Superpowers 新版，我们什么都不做
- [ ] **Superpowers upstream 升级的唯一风险**：breaking change。但这不是靠本地复刻防的，是靠 review upstream changelog 防的。如果真担心，锁定 Superpowers 版本（~/.claude-account1/plugins/<ver>）即可

## 涉及文件

**删除（25+ 个）**：
- `packages/engine/skills/dev/prompts/` 整个目录（11 子目录 / 21 md）
- `packages/engine/contracts/` 整个目录（2 yaml）
- `packages/engine/scripts/devgate/check-superpowers-alignment.cjs`
- `packages/engine/scripts/sync-from-upstream.sh`
- `packages/engine/scripts/generate-alignment-table.sh`
- `docs/superpowers-alignment-table.md`
- `packages/engine/skills/dev/steps/01-spec.md`
- `packages/engine/skills/dev/steps/02-code.md`

**修改**：
- `packages/engine/skills/dev/SKILL.md`（极简重写 142 → ~150 行但结构完全不同）
- `packages/engine/scripts/devgate/check-engine-hygiene.cjs`（Check 2 反转 + header 说明更新）
- `packages/engine/scripts/devgate/README.md`（重写反映 Phase 4）
- `.github/workflows/ci.yml`（删 Superpowers Alignment Gate step）
- `packages/engine/feature-registry.yml`（14.17.11 条目）
- 6 处版本号 bump 14.17.10 → 14.17.11

## 今天 + 昨天的完整演进（反省版）

| PR | 版本 | 类型 | 今天看回头 |
|---|---|---|---|
| #2406 | 14.17.5 | L1 对齐 | 🔴 本地复刻架构错 → Phase 4 回收 |
| #2408 | 14.17.6 | L2 加固 | ✅ Phase 3 已回滚 |
| #2410 | 14.17.7 | orphan worker | ✅ 真价值保留 |
| #2411 | 14.17.8 | 删 Standard | ✅ 真价值保留 |
| #2414 | 14.17.9 | 回滚 L2 + sync 脚本 | 🟡 回滚 L2 对；sync 脚本 Phase 4 回收 |
| #2415 | — | CI 优化 + autonomous 首跑 | ✅ 真价值保留 |
| #2417 | 14.17.10 | 对照表 | 🔴 Phase 4 回收（本地复刻的产物） |
| **#phase4** | **14.17.11** | **Engine 瘦身** | **真正到位** |

**5 个 PR 的架构工作真正有价值**：#2410 / #2411 / #2415 + Phase 3 回滚部分 + Phase 4。其他都是在"维护不该存在的复刻层"。

## 架构哲学（最终版）

> **Engine = Superpowers 自动化适配层 + Cecelia 独有前后端点 + 兜底。**
>
> **只加三类东西**：
> 1. 人机交互替代（autonomous-research-proxy.md）
> 2. Engine 独有步骤（worktree / enrich / decision / integrate / ship）
> 3. 兜底（Stop Hook / orphan-pr-worker / hooks）
>
> **不做**：
> - 复刻 Superpowers prompt 内容
> - 自建"协调器"
> - 自创"加强"层
> - 维护本地副本同步基础设施
